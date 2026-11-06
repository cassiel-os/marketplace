// M.U.G.E.N for Cassiel: the engine from mugen.min.js, the files from the app's own
// folder (App Files/M.U.G.E.N/game), a plain window like the original's.

import { createEngine } from './mugen.min.js';

const GAME = 'game';
const CONFIG = 'data/mugen.cfg';
// The dark title screen. More characters: edit data/select.def, as with any MUGEN.
const MOTIF = 'data/system.def';
/** Folders listed at once: a roster has hundreds. */
const LIST_AT_ONCE = 8;

const TEXT = {
  en: {
    setupTitle: 'Add your MUGEN folder',
    setupText: 'This app brings the engine, not the game. Copy what is inside your MUGEN folder (data, chars, stages, font...) here:',
    retry: 'Try again',
    failed: 'Could not start',
  },
  es: {
    setupTitle: 'Agrega tu carpeta de MUGEN',
    setupText: 'Esta app trae el motor, no el juego. Copia aquí lo que hay dentro de tu carpeta de MUGEN (data, chars, stages, font...):',
    retry: 'Intentar de nuevo',
    failed: 'No se pudo iniciar',
  },
};

const $ = (id) => document.getElementById(id);
const text = () => TEXT[(document.documentElement.lang || 'en').slice(0, 2)] ?? TEXT.en;

/** The motif's localcoord: the size the game is made for. */
async function motifSize() {
  const motif = await cassiel.appFiles.readText(`${GAME}/${MOTIF}`);
  const found = /^\s*localcoord\s*=\s*(\d+)\s*,\s*(\d+)/im.exec(motif);
  return found ? [Number(found[1]), Number(found[2])] : [320, 240];
}

/**
 * The window takes the motif's size; afterwards the canvas draws at as many whole
 * pixels per motif unit as the window needs, so it stays sharp when maximized.
 */
function fitWindow(engine, canvas, [width, height]) {
  void cassiel.window.setContentSize?.(width, height);
  let zoom = 0;
  new ResizeObserver(() => {
    const scale = Math.min(canvas.clientWidth / width, canvas.clientHeight / height) * devicePixelRatio;
    const next = Math.max(1, Math.ceil(scale));
    if (next === zoom) return;
    zoom = next;
    engine.setZoom(next);
  }).observe(canvas);
}

/** Every file below the game folder, as paths relative to it. */
async function listFiles() {
  const files = [];
  const pending = [''];
  const walk = async () => {
    for (let dir = pending.pop(); dir !== undefined; dir = pending.pop()) {
      const { items } = await cassiel.appFiles.list(dir ? `${GAME}/${dir}` : GAME);
      for (const item of items) {
        const path = dir ? `${dir}/${item.name}` : item.name;
        if (item.kind === 'folder') pending.push(path);
        else files.push(path);
      }
    }
  };
  // A worker stops when the list is empty for a moment: go on until nothing is left.
  while (pending.length > 0) await Promise.all(Array.from({ length: LIST_AT_ONCE }, walk));
  return files;
}

/** The engine's FileSource over the app's folder. */
function folderSource(files) {
  const open = async (path, init) => {
    const response = await fetch(await cassiel.appFiles.streamUrl(`${GAME}/${path}`), init);
    if (!response.ok) throw new Error(`HTTP ${response.status} reading ${path}`);
    return response;
  };
  return {
    list: () => files,
    read: async (path) => new Uint8Array(await (await open(path)).arrayBuffer()),
    readRange: async (path, start, end) => {
      if (end <= start) return new Uint8Array(0);
      const response = await open(path, { headers: { Range: `bytes=${start}-${end - 1}` } });
      const bytes = new Uint8Array(await response.arrayBuffer());
      // A server may answer a range with the whole file.
      return response.status === 206 ? bytes : bytes.subarray(start, end);
    },
  };
}

async function showSetup() {
  const t = text();
  $('setup-title').textContent = t.setupTitle;
  $('setup-text').textContent = t.setupText;
  $('setup-retry').textContent = t.retry;
  $('setup-path').textContent = `${await cassiel.appFiles.folder()}/${GAME}`;
  $('setup').hidden = false;
}

/** Video_HandleFullscreenKey: toggles full screen, which browsers only allow from a key press or click. */
function toggleFullscreen() {
  if (document.fullscreenElement) return document.exitFullscreen();
  return document.documentElement.requestFullscreen();
}

// Alt+Enter is the window's, not the game's: Enter must not reach it as a button.
addEventListener(
  'keydown',
  (event) => {
    if (event.code !== 'Enter' && event.code !== 'NumpadEnter') return;
    if (!event.altKey) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!event.repeat) void toggleFullscreen();
  },
  { capture: true },
);

/**
 * [Video] FullScreen = 1. A browser refuses full screen until the person does
 * something, so the window fills the desktop first and the first key or click
 * finishes the job.
 */
function startFullscreen() {
  void cassiel.window.toggleMaximize();
  const enter = (event) => {
    removeEventListener('keydown', enter, true);
    removeEventListener('pointerdown', enter, true);
    if (event.altKey && event.code?.endsWith('Enter')) return;
    if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
  };
  addEventListener('keydown', enter, true);
  addEventListener('pointerdown', enter, true);
}

async function start() {
  $('setup').hidden = true;
  const files = await listFiles();
  if (!files.some((path) => path.toLowerCase() === CONFIG)) {
    await showSetup();
    return;
  }
  const canvas = $('screen');
  canvas.hidden = false;
  const engine = await createEngine({
    canvas,
    source: folderSource(files),
    motif: MOTIF,
    onExit: () => cassiel.close(),
  });
  // [Video] KeepAspect: bars when the window isn't the game's shape; 0 stretches it.
  const config = await cassiel.appFiles.readText(`${GAME}/${CONFIG}`);
  canvas.classList.toggle('stretch', /^\s*keepaspect\s*=\s*0/im.test(config));
  fitWindow(engine, canvas, await motifSize());
  if (engine.config.fullScreen) startFullscreen();
  engine.start();
  canvas.focus();
  // The game has the keyboard while the window is on screen: clicks give it back.
  addEventListener('pointerdown', () => canvas.focus());
}

$('setup-retry').addEventListener('click', () => void start());

cassiel.ready.then(async () => {
  try {
    await start();
  } catch (error) {
    await cassiel.dialog.alert(text().failed, String(error?.message ?? error), 'error');
  }
});
