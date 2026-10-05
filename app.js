// Winamp for Spotify: Winamp 2 and its Media Library, to the pixel but drawn sharp,
// playing Spotify. Sign in (Premium plays); the library's tree has Search, Liked Songs
// and your playlists; double-click a song to play from there. The playlist is what was
// sent to Spotify, which moves through it (shuffle and repeat are Spotify's). The
// window has no title bar of the desktop's: Winamp's is it. Cass can search, play,
// pause and skip.
(() => {
  const { api, connect, device, playUris, enqueue, setShuffle, setRepeat } = window.SpotifyPlayer;
  const auth = window.SpotifyAuth;
  const $ = (id) => document.getElementById(id);

  const clock = (ms) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };
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
  const fill = (input) => input.style.setProperty('--p', `${((input.value - input.min) / (input.max - input.min)) * 100}%`);

  // ---------------------------------------------------------------- the playlist

  let queue = []; // the songs sent to Spotify, in order
  let selected = new Set();
  const currentIndex = () => {
    const t = device.state?.track_window?.current_track;
    return t ? queue.findIndex((q) => q.uri === t.uri || q.uri === t.linked_from?.uri) : -1;
  };

  async function playList(tracks, from = 0) {
    const playable = tracks.filter((t) => t?.uri?.startsWith('spotify:track:'));
    if (!playable.length) return status('Nothing playable there.');
    queue = playable;
    selected = new Set();
    renderQueue();
    try {
      device.player?.activateElement?.();
      await playUris(queue.map((t) => t.uri), Math.min(from, queue.length - 1));
      status('');
    } catch (e) {
      status(e.message);
    }
  }
  async function addToList(tracks) {
    try {
      if (!queue.length) return playList(tracks);
      for (const t of tracks) {
        await enqueue(t.uri);
        queue.push(t);
      }
      renderQueue();
      status(`Added ${tracks.length === 1 ? tracks[0].name : `${tracks.length} songs`}.`);
    } catch (e) {
      status(e.message);
    }
  }

  function renderQueue() {
    const list = $('queue');
    list.replaceChildren();
    const current = currentIndex();
    queue.forEach((t, i) => {
      const li = document.createElement('li');
      li.className = i === current ? 'current' : '';
      li.setAttribute('aria-selected', String(selected.has(i)));
      li.append(
        Object.assign(document.createElement('span'), { textContent: `${i + 1}. ${artists(t)} - ${t.name}` }),
        Object.assign(document.createElement('span'), { textContent: short(t.duration_ms) }),
      );
      li.addEventListener('click', (e) => {
        if (!(e.ctrlKey || e.metaKey)) selected = new Set();
        selected.has(i) ? selected.delete(i) : selected.add(i);
        renderQueue();
      });
      li.addEventListener('dblclick', () => playList(queue, i));
      list.append(li);
    });
    const total = queue.reduce((sum, t) => sum + t.duration_ms, 0);
    const before = current >= 0 ? queue.slice(0, current).reduce((sum, t) => sum + t.duration_ms, 0) : 0;
    $('plTotal').textContent = `${long(before)}/${long(total)}`;
  }

  // ---------------------------------------------------------------- the player

  let remaining = false; // the display counts down
  let shownUri = null;
  let seeking = false;
  let stateAt = performance.now();
  const bars = Array.from({ length: 19 }, () => $('viz').appendChild(document.createElement('i')));

  function renderPlayer() {
    const s = device.state;
    const t = s?.track_window?.current_track;
    const playing = !!s && !s.paused;
    const position = s ? Math.min(s.duration, s.position + (playing ? performance.now() - stateAt : 0)) : 0;
    $('time').textContent = remaining && s ? `-${clock(s.duration - position)}` : clock(position);
    $('plTime').textContent = clock(position);
    $('state').dataset.state = playing ? 'play' : s && position > 0 ? 'pause' : 'stop';
    const index = currentIndex();
    $('song').textContent = t ? `${index >= 0 ? `${index + 1}. ` : ''}${artists(t)} - ${t.name} (${short(s.duration)})` : 'Winamp for Spotify';
    // Spotify's web player streams AAC at 256 kbps, 44.1 kHz, with Premium.
    $('kbps').textContent = t ? '256' : '';
    $('khz').textContent = t ? '44' : '';
    $('stereo').style.visibility = t ? 'visible' : 'hidden';
    if (!seeking) {
      $('seek').value = s?.duration ? Math.round((position / s.duration) * 1000) : 0;
      $('seek').toggleAttribute('data-idle', !t);
    }
    $('shuffle').setAttribute('aria-pressed', String(!!s?.shuffle));
    $('repeat').setAttribute('aria-pressed', String(!!s?.repeat_mode));
    $('repeat').dataset.mode = ['off', 'context', 'track'][s?.repeat_mode ?? 0];
    if (t?.uri !== shownUri) {
      shownUri = t?.uri;
      renderQueue();
    }
    // The spectrum is for the look: Spotify's sound cannot be measured here.
    for (const bar of bars) bar.style.height = playing ? `${10 + Math.random() * 90}%` : '0';
  }
  device.listeners.add(() => {
    stateAt = performance.now();
    if (device.error) status(device.error);
    renderPlayer();
  });
  setInterval(() => device.state && !device.state.paused && renderPlayer(), 200);

  const findMusic = () => ($('query').focus(), $('query').select());
  const act = {
    prev: () => device.player?.previousTrack(),
    play: () => {
      device.player?.activateElement?.();
      if (device.state) device.player.resume();
      else if (queue.length) playList(queue, Math.max(0, [...selected][0] ?? 0));
    },
    pause: () => device.player?.togglePlay(),
    stop: () => device.player?.pause().then(() => device.player.seek(0)),
    next: () => device.player?.nextTrack(),
    eject: findMusic,
  };
  for (const name of ['prev', 'play', 'pause', 'stop', 'next']) $(name).addEventListener('click', act[name]);
  for (const b of document.querySelectorAll('[data-act]')) b.addEventListener('click', () => act[b.dataset.act]());
  $('eject').addEventListener('click', findMusic);
  $('display').addEventListener('click', () => ((remaining = !remaining), renderPlayer()));

  $('seek').addEventListener('input', () => (seeking = true));
  $('seek').addEventListener('change', () => {
    seeking = false;
    if (device.state?.duration) device.player?.seek(Math.round((device.state.duration * $('seek').value) / 1000));
  });
  $('volume').addEventListener('input', () => {
    fill($('volume'));
    device.player?.setVolume($('volume').value / 100);
    $('song').textContent = `Volume: ${$('volume').value}%`;
    clearTimeout(volumeTimer);
    volumeTimer = setTimeout(renderPlayer, 900);
    try {
      localStorage.setItem('player.volume', $('volume').value);
    } catch {
      /* not kept */
    }
  });
  let volumeTimer = 0;
  $('shuffle').addEventListener('click', () => setShuffle(!device.state?.shuffle).catch((e) => status(e.message)));
  $('repeat').addEventListener('click', () => {
    const next = ['context', 'track', 'off'][device.state?.repeat_mode ?? 0];
    setRepeat(next).catch((e) => status(e.message));
  });
  const togglePanel = (button, panel) =>
    button.addEventListener('click', () => {
      const on = button.getAttribute('aria-pressed') !== 'true';
      button.setAttribute('aria-pressed', String(on));
      $(panel).hidden = !on;
    });
  togglePanel($('eqToggle'), 'eq');
  togglePanel($('plToggle'), 'pl');

  // The equalizer's look: preamp and ten bands at 0 dB, Winamp's frequencies.
  $('bands').append(Object.assign(document.createElement('span'), { className: 'band' }));
  ['70', '180', '320', '600', '1K', '3K', '6K', '12K', '14K', '16K'].forEach((f, i) => {
    const x = 57 + i * 18;
    $('bands').append(
      Object.assign(document.createElement('span'), { className: 'band', style: `left:${x}px` }),
      Object.assign(document.createElement('span'), { className: 'band-l', style: `left:${x}px`, textContent: f }),
    );
  });

  $('add').addEventListener('click', (e) => {
    e.stopPropagation();
    $('addMenu').hidden = !$('addMenu').hidden;
  });
  addEventListener('click', () => ($('addMenu').hidden = true));
  for (const b of document.querySelectorAll('[data-go]'))
    b.addEventListener('click', () => (b.dataset.go === 'search' ? (findMusic(), openNode('search')) : openNode(b.dataset.go)));
  $('rem').addEventListener('click', () => {
    if (!selected.size) return status('Select songs in the playlist first.');
    // Spotify keeps its own queue: what is removed here just leaves this list.
    queue = queue.filter((_, i) => !selected.has(i));
    selected = new Set();
    renderQueue();
  });
  $('sel').addEventListener('click', () => {
    selected = new Set(queue.map((_, i) => i));
    renderQueue();
  });
  const clearList = () => {
    device.player?.pause();
    queue = [];
    selected = new Set();
    renderQueue();
  };
  $('clear').addEventListener('click', clearList);
  $('listOpts').addEventListener('click', clearList);

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
    item('root', 'Spotify', 0, caret(true)).onclick = null;
    item('search', 'Search', 1, bullet());
    item('liked', 'Liked Songs', 1, bullet());
    const header = item('playlists', 'Playlists', 0, caret(playlistsOpen));
    header.onclick = (e) => {
      e.stopPropagation();
      playlistsOpen = !playlistsOpen;
      renderTree();
    };
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
  async function searchTracks(q) {
    lastQuery = q;
    return (await api(`/search?${new URLSearchParams({ q, type: 'track', limit: '50' })}`)).tracks.items.filter(Boolean);
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
  $('mlEnqueue').addEventListener('click', () => rows[pick] && addToList([rows[pick]]));
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
      findMusic();
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
      clearList();
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
        // One of the person's own playlists, by name.
        const mine = playlists.find((p) => q.toLowerCase().includes(p.name.toLowerCase()) && p.name.length > 2);
        if (mine) {
          await openNode(mine.id);
          await playList(rows);
          return `reproduciendo tu playlist ${mine.name}`;
        }
        const r = await api(`/search?${new URLSearchParams({ q, type: 'track,artist,album,playlist', limit: '5' })}`);
        const kind = /playlist/i.test(q) ? 'playlist' : /álbum|album|disco/i.test(q) ? 'album' : /artista|artist/i.test(q) ? 'artist' : 'track';
        if (kind === 'playlist' && r.playlists.items.find(Boolean)) {
          const p = r.playlists.items.find(Boolean);
          await playList(await playlistTracks(p.id));
          return `reproduciendo la playlist ${p.name}`;
        }
        if (kind === 'album' && r.albums.items.find(Boolean)) {
          const a = await api(`/albums/${r.albums.items.find(Boolean).id}`);
          await playList(a.tracks.items.map((t) => ({ ...t, album: a })));
          return `reproduciendo el álbum ${a.name} de ${artists(a)}`;
        }
        if (kind === 'artist' && r.artists.items.find(Boolean)) {
          const a = r.artists.items.find(Boolean);
          await playList((await api(`/artists/${a.id}/top-tracks?market=from_token`)).tracks);
          return `reproduciendo lo más escuchado de ${a.name}`;
        }
        const tracks = r.tracks.items.filter(Boolean);
        if (!tracks.length) return 'no encontré nada';
        $('query').value = q;
        lastQuery = q;
        node = 'search';
        rows = tracks;
        renderTree();
        renderRows();
        await playList(tracks);
        return `reproduciendo ${tracks[0].name} de ${artists(tracks[0])}`;
      },
    },
    pause: { description: 'Pausa la música.', params: {}, run: () => (device.player?.pause(), 'en pausa') },
    resume: { description: 'Sigue reproduciendo.', params: {}, run: () => (act.play(), 'reproduciendo') },
    next: { description: 'Pasa a la siguiente canción.', params: {}, run: () => (act.next(), 'siguiente canción') },
    previous: { description: 'Regresa a la canción anterior.', params: {}, run: () => (act.prev(), 'canción anterior') },
    now: { description: 'Qué canción está sonando.', params: {}, run: nowPlaying },
  };
  for (const [name, action] of Object.entries(actions)) window.cassiel.actions.register(name, action);

  // The tokens and the volume come with the SDK's storage, once it is ready.
  window.cassiel.ready.then(async () => {
    try {
      const v = localStorage.getItem('player.volume');
      if (v !== null) $('volume').value = v;
    } catch {
      /* default */
    }
    fill($('volume'));
    await account();
    openNode('search');
  });
  fill($('volume'));
  renderQueue();
  renderPlayer();
  renderTree();
  renderRows();
})();
