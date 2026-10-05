// Spotify: the Web API (search, library, starting a song on this device) and the Web
// Playback SDK (this window becomes a Spotify Connect device, "Cassiel", and plays the
// music). Spotify's audio is protected: nothing here can process it.
(() => {
  const API = 'https://api.spotify.com/v1';

  /** A Web API call; null for a 204. */
  async function api(path, { method = 'GET', body } = {}) {
    const token = await window.SpotifyAuth.token();
    if (!token) throw new Error('Sign in to Spotify first.');
    const response = await fetch(path.startsWith('http') ? path : API + path, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (response.status === 204) return null;
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error?.message || `Spotify answered ${response.status}.`);
    return data;
  }

  // The device: Spotify's Web Playback SDK, loaded once signed in.
  const device = { player: null, id: null, state: null, error: null, listeners: new Set() };
  const changed = () => device.listeners.forEach((fn) => fn());

  function connect() {
    if (device.player || document.getElementById('spotify-sdk')) return;
    window.onSpotifyWebPlaybackSDKReady = () => {
      const player = new window.Spotify.Player({
        name: 'Cassiel',
        getOAuthToken: (give) => window.SpotifyAuth.token().then((t) => t && give(t)),
        volume: 0.8,
      });
      player.addListener('ready', ({ device_id }) => ((device.id = device_id), (device.error = null), changed()));
      player.addListener('not_ready', () => ((device.id = null), changed()));
      player.addListener('player_state_changed', (state) => ((device.state = state), changed()));
      for (const kind of ['initialization_error', 'authentication_error', 'account_error', 'playback_error'])
        player.addListener(kind, ({ message }) => {
          device.error = kind === 'account_error' ? 'Playing needs Spotify Premium.' : message;
          changed();
        });
      device.player = player;
      player.connect();
    };
    const script = document.createElement('script');
    script.id = 'spotify-sdk';
    script.src = 'https://sdk.scdn.co/spotify-player.js';
    document.head.append(script);
  }

  /** Plays songs (spotify:track:… URIs) on this device, from the first. */
  const playUris = (uris) => {
    if (!device.id) throw new Error(device.error || 'Spotify is still starting on this device.');
    return api(`/me/player/play?device_id=${device.id}`, { method: 'PUT', body: { uris } });
  };

  window.SpotifyBridge = { api, connect, device, playUris };
})();
