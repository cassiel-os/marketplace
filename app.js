// Neo Arcade: the zips in a folder of yours, played by FinalBurn Neo (Nostalgist runs
// RetroArch's FBNeo core, served from this app's folder: it works offline). The
// library lists the games with a picture of each (snap/<set>.png, as MAME keeps them,
// or <set>.png beside the zip, taken here after a while of play); the screen shows the
// chosen one's picture, and the game when it plays. Neo Geo games need neogeo.zip, the
// BIOS, in the same folder.
(() => {
  const $ = (id) => document.getElementById(id);
  const GAMES = window.NEO_GAMES;
  const BIOS = 'neogeo.zip';
  const SNAP_AFTER_MS = 25000; // a game with no picture gets one after this much play

  let folder = null; // the ROMs' folder
  let games = []; // { set, file, path, title, year, maker, known, snap }
  let pick = -1;
  let hasBios = false;
  let emu = null; // the running Nostalgist
  let playing = null; // the game it plays
  let paused = false;

  // ------------------------------------------------------------ bytes

  const toBase64 = (blob) =>
    new Promise((done, fail) => {
      const r = new FileReader();
      r.onload = () => done(String(r.result).slice(String(r.result).indexOf(',') + 1));
      r.onerror = () => fail(r.error);
      r.readAsDataURL(blob);
    });
  /** A file of the person's as a Blob. Read through a stream URL, not as base64: ROMs
   * are big (some Neo Geo ones near 100 MB). */
  const read = async (path, type) => {
    const response = await fetch(await window.cassiel.files.streamUrl(path));
    if (!response.ok) throw new Error(`${path.split('/').pop()}: ${response.status}`);
    const blob = await response.blob();
    return type ? new Blob([blob], { type }) : blob;
  };

  // ------------------------------------------------------------ the library

  const parent = (path) => path.replace(/\/[^/]+$/, '') || '/';
  const setOf = (file) => file.replace(/\.zip$/i, '').toLowerCase();

  async function scan() {
    games = [];
    hasBios = false;
    if (!folder) return render();
    let items = [];
    let snaps = new Map();
    try {
      items = (await window.cassiel.files.list(folder)).items;
    } catch (e) {
      return problem(`No se pudo leer ${folder}: ${e.message}`);
    }
    for (const it of items) if (it.kind === 'file' && /\.png$/i.test(it.name)) snaps.set(it.name.slice(0, -4).toLowerCase(), it.path);
    const snapDir = items.find((it) => it.kind === 'folder' && it.name.toLowerCase() === 'snap');
    if (snapDir) {
      try {
        for (const it of (await window.cassiel.files.list(snapDir.path)).items)
          if (/\.png$/i.test(it.name)) snaps.set(it.name.slice(0, -4).toLowerCase(), it.path);
      } catch {}
    }
    hasBios = items.some((it) => it.kind === 'file' && it.name.toLowerCase() === BIOS);
    games = items
      .filter((it) => it.kind === 'file' && /\.zip$/i.test(it.name) && it.name.toLowerCase() !== BIOS)
      .map((it) => {
        const set = setOf(it.name);
        const [title, year, maker] = GAMES[set] ?? [it.name.replace(/\.zip$/i, ''), null, null];
        return { set, file: it.name, path: it.path, title, year, maker, known: set in GAMES, snap: snaps.get(set) ?? null };
      })
      .sort((a, b) => a.title.localeCompare(b.title));
    pick = games.length ? 0 : -1;
    render();
    show();
  }

  const thumbs = new Map(); // snap path → object URL
  async function picture(game) {
    if (!game?.snap) return null;
    if (!thumbs.has(game.snap)) thumbs.set(game.snap, read(game.snap, 'image/png').then((b) => URL.createObjectURL(b)).catch(() => null));
    return thumbs.get(game.snap);
  }

  function render() {
    const list = $('games');
    $('count').textContent = String(games.length);
    const bios = $('bios');
    bios.classList.toggle('ok', !!folder && hasBios);
    bios.classList.toggle('missing', !!folder && !hasBios);
    bios.querySelector('i').textContent = !folder ? '—' : hasBios ? 'OK' : 'NO';
    list.replaceChildren();
    if (!folder) return list.append(note('Elige la carpeta donde tienes tus ROMs (zip). Neo Geo necesita también neogeo.zip ahí.'));
    if (!games.length) return list.append(note('No hay ROMs (zip) en esta carpeta.'));
    games.forEach((g, i) => {
      const li = document.createElement('li');
      li.role = 'option';
      li.setAttribute('aria-selected', String(i === pick));
      const thumb = Object.assign(document.createElement('span'), { className: 'thumb', textContent: g.set.slice(0, 4).toUpperCase() });
      picture(g).then((url) => url && ((thumb.style.backgroundImage = `url("${url}")`), (thumb.textContent = '')));
      li.append(thumb, Object.assign(document.createElement('span'), { className: 'name', textContent: g.title }));
      li.addEventListener('click', () => choose(i));
      li.addEventListener('dblclick', () => play(i));
      list.append(li);
    });
  }
  const note = (text) => Object.assign(document.createElement('li'), { className: 'note', textContent: text });

  function choose(i) {
    if (i < 0 || i >= games.length) return;
    pick = i;
    for (const [k, li] of [...$('games').children].entries()) li.setAttribute('aria-selected', String(k === i));
    $('games').children[i]?.scrollIntoView({ block: 'nearest' });
    if (!emu) show();
  }

  // ------------------------------------------------------------ the screen

  /** The chosen game's picture and line, while nothing plays. */
  async function show() {
    const g = games[pick];
    $('canvas').hidden = true;
    const snap = $('snap');
    const empty = $('empty');
    line(g);
    if (!folder) {
      snap.hidden = true;
      empty.hidden = false;
      empty.innerHTML = '<b>Neo Arcade</b>Tus juegos de Neo Geo y maquinitas, con FinalBurn Neo. Elige la carpeta de tus ROMs abajo a la izquierda.';
      return;
    }
    const url = await picture(g);
    if (games[pick] !== g || emu) return;
    snap.hidden = !url;
    if (url) snap.src = url;
    empty.hidden = !!url;
    if (!url)
      empty.innerHTML = g
        ? `<b>${escape(g.title)}</b>Doble clic o <kbd>Enter</kbd> para jugar.<br />Moneda <kbd>Shift</kbd> derecho, Start <kbd>Enter</kbd>, botones <kbd>Z</kbd> <kbd>X</kbd> <kbd>A</kbd> <kbd>S</kbd>.`
        : '';
  }
  const escape = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  function line(g) {
    $('now').textContent = g ? [g.title, [g.year, g.maker].filter(Boolean).join(' · ')].filter(Boolean).join(' — ') : '';
    const state = $('state');
    state.className = 'state';
    if (emu && playing) {
      state.classList.add(paused ? 'warn' : 'ok');
      state.textContent = paused ? 'En pausa' : 'Jugando';
    } else if (g) {
      const needsBios = g.known && !window.NEO_NOT_NEOGEO.has(g.set) && !hasBios;
      state.classList.add(needsBios ? 'bad' : g.known ? 'ok' : 'warn');
      state.textContent = needsBios ? 'Falta neogeo.zip' : g.known ? 'Compatible' : 'Sin verificar';
    } else state.textContent = '';
  }
  const problem = (text) => {
    const state = $('state');
    state.className = 'state bad';
    state.textContent = text;
  };

  // ------------------------------------------------------------ playing

  async function play(i = pick) {
    const g = games[i];
    if (!g) return;
    await stop();
    choose(i);
    playing = g;
    paused = false;
    $('snap').hidden = true;
    $('empty').hidden = false;
    $('empty').innerHTML = `<b>${escape(g.title)}</b>Cargando…`;
    const state = $('state');
    state.className = 'state warn';
    state.textContent = 'Cargando';
    try {
      const [rom, bios] = await Promise.all([read(g.path), hasBios ? read(`${folder}/${BIOS}`) : null]);
      if (playing !== g) return;
      // The canvas needs its size while the emulator starts: shown, but not seen yet.
      const canvas = $('canvas');
      canvas.style.visibility = 'hidden';
      canvas.hidden = false;
      emu = await window.Nostalgist.launch({
        element: canvas,
        core: 'fbneo',
        rom: { fileName: g.file, fileContent: rom },
        bios: bios ? [{ fileName: BIOS, fileContent: bios }] : [],
        resolveCoreJs: () => new URL('core/fbneo_libretro.js', location.href).href,
        resolveCoreWasm: () => new URL('core/fbneo_libretro.wasm', location.href).href,
        retroarchConfig: { input_exit_emulator: 'nul', input_menu_toggle: 'nul', video_smooth: false },
      });
      if (playing !== g) return stop();
      $('empty').hidden = true;
      canvas.style.visibility = '';
      canvas.focus();
      started = performance.now();
      line(g);
      menus();
    } catch (e) {
      emu = null;
      playing = null;
      $('canvas').style.visibility = '';
      show();
      problem(`No arrancó: ${e.message}`);
    }
  }

  async function stop() {
    if (!emu) return;
    const was = emu;
    emu = null;
    playing = null;
    paused = false;
    try {
      was.exit({ removeCanvas: false });
    } catch {}
    menus();
    show();
  }

  function pause() {
    if (!emu) return;
    paused = !paused;
    paused ? emu.pause() : emu.resume();
    line(playing);
    menus();
  }

  /** A picture of the game now, kept beside its zip: its thumbnail from then on. */
  async function capture(g = playing) {
    if (!emu || !g) return;
    try {
      const blob = await emu.screenshot();
      const path = `${folder}/${g.set}.png`;
      await window.cassiel.files.writeBytes(path, await toBase64(blob));
      thumbs.set(path, Promise.resolve(URL.createObjectURL(blob)));
      g.snap = path;
      render();
    } catch (e) {
      problem(`No se guardó la captura: ${e.message}`);
    }
  }

  async function saveState() {
    if (!emu || !playing) return;
    try {
      const { state } = await emu.saveState();
      await window.cassiel.files.writeBytes(`${folder}/${playing.set}.state`, await toBase64(state));
      window.cassiel.notify('Neo Arcade', `Partida guardada: ${playing.title}`);
    } catch (e) {
      problem(`No se guardó la partida: ${e.message}`);
    }
  }
  async function loadState() {
    if (!emu || !playing) return;
    try {
      await emu.loadState(await read(`${folder}/${playing.set}.state`));
    } catch {
      problem('No hay partida guardada de este juego.');
    }
  }

  // A picture for a game that has none, once it has played a while.
  let started = 0;
  setInterval(() => {
    if (emu && playing && !playing.snap && !paused && performance.now() - started > SNAP_AFTER_MS) capture();
  }, 1000);

  const fullscreen = () => (emu ? $('canvas') : $('screen')).requestFullscreen?.();

  // ------------------------------------------------------------ the folder

  async function chooseFolder() {
    const r = await window.cassiel.dialog.openFile({ title: 'Elige una ROM de tu carpeta de juegos', types: [{ label: 'ROMs (zip)', extensions: ['zip'] }] });
    if (!r) return;
    folder = parent(r.path);
    await window.cassiel.storage.set('folder', folder);
    await scan();
    const i = games.findIndex((g) => g.path === r.path);
    if (i >= 0) choose(i);
  }
  $('folder').addEventListener('click', chooseFolder);

  // ------------------------------------------------------------ keys and menus

  $('games').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      choose(Math.max(0, Math.min(games.length - 1, pick + (e.key === 'ArrowDown' ? 1 : -1))));
    } else if (e.key === 'Enter') play();
  });
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.fullscreenElement) document.exitFullscreen();
  });

  const about = () =>
    window.cassiel.dialog.alert(
      'Neo Arcade',
      'Juegos de Neo Geo y maquinitas con tus propias ROMs.\n\nEmulación: FinalBurn Neo (libretro), licencia no comercial; corre con Nostalgist (MIT). Las ROMs y el BIOS no se incluyen: son de sus dueños.',
    );
  const sets = () =>
    window.cassiel.dialog.alert(
      'ROMs compatibles',
      'Sets de FinalBurn Neo (versión de noviembre de 2025): cada juego un zip con su nombre de set (mslug.zip, kof98.zip). Lo más sencillo es un set "non-merged": cada zip trae todo lo suyo. En un set "split", un clon necesita el zip de su juego padre en la misma carpeta.\n\nNeo Geo: neogeo.zip del mismo set, junto a los juegos. Sets recientes de MAME suelen servir para Neo Geo; si uno no arranca, es que su zip no es el que FinalBurn Neo espera.',
    );
  const controls = () =>
    window.cassiel.dialog.alert(
      'Controles',
      'Mover: flechas\nBotones A B C D: Z X A S\nStart: Enter\nMoneda: Shift derecho\n\nUn control (gamepad) conectado funciona solo.',
    );

  function menus() {
    window.cassiel.menu.set([
      {
        label: '&Archivo',
        items: [
          { label: 'Elegir &carpeta de ROMs…', action: chooseFolder },
          { label: '&Volver a leer la carpeta', shortcut: 'F5', action: scan, enabled: () => !!folder },
          'separator',
          { label: '&Salir', action: () => window.cassiel.close() },
        ],
      },
      {
        label: '&Emulación',
        items: [
          { label: '&Jugar', shortcut: 'Ctrl+Enter', action: () => play(), enabled: () => pick >= 0 },
          { label: '&Pausa', shortcut: 'F3', checked: () => paused, action: pause, enabled: () => !!emu },
          { label: '&Reiniciar', action: () => emu?.restart(), enabled: () => !!emu },
          { label: '&Detener', shortcut: 'Ctrl+Q', action: stop, enabled: () => !!emu },
          'separator',
          { label: '&Guardar partida', shortcut: 'F2', action: saveState, enabled: () => !!emu },
          { label: '&Cargar partida', shortcut: 'F4', action: loadState, enabled: () => !!emu },
          { label: 'Ca&ptura de pantalla', shortcut: 'F12', action: () => capture(), enabled: () => !!emu },
        ],
      },
      { label: '&Opciones', items: [{ label: '&Controles…', action: controls }] },
      { label: '&Vídeo', items: [{ label: '&Pantalla completa', shortcut: 'F11', action: fullscreen }] },
      {
        label: 'A&yuda',
        items: [
          { label: '&ROMs compatibles…', action: sets },
          'separator',
          { label: '&Acerca de Neo Arcade', action: about },
        ],
      },
    ]);
  }

  // ------------------------------------------------------------ Cass

  window.cassiel.actions.register('play', {
    description: 'Pone a jugar un juego de la biblioteca. Dile cuál.',
    params: { game: 'el nombre del juego, por ejemplo "Metal Slug" o "kof98"' },
    run: async ({ game }) => {
      const q = String(game ?? '').toLowerCase();
      const i = games.findIndex((g) => g.set === q || g.title.toLowerCase().includes(q));
      if (i < 0) return `no tengo "${game}" en la biblioteca`;
      play(i);
      return `jugando ${games[i].title}`;
    },
  });
  window.cassiel.actions.register('stop', { description: 'Detiene el juego.', params: {}, run: () => (stop(), 'detenido') });
  window.cassiel.actions.register('list', {
    description: 'Qué juegos hay en la biblioteca.',
    params: {},
    run: () => (games.length ? games.map((g) => g.title).join(', ') : 'la biblioteca está vacía'),
  });

  // ------------------------------------------------------------ start

  menus();
  render();
  show();
  window.cassiel.ready.then(async () => {
    folder = (await window.cassiel.storage.get('folder')) ?? null;
    await scan();
  });
})();
