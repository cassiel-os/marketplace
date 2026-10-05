// Spotify in Cassiel (unofficial): Spotify's own embedded player, driven through its
// iframe API. A link (or a spotify: URI) to a song, album, playlist, artist, podcast or
// episode opens in it; with Spotify Premium signed in it plays in full, otherwise
// Spotify plays previews. Cass finds what to play (web_search) and opens it here.
(() => {
  const TYPES = ['track', 'album', 'playlist', 'artist', 'show', 'episode'];
  const RECENT_KEY = 'spotify.recent';
  const RECENT_MAX = 10;
  const $ = (id) => document.getElementById(id);

  let controller = null; // Spotify's player, once its API has loaded
  let waiting = null; // a URI asked for before then
  let current = null; // { uri, link }
  let playback = { paused: true, position: 0, duration: 0, playing: null }; // playing: the song's URI
  let playWhenReady = false; // the embed reloads with each link: play once it is ready

  /** spotify:<type>:<id> for a Spotify link or URI, or null. */
  const toUri = (text) => {
    const raw = String(text ?? '').trim();
    const uri = /^spotify:(\w+):([A-Za-z0-9]+)$/.exec(raw);
    if (uri && TYPES.includes(uri[1])) return `spotify:${uri[1]}:${uri[2]}`;
    try {
      const url = new URL(/^https?:\/\//.test(raw) ? raw : `https://${raw}`);
      if (url.hostname !== 'open.spotify.com') return null;
      const parts = url.pathname.split('/').filter((p) => p && !p.startsWith('intl-') && p !== 'embed');
      return TYPES.includes(parts[0]) && /^[A-Za-z0-9]+$/.test(parts[1] ?? '') ? `spotify:${parts[0]}:${parts[1]}` : null;
    } catch {
      return null;
    }
  };
  const toLink = (uri) => `https://open.spotify.com/${uri.split(':').slice(1).join('/')}`;
  const KIND = { track: 'song', album: 'album', playlist: 'playlist', artist: 'artist', show: 'podcast', episode: 'episode' };

  const read = (key, fallback) => {
    try {
      const kept = localStorage.getItem(key);
      return kept === null ? fallback : JSON.parse(kept);
    } catch {
      return fallback;
    }
  };
  const remember = (link) => {
    const recent = [link, ...read(RECENT_KEY, []).filter((l) => l !== link)].slice(0, RECENT_MAX);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
    } catch {
      /* not kept this time */
    }
  };

  /** Opens a Spotify link in the player (and plays it, if `play`). Throws on anything else. */
  function open(text, play = true) {
    const uri = toUri(text);
    if (!uri) throw new Error('That is not a Spotify link.');
    current = { uri, link: toLink(uri) };
    $('empty').hidden = true;
    $('link').value = current.link;
    remember(current.link);
    setMenus();
    playback = { paused: true, position: 0, duration: 0, playing: null };
    if (!controller) waiting = { uri, play };
    else {
      playWhenReady = play;
      controller.loadEntity(uri);
    }
    return current;
  }

  // Spotify's iframe API calls this once it has loaded (the script is async).
  window.onSpotifyIframeApiReady = (api) => {
    const holder = document.createElement('div');
    $('embed').append(holder);
    api.createController(holder, { width: '100%', height: '100%', uri: waiting?.uri ?? '' }, (made) => {
      controller = made;
      controller.addListener('playback_update', (e) => {
        playback = { paused: e.data.isPaused, position: e.data.position, duration: e.data.duration, playing: e.data.playingURI ?? null };
      });
      // Browsers may block playing before the person has touched the page (Safari
      // always does): then Spotify's own play button starts it.
      controller.addListener('ready', () => {
        if (!playWhenReady) return;
        playWhenReady = false;
        controller.play();
      });
      playWhenReady = !!waiting?.play;
      waiting = null;
    });
  };

  $('bar').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      open($('link').value);
    } catch (err) {
      await window.cassiel.dialog.alert('Spotify', `${err.message} Copy one from Spotify with Share > Copy link.`);
    }
  });

  const minutes = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

  /** The menu bar; set again when the recent links change. */
  const setMenus = () => window.cassiel.menu.set([
    {
      label: '&File',
      items: [
        { label: '&Open Link…', shortcut: 'Ctrl+L', action: () => ($('link').select(), $('link').focus()) },
        {
          label: '&Recent',
          items: read(RECENT_KEY, []).length
            ? read(RECENT_KEY, []).map((link) => ({ label: link.replace('https://open.spotify.com/', ''), action: () => open(link) }))
            : [{ label: '(None)', enabled: false }],
        },
      ],
    },
    {
      label: '&Play',
      items: [
        { label: '&Play/Pause', shortcut: 'Space', enabled: () => !!controller && !!current, action: () => controller.togglePlay() },
        { label: '&Back 15 Seconds', enabled: () => !!controller && !!current, action: () => controller.seek(Math.max(0, playback.position / 1000 - 15)) },
        { label: '&Ahead 15 Seconds', enabled: () => !!controller && !!current, action: () => controller.seek(playback.position / 1000 + 15) },
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
              'Spotify for Cassiel 0.1\n\nAn unofficial app: it is not made by Spotify, nor affiliated with or endorsed by it. ' +
                'It shows Spotify\'s own player; Spotify, its music and its logo belong to Spotify AB.',
            ),
        },
      ],
    },
  ]);
  addEventListener('keydown', (e) => {
    if (e.key === ' ' && e.target === document.body && controller && current) {
      e.preventDefault();
      controller.togglePlay();
    }
  });

  // What Cass can do here. Its words go to the model, so they are in its language.
  const actions = {
    play: {
      description:
        'Abre y reproduce en Spotify una canción, álbum, playlist, artista o podcast. Necesita su dirección de open.spotify.com: búscala antes con web_search (por ejemplo "site:open.spotify.com playlist lofi"); nunca la inventes.',
      params: { link: 'dirección de open.spotify.com o URI spotify:' },
      run: ({ link }) => {
        const { uri } = open(link);
        return `abriendo ${KIND[uri.split(':')[1]]} en Spotify`;
      },
    },
    pause: {
      description: 'Pausa la música de Spotify.',
      params: {},
      run: () => {
        if (!controller || !current) throw new Error('no hay nada abierto en Spotify');
        controller.pause();
        return 'en pausa';
      },
    },
    resume: {
      description: 'Sigue reproduciendo la música de Spotify.',
      params: {},
      run: () => {
        if (!controller || !current) throw new Error('no hay nada abierto en Spotify');
        controller.resume();
        return 'reproduciendo';
      },
    },
    now: {
      description: 'Qué está abierto en Spotify, qué canción suena (su dirección; ábrela con web_open si necesitas el título) y si está en pausa.',
      params: {},
      run: () =>
        current
          ? `${KIND[current.uri.split(':')[1]]} ${current.link}, ${playback.paused ? 'en pausa' : 'sonando'}` +
            (playback.playing && playback.playing !== current.uri ? `; la canción es ${toLink(playback.playing)}` : '') +
            (playback.duration ? ` (${minutes(playback.position)} de ${minutes(playback.duration)})` : '')
          : 'no hay nada abierto en Spotify',
    },
  };
  for (const [name, action] of Object.entries(actions)) window.cassiel.actions.register(name, action);

  // Opened with a link (Cass, or a file): play it. The recent links are kept by the SDK,
  // in once it is ready.
  window.cassiel.ready.then(({ props }) => {
    setMenus();
    const link = props?.url ?? props?.link;
    if (link) {
      try {
        open(link);
      } catch {
        /* not a Spotify link: stays empty */
      }
    }
  });
})();
