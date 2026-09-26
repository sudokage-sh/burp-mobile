(function () {
  if (window.__burpMobileContent) return;
  window.__burpMobileContent = true;

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.source !== "burp-mobile-hook") return;

    if (msg.type === "LOG") {
      chrome.runtime.sendMessage({ type: "LOG_REQUEST", data: msg.data }).catch(function(){});
    }
  });

  function requestInject() {
    chrome.runtime.sendMessage({ type: "INJECT_HOOKS" }).catch(function(){});
  }
  requestInject();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", requestInject);
  else setTimeout(requestInject, 30);
})();
