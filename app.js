// Winamp for Spotify: Webamp (Winamp 2, its base skin made sharp) and a Media Library,
// playing Spotify. Sign in (Premium plays); the library's tree has Search, Liked Songs
// and your playlists; double-click a song to play from there in Webamp. Webamp drives
// Spotify through SpotifyMedia (spotify.js). Its equalizer, balance and visualizer
// cannot touch Spotify's protected sound. Cass can search, play, pause and skip.
(() => {
  const { api, connect, device, SpotifyMedia, toTrack } = window.Spotify4Webamp;
  const auth = window.SpotifyAuth;
  const $ = (id) => document.getElementById(id);

  const short = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
  const long = (ms) => {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    return `${h ? `${h}:` : ''}${String(Math.floor(s / 60) % 60).padStart(h ? 2 : 1, '0')}:${String(s % 60).padStart(2, '0')}`;
  };
  const artists = (t) => t.artists?.map((a) => a.name).join(', ') ?? '';
  let note = '';
  const status = (text) => {
    note = text ?? '';
    renderStatus();
  };
  window.addEventListener('spotify-error', (e) => status(e.detail));

  // ---------------------------------------------------------------- Webamp

  // Its three windows stacked in the left column, the playlist down to the bottom (in
  // Winamp's steps of 29 pixels). Made once the page has its final size.
  const MAIN = 116;
  const EQ = 116;
  const PLAYLIST = 116;
  const STEP = 29;
  let webamp = null;
  function place() {
    const room = innerHeight;
    const extraHeight = Math.max(0, Math.floor((room - MAIN - EQ - PLAYLIST) / STEP));
    $('stage').style.height = `${MAIN + EQ + PLAYLIST + extraHeight * STEP}px`;
    webamp = new window.Webamp({
      __customMediaClass: SpotifyMedia,
      windowLayout: {
        main: { position: { left: 0, top: 0 } },
        equalizer: { position: { left: 0, top: MAIN } },
        playlist: { position: { left: 0, top: MAIN + EQ }, size: { extraHeight, extraWidth: 0 } },
      },
      enableHotkeys: false,
      zIndex: 1,
    });
    // Its own close and minimize act on the Cassiel window.
    webamp.onWillClose((cancel) => {
      cancel();
      window.cassiel.close();
    });
    webamp.onMinimize(() => window.cassiel.window.minimize());
    webamp.renderInto($('stage')).then(eqShapes);
  }

  // The equalizer's lit parts, drawn as shapes (skin.css): each slider's slot in the
  // color of its level, green at -12 dB to red at +12 as in Winamp's 28 steps, and the
  // graph's curve through the ten bands with the preamp's line under it.
  const LEVELS = [
    '#2a9a16', '#2a9a16', '#5ab02c', '#71cd34', '#71cd34', '#89e230', '#89e230', '#a4e238', '#a4e238', '#c4db32',
    '#c4db32', '#c4db32', '#c4db32', '#c4db32', '#e0cd30', '#e0cd30', '#e0cd30', '#e0cd30', '#e0b228', '#e09228',
    '#e09228', '#dc771f', '#c6780f', '#dc771f', '#e0541e', '#e0541e', '#d3221b', '#d3221b',
  ];
  const BANDS = [60, 170, 310, 600, 1000, 3000, 6000, 12000, 14000, 16000];
  const SVG = 'http://www.w3.org/2000/svg';
  function eqShapes() {
    const graph = document.createElementNS(SVG, 'svg');
    graph.classList.add('eq-curve');
    graph.setAttribute('viewBox', '0 0 113 19');
    graph.innerHTML = `
      <defs><linearGradient id="eq-heat" x1="0" y1="1" x2="0" y2="18" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#d3221b"/><stop offset="0.3" stop-color="#e09228"/>
        <stop offset="0.5" stop-color="#e0cd30"/><stop offset="0.75" stop-color="#89e230"/>
        <stop offset="1" stop-color="#2a9a16"/></linearGradient></defs>
      <g stroke="#6c6c7e" stroke-width="1">${BANDS.map((_, i) => `<line x1="${2.5 + 12 * i}" y1="0" x2="${2.5 + 12 * i}" y2="19"/>`).join('')}</g>
      <line class="preamp" x1="0" x2="113" stroke="#bacbdd" stroke-width="1"/>
      <path class="curve" fill="none" stroke="url(#eq-heat)" stroke-width="1.2" stroke-linejoin="round"/>`;
    const y = (value) => 1.5 + ((100 - value) / 100) * 16;
    let last = null;
    const draw = () => {
      const sliders = webamp.store.getState().equalizer.sliders;
      if (sliders === last && graph.isConnected) return;
      last = sliders;
      const eq = document.querySelector('#equalizer-window');
      if (!eq) return;
      if (!graph.isConnected) eq.append(graph);
      for (const [key, value] of Object.entries(sliders)) {
        const band = eq.querySelector(key === 'preamp' ? '#preamp' : `#band-${key}`);
        band?.style.setProperty('--level', LEVELS[Math.round((value / 100) * 27)]);
      }
      const at = (value) => y(value).toFixed(2);
      graph.querySelector('.preamp').setAttribute('y1', at(sliders.preamp));
      graph.querySelector('.preamp').setAttribute('y2', at(sliders.preamp));
      // A smooth curve through the bands (Catmull-Rom, as cubic Béziers).
      const p = BANDS.map((band, i) => [2.5 + 12 * i, y(sliders[band])]);
      let d = `M${p[0][0]},${p[0][1].toFixed(2)}`;
      for (let i = 0; i < p.length - 1; i++) {
        const [a, b, c, e] = [p[i - 1] ?? p[i], p[i], p[i + 1], p[i + 2] ?? p[i + 1]];
        const c1 = [b[0] + (c[0] - a[0]) / 6, b[1] + (c[1] - a[1]) / 6];
        const c2 = [c[0] - (e[0] - b[0]) / 6, c[1] - (e[1] - b[1]) / 6];
        d += ` C${c1[0].toFixed(2)},${Math.min(18, Math.max(1, c1[1])).toFixed(2)} ${c2[0].toFixed(2)},${Math.min(18, Math.max(1, c2[1])).toFixed(2)} ${c[0]},${c[1].toFixed(2)}`;
      }
      graph.querySelector('.curve').setAttribute('d', d);
    };
    webamp.store.subscribe(draw);
    draw();
  }
  if (document.readyState === 'complete') requestAnimationFrame(place);
  else addEventListener('load', () => requestAnimationFrame(place), { once: true });

  const playList = (tracks, from = 0) => {
    const playable = tracks.filter((t) => t?.uri?.startsWith('spotify:track:'));
    if (!playable.length) return status('Nothing playable there.');
    if (!device.id) return status(device.error || 'Spotify is still starting on this device; try again in a moment.');
    status('');
    device.player?.activateElement?.();
    webamp?.setTracksToPlay(playable.map(toTrack));
    if (from > 0) webamp?.setCurrentTrack(Math.min(from, playable.length - 1));
  };
  const enqueue = (tracks) => {
    const playable = tracks.filter((t) => t?.uri?.startsWith('spotify:track:'));
    webamp?.appendTracks(playable.map(toTrack));
    status(`Added ${playable.length === 1 ? playable[0].name : `${playable.length} songs`} to the playlist.`);
  };
  device.listeners.add(() => device.error && status(device.error));

  // ---------------------------------------------------------------- the library

  let playlists = []; // the person's, for the tree
  let node = 'search'; // what the tree has selected: 'search', 'liked' or a playlist id
  let rows = []; // the songs shown
  let pick = -1;
  let lastQuery = '';
  let playlistsOpen = true;

  function renderTree() {
    const tree = $('tree');
    tree.replaceChildren();
    const item = (id, label, depth, lead) => {
      const li = document.createElement('li');
      li.dataset.depth = String(depth);
      li.setAttribute('aria-selected', String(node === id));
      if (lead) li.append(lead);
      li.append(document.createTextNode(label));
      li.addEventListener('click', () => openNode(id));
      tree.append(li);
      return li;
    };
    const caret = (open) => Object.assign(document.createElement('span'), { className: `caret${open ? '' : ' closed'}` });
    const bullet = () => Object.assign(document.createElement('span'), { className: 'bullet' });
    item('root', 'Spotify', 0, caret(true));
    item('search', 'Search', 1, bullet());
    item('liked', 'Liked Songs', 1, bullet());
    const header = item('playlists', 'Playlists', 0, caret(playlistsOpen));
    header.addEventListener('click', () => {
      playlistsOpen = !playlistsOpen;
      renderTree();
    });
    if (playlistsOpen) for (const p of playlists) item(p.id, p.name, 1, bullet());
  }

  function renderRows() {
    const list = $('results');
    list.replaceChildren();
    const empty = (text) => list.append(Object.assign(document.createElement('li'), { className: 'empty', textContent: text }));
    if (!auth.signedIn()) empty('Sign in with Spotify (bottom left) to see your music. Playing needs Spotify Premium.');
    else if (!rows.length) empty(node === 'search' ? (lastQuery ? 'Nothing found.' : 'Type in Search to find music on Spotify.') : 'Loading…');
    rows.forEach((t, i) => {
      const li = document.createElement('li');
      li.setAttribute('aria-selected', String(i === pick));
      for (const text of [artists(t), t.album?.name ?? '', t.track_number ? `${t.track_number}` : '', t.name, short(t.duration_ms)])
        li.append(Object.assign(document.createElement('span'), { textContent: text }));
      li.addEventListener('click', () => ((pick = i), renderRows()));
      li.addEventListener('dblclick', () => playList(rows, i));
      list.append(li);
    });
    renderStatus();
  }
  function renderStatus() {
    const total = rows.reduce((sum, t) => sum + (t.duration_ms ?? 0), 0);
    $('status').textContent = note || (rows.length ? `${rows.length} items [${long(total)}]` : 'Unofficial. Not made by or affiliated with Spotify or Winamp.');
  }

  const playlistTracks = async (id) => {
    const tracks = [];
    let next = `/playlists/${id}/tracks?limit=100`;
    while (next && tracks.length < 500) {
      const page = await api(next);
      tracks.push(...page.items.map((i) => i.track).filter((t) => t?.uri));
      next = page.next;
    }
    return tracks;
  };
  const searchTracks = async (q) => {
    lastQuery = q;
    return (await api(`/search?${new URLSearchParams({ q, type: 'track', limit: '50' })}`)).tracks.items.filter(Boolean);
  };

  async function openNode(id) {
    if (id === 'playlists' || id === 'root') return;
    node = id;
    rows = [];
    pick = -1;
    note = '';
    renderTree();
    renderRows();
    if (!auth.signedIn()) return;
    try {
      if (id === 'search') rows = lastQuery ? await searchTracks(lastQuery) : [];
      else if (id === 'liked') rows = (await api('/me/tracks?limit=50')).items.map((i) => i.track);
      else rows = await playlistTracks(id);
    } catch (e) {
      note = e.message;
    }
    if (node === id) renderRows();
  }

  $('search').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = $('query').value.trim();
    if (!q) return;
    lastQuery = q;
    openNode('search');
  });
  $('clearSearch').addEventListener('click', () => {
    $('query').value = '';
    lastQuery = '';
    openNode('search');
  });
  $('mlPlay').addEventListener('click', () => rows.length && playList(rows, Math.max(0, pick)));
  $('mlEnqueue').addEventListener('click', () => rows[pick] && enqueue([rows[pick]]));
  $('results').addEventListener('keydown', (e) => {
    if (!rows.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      pick = Math.max(0, Math.min(rows.length - 1, pick + (e.key === 'ArrowDown' ? 1 : -1)));
      renderRows();
    } else if (e.key === 'Enter' && rows[pick]) playList(rows, pick);
  });
  addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      $('query').focus();
      $('query').select();
    }
  });

  // ---------------------------------------------------------------- the account

  async function account() {
    if (!auth.signedIn()) {
      $('sign').textContent = 'Sign in';
      playlists = [];
      renderTree();
      return;
    }
    try {
      const me = await api('/me');
      $('sign').textContent = me.display_name ?? me.id;
      $('sign').dataset.tooltip = `Signed in to Spotify${me.product === 'premium' ? '' : ' (playing needs Premium)'}. Click to sign out.`;
      connect();
      playlists = (await api('/me/playlists?limit=50')).items.filter(Boolean);
    } catch (e) {
      status(e.message);
    }
    renderTree();
  }
  $('sign').addEventListener('click', async () => {
    if (auth.signedIn()) {
      if (!(await window.cassiel.dialog.confirm('Spotify', 'Sign out of Spotify in this app?', 'Sign out'))) return;
      auth.signOut();
      device.player?.disconnect();
      webamp?.stop();
      await account();
      return openNode('search');
    }
    try {
      await auth.signIn();
      status('');
      await account();
      openNode(node);
    } catch (e) {
      status(e.message);
    }
  });

  // ---------------------------------------------------------------- Cass

  // What Cass can do here. Its words go to the model, so they are in its language.
  const nowPlaying = () => {
    const t = device.state?.track_window?.current_track;
    if (!t) return 'no suena nada en Winamp for Spotify';
    return `${device.state.paused ? 'en pausa' : 'sonando'}: ${t.name} de ${artists(t)} (${t.album?.name ?? ''})`;
  };
  const actions = {
    play: {
      description: 'Busca en Spotify y reproduce: una canción, un artista (sus canciones más populares), un álbum o una playlist (de la persona o pública). Dile qué buscar.',
      params: { query: 'qué buscar, por ejemplo "Bohemian Rhapsody" o "playlist lofi"' },
      run: async ({ query }) => {
        if (!auth.signedIn()) throw new Error('la persona no ha iniciado sesión en Spotify');
        const q = String(query ?? '');
        const mine = playlists.find((p) => p.name.length > 2 && q.toLowerCase().includes(p.name.toLowerCase()));
        if (mine) {
          playList(await playlistTracks(mine.id));
          return `reproduciendo tu playlist ${mine.name}`;
        }
        const r = await api(`/search?${new URLSearchParams({ q, type: 'track,artist,album,playlist', limit: '5' })}`);
        const kind = /playlist/i.test(q) ? 'playlist' : /álbum|album|disco/i.test(q) ? 'album' : /artista|artist/i.test(q) ? 'artist' : 'track';
        if (kind === 'playlist' && r.playlists.items.find(Boolean)) {
          const p = r.playlists.items.find(Boolean);
          playList(await playlistTracks(p.id));
          return `reproduciendo la playlist ${p.name}`;
        }
        if (kind === 'album' && r.albums.items.find(Boolean)) {
          const a = await api(`/albums/${r.albums.items.find(Boolean).id}`);
          playList(a.tracks.items.map((t) => ({ ...t, album: a })));
          return `reproduciendo el álbum ${a.name} de ${artists(a)}`;
        }
        if (kind === 'artist' && r.artists.items.find(Boolean)) {
          const a = r.artists.items.find(Boolean);
          playList((await api(`/artists/${a.id}/top-tracks?market=from_token`)).tracks);
          return `reproduciendo lo más escuchado de ${a.name}`;
        }
        const tracks = r.tracks.items.filter(Boolean);
        if (!tracks.length) return 'no encontré nada';
        playList(tracks);
        return `reproduciendo ${tracks[0].name} de ${artists(tracks[0])}`;
      },
    },
    pause: { description: 'Pausa la música.', params: {}, run: () => (webamp?.pause(), 'en pausa') },
    resume: { description: 'Sigue reproduciendo.', params: {}, run: () => (webamp?.play(), 'reproduciendo') },
    next: { description: 'Pasa a la siguiente canción.', params: {}, run: () => (webamp?.nextTrack(), 'siguiente canción') },
    previous: { description: 'Regresa a la canción anterior.', params: {}, run: () => (webamp?.previousTrack(), 'canción anterior') },
    now: { description: 'Qué canción está sonando.', params: {}, run: nowPlaying },
  };
  for (const [name, action] of Object.entries(actions)) window.cassiel.actions.register(name, action);

  // The tokens come with the SDK's storage, once it is ready.
  window.cassiel.ready.then(async () => {
    await account();
    openNode('search');
  });
  renderTree();
  renderRows();
})();
