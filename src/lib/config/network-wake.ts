/** Detail-page Wake button for a tracked network device. `{{wakeDevice}}` is
 *  substituted on apply, like the Samsung remote's device id. */
export const NETWORK_WAKE_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  :root { --text: #ddd; --muted: #999; --border: #444; --primary: #4a9eff; --surface: #222; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 8px; font: 13px/1.4 system-ui, sans-serif; color: var(--text); background: transparent; }
  .row { display: flex; gap: 8px; align-items: center; }
  button { font: inherit; color: #fff; background: var(--primary); border: 0; border-radius: 6px; padding: 6px 10px; cursor: pointer; }
  button:disabled { opacity: .5; cursor: default; }
  .note { color: var(--muted); font-size: 11px; margin-top: 6px; }
  .error { color: #e55353; }
</style>
</head>
<body>
  <div class="row">
    <button id="wake" type="button">Wake</button>
    <span id="state" class="note"></span>
  </div>
  <div id="message" class="note"></div>
  <script>
    const id = "{{wakeDevice}}";
    const wake = document.getElementById("wake");
    const message = document.getElementById("message");
    if (!id) {
      wake.disabled = true;
      message.textContent = "Apply the bundle with the network device id.";
    }
    wake.addEventListener("click", async () => {
      if (!id) return;
      wake.disabled = true;
      message.className = "note";
      message.textContent = "Sending…";
      try {
        await ihome.call("network.info", { id, wake: true });
        message.textContent = "Wake packet sent.";
      } catch (error) {
        message.className = "note error";
        message.textContent =
          "Wake failed: " + (error && error.message ? error.message : error);
      } finally {
        setTimeout(() => (wake.disabled = false), 3000);
      }
    });
  </script>
</body>
</html>`;
