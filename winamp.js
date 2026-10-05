// Winamp 2's three windows (index.html, drawn by winamp.css) on the player (player.js):
// the main window's display and keys, the equalizer, the playlist. Spotify's sound is
// protected, so the equalizer and balance move but cannot change it.
(() => {
  const player = window.WinampPlayer;
  const { state } = player;
  const $ = (id) => document.getElementById(id);
  const main = $('main');
  const two = (n) => String(n).padStart(2, '0');
  const clock = (ms) => `${Math.floor(ms / 60000)}:${two(Math.floor(ms / 1000) % 60)}`;
  const long = (ms) => {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    return `${h ? `${h}:${two(Math.floor(s / 60) % 60)}` : Math.floor(s / 60)}:${two(s % 60)}`;
  };
  const artists = (t) => t.artists?.map((a) => a.name).join(', ') ?? '';
  const label = (t, i) => `${i + 1}. ${artists(t)} - ${t.name}`;

  // What Winamp remembers between runs: volume, shuffle, repeat, the equalizer.
  const PREFS = 'winamp.prefs';
  const prefs = (() => {
    try {
      return JSON.parse(localStorage.getItem(PREFS)) ?? {};
    } catch {
      return {};
    }
  })();
  const save = () => {
    try {
      localStorage.setItem(PREFS, JSON.stringify({ volume: state.volume, shuffle: state.shuffle, repeat: state.repeat, eq }));
    } catch {}
  };

  // ------------------------------------------------------------ the main window

  // Volume and balance light up green to red as they rise, in 28 steps of the strip.
  const strip = (el, level) => (el.style.backgroundPosition = `0 ${-Math.round(level * 27) * 15}px`);
  const volume = $('volume');
  const balance = $('balance');
  volume.addEventListener('input', () => {
    player.setVolume(+volume.value);
    save();
  });
  balance.addEventListener('input', () => {
    if (Math.abs(+balance.value) < 15) balance.value = '0'; // it catches at the center
    strip($('balanceStrip'), Math.abs(+balance.value) / 100);
  });

  let remaining = false; // the time counts down
  $('time').addEventListener('click', () => {
    remaining = !remaining;
    tick();
  });

  const position = $('position');
  let seeking = false;
  position.addEventListener('pointerdown', () => (seeking = true));
  position.addEventListener('change', () => {
    seeking = false;
    player.seek(+position.value / 1000);
  });

  const find = () => window.dispatchEvent(new Event('winamp-find'));
  const act = {
    previous: () => player.previous(),
    play: () => player.play(),
    pause: () => player.pause(),
    stop: () => player.stop(),
    next: () => player.next(),
    eject: find,
  };
  for (const name of Object.keys(act)) $(name).addEventListener('click', act[name]);
  for (const b of document.querySelectorAll('.pl-mini [data-do]')) b.addEventListener('click', () => act[b.dataset.do]());
  $('shuffle').addEventListener('click', () => (player.toggle('shuffle'), save()));
  $('repeat').addEventListener('click', () => (player.toggle('repeat'), save()));

  // The equalizer and playlist windows come and go; the playlist fills what is left.
  const show = (id, on) => {
    $(id).hidden = !on;
    $(id === 'eq' ? 'eqButton' : 'plButton').classList.toggle('selected', on);
  };
  $('eqButton').addEventListener('click', () => show('eq', $('eq').hidden));
  $('plButton').addEventListener('click', () => show('pl', $('pl').hidden));
  $('eqClose').addEventListener('click', () => show('eq', false));
  $('plClose').addEventListener('click', () => show('pl', false));

  // The song's title runs along the display when it does not fit.
  const marquee = $('marquee');
  let marqueeText = '';
  let marqueeAt = 0;
  function setMarquee(text) {
    if (text === marqueeText) return;
    marqueeText = text;
    marqueeAt = 0;
    marquee.textContent = text;
    marquee.dataset.loop = '';
    marquee.style.transform = '';
    // Too long: it loops, the text twice with a gap.
    if (marquee.scrollWidth > 154) {
      marquee.textContent = `${text}  ***  ${text}  ***  `;
      marquee.dataset.loop = 'yes';
    }
  }

  function tick() {
    const ms = state.current >= 0 ? player.elapsed() : 0;
    const shown = remaining && state.duration ? state.duration - ms : ms;
    const m = Math.min(99, Math.floor(shown / 60000));
    const s = Math.floor(shown / 1000) % 60;
    $('m1').textContent = String(Math.floor(m / 10));
    $('m2').textContent = String(m % 10);
    $('s1').textContent = String(Math.floor(s / 10));
    $('s2').textContent = String(s % 10);
    main.classList.toggle('remaining', remaining && !!state.duration);
    if (!seeking) position.value = String(state.duration ? Math.round((ms / state.duration) * 1000) : 0);
    $('plTime').textContent = state.status === 'stop' ? '' : `${remaining ? '-' : ''}${clock(shown)}`;
    if (marquee.dataset.loop) {
      const half = marquee.scrollWidth / 2;
      marqueeAt = (marqueeAt + 1) % half;
      marquee.style.transform = `translateX(${-marqueeAt}px)`;
    }
  }
  setInterval(tick, 45);

  function renderMain() {
    main.classList.remove('play', 'pause', 'stop');
    main.classList.add(state.status);
    const track = state.tracks[state.current];
    setMarquee(track ? `${label(track, state.current)} (${clock(track.duration_ms ?? 0)})` : 'Winamp for Spotify');
    const on = state.status !== 'stop';
    $('kbps').textContent = on ? '320' : '';
    $('khz').textContent = on ? '44' : '';
    $('stereo').classList.toggle('selected', on);
    $('shuffle').classList.toggle('selected', state.shuffle);
    $('repeat').classList.toggle('selected', state.repeat);
    volume.value = String(state.volume);
    strip($('volumeStrip'), state.volume / 100);
    tick();
  }

  // ------------------------------------------------------------ the equalizer

  const BANDS = ['preamp', 60, 170, 310, 600, 1000, 3000, 6000, 12000, 14000, 16000];
  const NAMES = { preamp: 'PREAMP', 1000: '1K', 3000: '3K', 6000: '6K', 12000: '12K', 14000: '14K', 16000: '16K' };
  // Slot colors by level, -12 dB (green) to +12 (red), Winamp's 28 steps.
  const LEVELS = [
    '#2a9a16', '#2a9a16', '#5ab02c', '#71cd34', '#71cd34', '#89e230', '#89e230', '#a4e238', '#a4e238', '#c4db32',
    '#c4db32', '#c4db32', '#c4db32', '#c4db32', '#e0cd30', '#e0cd30', '#e0cd30', '#e0cd30', '#e0b228', '#e09228',
    '#e09228', '#dc771f', '#c6780f', '#dc771f', '#e0541e', '#e0541e', '#d3221b', '#d3221b',
  ];
  // Levels 0 to 100 (50 is 0 dB), Winamp's presets in spirit.
  const PRESETS = {
    Flat: [50, 50, 50, 50, 50, 50, 50, 50, 50, 50],
    Classical: [50, 50, 50, 50, 50, 50, 30, 30, 30, 22],
    Club: [50, 50, 63, 70, 70, 70, 63, 50, 50, 50],
    Dance: [80, 72, 57, 50, 50, 33, 30, 30, 50, 50],
    'Full Bass': [80, 80, 80, 70, 56, 40, 30, 25, 24, 24],
    'Full Treble': [30, 30, 30, 40, 57, 77, 90, 90, 90, 93],
    Pop: [45, 63, 72, 74, 64, 47, 43, 43, 45, 45],
    Rock: [73, 63, 37, 30, 42, 60, 74, 78, 78, 78],
    Techno: [72, 66, 50, 36, 38, 50, 72, 76, 76, 74],
  };
  const eq = { on: true, auto: false, preamp: 50, bands: Array(10).fill(50), ...prefs.eq };
  const TRAVEL = 51; // px the knob moves, top (+12) to bottom (-12)

  const bandsEl = $('bands');
  const bandEls = BANDS.map((band, i) => {
    const el = document.createElement('div');
    el.className = `band${band === 'preamp' ? ' preamp' : ''}`;
    el.style.left = `${band === 'preamp' ? 21 : 78 + (i - 1) * 18}px`;
    el.dataset.name = NAMES[band] ?? String(band);
    el.setAttribute('role', 'slider');
    el.setAttribute('aria-label', band === 'preamp' ? 'Preamp' : `${NAMES[band] ?? band} Hz`);
    el.tabIndex = -1;
    el.append(Object.assign(document.createElement('div'), { className: 'knob' }));
    const set = (y) => {
      const top = el.getBoundingClientRect().top;
      const scale = el.offsetHeight / el.getBoundingClientRect().height || 1;
      const v = Math.round(100 - (Math.min(TRAVEL, Math.max(0, (y - top) * scale - 5.5)) / TRAVEL) * 100);
      setBand(i, v);
    };
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      el.classList.add('active');
      set(e.clientY);
      const move = (m) => set(m.clientY);
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', () => (el.removeEventListener('pointermove', move), el.classList.remove('active'), save()), { once: true });
    });
    el.addEventListener('dblclick', () => (setBand(i, 50), save()));
    bandsEl.append(el);
    return el;
  });
  const valueOf = (i) => (i === 0 ? eq.preamp : eq.bands[i - 1]);
  function setBand(i, v) {
    if (i === 0) eq.preamp = v;
    else eq.bands[i - 1] = v;
    renderEq();
  }

  const SVG = 'http://www.w3.org/2000/svg';
  const graph = $('eqGraph');
  graph.innerHTML = `
    <defs><linearGradient id="eq-heat" x1="0" y1="1" x2="0" y2="18" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#d3221b"/><stop offset="0.3" stop-color="#e09228"/>
      <stop offset="0.5" stop-color="#e0cd30"/><stop offset="0.75" stop-color="#89e230"/>
      <stop offset="1" stop-color="#2a9a16"/></linearGradient></defs>
    <g stroke="#6c6c7e" stroke-width="1">${eq.bands.map((_, i) => `<line x1="${2.5 + 12 * i}" y1="0" x2="${2.5 + 12 * i}" y2="19"/>`).join('')}</g>
    <line class="pre" x1="0" x2="113" stroke="#bacbdd" stroke-width="1"/>
    <path class="curve" fill="none" stroke="url(#eq-heat)" stroke-width="1.2" stroke-linejoin="round"/>`;
  graph.setAttribute('xmlns', SVG);

  function renderEq() {
    bandEls.forEach((el, i) => {
      const v = valueOf(i);
      el.style.setProperty('--level', LEVELS[Math.round((v / 100) * 27)]);
      el.style.setProperty('--knob', `${((100 - v) / 100) * TRAVEL}px`);
      el.setAttribute('aria-valuenow', String(Math.round(((v - 50) / 50) * 12)));
    });
    $('eqOn').classList.toggle('selected', eq.on);
    $('eqAuto').classList.toggle('selected', eq.auto);
    const y = (v) => 1.5 + ((100 - v) / 100) * 16;
    const pre = graph.querySelector('.pre');
    pre.setAttribute('y1', y(eq.preamp).toFixed(2));
    pre.setAttribute('y2', y(eq.preamp).toFixed(2));
    // A smooth curve through the bands (Catmull-Rom, as cubic Béziers), kept inside.
    const p = eq.bands.map((v, i) => [2.5 + 12 * i, y(v)]);
    const clamp = (n) => Math.min(18, Math.max(1, n)).toFixed(2);
    let d = `M${p[0][0]},${p[0][1].toFixed(2)}`;
    for (let i = 0; i < p.length - 1; i++) {
      const [a, b, c, e] = [p[i - 1] ?? p[i], p[i], p[i + 1], p[i + 2] ?? p[i + 1]];
      d += ` C${(b[0] + (c[0] - a[0]) / 6).toFixed(2)},${clamp(b[1] + (c[1] - a[1]) / 6)} ${(c[0] - (e[0] - b[0]) / 6).toFixed(2)},${clamp(c[1] - (e[1] - b[1]) / 6)} ${c[0]},${c[1].toFixed(2)}`;
    }
    graph.querySelector('.curve').setAttribute('d', d);
  }
  $('eqOn').addEventListener('click', () => ((eq.on = !eq.on), renderEq(), save()));
  $('eqAuto').addEventListener('click', () => ((eq.auto = !eq.auto), renderEq(), save()));
  $('eqOn').dataset.tooltip = "Spotify's sound is protected: the equalizer cannot change it";

  const menu = $('presetMenu');
  for (const name of Object.keys(PRESETS)) {
    const li = Object.assign(document.createElement('li'), { textContent: name, role: 'menuitem' });
    li.addEventListener('click', () => {
      eq.bands = [...PRESETS[name]];
      menu.hidden = true;
      renderEq();
      save();
    });
    menu.append(li);
  }
  $('eqPresets').addEventListener('click', (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
  });
  addEventListener('click', () => (menu.hidden = true));

  // ------------------------------------------------------------ the playlist

  const list = $('plList');
  const thumb = $('plThumb');
  const ROW = 13;
  let selected = new Set();
  let anchor = -1;

  function renderList() {
    list.replaceChildren(
      ...state.tracks.map((t, i) => {
        const li = document.createElement('li');
        li.role = 'option';
        li.className = `${i === state.current ? 'current' : ''}${selected.has(i) ? ' selected' : ''}`;
        li.setAttribute('aria-selected', String(selected.has(i)));
        li.append(
          Object.assign(document.createElement('span'), { className: 'n', textContent: label(t, i) }),
          Object.assign(document.createElement('span'), { className: 'd', textContent: clock(t.duration_ms ?? 0) }),
        );
        li.addEventListener('click', (e) => pick(i, e));
        li.addEventListener('dblclick', () => player.play(i));
        return li;
      }),
    );
    const sum = (ix) => ix.reduce((n, i) => n + (state.tracks[i]?.duration_ms ?? 0), 0);
    const all = state.tracks.map((_, i) => i);
    $('plTotal').textContent = state.tracks.length ? `${long(sum([...selected]))}/${long(sum(all))}` : '';
    scrolled();
  }
  function pick(i, e = {}) {
    if (e.shiftKey && anchor >= 0) {
      selected = new Set();
      for (let k = Math.min(anchor, i); k <= Math.max(anchor, i); k++) selected.add(k);
    } else if (e.ctrlKey || e.metaKey) {
      selected.has(i) ? selected.delete(i) : selected.add(i);
      anchor = i;
    } else {
      selected = new Set([i]);
      anchor = i;
    }
    renderList();
    list.children[i]?.scrollIntoView({ block: 'nearest' });
  }
  const removeSelected = () => {
    if (!selected.size) return;
    player.remove([...selected]);
    selected = new Set();
    anchor = -1;
  };
  const selectAll = () => {
    selected = selected.size === state.tracks.length ? new Set() : new Set(state.tracks.map((_, i) => i));
    renderList();
  };
  list.addEventListener('keydown', (e) => {
    if (!state.tracks.length) return;
    const at = anchor < 0 ? -1 : anchor;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      pick(Math.max(0, Math.min(state.tracks.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1))), { shiftKey: e.shiftKey && anchor >= 0 });
    } else if (e.key === 'Enter' && at >= 0) player.play(at);
    else if (e.key === 'Delete' || e.key === 'Backspace') removeSelected();
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      selectAll();
    } else return;
    e.stopPropagation();
  });

  // The scroll bar: a gold thumb in the frame's right column, the list's own hidden.
  function scrolled() {
    const room = list.clientHeight;
    const travel = list.parentElement.clientHeight - thumb.offsetHeight;
    const max = list.scrollHeight - room;
    thumb.style.top = `${max > 0 ? (list.scrollTop / max) * travel : 0}px`;
  }
  list.addEventListener('scroll', scrolled);
  thumb.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    thumb.setPointerCapture(e.pointerId);
    const from = e.clientY;
    const start = list.scrollTop;
    const travel = list.parentElement.clientHeight - thumb.offsetHeight;
    const move = (m) => (list.scrollTop = start + ((m.clientY - from) / travel) * (list.scrollHeight - list.clientHeight));
    thumb.addEventListener('pointermove', move);
    thumb.addEventListener('pointerup', () => thumb.removeEventListener('pointermove', move), { once: true });
  });
  $('plUp').addEventListener('click', () => list.scrollBy(0, -ROW));
  $('plDown').addEventListener('click', () => list.scrollBy(0, ROW));
  addEventListener('resize', scrolled);

  $('plAdd').addEventListener('click', find);
  $('plRem').addEventListener('click', removeSelected);
  $('plSel').addEventListener('click', selectAll);
  $('plMisc').addEventListener('click', () => {
    selected = new Set();
    player.sort();
  });
  $('plList2').addEventListener('click', async () => {
    if (!state.tracks.length) return;
    if (await window.cassiel.dialog.confirm('Winamp', 'Clear the playlist?', 'Clear')) player.clear();
  });

  // ------------------------------------------------------------ keys

  // Winamp's: Z X C V B for the transport, S shuffle, R repeat, L to find music.
  addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.('input, textarea, select, .ml')) return;
    const key = { z: 'previous', x: 'play', c: 'pause', v: 'stop', b: 'next', l: 'eject' }[e.key.toLowerCase()];
    if (key) act[key]();
    else if (e.key.toLowerCase() === 's') $('shuffle').click();
    else if (e.key.toLowerCase() === 'r') $('repeat').click();
    else return;
    e.preventDefault();
  });

  // ------------------------------------------------------------ start

  // The title bars turn gold while the app has the focus.
  const focused = () => document.body.classList.toggle('active', document.hasFocus());
  addEventListener('focus', focused);
  addEventListener('blur', focused);
  focused();

  if (prefs.volume != null) state.volume = prefs.volume;
  state.shuffle = !!prefs.shuffle;
  state.repeat = !!prefs.repeat;
  let shown = -1;
  player.on(() => {
    renderMain();
    renderList();
    if (state.current !== shown && state.current >= 0) {
      shown = state.current;
      list.children[state.current]?.scrollIntoView({ block: 'nearest' });
    }
  });
  renderMain();
  renderEq();
  renderList();
})();
