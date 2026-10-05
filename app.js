// Winamp for Spotify: Winamp 2 (winamp.js, player.js) and a Media Library, playing
// Spotify. Sign in (Premium plays); the library's tree has Search, Liked Songs and your
// playlists; double-click a song to play from there in Winamp. Cass can search, play,
// pause and skip.
(() => {
  const { api, connect, device } = window.SpotifyBridge;
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

  // ---------------------------------------------------------------- the player

  const player = window.WinampPlayer;
  const playList = (tracks, from = 0) => {
    const playable = tracks.filter((t) => t?.uri?.startsWith('spotify:track:'));
    if (!playable.length) return status('Nothing playable there.');
    if (!device.id) return status(device.error || 'Spotify is still starting on this device; try again in a moment.');
    status('');
    player.load(playable, from);
  };
  const enqueue = (tracks) => {
    const playable = tracks.filter((t) => t?.uri?.startsWith('spotify:track:'));
    player.append(playable);
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
  // Winamp's eject and ADD: find music here.
  window.addEventListener('winamp-find', () => {
    $('query').focus();
    $('query').select();
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
      player.stop();
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
    pause: { description: 'Pausa la música.', params: {}, run: () => (player.state.status === 'play' && player.pause(), 'en pausa') },
    resume: { description: 'Sigue reproduciendo.', params: {}, run: () => (player.state.status !== 'play' && player.play(), 'reproduciendo') },
    next: { description: 'Pasa a la siguiente canción.', params: {}, run: () => (player.next(), 'siguiente canción') },
    previous: { description: 'Regresa a la canción anterior.', params: {}, run: () => (player.previous(), 'canción anterior') },
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
