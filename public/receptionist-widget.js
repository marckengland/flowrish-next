(function () {
  'use strict';
  const script = document.currentScript;
  const publicId = script && script.getAttribute('data-flowrish-receptionist');
  if (!publicId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(publicId)) return;
  let baseOrigin;
  try { baseOrigin = new URL(script.src).origin; } catch { return; }
  if (!baseOrigin.startsWith('https://') || location.origin === 'null') return;

  const launcher = document.createElement('button');
  launcher.type = 'button';
  launcher.textContent = 'Chat with us';
  launcher.setAttribute('aria-expanded', 'false');
  launcher.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483646;min-height:48px;padding:12px 20px;border:1px solid #176049;border-radius:24px;background:#176049;color:white;font:600 16px system-ui,sans-serif;cursor:pointer;box-shadow:0 4px 16px #0002';
  let panel;
  let iframe;
  let close;

  window.addEventListener('message', function (event) {
    if (!iframe || event.source !== iframe.contentWindow || event.origin !== baseOrigin || event.data?.type !== 'flowrish-receptionist:ready') return;
    iframe.contentWindow.postMessage({ type: 'flowrish-receptionist:init' }, baseOrigin);
  });

  function hide() {
    panel.hidden = true;
    panel.style.display = 'none';
    launcher.hidden = false;
    launcher.setAttribute('aria-expanded', 'false');
    launcher.focus();
  }

  launcher.addEventListener('click', function () {
    if (!panel) {
      panel = document.createElement('div');
      panel.setAttribute('role', 'region');
      panel.setAttribute('aria-label', 'Business chat');
      panel.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:2147483647;width:min(380px,calc(100vw - 24px));height:min(680px,calc(100dvh - 24px));background:white;border:1px solid #b9c8c1;border-radius:12px;box-shadow:0 8px 36px #0003;overflow:hidden;display:flex;flex-direction:column';
      close = document.createElement('button');
      close.type = 'button';
      close.textContent = 'Close chat';
      close.style.cssText = 'flex:none;align-self:flex-end;margin:4px 8px;min-height:44px;padding:8px 12px;border:0;background:white;color:#176049;font:600 15px system-ui,sans-serif;cursor:pointer';
      close.addEventListener('click', hide);
      panel.append(close);
      iframe = document.createElement('iframe');
      iframe.title = 'Business website assistant';
      iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
      iframe.referrerPolicy = 'no-referrer';
      iframe.style.cssText = 'width:100%;flex:1;min-height:0;border:0;background:white';
      iframe.src = `${baseOrigin}/api/public/website-receptionist/${publicId}/embed?origin=${encodeURIComponent(location.origin)}`;
      panel.append(iframe);
      document.body.append(panel);
    }
    panel.hidden = false;
    // Inline display is set for layout, so explicitly restore it when reopening.
    panel.style.display = 'flex';
    launcher.hidden = true;
    launcher.setAttribute('aria-expanded', 'true');
    close.focus();
  });
  if (document.body) document.body.append(launcher);
  else document.addEventListener('DOMContentLoaded', function () { document.body.append(launcher); }, { once: true });
})();
