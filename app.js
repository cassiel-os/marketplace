// Winamp for Spotify: classic Winamp, drawn sharp at any size, playing Spotify. Sign in
// (Premium plays), find music in the library on the right, double-click to play it; the
// playlist is what was sent to Spotify, which keeps moving through it (shuffle and
// repeat are Spotify's). The window has no title bar of the desktop's: the app draws
// Winamp's. Cass can search, play, pause and skip.
(() => {
  const { api, connect, device, playUris, enqueue, setShuffle, setRepeat } = window.SpotifyPlayer;
  const auth = window.SpotifyAuth;
  const $ = (id) => document.getElementById(id);

  const clock = (ms) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };
  const short = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
  const artists = (t) => t.artists?.map((a) => a.name).join(', ') ?? '';
  const status = (text) => ($('status').textContent = text || 'Unofficial. Not made by or affiliated with Spotify or Winamp.');
  const fill = (input) => input.style.setProperty('--p', `${((input.value - input.min) / (input.max - input.min)) * 100}%`);

  // ---------------------------------------------------------------- the playlist

  let queue = []; // the songs sent to Spotify, in order
  let selected = -1;
  const currentIndex = () => {
    const t = device.state?.track_window?.current_track;
    return t ? queue.findIndex((q) => q.uri === t.uri || q.uri === t.linked_from?.uri) : -1;
  };

  async function playList(tracks, from = 0) {
    const playable = tracks.filter((t) => t?.uri?.startsWith('spotify:track:'));
    if (!playable.length) return status('Nothing playable there.');
    queue = playable;
    selected = -1;
    renderQueue();
    try {
      device.player?.activateElement?.();
      await playUris(queue.map((t) => t.uri), Math.min(from, queue.length - 1));
      status('');
    } catch (e) {
      status(e.message);
    }
  }
  async function addToList(track) {
    try {
      if (!queue.length) return playList([track]);
      await enqueue(track.uri);
      queue.push(track);
      renderQueue();
      status(`Added ${track.name}.`);
    } catch (e) {
      status(e.message);
    }
  }

  function renderQueue() {
    const list = $('queue');
    list.replaceChildren();
    if (!queue.length) {
      list.append(Object.assign(document.createElement('li'), { className: 'empty', textContent: 'Double-click something in the library to play it here.' }));
      return;
    }
    const current = currentIndex();
    queue.forEach((t, i) => {
      const li = document.createElement('li');
      li.className = i === current ? 'current' : '';
      li.setAttribute('aria-selected', String(i === selected));
      li.append(
        Object.assign(document.createElement('span'), { textContent: `${i + 1}. ${artists(t)} - ${t.name}` }),
        Object.assign(document.createElement('span'), { className: 'len', textContent: short(t.duration_ms) }),
      );
      li.addEventListener('click', () => ((selected = i), renderQueue()));
      li.addEventListener('dblclick', () => playList(queue, i));
      list.append(li);
    });
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
    $('state').textContent = playing ? '▶' : s ? '❚❚' : '■';
    const index = currentIndex();
    $('song').textContent = t
      ? `${index >= 0 ? `${index + 1}. ` : ''}${artists(t)} - ${t.name} (${short(s.duration)})`
      : auth.signedIn()
        ? 'WINAMP FOR SPOTIFY'
        : 'SIGN IN WITH SPOTIFY TO PLAY';
    $('album').textContent = t?.album?.name ?? 'SPOTIFY';
    $('device').textContent = device.id ? 'CASSIEL' : device.error ? 'OFF' : '...';
    if (!seeking) {
      $('seek').value = s?.duration ? Math.round((position / s.duration) * 1000) : 0;
      fill($('seek'));
    }
    $('shuffle').setAttribute('aria-pressed', String(!!s?.shuffle));
    $('repeat').setAttribute('aria-pressed', String(!!s?.repeat_mode));
    if (t?.uri !== shownUri) {
      shownUri = t?.uri;
      renderQueue();
    }
    // The spectrum is for the look: Spotify's sound cannot be measured here.
    for (const bar of bars) bar.style.height = playing ? `${8 + Math.random() * 92}%` : '0%';
  }
  device.listeners.add(() => {
    stateAt = performance.now();
    if (device.error) status(device.error);
    renderPlayer();
  });
  setInterval(() => device.state && !device.state.paused && renderPlayer(), 250);

  const act = {
    prev: () => device.player?.previousTrack(),
    play: () => {
      device.player?.activateElement?.();
      if (device.state) device.player.resume();
      else if (queue.length) playList(queue, Math.max(0, selected));
    },
    pause: () => device.player?.togglePlay(),
    stop: () => device.player?.pause().then(() => device.player.seek(0)),
    next: () => device.player?.nextTrack(),
  };
  for (const name of ['prev', 'play', 'pause', 'stop', 'next']) $(name).addEventListener('click', act[name]);
  for (const b of document.querySelectorAll('[data-act]')) b.addEventListener('click', () => act[b.dataset.act]());
  $('eject').addEventListener('click', () => ($('query').focus(), $('query').select()));
  $('display').addEventListener('click', () => ((remaining = !remaining), renderPlayer()));

  $('seek').addEventListener('input', () => ((seeking = true), fill($('seek'))));
  $('seek').addEventListener('change', () => {
    seeking = false;
    if (device.state?.duration) device.player?.seek(Math.round((device.state.duration * $('seek').value) / 1000));
  });
  $('volume').addEventListener('input', () => {
    fill($('volume'));
    device.player?.setVolume($('volume').value / 100);
    status(`Volume: ${$('volume').value}%`);
    try {
      localStorage.setItem('player.volume', $('volume').value);
    } catch {
      /* not kept */
    }
  });
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

  // The equalizer's look: bands at 0 dB (Spotify's audio cannot be shaped).
  $('bands').append(
    Object.assign(document.createElement('div'), { className: 'band preamp', innerHTML: '<i></i><span>PREAMP</span>' }),
    Object.assign(document.createElement('div'), { className: 'db', innerHTML: '<span>+12 db</span><span>+0 db</span><span>-12 db</span>' }),
    ...['60', '170', '310', '600', '1K', '3K', '6K', '12K', '14K', '16K'].map((f) =>
      Object.assign(document.createElement('div'), { className: 'band', innerHTML: `<i></i><span>${f}</span>` }),
    ),
  );

  $('add').addEventListener('click', (e) => {
    e.stopPropagation();
    $('addMenu').hidden = !$('addMenu').hidden;
  });
  addEventListener('click', () => ($('addMenu').hidden = true));
  for (const b of document.querySelectorAll('[data-go]'))
    b.addEventListener('click', () => (b.dataset.go === 'search' ? ($('query').focus(), show('search')) : show(b.dataset.go)));
  $('clear').addEventListener('click', () => {
    device.player?.pause();
    queue = [];
    selected = -1;
    renderQueue();
  });

  // ---------------------------------------------------------------- the library

  let tab = 'search';
  let rows = [];
  let pick = -1;
  let lastQuery = '';

  const trackRow = (t, all) => ({
    kind: 'track',
    title: t.name,
    sub: `${artists(t)} / ${t.album?.name ?? ''}`,
    art: t.album?.images?.at(-1)?.url,
    len: short(t.duration_ms),
    play: () => playList(all, all.indexOf(t)),
    add: () => addToList(t),
  });
  const collectionRow = (kind, item, sub, tracksOf) => ({
    kind,
    title: item.name,
    sub,
    art: item.images?.at(-1)?.url,
    play: async () => playList(await tracksOf(item)),
    add: async () => {
      for (const t of await tracksOf(item)) await addToList(t);
    },
  });
  const playlistTracks = async (p) => (await api(`/playlists/${p.id}/tracks?limit=100`)).items.map((i) => i.track).filter(Boolean);
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
      ...r.artists.items.filter(Boolean).map((a) => collectionRow('artist', a, 'Artist / top songs', artistTracks)),
      ...r.albums.items.filter(Boolean).map((a) => collectionRow('album', a, `Album / ${artists(a)}`, albumTracks)),
      ...r.playlists.items.filter(Boolean).map((p) => collectionRow('playlist', p, `Playlist / ${p.owner?.display_name ?? ''}`, playlistTracks)),
    ];
  }

  function renderResults() {
    const list = $('results');
    list.replaceChildren();
    const empty = (text) => list.append(Object.assign(document.createElement('li'), { className: 'empty', textContent: text }));
    if (!auth.signedIn()) return empty('Sign in with Spotify to find music. Playing needs Spotify Premium.');
    if (!rows.length) return empty(tab === 'search' ? (lastQuery ? 'Nothing found.' : 'Type to search Spotify.') : 'Nothing here yet.');
    rows.forEach((row, i) => {
      const li = document.createElement('li');
      li.setAttribute('aria-selected', String(i === pick));
      const art = row.art ? Object.assign(document.createElement('img'), { src: row.art, alt: '', loading: 'lazy' }) : Object.assign(document.createElement('span'), { className: 'noart' });
      const text = document.createElement('span');
      text.className = 'text';
      text.append(Object.assign(document.createElement('strong'), { textContent: row.title }), Object.assign(document.createElement('small'), { textContent: row.sub }));
      const add = Object.assign(document.createElement('button'), { className: 'btn add', textContent: '+ ADD' });
      add.addEventListener('click', (e) => (e.stopPropagation(), row.add()));
      li.append(art, text, add, Object.assign(document.createElement('span'), { className: 'len', textContent: row.len ?? '' }));
      li.addEventListener('click', () => ((pick = i), renderResults()));
      li.addEventListener('dblclick', () => row.play());
      list.append(li);
    });
  }

  async function show(next) {
    tab = next;
    for (const b of document.querySelectorAll('[role=tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    rows = [];
    pick = -1;
    renderResults();
    if (!auth.signedIn()) return;
    try {
      if (tab === 'search') rows = lastQuery ? await search(lastQuery) : [];
      else if (tab === 'playlists')
        rows = (await api('/me/playlists?limit=50')).items.filter(Boolean).map((p) => collectionRow('playlist', p, `${p.tracks?.total ?? ''} songs`, playlistTracks));
      else {
        const tracks = (await api('/me/tracks?limit=50')).items.map((i) => i.track);
        rows = tracks.map((t) => trackRow(t, tracks));
      }
    } catch (e) {
      status(e.message);
    }
    renderResults();
  }

  $('search').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = $('query').value.trim();
    if (!q) return;
    lastQuery = q;
    show('search');
  });
  for (const b of document.querySelectorAll('[role=tab]')) b.addEventListener('click', () => show(b.dataset.tab));
  $('results').addEventListener('keydown', (e) => {
    if (!rows.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      pick = Math.max(0, Math.min(rows.length - 1, pick + (e.key === 'ArrowDown' ? 1 : -1)));
      renderResults();
    } else if (e.key === 'Enter' && rows[pick]) rows[pick].play();
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
      $('who').textContent = 'Not signed in';
      $('sign').textContent = 'SIGN IN';
      return;
    }
    $('sign').textContent = 'SIGN OUT';
    try {
      const me = await api('/me');
      $('who').textContent = `${me.display_name ?? me.id}${me.product === 'premium' ? '' : ' (playing needs Premium)'}`;
      connect();
    } catch (e) {
      status(e.message);
    }
  }
  $('sign').addEventListener('click', async () => {
    if (auth.signedIn()) {
      auth.signOut();
      device.player?.disconnect();
      queue = [];
      renderQueue();
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

  // ---------------------------------------------------------------- Cass

  // What Cass can do here. Its words go to the model, so they are in its language.
  const nowPlaying = () => {
    const t = device.state?.track_window?.current_track;
    if (!t) return 'no suena nada en Winamp for Spotify';
    return `${device.state.paused ? 'en pausa' : 'sonando'}: ${t.name} de ${artists(t)} (${t.album?.name ?? ''})`;
  };
  const actions = {
    play: {
      description: 'Busca en Spotify y reproduce: una canción, un artista (sus canciones más populares), un álbum o una playlist. Dile qué buscar.',
      params: { query: 'qué buscar, por ejemplo "Bohemian Rhapsody" o "playlist lofi"' },
      run: async ({ query }) => {
        if (!auth.signedIn()) throw new Error('la persona no ha iniciado sesión en Spotify');
        const q = String(query ?? '');
        $('query').value = q;
        rows = await search(q);
        tab = 'search';
        renderResults();
        const wantsList = /playlist|álbum|album|artista|artist/i.test(q);
        const choice = (wantsList && rows.find((r) => r.kind !== 'track')) || rows[0];
        if (!choice) return 'no encontré nada';
        await choice.play();
        const what = { track: 'la canción', artist: 'al artista', album: 'el álbum', playlist: 'la playlist' }[choice.kind];
        return `reproduciendo ${what} ${choice.title} (${choice.sub})`;
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
    show('search');
  });
  fill($('volume'));
  fill($('seek'));
  renderQueue();
  renderPlayer();
  renderResults();
})();
