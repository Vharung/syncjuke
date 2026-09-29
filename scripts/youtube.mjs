import { log } from "./constants.mjs";

let apiPromise = null;

function loadApi() {
  if (window.YT?.Player) return Promise.resolve();
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); log("API YouTube chargée"); resolve(); };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    document.head.append(s);
  });
  return apiPromise;
}

/** Lance le chargement de l'API YouTube le plus tôt possible. */
export function preloadApi() { return loadApi(); }

/** Extrait l'ID d'une vidéo depuis un lien ou un ID brut. */
export function parseVideoId(input) {
  const str = String(input ?? "").trim();
  const m = str.match(/(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/|\/live\/)([\w-]{11})/);
  if (m) return m[1];
  return /^[\w-]{11}$/.test(str) ? str : null;
}

export async function fetchTitle(videoId) {
  try {
    const url = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
    const res = await fetch(url);
    if (res.ok) return (await res.json()).title;
  } catch (e) { /* on retombe sur l'ID */ }
  return `YouTube ${videoId}`;
}

/**
 * Enveloppe autour du lecteur IFrame YouTube.
 * Point d'extension : un futur SpotifyProvider exposera la même interface
 * (init, sync, pause, stop, setVolume, setLoop, getTime, getDuration, isPlaying).
 */
export class YouTubeProvider {
  videoId = null;
  loop = false;
  #wantPlaying = false;
  #timer = null;

  constructor({ onEnded, onBlocked, onPlaying } = {}) {
    this.onEnded = onEnded;
    this.onBlocked = onBlocked;
    this.onPlaying = onPlaying;
  }

  async init() {
    await loadApi();
    const host = document.createElement("div");
    host.className = "syncjuke-player-host";
    const target = document.createElement("div");
    host.append(target);
    document.body.append(host);
    await new Promise((resolve) => {
      this.player = new YT.Player(target, {
        width: "200", height: "113",
        playerVars: { playsinline: 1, controls: 0, disablekb: 1, origin: location.origin },
        events: {
          onReady: () => { log("lecteur YouTube prêt"); resolve(); },
          onStateChange: (e) => this.#onState(e),
          onAutoplayBlocked: () => this.onBlocked?.()
        }
      });
    });
  }

  #onState(e) {
    if (e.data === YT.PlayerState.PLAYING) {
      clearTimeout(this.#timer);
      log("lecture démarrée");
      this.onPlaying?.();
    } else if (e.data === YT.PlayerState.ENDED) {
      if (this.loop) { this.player.seekTo(0, true); this.player.playVideo(); }
      else { this.#wantPlaying = false; this.onEnded?.(); }
    }
  }

  #watchBlocked() {
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      if (!this.#wantPlaying) return;
      const s = this.player.getPlayerState();
      if (s === YT.PlayerState.UNSTARTED || s === YT.PlayerState.CUED) this.onBlocked?.();
    }, 2000);
  }

  /** Aligne le lecteur sur un état {videoId, position, playing}. */
  sync({ videoId, position = 0, playing = true }) {
    if (!videoId) return this.stop();
    const p = this.player;
    this.#wantPlaying = playing;
    if (this.videoId !== videoId) {
      this.videoId = videoId;
      const args = { videoId, startSeconds: position };
      playing ? p.loadVideoById(args) : p.cueVideoById(args);
    } else {
      p.seekTo(position, true);
      playing ? p.playVideo() : p.pauseVideo();
    }
    if (playing) this.#watchBlocked();
  }

  pause() { this.#wantPlaying = false; this.player.pauseVideo(); }
  stop() { this.#wantPlaying = false; this.videoId = null; this.player.stopVideo(); }
  setVolume(v) { this.player.setVolume(v); }
  setLoop(b) { this.loop = !!b; }
  getTime() { return this.player?.getCurrentTime?.() ?? 0; }
  getDuration() { return this.player?.getDuration?.() ?? 0; }
  get isPlaying() { return this.player?.getPlayerState?.() === YT.PlayerState.PLAYING; }
}

function decodeEntities(str) {
  return new DOMParser().parseFromString(str, "text/html").documentElement.textContent;
}

/** Recherche de vidéos via YouTube Data API v3 (clé API requise). */
export async function searchYouTube(query, apiKey, max = 10) {
  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  url.search = new URLSearchParams({
    part: "snippet", type: "video", videoEmbeddable: "true",
    maxResults: String(max), q: query, key: apiKey
  }).toString();
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message ?? res.statusText);
  return (data.items ?? []).map((i) => ({
    videoId: i.id.videoId,
    title: decodeEntities(i.snippet.title),
    channel: decodeEntities(i.snippet.channelTitle),
    thumb: i.snippet.thumbnails?.default?.url ?? ""
  }));
}
