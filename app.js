// Spotify in Cassiel (unofficial), after Spotify's iFrame API playground: Spotify's own
// embedded player, created once its API has loaded, already showing something (the link
// the app was opened with, the last one played, or a playlist to start with), with Play
// and Pause under it and what is playing. Another link loads into the same player
// (loadEntity). With Spotify Premium signed in it plays in full; otherwise Spotify plays
// previews. Cass finds what to play (web_search) and opens it here.
(() => {
  const TYPES = ['track', 'album', 'playlist', 'artist', 'show', 'episode'];
  const START = 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M'; // Today's Top Hits
  const RECENT_KEY = 'spotify.recent';
  const RECENT_MAX = 10;
  const $ = (id) => document.getElementById(id);

  let controller = null; // Spotify's player, once created
  let loaded = null; // the link in it
  let wanted = null; // a link asked for before the player exists: { link, play }
  let playWhenReady = false; // the player reloads with each link: play once it is ready
  let playback = { paused: true, buffering: false, position: 0, duration: 0, playing: null };

  /** The open.spotify.com link for a Spotify link or spotify: URI, or null. */
  const toLink = (text) => {
    const raw = String(text ?? '').trim();
    const uri = /^spotify:(\w+):([A-Za-z0-9]+)$/.exec(raw);
    if (uri) return TYPES.includes(uri[1]) ? `https://open.spotify.com/${uri[1]}/${uri[2]}` : null;
    try {
      const url = new URL(/^https?:\/\//.test(raw) ? raw : `https://${raw}`);
      if (url.hostname !== 'open.spotify.com') return null;
      const parts = url.pathname.split('/').filter((p) => p && !p.startsWith('intl-') && p !== 'embed');
      return TYPES.includes(parts[0]) && /^[A-Za-z0-9]+$/.test(parts[1] ?? '') ? `https://open.spotify.com/${parts[0]}/${parts[1]}` : null;
    } catch {
      return null;
    }
  };
  const kindOf = (link) => ({ track: 'song', album: 'album', playlist: 'playlist', artist: 'artist', show: 'podcast', episode: 'episode' })[link.split('/')[3]];
  const fromUri = (uri) => (uri ? toLink(uri) : null);
  const minutes = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

  const read = (key, fallback) => {
    try {
      const kept = localStorage.getItem(key);
      return kept === null ? fallback : JSON.parse(kept);
    } catch {
      return fallback;
    }
  };
  const remember = (link) => {
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify([link, ...read(RECENT_KEY, []).filter((l) => l !== link)].slice(0, RECENT_MAX)));
    } catch {
      /* not kept this time */
    }
  };

  function show() {
    const ready = !!controller && !!loaded;
    $('play').disabled = !ready || !playback.paused;
    $('pause').disabled = !ready || playback.paused;
    $('state').textContent = !ready
      ? ''
      : playback.buffering
        ? 'Loading…'
        : playback.duration
          ? `${playback.paused ? 'Paused' : 'Playing'} ${minutes(playback.position)} / ${minutes(playback.duration)}`
          : 'Ready';
  }

  /** Opens a Spotify link in the player (and plays it, if `play`). Throws on anything else. */
  function open(text, play = true) {
    const link = toLink(text);
    if (!link) throw new Error('That is not a Spotify link.');
    $('link').value = link;
    remember(link);
    setMenus();
    playback = { paused: true, buffering: false, position: 0, duration: 0, playing: null };
    if (!controller) {
      wanted = { link, play };
      return link;
    }
    loaded = link;
    playWhenReady = play;
    controller.loadEntity(link);
    show();
    return link;
  }

  // The player is made once both Spotify's iFrame API and the SDK are in (the SDK
  // brings the recent links and the link the app was opened with).
  let api = null;
  let sdkReady = false;
  window.onSpotifyIframeApiReady = (loadedApi) => {
    api = loadedApi;
    create();
  };
  let creating = false;
  function create() {
    if (!api || !sdkReady || creating) return;
    creating = true;
    const first = wanted?.link ?? read(RECENT_KEY, [])[0] ?? START;
    playWhenReady = !!wanted?.play;
    wanted = null;
    const holder = document.createElement('div');
    $('embed').append(holder);
    api.createController(holder, { width: '100%', height: '100%', url: first }, (made) => {
      controller = made;
      loaded = first;
      $('link').value = first;
      // A link asked for while the player was being made.
      if (wanted) {
        const { link, play } = wanted;
        wanted = null;
        open(link, play);
      }
      // Ready once at first and again after each loadEntity. A browser may refuse to
      // play before the person has touched the page (Safari always does): then
      // Spotify's own play button starts it.
      controller.addListener('ready', () => {
        $('loading').hidden = true;
        if (playWhenReady) {
          playWhenReady = false;
          controller.play();
        }
        show();
      });
      controller.addListener('playback_update', (e) => {
        const { position, duration, isBuffering, isPaused, playingURI } = e.data;
        playback = { paused: isPaused, buffering: isBuffering, position, duration, playing: playingURI ?? null };
        show();
      });
      show();
    });
  }
  const script = document.createElement('script');
  script.src = 'https://open.spotify.com/embed/iframe-api/v1';
  script.async = true;
  script.onerror = () => ($('loading').textContent = "Couldn't reach Spotify.");
  document.body.append(script);

  $('play').addEventListener('click', () => controller?.resume());
  $('pause').addEventListener('click', () => controller?.pause());
  $('bar').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      open($('link').value);
    } catch (err) {
      await window.cassiel.dialog.alert('Spotify', `${err.message} Copy one in Spotify with Share > Copy link.`);
    }
  });

  /** The menu bar; set again when the recent links change. */
  function setMenus() {
    const recent = read(RECENT_KEY, []);
    window.cassiel.menu.set([
      {
        label: '&File',
        items: [
          { label: '&Open Link…', shortcut: 'Ctrl+L', action: () => ($('link').select(), $('link').focus()) },
          {
            label: '&Recent',
            items: recent.length
              ? recent.map((link) => ({ label: link.replace('https://open.spotify.com/', ''), action: () => open(link) }))
              : [{ label: '(None)', enabled: false }],
          },
        ],
      },
      {
        label: '&Play',
        items: [
          { label: '&Play', enabled: () => !!loaded && playback.paused, action: () => controller.resume() },
          { label: 'P&ause', enabled: () => !!loaded && !playback.paused, action: () => controller.pause() },
          { label: '&Restart', enabled: () => !!loaded, action: () => controller.restart() },
          'separator',
          { label: '&Back 15 Seconds', enabled: () => !!loaded, action: () => controller.seek(Math.max(0, playback.position / 1000 - 15)) },
          { label: 'A&head 15 Seconds', enabled: () => !!loaded, action: () => controller.seek(playback.position / 1000 + 15) },
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
                'Spotify for Cassiel 0.3\n\nAn unofficial app: it is not made by Spotify, nor affiliated with or endorsed by it. ' +
                  "It shows Spotify's own player; Spotify, its music and its logo belong to Spotify AB.",
              ),
          },
        ],
      },
    ]);
  }

  // What Cass can do here. Its words go to the model, so they are in its language.
  const needsPlayer = () => {
    if (!controller || !loaded) throw new Error('Spotify todavía no está listo');
  };
  const actions = {
    play: {
      description:
        'Abre y reproduce en Spotify una canción, álbum, playlist, artista o podcast. Necesita su dirección de open.spotify.com: búscala antes con web_search (por ejemplo "site:open.spotify.com playlist lofi"); nunca la inventes.',
      params: { link: 'dirección de open.spotify.com o URI spotify:' },
      run: ({ link }) => `abriendo ${kindOf(open(link))} en Spotify`,
    },
    pause: {
      description: 'Pausa la música de Spotify.',
      params: {},
      run: () => (needsPlayer(), controller.pause(), 'en pausa'),
    },
    resume: {
      description: 'Sigue reproduciendo la música de Spotify.',
      params: {},
      run: () => (needsPlayer(), controller.resume(), 'reproduciendo'),
    },
    now: {
      description: 'Qué está abierto en Spotify, qué canción suena (su dirección; ábrela con web_open si necesitas el título) y si está en pausa.',
      params: {},
      run: () => {
        if (!loaded) return 'no hay nada abierto en Spotify';
        const song = fromUri(playback.playing);
        return (
          `${kindOf(loaded)} ${loaded}, ${playback.paused ? 'en pausa' : 'sonando'}` +
          (song && song !== loaded ? `; la canción es ${song}` : '') +
          (playback.duration ? ` (${minutes(playback.position)} de ${minutes(playback.duration)})` : '')
        );
      },
    },
  };
  for (const [name, action] of Object.entries(actions)) window.cassiel.actions.register(name, action);

  // Opened with a link (by Cass, or a file): that one, playing. Recent links are kept by
  // the SDK, in once it is ready.
  window.cassiel.ready.then(({ props }) => {
    setMenus();
    const link = props?.url ?? props?.link;
    if (link) {
      try {
        open(link);
      } catch {
        /* not a Spotify link: the player shows what it would anyway */
      }
    }
    sdkReady = true;
    create();
  });
  show();
})();
