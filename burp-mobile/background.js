const MAX_REQUESTS = 100;

let dnrRuleIdCounter = 1;

const FORBIDDEN_HEADER_NAMES = new Set([
  "cookie", "cookie2", "host", "origin", "referer", "referrer",
  "connection", "content-length", "transfer-encoding", "upgrade",
  "via", "te", "trailer", "keep-alive", "expect", "date", "dnt",
  "access-control-request-headers", "access-control-request-method"
]);

function isForbiddenHeaderName(name) {
  const n = String(name).toLowerCase();
  return FORBIDDEN_HEADER_NAMES.has(n) || n.startsWith("sec-") || n.startsWith("proxy-");
}

function escapeForRegexFilter(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function replayViaBackground(request) {
  const started = Date.now();
  const r = request || {};
  const method = String(r.method || "GET").toUpperCase();

  let target;
  try {
    target = new URL(r.url);
  } catch (e) {
    return { ok: false, error: `Invalid URL: ${r.url}`, elapsed: 0, url: r.url };
  }

  const fetchHeaders = {};
  const forcedHeaders = [];
  const seenForbidden = new Set();
  for (const [k, v] of Object.entries(r.headers || {})) {
    if (isForbiddenHeaderName(k)) {
      forcedHeaders.push({ header: k, operation: "set", value: String(v) });
      seenForbidden.add(k.toLowerCase());
    } else {
      fetchHeaders[k] = v;
    }
  }

  if (!seenForbidden.has("origin")) {
    forcedHeaders.push({ header: "Origin", operation: "set", value: target.origin });
  }
  if (!seenForbidden.has("referer") && !seenForbidden.has("referrer")) {
    forcedHeaders.push({ header: "Referer", operation: "set", value: target.origin + "/" });
  }

  const ruleId = dnrRuleIdCounter++;
  const hasForced = forcedHeaders.length > 0;

  if (hasForced) {
    try {
      await chrome.declarativeNetRequest.updateSessionRules({
        addRules: [{
          id: ruleId,
          priority: 1,
          condition: {
            regexFilter: `^${escapeForRegexFilter(target.href)}$`,
            resourceTypes: ["xmlhttprequest"]
          },
          action: { type: "modifyHeaders", requestHeaders: forcedHeaders }
        }]
      });
    } catch (e) {
      return {
        ok: false,
        error: `Could not install header-override rule: ${e.message || e}`,
        elapsed: Date.now() - started,
        url: target.href
      };
    }
  }

  try {
    const opts = {
      method,
      headers: fetchHeaders,
      credentials: "include",
      cache: "no-store"
    };
    if (r.body && !["GET", "HEAD"].includes(method)) opts.body = r.body;

    const response = await fetch(target.href, opts);
    const elapsed = Date.now() - started;
    const responseHeaders = {};
    response.headers.forEach((v, k) => { responseHeaders[k] = v; });

    let responseBody = "";
    try { responseBody = await response.clone().text(); } catch (e) { responseBody = `[body unreadable: ${e.message || e}]`; }

    let raw = `HTTP/1.1 ${response.status} ${response.statusText}\r\n`;
    for (const [k, v] of Object.entries(responseHeaders)) raw += `${k}: ${v}\r\n`;
    raw += `\r\n${responseBody.substring(0, 500000)}`;

    return {
      ok: true,
      status: response.status,
      statusText: response.statusText,
      elapsed,
      raw,
      responseHeaders,
      responseBody: responseBody.substring(0, 500000),
      url: target.href,
      overriddenHeaders: forcedHeaders.map(h => h.header)
    };
  } catch (err) {
    return {
      ok: false,
      error: String(err && err.message ? err.message : err),
      elapsed: Date.now() - started,
      url: target.href,
      hint: "Background-context fetch failed. Check that host_permissions covers this origin, and that the URL/method/body are valid - this is no longer a page-CORS error."
    };
  } finally {
    if (hasForced) {
      try { await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleId] }); } catch (e) {}
    }
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ requests: [] });
});

async function injectHooksIntoTab(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tabId, allFrames: true },
      files: ["content/page-hooks.js"],
      world: "MAIN",
      injectImmediately: true
    });
    console.log("[Burp Mobile] Hooks injected into tab", tabId);
  } catch (e) {

  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "INJECT_HOOKS") {
    if (sender.tab && sender.tab.id) {
      injectHooksIntoTab(sender.tab.id).then(() => sendResponse({ ok: true }));
      return true;
    }
    sendResponse({ ok: false });
  }

  if (message.type === "REPLAY_ON_PAGE") {
    replayViaBackground(message.request)
      .then(result => {
        chrome.runtime.sendMessage({ type: "REPLAY_RESULT", data: { id: message.id, ...result } }).catch(() => {});
      });
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "LOG_REQUEST") {
    chrome.storage.local.get(["requests"], (data) => {
      let requests = data.requests || [];
      const entry = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        tabId: sender.tab ? sender.tab.id : null,
        timestamp: Date.now(),
        ...message.data
      };
      requests.unshift(entry);
      if (requests.length > MAX_REQUESTS) requests = requests.slice(0, MAX_REQUESTS);

      chrome.storage.local.set({ requests }, () => {
        if (sender.tab && sender.tab.id) {
          const count = requests.filter(r => r.tabId === sender.tab.id).length;
          chrome.action.setBadgeText({
            tabId: sender.tab.id,
            text: count > 0 ? String(Math.min(count, 99)) : ""
          });
          chrome.action.setBadgeBackgroundColor({
            tabId: sender.tab.id,
            color: "#f97316"
          });
        }
        sendResponse({ ok: true, id: entry.id });
      });
    });
    return true;
  }

  if (message.type === "GET_REQUESTS") {
    chrome.storage.local.get(["requests"], (data) => {
      let list = data.requests || [];
      if (message.tabId) {
        list = list.filter(r => r.tabId === message.tabId);
      }
      sendResponse({ requests: list });
    });
    return true;
  }

  if (message.type === "CLEAR_REQUESTS") {
    chrome.storage.local.set({ requests: [] }, () => {
      if (message.tabId) {
        chrome.action.setBadgeText({ tabId: message.tabId, text: "" });
      }
      sendResponse({ ok: true });
    });
    return true;
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "loading" || changeInfo.status === "complete") {
    if (tab.url && (tab.url.startsWith("http://") || tab.url.startsWith("https://"))) {
      injectHooksIntoTab(tabId);
    }
  }
});
