import { MODULE_ID } from "./constants.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const j = () => game.syncjuke;
const L = (k) => game.i18n.localize(k);
const plId = (t) => t.closest("[data-playlist-id]")?.dataset.playlistId;
const idx = (t) => Number(t.closest("[data-index]")?.dataset.index);

const actions = {
  togglePlay() { j().state.playing ? j().pause() : j().resume(); },
  stop() { j().stop(); },
  next() { j().step(1); },
  prev() { j().step(-1); },
  unlock() { j().unlock(); },
  async addPlaylist() {
    const input = this.element.querySelector("input[name=newPlaylist]");
    await j().addPlaylist(input.value);
  },
  async deletePlaylist(event, target) {
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: L("SYNCJUKE.Delete") }, content: `<p>${L("SYNCJUKE.DeleteConfirm")}</p>`
    });
    if (ok) j().deletePlaylist(plId(target));
  },
  async addTrack(event, target) {
    const input = target.closest("[data-playlist-id]").querySelector("input[name=url]");
    await j().addTrack(plId(target), input.value);
  },
  removeTrack(event, target) { j().removeTrack(plId(target), idx(target)); },
  playTrack(event, target) { j().play(plId(target), idx(target)); },
  previewTrack(event, target) {
    const pl = j().playlists.find((p) => p.id === plId(target));
    const t = pl?.tracks[idx(target)];
    if (t) j().startPreview(t.videoId, t.title);
  },
  stopPreview() { j().stopPreview(); },
  async search() {
    await j().search(this.element.querySelector("input[name=query]").value);
  },
  previewResult(event, target) {
    const r = j().searchState.results[idx(target)];
    if (r) j().startPreview(r.videoId, r.title);
  },
  addResult(event, target) {
    const r = j().searchState.results[idx(target)];
    if (r) j().addResult(r);
  }
};

export class JukeboxApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "syncjuke",
    classes: ["syncjuke"],
    window: { title: "SYNCJUKE.Title", icon: "fa-solid fa-music", resizable: true },
    position: { width: 400, height: 660 },
    actions
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/jukebox.hbs`, scrollable: [".playlists"] }
  };

  async _prepareContext() {
    const jb = j();
    const s = jb.state;
    const loops = ["Off", "Track", "Playlist"].map((k) => ({
      value: k.toLowerCase(), label: L(`SYNCJUKE.Loop.${k}`), selected: s.loopMode === k.toLowerCase()
    }));
    const playlists = jb.playlists.map((p) => ({
      ...p,
      tracks: p.tracks.map((t, i) => ({ ...t, index: i, active: s.playlistId === p.id && s.index === i }))
    }));
    const target = jb.searchState.target ?? playlists[0]?.id;
    const playlistOptions = playlists.map((p) => ({ id: p.id, name: p.name, selected: p.id === target }));
    return {
      search: jb.searchState, hasApiKey: !!jb.apiKey, playlistOptions,
      isGM: game.user.isGM, volume: jb.volume, state: s, blocked: jb.blocked,
      loops, playlists, previewTitle: jb.previewState.videoId ? jb.previewState.title : null
    };
  }

  _onRender(context, options) {
    this.element.querySelector("input[name=volume]")
      ?.addEventListener("input", (e) => j().setVolume(Number(e.target.value)));
    this.element.querySelector("input[name=query]")
      ?.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); j().search(e.target.value); } });
    this.element.querySelector("select[name=searchTarget]")
      ?.addEventListener("change", (e) => { j().searchState.target = e.target.value; });
    this.element.querySelector("select[name=loopMode]")
      ?.addEventListener("change", (e) => j().setLoopMode(e.target.value));
  }

  async close(options) {
    await super.close(options);
    if (j().app === this) j().app = null;
  }
}
