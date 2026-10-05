// Spotify for Webamp: the Web API (search, library, starting a song on this device), the
// Web Playback SDK (this window becomes a Spotify Connect device, "Cassiel", and plays
// the music), and SpotifyMedia, the player Webamp drives instead of its own <audio>.
// Spotify's audio is protected, so Webamp's equalizer, balance and visualizer cannot
// touch it: they stay, quiet.
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

  /** Webamp's media, played by Spotify. Webamp makes one and drives it: a song from
   * its playlist is "loaded" (its URL is the song's spotify: URI), then played,
   * paused, sought. Time comes from Spotify's state, between updates counted here. */
  class SpotifyMedia {
    constructor() {
      this._handlers = {};
      this._uri = null;
      this._started = false; // the loaded song has begun on Spotify
      this._position = 0; // ms, as of _at
      this._at = performance.now();
      this._duration = 0; // ms
      this._paused = true;
      this._context = null;
      this._analyser = null;
      this._ticker = setInterval(() => !this._paused && this._emit('timeupdate'), 250);
      this._onDevice = () => this._update(device.state);
      device.listeners.add(this._onDevice);
    }
    on(event, callback) {
      (this._handlers[event] ??= []).push(callback);
    }
    _emit(event, ...args) {
      for (const fn of this._handlers[event] ?? []) fn(...args);
    }
    _update(state) {
      if (!state || !this._uri) return;
      const current = state.track_window?.current_track;
      // A song that ends: Spotify stops at its start with it as the previous one.
      const ended =
        this._started &&
        !this._paused &&
        state.paused &&
        state.position === 0 &&
        state.track_window?.previous_tracks?.some((t) => t.uri === this._uri || t.linked_from?.uri === this._uri);
      if (current && (current.uri === this._uri || current.linked_from?.uri === this._uri)) {
        this._position = state.position;
        this._at = performance.now();
        this._duration = state.duration || this._duration;
        const wasPaused = this._paused;
        this._paused = state.paused;
        if (wasPaused && !state.paused) this._emit('playing');
        this._emit('stopWaiting');
      }
      if (ended) {
        this._paused = true;
        this._started = false;
        this._emit('ended');
      }
    }
    timeElapsed() {
      const ms = this._paused ? this._position : this._position + (performance.now() - this._at);
      return Math.min(ms, this._duration || ms) / 1000;
    }
    timeRemaining() {
      return Math.max(0, this.duration() - this.timeElapsed());
    }
    percentComplete() {
      return this.duration() ? (this.timeElapsed() / this.duration()) * 100 : 0;
    }
    duration() {
      return this._duration / 1000;
    }
    async loadFromUrl(url, autoPlay) {
      this._uri = url;
      this._started = false;
      this._position = 0;
      this._paused = true;
      this._emit('fileLoaded');
      if (autoPlay) await this.play();
    }
    async play() {
      if (!this._uri) return;
      device.player?.activateElement?.();
      this._emit('waiting');
      try {
        if (this._started) await device.player.resume();
        else {
          await playUris([this._uri]);
          this._started = true;
        }
      } catch (e) {
        this._emit('stopWaiting');
        window.dispatchEvent(new CustomEvent('spotify-error', { detail: e.message }));
      }
    }
    pause() {
      this._paused = true;
      device.player?.pause();
    }
    stop() {
      this._paused = true;
      this._position = 0;
      device.player?.pause().then(() => device.player.seek(0));
    }
    seekToPercentComplete(percent) {
      this.seekToTime((this.duration() * percent) / 100);
    }
    seekToTime(seconds) {
      this._position = seconds * 1000;
      this._at = performance.now();
      device.player?.seek(Math.round(seconds * 1000));
    }
    setVolume(volume) {
      device.player?.setVolume(volume / 100);
    }
    // Spotify's audio cannot be processed here: balance, preamp and EQ do nothing.
    setBalance() {}
    setPreamp() {}
    setEqBand() {}
    disableEq() {}
    enableEq() {}
    getAnalyser() {
      // The visualizer gets an analyser with no sound in it.
      this._context ??= new AudioContext();
      this._analyser ??= this._context.createAnalyser();
      return this._analyser;
    }
    dispose() {
      clearInterval(this._ticker);
      device.listeners.delete(this._onDevice);
      this._context?.close();
    }
  }

  /** A Spotify track as a Webamp playlist entry. */
  const toTrack = (t) => ({
    url: t.uri,
    duration: t.duration_ms / 1000,
    metaData: {
      artist: t.artists?.map((a) => a.name).join(', ') ?? '',
      title: t.name,
      album: t.album?.name,
      albumArtUrl: t.album?.images?.[0]?.url,
    },
  });

  window.Spotify4Webamp = { api, connect, device, playUris, SpotifyMedia, toTrack };
})();
