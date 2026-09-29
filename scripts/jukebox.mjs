import { MODULE_ID, EVENT, log } from "./constants.mjs";
import { YouTubeProvider, parseVideoId, fetchTitle, searchYouTube } from "./youtube.mjs";
import { JukeboxApp } from "./app.mjs";
import { refreshSidebar } from "./sidebar.mjs";

const BLANK = { videoId: null, title: "", playing: false, position: 0, loopMode: "off", playlistId: null, index: -1 };

export class Jukebox {
  state = { ...BLANK };
  previewState = { videoId: null, title: "" };
  blocked = false;
  app = null;
  searchState = { query: "", results: [], loading: false, error: null, target: null };
  #receivedAt = Date.now();

  get volume() { return game.settings.get(MODULE_ID, "volume"); }
  get apiKey() { return (game.settings.get(MODULE_ID, "apiKey") ?? "").trim(); }
  get playlists() { return game.settings.get(MODULE_ID, "playlists"); }

  ready = false;
  #gotState = false;

  async init() {
    game.socket.on(EVENT, (data, senderId) => this.#onSocket(data, senderId));
    this.#requestState();
    this.main = new YouTubeProvider({
      onEnded: () => this.#onMainEnded(),
      onBlocked: () => this.#onBlocked(),
      onPlaying: () => { if (this.blocked) { this.blocked = false; this.refresh(); } }
    });
    await this.main.init();
    this.main.setVolume(this.volume);

    if (game.user.isGM) {
      this.previewPlayer = new YouTubeProvider({
        onEnded: () => { this.previewState = { videoId: null, title: "" }; this.refresh(); }
      });
      await this.previewPlayer.init();
      this.previewPlayer.setVolume(this.volume);
    }

    this.ready = true;
    if (this.state.videoId) this.#apply({ ...this.state, position: this.currentPosition() });
    this.refresh();
    log("Jukebox prêt");
  }

  /** Un joueur redemande l'état au MJ toutes les 3 s jusqu'à l'avoir reçu (le MJ peut se connecter après lui). */
  #requestState() {
    if (game.user.isGM) return;
    let tries = 0;
    const tick = () => {
      if (this.#gotState || ++tries > 20) return;
      game.socket.emit(EVENT, { type: "requestState", sender: game.user.id });
      setTimeout(tick, 3000);
    };
    tick();
  }

  /* ---------------- UI ---------------- */
  toggleApp() {
    this.app ??= new JukeboxApp();
    this.app.rendered ? this.app.close() : this.app.render({ force: true });
  }
  openApp() {
    this.app ??= new JukeboxApp();
    this.app.render({ force: true });
  }
  refresh() {
    if (this.app?.rendered) this.app.render();
    refreshSidebar();
  }

  /* ---------------- Volume (personnel) ---------------- */
  setVolume(v) {
    game.settings.set(MODULE_ID, "volume", v);
    this.main.setVolume(v);
    this.previewPlayer?.setVolume(v);
    document.querySelectorAll(".syncjuke input[name=volume], .syncjuke-sidebar input[name=volume]")
      .forEach((el) => { if (Number(el.value) !== v) el.value = v; });
  }

  /* ---------------- Synchro ---------------- */
  /** Position estimée du morceau courant, en secondes. */
  currentPosition() {
    const s = this.state;
    if (!s.videoId) return 0;
    if (this.ready && this.main.videoId === s.videoId && this.main.isPlaying) return this.main.getTime();
    let pos = s.position + (s.playing ? (Date.now() - this.#receivedAt) / 1000 : 0);
    const d = this.main.getDuration();
    if (d > 0 && pos > d) pos = s.loopMode === "track" ? pos % d : d;
    return pos;
  }

  #apply(state) {
    this.state = state;
    this.#receivedAt = Date.now();
    if (!this.ready) return this.refresh();
    this.main.setLoop(state.loopMode === "track");
    if (!state.videoId) this.main.stop();
    else this.main.sync({ videoId: state.videoId, position: state.position + (state.playing ? 0.15 : 0), playing: state.playing });
    this.refresh();
  }

  #onSocket(data, senderId) {
    if (!data?.type) return;
    // Foundry ne transmet pas toujours l'expéditeur : on le lit dans le message.
    const id = typeof senderId === "string" ? senderId : data.sender;
    const sender = game.users.get(id);
    if (data.type === "state" && sender?.isGM) {
      this.#gotState = true;
      log(`état reçu : ${data.state.videoId ?? "aucun"}`);
      this.#apply(data.state);
    } else if (data.type === "requestState" && game.user.isGM && sender) {
      const state = { ...this.state, position: this.currentPosition() };
      game.socket.emit(EVENT, { type: "state", state, sender: game.user.id }, { recipients: [id] });
    }
  }

  #onBlocked() {
    if (!this.state.playing) return;
    this.blocked = true;
    ui.notifications.warn(game.i18n.localize("SYNCJUKE.Blocked"));
    this.refresh();
  }

