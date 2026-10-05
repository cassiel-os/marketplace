// The player: Winamp's playlist and transport, played by Spotify on this device. One
// song is started at a time; its end (Spotify stops at its start, listing it as the
// previous one) moves on to the next, as Winamp does, with shuffle and repeat.
(() => {
  const { device, playUris } = window.SpotifyBridge;
  const listeners = new Set();
  const state = {
    tracks: [], // Spotify track objects
    current: -1,
    status: 'stop', // 'play', 'pause' or 'stop'
    position: 0, // ms, as of `at`
    at: performance.now(),
    duration: 0, // ms
    shuffle: false,
    repeat: false,
    volume: 80,
  };
  let started = false; // the current song has begun on Spotify (so it resumes)
  let waiting = false; // asked Spotify to start it; no word back yet
  const emit = () => listeners.forEach((fn) => fn());
  const same = (t, uri) => !!t && (t.uri === uri || t.linked_from?.uri === uri);
  const fail = (e) => window.dispatchEvent(new CustomEvent('spotify-error', { detail: e.message }));

  let tuned = null; // the device the volume was set on
  device.listeners.add(() => {
    if (device.id && device.id !== tuned) {
      tuned = device.id;
      device.player?.setVolume(state.volume / 100);
    }
    const s = device.state;
    const track = state.tracks[state.current];
    if (!s || !track || !started) return;
    const ended = state.status === 'play' && !waiting && s.paused && s.position === 0 && s.track_window?.previous_tracks?.some((t) => same(t, track.uri));
    if (ended) return advance();
    if (!same(s.track_window?.current_track, track.uri)) return;
    if (waiting && s.paused) return; // still starting
    waiting = false;
    state.position = s.position;
    state.at = performance.now();
    state.duration = s.duration || state.duration;
    if (state.status !== 'stop') state.status = s.paused ? 'pause' : 'play';
    emit();
  });

  /** The song's time now, in ms. */
  const elapsed = () => Math.min(state.duration || Infinity, state.status === 'play' && !waiting ? state.position + (performance.now() - state.at) : state.position);

  async function start(i) {
    const track = state.tracks[i];
    if (!track) return;
    Object.assign(state, { current: i, status: 'play', position: 0, at: performance.now(), duration: track.duration_ms ?? 0 });
    started = false;
    waiting = true;
    emit();
    device.player?.activateElement?.();
    try {
      await playUris([track.uri]);
      if (state.current === i) started = true;
    } catch (e) {
      waiting = false;
      state.status = 'stop';
      emit();
      fail(e);
    }
  }
  /** Points at a song without playing it (Winamp's next and previous when stopped). */
  function cue(i) {
    if (state.status === 'play') return start(i);
    if (started) device.player?.pause();
    Object.assign(state, { current: i, status: 'stop', position: 0, duration: state.tracks[i]?.duration_ms ?? 0 });
    started = false;
    emit();
  }
  const random = () => {
    if (state.tracks.length < 2) return 0;
    let i;
    do i = Math.floor(Math.random() * state.tracks.length);
    while (i === state.current);
    return i;
  };
  /** The song after this one, or -1 at the end of the list without repeat. */
  const after = (step) => {
    if (!state.tracks.length) return -1;
    if (state.shuffle) return random();
    const i = state.current + step;
    if (i >= 0 && i < state.tracks.length) return i;
    return state.repeat ? (i + state.tracks.length) % state.tracks.length : -1;
  };
  function advance() {
    const i = after(1);
    if (i < 0) {
      Object.assign(state, { status: 'stop', position: 0 });
      started = false;
      return emit();
    }
    start(i);
  }

  const player = {
    state,
    elapsed,
    on: (fn) => listeners.add(fn),
    play(i) {
      if (i != null) return start(i);
      if (state.status === 'pause' && started) {
        device.player?.resume();
        state.status = 'play';
        state.at = performance.now();
        return emit();
      }
      if (state.status === 'play' && started) return player.seek(0);
      start(Math.max(0, state.current));
    },
    /** Winamp's pause: pauses, or plays on when paused. */
    pause() {
      if (state.status === 'pause') return player.play();
      if (state.status !== 'play') return;
      state.position = elapsed();
      state.status = 'pause';
      device.player?.pause();
      emit();
    },
    stop() {
      if (started) device.player?.pause().then(() => device.player.seek(0));
      Object.assign(state, { status: 'stop', position: 0 });
      started = false;
      emit();
    },
    next() {
      const i = after(1);
      if (i >= 0) cue(i);
    },
    previous() {
      const i = state.shuffle ? random() : state.current - 1 >= 0 ? state.current - 1 : state.repeat ? state.tracks.length - 1 : -1;
      if (i >= 0) cue(i);
    },
    /** Moves in the song, `fraction` 0 to 1. */
    seek(fraction) {
      if (!started || !state.duration) return;
      const ms = Math.round(state.duration * Math.min(1, Math.max(0, fraction)));
      state.position = ms;
      state.at = performance.now();
      device.player?.seek(ms);
      emit();
    },
    setVolume(volume) {
      state.volume = volume;
      device.player?.setVolume(volume / 100);
      emit();
    },
    toggle(flag) {
      state[flag] = !state[flag];
      emit();
    },
    /** A new list, played from `from`. */
    load(tracks, from = 0) {
      state.tracks = [...tracks];
      start(Math.min(from, tracks.length - 1));
    },
    append(tracks) {
      state.tracks.push(...tracks);
      if (state.current < 0) state.current = 0;
      emit();
    },
    /** Takes songs out (by index); the playing one stops if it goes. */
    remove(indices) {
      const gone = new Set(indices);
      if (gone.has(state.current)) player.stop();
      const kept = state.tracks.map((t, i) => [t, i]).filter(([, i]) => !gone.has(i));
      const current = kept.findIndex(([, i]) => i === state.current);
      state.tracks = kept.map(([t]) => t);
      state.current = current >= 0 ? current : state.tracks.length ? 0 : -1;
      emit();
    },
    clear() {
      player.stop();
      state.tracks = [];
      state.current = -1;
      emit();
    },
    /** Sorts by artist, then title, keeping the playing song current. */
    sort() {
      const playing = state.tracks[state.current];
      const key = (t) => `${t.artists?.[0]?.name ?? ''}\u0000${t.name}`.toLowerCase();
      state.tracks.sort((a, b) => key(a).localeCompare(key(b)));
      state.current = state.tracks.indexOf(playing);
      emit();
    },
  };
  window.WinampPlayer = player;
})();
