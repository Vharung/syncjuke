import { MODULE_ID } from "./constants.mjs";
import { Jukebox } from "./jukebox.mjs";
import { injectSidebar } from "./sidebar.mjs";
import { preloadApi } from "./youtube.mjs";

Hooks.once("init", () => {
  // Chargement anticipé de l'API YouTube (en parallèle du démarrage de Foundry).
  const pre = document.createElement("link");
  pre.rel = "preconnect"; pre.href = "https://www.youtube.com";
  document.head.append(pre);
  preloadApi();

  game.settings.register(MODULE_ID, "volume", { scope: "client", config: false, type: Number, default: 60 });
  game.settings.register(MODULE_ID, "apiKey", {
    name: "SYNCJUKE.ApiKeyName", hint: "SYNCJUKE.ApiKeyHint",
    scope: "client", config: true, type: String, default: "",
    onChange: () => game.syncjuke?.refresh()
  });
  game.settings.register(MODULE_ID, "playlists", {
    scope: "world", config: false, type: Array, default: [],
    onChange: () => game.syncjuke?.refresh()
  });
  game.keybindings.register(MODULE_ID, "toggle", {
    name: "SYNCJUKE.Title",
    editable: [{ key: "KeyJ", modifiers: ["Alt"] }],
    onDown: () => { game.syncjuke?.toggleApp(); return true; }
  });
});

Hooks.once("ready", async () => {
  game.syncjuke = new Jukebox();
  await game.syncjuke.init();
  game.modules.get(MODULE_ID).api = { open: () => game.syncjuke.toggleApp() };
  if (ui.playlists?.element) injectSidebar(ui.playlists, ui.playlists.element);
});

// Format v13+ : `controls` est un objet indexé par nom de groupe.
Hooks.on("getSceneControlButtons", (controls) => {
  const group = controls.tokens;
  if (!group) return;
  group.tools[MODULE_ID] = {
    name: MODULE_ID,
    title: "SYNCJUKE.Title",
    icon: "fa-solid fa-music",
    order: Object.keys(group.tools).length,
    button: true,
    onChange: () => game.syncjuke?.toggleApp()
  };
});

// Mini-lecteur dans l'onglet « Playlists » (musique) de la barre latérale.
Hooks.on("renderPlaylistDirectory", (app, html) => injectSidebar(app, html));
