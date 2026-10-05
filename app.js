// Winamp for Spotify: Webamp (the Winamp of the web) playing Spotify. Sign in with
// Spotify (Premium plays), find songs, artists, albums and playlists, or open your own
// playlists and Liked Songs; double-click (or Enter) plays from there in Webamp. Cass
// can search, play, pause and skip.
(() => {
  const { api, connect, device, SpotifyMedia, toTrack } = window.Spotify4Webamp;
  const auth = window.SpotifyAuth;
  const $ = (id) => document.getElementById(id);
  const list = $('list');

  // Webamp, its windows stacked in the left column; they can still be moved.
  const webamp = new window.Webamp({
    __customMediaClass: SpotifyMedia,
    windowLayout: {
      main: { position: { left: 0, top: 0 } },
      equalizer: { position: { left: 0, top: 116 } },
      playlist: { position: { left: 0, top: 232 }, size: { extraHeight: 4, extraWidth: 0 } },
    },
    enableHotkeys: false,
    zIndex: 1,
  });
  webamp.renderInto($('deck'));

  // No desktop title bar: Webamp's are the window's. Dragging one moves the Cassiel
  // window (not Webamp's window inside it), a double click maximizes it, and Webamp's
  // close and minimize act on it. Its other keys (shade, the equalizer's and playlist's
  // close) stay Webamp's.
  const BARS = '#title-bar, .equalizer-top, .playlist-top';
  const KEYS = '#option-context, #minimize, #shade, #close, #equalizer-shade, #equalizer-close, #playlist-shade-button, #playlist-close-button';
  const onBar = (e) => e.target.closest?.(BARS) && !e.target.closest(KEYS);
  for (const kind of ['mousedown', 'touchstart']) addEventListener(kind, (e) => onBar(e) && e.stopPropagation(), true);
  addEventListener(
    'pointerdown',
    (e) => {
      if (e.button !== 0 || !onBar(e)) return;
      e.stopPropagation();
      let x = e.screenX;
      let y = e.screenY;
      const move = (m) => {
        const dx = m.screenX - x;
        const dy = m.screenY - y;
        if (!dx && !dy) return;
        x = m.screenX;
        y = m.screenY;
        window.cassiel.window.moveBy(dx, dy);
      };
      const up = () => {
        removeEventListener('pointermove', move);
        removeEventListener('pointerup', up);
        removeEventListener('pointercancel', up);
      };
      addEventListener('pointermove', move);
      addEventListener('pointerup', up);
      addEventListener('pointercancel', up);
    },
    true,
  );
  addEventListener(
    'dblclick',
    (e) => {
      if (!onBar(e)) return;
      e.stopPropagation();
      window.cassiel.window.toggleMaximize();
    },
    true,
  );
  webamp.onWillClose((cancel) => {
    cancel();
    window.cassiel.close();
  });
  webamp.onMinimize(() => window.cassiel.window.minimize());

  // The library window's title, in the frame's own letters; its frame turns gold while
  // the app has the focus, as Winamp's windows do.
  for (const ch of 'SPOTIFY LIBRARY')
    $('libraryTitle').append(Object.assign(document.createElement('div'), { className: `gen-text-letter gen-text-${ch === ' ' ? 'space' : ch.toLowerCase()}` }));
  const focused = () => $('libraryWindow').classList.toggle('selected', document.hasFocus());
  addEventListener('focus', focused);
  addEventListener('blur', focused);
  focused();

  let tab = 'search';
  let rows = []; // what the list shows: { kind, title, sub, art, time, play }
  let selected = -1;
  let lastQuery = '';

  const status = (text) => ($('status').textContent = text || 'Unofficial. Not made by or affiliated with Spotify or Winamp.');
  window.addEventListener('spotify-error', (e) => status(e.detail));
  const minutes = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

  /** Plays Spotify tracks in Webamp, from the first. */
  const playTracks = (tracks) => {
    const playable = tracks.filter((t) => t && t.uri?.startsWith('spotify:track:'));
    if (!playable.length) return status('Nothing playable there.');
    if (!device.id) return status(device.error || 'Spotify is still starting on this device; try again in a moment.');
    status('');
    webamp.setTracksToPlay(playable.map(toTrack));
  };

  function render() {
    list.replaceChildren();
    if (!auth.signedIn()) return note('Sign in with Spotify to search and play. Playing needs Spotify Premium.');
    if (!rows.length) return note(tab === 'search' ? (lastQuery ? 'Nothing found.' : 'Type to search Spotify.') : 'Nothing here yet.');
    rows.forEach((row, i) => {
      const li = document.createElement('li');
      li.setAttribute('aria-selected', String(i === selected));
      // As a playlist line: number, title, then what it is, dimmer; time on the right.
      const text = document.createElement('span');
      text.className = 'text';
      text.append(`${i + 1}. ${row.title}  `, Object.assign(document.createElement('small'), { textContent: row.sub }));
      li.append(text, Object.assign(document.createElement('span'), { className: 'time', textContent: row.time ?? '' }));
      li.addEventListener('click', () => ((selected = i), render()));
      li.addEventListener('dblclick', () => run(row));
      list.append(li);
    });
  }
  const note = (text) => list.append(Object.assign(document.createElement('li'), { className: 'note', textContent: text }));
  const run = async (row) => {
    try {
      device.player?.activateElement?.();
      await row.play();
    } catch (e) {
      status(e.message);
    }
  };

  // Rows for each kind of thing Spotify returns.
  const trackRow = (t, all) => ({
    kind: 'track',
    title: t.name,
    sub: `${t.artists.map((a) => a.name).join(', ')} / ${t.album?.name ?? ''}`,
    art: t.album?.images?.at(-1)?.url,
    time: minutes(t.duration_ms),
    play: () => playTracks(all.slice(all.indexOf(t))),
  });
  const collectionRow = (kind, item, sub, tracksOf) => ({
    kind,
    title: item.name,
    sub,
    art: item.images?.at(-1)?.url,
    play: async () => playTracks(await tracksOf(item)),
  });
  const playlistTracks = async (p) => (await api(`/playlists/${p.id}/tracks?limit=100`)).items.map((i) => i.track);
  const albumTracks = async (a) => {
    const album = await api(`/albums/${a.id}`);
    return album.tracks.items.map((t) => ({ ...t, album }));
  };
  const artistTracks = async (a) => (await api(`/artists/${a.id}/top-tracks?market=from_token`)).tracks;

  async function search(q) {
    lastQuery = q;
    const r = await api(`/search?${new URLSearchParams({ q, type: 'track,artist,album,playlist', limit: '8' })}`);
    const tracks = r.tracks.items.filter(Boolean);
    return [
      ...tracks.map((t) => trackRow(t, tracks)),
      ...r.artists.items.filter(Boolean).map((a) => collectionRow('artist', a, 'Artist: its top songs', artistTracks)),
      ...r.albums.items.filter(Boolean).map((a) => collectionRow('album', a, `Album / ${a.artists.map((x) => x.name).join(', ')}`, albumTracks)),
      ...r.playlists.items.filter(Boolean).map((p) => collectionRow('playlist', p, `Playlist / ${p.owner?.display_name ?? ''}`, playlistTracks)),
    ];
  }
  const myPlaylists = async () =>
    (await api('/me/playlists?limit=50')).items.filter(Boolean).map((p) => collectionRow('playlist', p, `${p.tracks?.total ?? ''} songs`, playlistTracks));
  async function liked() {
    const tracks = (await api('/me/tracks?limit=50')).items.map((i) => i.track);
    return tracks.map((t) => trackRow(t, tracks));
  }

  async function show(nextTab) {
    tab = nextTab;
    for (const b of document.querySelectorAll('[role=tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    selected = -1;
    rows = [];
    render();
    if (!auth.signedIn()) return;
    try {
      rows = tab === 'search' ? (lastQuery ? await search(lastQuery) : []) : tab === 'playlists' ? await myPlaylists() : await liked();
    } catch (e) {
      status(e.message);
    }
    render();
  }

  async function account() {
    setMenus();
    if (!auth.signedIn()) {
      $('who').textContent = 'Not signed in';
      $('sign').textContent = 'Sign in with Spotify';
      return;
    }
    $('sign').textContent = 'Sign out';
    try {
      const me = await api('/me');
      $('who').textContent = `${me.display_name ?? me.id}${me.product === 'premium' ? '' : ' (playing needs Premium)'}`;
      connect();
    } catch (e) {
      $('who').textContent = 'Signed in';
      status(e.message);
    }
  }

  $('sign').addEventListener('click', async () => {
    if (auth.signedIn()) {
      auth.signOut();
      device.player?.disconnect();
      await account();
      return show(tab);
    }
    try {
      await auth.signIn();
      status('');
      await account();
      show(tab);
    } catch (e) {
      status(e.message);
    }
  });
  $('search').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = $('query').value.trim();
    if (!q) return;
    lastQuery = q;
    show('search');
  });
  for (const b of document.querySelectorAll('[role=tab]')) b.addEventListener('click', () => show(b.dataset.tab));
  list.addEventListener('keydown', (e) => {
    if (!rows.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      selected = Math.max(0, Math.min(rows.length - 1, selected + (e.key === 'ArrowDown' ? 1 : -1)));
      render();
    } else if (e.key === 'Enter' && rows[selected]) run(rows[selected]);
  });
  device.listeners.add(() => device.error && status(device.error));

  /** The menu bar; set again when signing in or out (its first item says which). */
  const setMenus = () => window.cassiel.menu.set([
    {
      label: '&Spotify',
      items: [
        { label: auth.signedIn() ? 'Sign &Out' : 'Sign &In…', action: () => $('sign').click() },
        'separator',
        { label: '&Search…', shortcut: 'Ctrl+F', action: () => ($('query').focus(), $('query').select()) },
        { label: 'My &Playlists', action: () => show('playlists') },
        { label: '&Liked Songs', action: () => show('liked') },
      ],
    },
    {
      label: '&Play',
      items: [
        { label: '&Play', action: () => webamp.play() },
        { label: 'P&ause', action: () => webamp.pause() },
        { label: '&Stop', action: () => webamp.stop() },
        'separator',
        { label: '&Next', action: () => webamp.nextTrack() },
        { label: 'P&revious', action: () => webamp.previousTrack() },
      ],
    },
    {
      label: '&Help',
      items: [
        {
          label: '&About',
          action: () =>
            window.cassiel.dialog.alert(
              'About',
              'Winamp for Spotify 0.1\n\nPlays Spotify in Webamp, the Winamp of the web by Jordan Eldredge (MIT). Needs Spotify Premium.\n\n' +
                'Unofficial: not made by, affiliated with or endorsed by Spotify or Winamp. Spotify and its music belong to Spotify AB; Winamp is a trademark of its owners.',
            ),
        },
      ],
    },
  ]);

  // What Cass can do here. Its words go to the model, so they are in its language.
  const nowPlaying = () => {
    const t = device.state?.track_window?.current_track;
    if (!t) return 'no suena nada en Winamp for Spotify';
    return `${device.state.paused ? 'en pausa' : 'sonando'}: ${t.name} de ${t.artists.map((a) => a.name).join(', ')} (${t.album?.name ?? ''})`;
  };
  const actions = {
    play: {
      description: 'Busca en Spotify y reproduce en Winamp: una canción, un artista (sus canciones más populares), un álbum o una playlist. Dile qué buscar.',
      params: { query: 'qué buscar, por ejemplo "Bohemian Rhapsody" o "playlist lofi"' },
      run: async ({ query }) => {
        if (!auth.signedIn()) throw new Error('la persona no ha iniciado sesión en Spotify');
        const found = await search(String(query ?? ''));
        $('query').value = String(query ?? '');
        rows = found;
        tab = 'search';
        render();
        const wantsList = /playlist|álbum|album|artista|artist/i.test(String(query));
        const pick = (wantsList && found.find((r) => r.kind !== 'track')) || found[0];
        if (!pick) return 'no encontré nada';
        await pick.play();
        return `reproduciendo ${pick.kind === 'track' ? 'la canción' : pick.kind === 'artist' ? 'al artista' : pick.kind === 'album' ? 'el álbum' : 'la playlist'} ${pick.title} (${pick.sub})`;
      },
    },
    pause: { description: 'Pausa la música.', params: {}, run: () => (webamp.pause(), 'en pausa') },
    resume: { description: 'Sigue reproduciendo.', params: {}, run: () => (webamp.play(), 'reproduciendo') },
    next: { description: 'Pasa a la siguiente canción.', params: {}, run: () => (webamp.nextTrack(), 'siguiente canción') },
    previous: { description: 'Regresa a la canción anterior.', params: {}, run: () => (webamp.previousTrack(), 'canción anterior') },
    now: { description: 'Qué canción está sonando.', params: {}, run: nowPlaying },
  };
  for (const [name, action] of Object.entries(actions)) window.cassiel.actions.register(name, action);

  // Tokens come with the SDK's storage, once it is ready.
  window.cassiel.ready.then(async () => {
    await account();
    show('search');
  });
  render();
})();