  /** À appeler depuis un clic : le geste utilisateur débloque l'audio. */
  unlock() {
    this.blocked = false;
    this.main.sync({ videoId: this.state.videoId, position: this.currentPosition(), playing: this.state.playing });
    this.refresh();
  }

  /* ---------------- Diffusion (MJ) ---------------- */
  #broadcast(patch) {
    const state = { ...this.state, position: this.currentPosition(), ...patch };
    this.#apply(state);
    game.socket.emit(EVENT, { type: "state", state, sender: game.user.id });
  }

  play(playlistId, index) {
    const track = this.playlists.find((p) => p.id === playlistId)?.tracks[index];
    if (!track) return;
    this.stopPreview();
    this.#broadcast({ videoId: track.videoId, title: track.title, playing: true, position: 0, playlistId, index });
  }
  pause() { this.#broadcast({ playing: false }); }
  resume() { if (this.state.videoId) this.#broadcast({ playing: true }); }
  stop() { this.#broadcast({ ...BLANK, loopMode: this.state.loopMode }); }
  setLoopMode(loopMode) { this.#broadcast({ loopMode }); }

  step(dir, auto = false) {
    const pl = this.playlists.find((p) => p.id === this.state.playlistId);
    if (!pl?.tracks.length) return;
    let i = this.state.index + dir;
    if (i >= pl.tracks.length || i < 0) {
      if (auto && this.state.loopMode !== "playlist") return this.stop();
      i = (i + pl.tracks.length) % pl.tracks.length;
    }
    this.play(pl.id, i);
  }

  #onMainEnded() {
    if (!game.user.isGM) { this.state.playing = false; this.refresh(); return; }
    if (this.state.playlistId) this.step(1, true);
    else this.#broadcast({ playing: false, position: 0 });
  }

  /* ---------------- Pré-écoute (local MJ) ---------------- */
  startPreview(videoId, title) {
    if (!this.previewPlayer) return;
    this.previewState = { videoId, title };
    this.previewPlayer.setLoop(this.state.loopMode === "track");
    this.previewPlayer.sync({ videoId, position: 0, playing: true });
    this.refresh();
  }
  stopPreview() {
    if (!this.previewPlayer || !this.previewState.videoId) return;
    this.previewPlayer.stop();
    this.previewState = { videoId: null, title: "" };
    this.refresh();
  }

  /* ---------------- Playlists (MJ) ---------------- */
  async #save(list) {
    await game.settings.set(MODULE_ID, "playlists", list);
    this.refresh();
  }
  async addPlaylist(name) {
    if (!name?.trim()) return;
    const list = structuredClone(this.playlists);
    list.push({ id: foundry.utils.randomID(), name: name.trim(), tracks: [] });
    await this.#save(list);
  }
  async deletePlaylist(id) {
    if (this.state.playlistId === id) this.stop();
    await this.#save(this.playlists.filter((p) => p.id !== id));
  }
  /* ---------------- Recherche YouTube (MJ) ---------------- */
  async search(query) {
    query = query?.trim();
    if (!query) return;
    if (!this.apiKey) return ui.notifications.warn(game.i18n.localize("SYNCJUKE.NoApiKey"));
    this.searchState = { ...this.searchState, query, loading: true, error: null, results: [] };
    this.refresh();
    try {
      const results = await searchYouTube(query, this.apiKey);
      this.searchState.results = results;
      if (!results.length) this.searchState.error = game.i18n.localize("SYNCJUKE.NoResults");
    } catch (e) {
      this.searchState.error = e.message;
    }
    this.searchState.loading = false;
    this.refresh();
  }

  async addResult(r) {
    const list = structuredClone(this.playlists);
    const pl = list.find((p) => p.id === this.searchState.target) ?? list[0];
    if (!pl) return ui.notifications.warn(game.i18n.localize("SYNCJUKE.NoPlaylist"));
    pl.tracks.push({ videoId: r.videoId, title: r.title });
    await this.#save(list);
    ui.notifications.info(game.i18n.format("SYNCJUKE.Added", { title: r.title, playlist: pl.name }));
  }

  async addTrack(playlistId, input) {
    const videoId = parseVideoId(input);
    if (!videoId) return ui.notifications.error(game.i18n.localize("SYNCJUKE.InvalidUrl"));
    const title = await fetchTitle(videoId);
    const list = structuredClone(this.playlists);
    list.find((p) => p.id === playlistId)?.tracks.push({ videoId, title });
    await this.#save(list);
  }
  async removeTrack(playlistId, index) {
    const list = structuredClone(this.playlists);
    list.find((p) => p.id === playlistId)?.tracks.splice(index, 1);
    await this.#save(list);
  }
}
