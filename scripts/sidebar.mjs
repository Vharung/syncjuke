const L = (k) => game.i18n.localize(k);
const j = () => game.syncjuke;

function build(box) {
  const jb = j();
  if (!jb) return;
  const gm = game.user.isGM;
  box.innerHTML = `
    <div class="mini-title"><i class="fa-solid fa-music"></i> <span class="t"></span></div>
    ${jb.blocked ? `<button type="button" class="unlock" data-mini="unlock"><i class="fa-solid fa-volume-high"></i> ${L("SYNCJUKE.Unlock")}</button>` : ""}
    <div class="mini-controls">
      ${gm ? `
        <button type="button" data-mini="prev"><i class="fa-solid fa-backward-step"></i></button>
        <button type="button" data-mini="toggle"><i class="fa-solid ${jb.state.playing ? "fa-pause" : "fa-play"}"></i></button>
        <button type="button" data-mini="stop"><i class="fa-solid fa-stop"></i></button>
        <button type="button" data-mini="next"><i class="fa-solid fa-forward-step"></i></button>` : ""}
      <input type="range" name="volume" min="0" max="100" step="1" value="${jb.volume}" data-tooltip="SYNCJUKE.Volume">
      ${gm ? `<button type="button" data-mini="open" data-tooltip="SYNCJUKE.OpenJukebox"><i class="fa-solid fa-sliders"></i></button>` : ""}
    </div>`;
  box.querySelector(".t").textContent = jb.state.videoId ? jb.state.title : L("SYNCJUKE.Nothing");
}

export function refreshSidebar() {
  document.querySelectorAll(".syncjuke-sidebar").forEach(build);
}

export function injectSidebar(app, html) {
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root) return;
  root.querySelector(".syncjuke-sidebar")?.remove();

  const box = document.createElement("section");
  box.className = "syncjuke-sidebar";
  box.addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-mini]");
    const jb = j();
    if (!btn || !jb) return;
    switch (btn.dataset.mini) {
      case "toggle": jb.state.playing ? jb.pause() : jb.resume(); break;
      case "stop": jb.stop(); break;
      case "next": jb.step(1); break;
      case "prev": jb.step(-1); break;
      case "unlock": jb.unlock(); break;
      case "open": jb.openApp(); break;
    }
  });
  box.addEventListener("input", (ev) => {
    if (ev.target.name === "volume") j()?.setVolume(Number(ev.target.value));
  });

  const header = root.querySelector("header.directory-header") ?? root.querySelector(".directory-header");
  header ? header.after(box) : root.prepend(box);
  build(box);
}
