document.addEventListener("DOMContentLoaded", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const currentTabId = tab?.id;

  const loggerTab = document.getElementById("loggerTab");
  const repeaterTab = document.getElementById("repeaterTab");
  const detailView = document.getElementById("detailView");
  const requestList = document.getElementById("requestList");
  const countLabel = document.getElementById("countLabel");
  const tabs = document.querySelectorAll(".tab");

  let currentRequests = [];
  let selectedRequest = null;

  tabs.forEach(t => {
    t.addEventListener("click", () => {
      tabs.forEach(x => x.classList.remove("active"));
      t.classList.add("active");
      document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
      document.getElementById(t.dataset.tab + "Tab").classList.add("active");
      detailView.classList.add("hidden");
    });
  });

  async function loadRequests() {
    try {
      const res = await chrome.runtime.sendMessage({ type: "GET_REQUESTS", tabId: currentTabId });
      currentRequests = res.requests || [];
    } catch (e) {
      currentRequests = [];
    }

    countLabel.textContent = currentRequests.length;

    if (currentRequests.length === 0) {
      requestList.innerHTML = `<div class="empty">No requests yet.<br>Browse any web site...</div>`;
      return;
    }

    requestList.innerHTML = currentRequests.map(r => {
      const statusClass = r.status >= 500 ? "s5" : r.status >= 400 ? "s4" : r.status >= 300 ? "s3" : "s2";
      const shortUrl = (r.url || "").length > 50 ? r.url.substring(0, 50) + "..." : (r.url || "");
      return `
        <div class="req-item" data-id="${r.id}">
          <div class="req-line1">
            <span class="method ${r.method || "GET"}">${r.method || "GET"}</span>
            <span class="status ${statusClass}">${r.status || "ERR"}</span>
            <span class="url" title="${escapeHtml(r.url)}">${escapeHtml(shortUrl)}</span>
          </div>
          <div class="req-meta">${r.duration || 0}ms • ${r.type || "req"}</div>
        </div>
      `;
    }).join("");

    document.querySelectorAll(".req-item").forEach(item => {
      item.addEventListener("click", () => {
        const id = item.dataset.id;
        selectedRequest = currentRequests.find(r => r.id === id);
        if (selectedRequest) showDetail(selectedRequest);
      });
    });
  }

  function buildRawRequest(r) {
    try {
      let absoluteUrl = r.url || "";

      if (absoluteUrl && !absoluteUrl.startsWith("http")) {
        absoluteUrl = "https://" + absoluteUrl.replace(/^\/\//, "");
      }

      const u = new URL(absoluteUrl);
      const path = u.pathname + (u.search || "");
      let raw = `${r.method || "GET"} ${path} HTTP/1.1\r\n`;
      raw += `Host: ${u.host}\r\n`;

      const headers = r.requestHeaders || {};
      let hasContentType = false;
      for (const [k, v] of Object.entries(headers)) {
        if (k.toLowerCase() === "host") continue;
        if (k.toLowerCase() === "content-type") hasContentType = true;
        raw += `${k}: ${v}\r\n`;
      }

      if (r.requestBody && !hasContentType) {
        const bodyTrim = (r.requestBody || "").trim();
        if (bodyTrim.startsWith("{") || bodyTrim.startsWith("[")) {
          raw += `Content-Type: application/json\r\n`;
        }
      }

      raw += `\r\n`;
      if (r.requestBody) raw += r.requestBody;
      return raw;
    } catch (e) {

      let raw = `${r.method || "GET"} ${r.url || "/"} HTTP/1.1\r\n`;
      raw += `Host: unknown\r\n\r\n`;
      if (r.requestBody) raw += r.requestBody;
      return raw;
    }
  }

  function buildRawResponse(r) {
    let raw = `HTTP/1.1 ${r.status || 0}\r\n`;
    const headers = r.responseHeaders || {};
    for (const [k, v] of Object.entries(headers)) {
      raw += `${k}: ${v}\r\n`;
    }
    raw += `\r\n`;
    raw += r.responseBody || "";
    return raw;
  }

  function showDetail(r) {
    detailView.classList.remove("hidden");
    document.getElementById("detailMeta").textContent =
      `${r.method} ${r.url}  →  ${r.status} (${r.duration || 0}ms)`;

    document.getElementById("reqRaw").value = buildRawRequest(r);
    document.getElementById("respRaw").value = buildRawResponse(r);
  }

  document.getElementById("backBtn").addEventListener("click", () => {
    detailView.classList.add("hidden");
  });

  document.getElementById("sendToRepeaterBtn").addEventListener("click", () => {
    if (!selectedRequest) return;
    const raw = buildRawRequest(selectedRequest);
    document.getElementById("repRaw").value = raw;
    document.getElementById("repResult").classList.add("hidden");

    tabs.forEach(x => x.classList.remove("active"));
    document.querySelector('.tab[data-tab="repeater"]').classList.add("active");
    document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
    repeaterTab.classList.add("active");
    detailView.classList.add("hidden");
  });

  const pendingRepeats = new Map();

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || message.type !== "REPLAY_RESULT") return;
    const data = message.data || {};
    const pending = pendingRepeats.get(data.id);
    if (!pending) return;
    pendingRepeats.delete(data.id);

    const { statusEl, respRawEl } = pending;
    if (data.ok) {
      statusEl.textContent = `${data.status} (${data.elapsed}ms)`;
      statusEl.style.color = data.status >= 400 ? "#f87171" : "#4ade80";
      let raw = data.raw || "";
      if (data.overriddenHeaders && data.overriddenHeaders.length) {
        raw = `// header override active (sent as-typed): ${data.overriddenHeaders.join(", ")}\n${raw}`;
      }
      respRawEl.value = raw;
    } else {
      statusEl.textContent = "Error";
      statusEl.style.color = "#f87171";
      respRawEl.value = data.error || "Unknown error";
    }
  });

  document.getElementById("sendBtn").addEventListener("click", async () => {
    const raw = document.getElementById("repRaw").value.trim();
    if (!raw) { alert("Request is empty"); return; }

    const parsed = parseRawRequest(raw);
    if (!parsed) {
      alert("Parse error.\nFirst line must be: METHOD /path HTTP/1.1\nAnd Host: header is required (or full URL).");
      return;
    }

    const resultBox = document.getElementById("repResult");
    const statusEl = document.getElementById("repStatus");
    const respRawEl = document.getElementById("repRespRaw");
    resultBox.classList.remove("hidden");
    statusEl.textContent = "Sending...";
    statusEl.style.color = "#94a3b8";
    respRawEl.value = "";

    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    pendingRepeats.set(id, { statusEl, respRawEl });

    try {
      const res = await chrome.runtime.sendMessage({
        type: "REPLAY_ON_PAGE",
        tabId: currentTabId,
        id,
        request: parsed
      });
      if (!res || !res.ok) {
        pendingRepeats.delete(id);
        statusEl.textContent = "Error";
        statusEl.style.color = "#f87171";
        respRawEl.value = res?.error || "Could not reach active page.";
      }
    } catch (err) {
      pendingRepeats.delete(id);
      statusEl.textContent = "Error";
      statusEl.style.color = "#f87171";
      respRawEl.value = String(err);
    }
  });

  function parseRawRequest(raw) {
    try {
      const lines = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
      const first = lines[0].trim();
      const m = first.match(/^(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s+(\S+)/i);
      if (!m) return null;

      const method = m[1].toUpperCase();
      let pathOrUrl = m[2];

      const headers = {};
      let i = 1;
      for (; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim() === "") {
          i++;
          break;
        }
        const idx = line.indexOf(":");
        if (idx > 0) {
          const key = line.slice(0, idx).trim();
          const val = line.slice(idx + 1).trim();
          headers[key] = val;
        }
      }

      const body = lines.slice(i).join("\n");

      let url;
      if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) {
        url = pathOrUrl;
      } else {
        let host = headers["Host"] || headers["host"];
        if (!host) {
        
          return null;
        }
        const protocol = (host.includes("localhost") || host.startsWith("127.") || host.startsWith("192.168.")) ? "http" : "https";
        url = protocol + "://" + host + (pathOrUrl.startsWith("/") ? pathOrUrl : "/" + pathOrUrl);
      }

      return { method, url, headers, body };
    } catch (e) {
      return null;
    }
  }

  async function copyTextFrom(id, button) {
    const el = document.getElementById(id);
    if (!el) return;
    const value = "value" in el ? el.value : el.textContent;
    try {
      await navigator.clipboard.writeText(value || "");
    } catch (e) {
      el.focus();
      if (typeof el.select === "function") el.select();
      try { document.execCommand("copy"); } catch (_) {}
    }
    const old = button.textContent;
    button.textContent = "Copied";
    setTimeout(() => { button.textContent = old; }, 900);
  }

  document.querySelectorAll(".copy-btn").forEach(btn => {
    btn.addEventListener("click", () => copyTextFrom(btn.dataset.copy, btn));
  });

  document.getElementById("refreshBtn").addEventListener("click", loadRequests);
  document.getElementById("clearBtn").addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: "CLEAR_REQUESTS", tabId: currentTabId });
    loadRequests();
  });

  function escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  const repRaw = document.getElementById("repRaw");
  if (repRaw) {
    repRaw.style.webkitUserSelect = "text";
    repRaw.style.userSelect = "text";
  }

  loadRequests();
  setInterval(loadRequests, 2000);
});
