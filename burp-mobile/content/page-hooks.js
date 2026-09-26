(function () {
  if (window.__burpMobileHooksInstalled) return;
  window.__burpMobileHooksInstalled = true;

  function send(type, data) {
    try {
      window.postMessage({ source: "burp-mobile-hook", type, data }, "*");
    } catch (e) {}
  }

  function sendLog(data) { send("LOG", data); }

  function toAbsoluteUrl(url) {
    try { return new URL(url, location.href).href; } catch (e) { return url; }
  }

  function headersToObject(headers) {
    const out = {};
    if (!headers) return out;
    try {
      if (headers instanceof Headers) headers.forEach((v, k) => { out[k] = v; });
      else if (typeof headers === "object") Object.keys(headers).forEach(k => { out[k] = headers[k]; });
    } catch (e) {}
    return out;
  }

  const _fetch = window.fetch;
  window.fetch = async function (...args) {
    const start = performance.now();
    let url = "", method = "GET", reqHeaders = {}, reqBody = null, credentials = "same-origin";

    try {
      if (typeof args[0] === "string" || args[0] instanceof URL) {
        url = toAbsoluteUrl(String(args[0]));
        if (args[1]) {
          method = (args[1].method || "GET").toUpperCase();
          reqHeaders = headersToObject(args[1].headers);
          credentials = args[1].credentials || "same-origin";
          if (args[1].body != null) reqBody = typeof args[1].body === "string" ? args[1].body : String(args[1].body);
        }
      } else if (args[0] && typeof args[0] === "object") {
        const req = args[0];
        url = toAbsoluteUrl(req.url || "");
        method = (req.method || "GET").toUpperCase();
        credentials = req.credentials || "same-origin";
        reqHeaders = headersToObject(req.headers);
        try { if (req.clone) reqBody = await req.clone().text(); } catch (e) {}
      }
    } catch (e) {}

    if (!url) url = location.href;

    try {
      const response = await _fetch.apply(this, args);
      const duration = Math.round(performance.now() - start);
      const respHeaders = {};
      try { response.headers.forEach((v, k) => { respHeaders[k] = v; }); } catch (e) {}
      let respBody = "";
      try { respBody = await response.clone().text(); } catch (e) { respBody = "[body unreadable]"; }

      sendLog({ method, url, requestHeaders: reqHeaders, requestBody: reqBody,
        credentials, status: response.status, responseHeaders: respHeaders,
        responseBody: (respBody || "").substring(0, 400000), duration, type: "fetch" });
      return response;
    } catch (err) {
      sendLog({ method, url, requestHeaders: reqHeaders, requestBody: reqBody,
        credentials, status: 0, responseHeaders: {}, responseBody: String(err),
        duration: Math.round(performance.now() - start), type: "fetch", error: true });
      throw err;
    }
  };

  
  const OriginalXHR = window.XMLHttpRequest;
  function HookedXHR() {
    const xhr = new OriginalXHR();
    let method = "GET", url = "", reqHeaders = {}, reqBody = null;
    const startTime = performance.now();

    const _open = xhr.open;
    xhr.open = function (m, u) {
      method = (m || "GET").toUpperCase();
      url = toAbsoluteUrl(u);
      return _open.apply(xhr, arguments);
    };
    const _setRequestHeader = xhr.setRequestHeader;
    xhr.setRequestHeader = function (k, v) {
      reqHeaders[k] = v;
      return _setRequestHeader.apply(xhr, arguments);
    };
    const _send = xhr.send;
    xhr.send = function (body) {
      reqBody = body != null ? String(body) : null;
      xhr.addEventListener("loadend", function () {
        const respHeaders = {};
        try {
          const raw = xhr.getAllResponseHeaders() || "";
          raw.trim().split(/[\r\n]+/).forEach(line => {
            const parts = line.split(": ");
            if (parts.length >= 2) respHeaders[parts.shift()] = parts.join(": ");
          });
        } catch (e) {}
        sendLog({ method, url: url || location.href, requestHeaders: reqHeaders,
          requestBody: reqBody, credentials: "same-origin", status: xhr.status,
          responseHeaders: respHeaders, responseBody: (xhr.responseText || "").substring(0, 400000),
          duration: Math.round(performance.now() - startTime), type: "xhr" });
      });
      return _send.apply(xhr, arguments);
    };
    return xhr;
  }
  HookedXHR.prototype = OriginalXHR.prototype;
  try { Object.keys(OriginalXHR).forEach(k => { try { HookedXHR[k] = OriginalXHR[k]; } catch (e) {} }); } catch (e) {}
  window.XMLHttpRequest = HookedXHR;

  console.log("%c[Burp Mobile] Hooks ACTIVE", "color:#f97316;font-weight:bold");
})();
