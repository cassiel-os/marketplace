// M.U.G.E.N.js for Cassiel: the engine from mugen.min.js, the files from the app's
// own folder (App Files/M.U.G.E.N.js/game), and the desktop's menus and dialogs.

import { createEngine } from './mugen.min.js';

const GAME = 'game';
const CONFIG = 'data/mugen.cfg';
/** Folders listed at once: a roster has hundreds. */
const LIST_AT_ONCE = 8;

const TEXT = {
  en: {
    setupTitle: 'Add your MUGEN folder',
    setupText: 'This app brings the engine, not the game. Copy what is inside your MUGEN folder (data, chars, stages, font...) here:',
    retry: 'Try again',
    listing: 'Reading your files...',
    loading: 'Loading',
    phases: { motif: 'motif', characters: 'characters', hud: 'HUD', loading: 'match' },
    sound: 'Press a key or click for sound',
    game: '&Game',
    fullscreen: '&Full Screen',
    exit: 'E&xit',
    failed: 'Could not start',
  },
  es: {
    setupTitle: 'Agrega tu carpeta de MUGEN',
    setupText: 'Esta app trae el motor, no el juego. Copia aquí lo que hay dentro de tu carpeta de MUGEN (data, chars, stages, font...):',
    retry: 'Intentar de nuevo',
    listing: 'Leyendo tus archivos...',
    loading: 'Cargando',
    phases: { motif: 'motif', characters: 'personajes', hud: 'HUD', loading: 'partida' },
    sound: 'Pulsa una tecla o haz clic para oír el sonido',
    game: '&Juego',
    fullscreen: '&Pantalla completa',
    exit: '&Salir',
    failed: 'No se pudo iniciar',
  },
};

const $ = (id) => document.getElementById(id);
const text = () => TEXT[(document.documentElement.lang || 'en').slice(0, 2)] ?? TEXT.en;

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

function showProgress(progress) {
  const t = text();
  if (!progress) {
    $('status').textContent = '';
    return;
  }
  const count = progress.phase === 'characters' && progress.done !== undefined ? ` ${progress.done}/${progress.total}` : '';
  $('status').textContent = `${t.loading} ${t.phases[progress.phase]}...${count}`;
}

async function showSetup() {
  const t = text();
  $('status').textContent = '';
  $('setup-title').textContent = t.setupTitle;
  $('setup-text').textContent = t.setupText;
  $('setup-retry').textContent = t.retry;
  $('setup-path').textContent = `${await cassiel.appFiles.folder()}/${GAME}`;
  $('setup').hidden = false;
}

function setMenu() {
  const t = text();
  cassiel.menu.set([
    {
      label: t.game,
      items: [
        { label: t.fullscreen, windowAction: 'fullscreen', action: () => $('screen').requestFullscreen?.() },
        'separator',
        { label: t.exit, action: () => cassiel.close() },
      ],
    },
  ]);
}

async function start() {
  const t = text();
  $('setup').hidden = true;
  $('status').textContent = t.listing;
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
    onProgress: showProgress,
    onExit: () => cassiel.close(),
  });
  engine.start();
  canvas.focus();
  // A gamepad alone can't start the sound: browsers want a key press, click or touch.
  setInterval(() => {
    if (!engine.loading) $('status').textContent = engine.running && engine.audioLocked ? t.sound : '';
  }, 500);
  // The game has the keyboard while the window is on screen: clicks give it back.
  addEventListener('pointerdown', () => canvas.focus());
}

$('setup-retry').addEventListener('click', () => void start());

cassiel.ready.then(async () => {
  setMenu();
  try {
    await start();
  } catch (error) {
    $('status').textContent = '';
    await cassiel.dialog.alert(text().failed, String(error?.message ?? error), 'error');
  }
});
