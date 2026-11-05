/*
 * Bizfy Voice AI website widget. Put this on a page:
 *   <script src="https://YOUR-APP/widget.js" data-key="wk_..." async></script>
 * Optional: data-label="Talk to us", data-color="#2563eb", data-position="left"
 * The page must be on a site listed in the widget's settings. The call itself runs in a small frame hosted by the app.
 */
(function () {
  var script = document.currentScript;
  if (!script || window.__voiceaiWidget) return;
  window.__voiceaiWidget = true;
  var key = script.getAttribute("data-key") || "";
  var base = new URL(script.src).origin;
  var label = script.getAttribute("data-label") || "Talk to us";
  var color = /^#[0-9a-fA-F]{6}$/.test(script.getAttribute("data-color") || "") ? script.getAttribute("data-color") : "#2563eb";
  var side = script.getAttribute("data-position") === "left" ? "left" : "right";

  var button = document.createElement("button");
  button.type = "button";
  button.textContent = "🎙 " + label;
  button.setAttribute("aria-label", label);
  button.style.cssText = "position:fixed;bottom:20px;" + side + ":20px;z-index:2147483000;border:0;border-radius:999px;padding:12px 18px;font:600 15px system-ui,sans-serif;color:#fff;background:" + color + ";box-shadow:0 6px 20px rgba(0,0,0,.25);cursor:pointer";
  var frame = null;
  function close() { if (frame) { frame.remove(); frame = null; } button.textContent = "🎙 " + label; }

  button.onclick = function () {
    if (frame) return close();
    frame = document.createElement("iframe");
    frame.src = base + "/widget/frame?o=" + encodeURIComponent(location.origin);
    frame.allow = "microphone";
    frame.title = label;
    frame.style.cssText = "position:fixed;bottom:76px;" + side + ":20px;z-index:2147483000;width:340px;height:380px;max-width:calc(100vw - 40px);border:0;border-radius:16px;box-shadow:0 10px 40px rgba(0,0,0,.35);background:#0d1426";
    document.body.appendChild(frame);
    button.textContent = "✕ Close";
  }
  function giveToken() {
    // The pass is requested from THIS page, so the server sees this site's address and can check it against the widget's list.
    fetch(base + "/api/widget/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: key }) })
      .then(function (r) { return r.ok ? r.json() : r.json().catch(function () { return {}; }).then(function (b) { throw new Error(r.status === 403 ? "This site is not allowed to use the widget." : b.error === "rate_limited" ? "Too many tries. Wait a minute." : "The widget is not available."); }); })
      .then(function (s) { frame && frame.contentWindow.postMessage({ type: "voiceai-start", token: s.token, url: s.url, language: s.language, voice: s.voice }, base); })
      .catch(function (e) { frame && frame.contentWindow.postMessage({ type: "voiceai-error", message: e.message }, base); });
  }
  window.addEventListener("message", function (e) {
    if (e.origin !== base || !e.data) return;
    if (e.data.type === "voiceai-close") close();
    else if (e.data.type === "voiceai-ready" && frame && e.source === frame.contentWindow) giveToken();
  });
  document.body.appendChild(button);
})();
