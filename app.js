// Checkers against Cass, after MSN Messenger's Instant Games. The person plays red, from
// the bottom, and moves first: click a piece, then where it goes (a double jump is
// clicked one landing at a time). Cass, the assistant, is told the game's big moments
// (assistant.tell) and can play it for the person or read it (its actions); Cass's own
// moves come from the engine, never from the model.
(() => {
  const E = window.CheckersEngine;
  const PERSON = 'red';
  const CASS = 'white';
  const STEP_MS = 220; // each jump of an animated move
  const THINK_MS = 450; // Cass's pause before it moves
  const QUIET_LIMIT = 80; // half-moves without a capture or a crowning: a draw
  const LEVELS = ['easy', 'medium', 'hard'];
  const LEVEL_KEY = 'checkers.level';
  const STATS_KEY = 'checkers.stats';

  const $ = (id) => document.getElementById(id);
  const boardEl = $('board');
  const area = $('area');

  const state = {
    board: E.newBoard(),
    turn: PERSON,
    steps: [], // the squares clicked so far for the person's move
    last: [], // the last move's path
    quiet: 0,
    result: null, // 'red' | 'white' | 'draw'
    busy: false, // a move is being shown
    note: '', // what Cass says about a draw offer
    level: 'medium',
    game: 0, // which game a pending move belongs to
  };

  const read = (key, fallback) => {
    try {
      const kept = localStorage.getItem(key);
      return kept === null ? fallback : JSON.parse(kept);
    } catch {
      return fallback;
    }
  };
  const keep = (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* not kept this time */
    }
  };
  const wait = (ms) => new Promise((done) => setTimeout(done, ms));
  /** Tells Cass about a moment of the game, in its words (it may remark on it aloud). */
  const tell = (text) => window.cassiel.assistant.tell(`Damas: ${text}`).catch(() => {});

  /** The board partway through a move: the piece on `path`'s last square, what it
   * jumped on the way gone (a jump's victim is the square between its two landings). */
  const partway = (board, path) => {
    const shown = board.slice();
    const piece = shown[path[0]];
    shown[path[0]] = null;
    for (let i = 1; i < path.length; i++) if (Math.abs(path[i] - path[i - 1]) > 9) shown[(path[i] + path[i - 1]) / 2] = null;
    shown[path[path.length - 1]] = piece;
    return shown;
  };

  const moves = () => (state.result ? [] : E.legalMoves(state.board, state.turn));
  const mine = () => (state.turn === PERSON && !state.busy && !state.result ? moves() : []);
  const matching = () => mine().filter((m) => state.steps.every((s, i) => m.path[i] === s));
  const targets = () => (state.steps.length ? matching().map((m) => m.path[state.steps.length]).filter((s) => s !== undefined) : []);
  const moveName = (path) => path.map(E.nameOf).join(path.length > 2 || Math.abs(path[1] - path[0]) > 9 ? 'x' : '-');

  // The board's squares, made once; pieces are elements of their own, kept by id, so a
  // move slides them.
  const squares = Array.from({ length: 64 }, (_, square) => {
    const el = document.createElement('div');
    el.className = `square ${E.isDark(square) ? 'is-dark' : 'is-light'}`;
    if (E.rowOf(square) === 7) el.dataset.file = 'abcdefgh'[E.colOf(square)];
    if (E.colOf(square) === 0) el.dataset.rank = String(8 - E.rowOf(square));
    el.append(Object.assign(document.createElement('span'), { className: 'mark' }));
    el.addEventListener('click', () => pick(square));
    boardEl.append(el);
    return el;
  });
  const pieces = new Map();
  const CROWN = '<svg class="crown" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 10H5z"/></svg>';
  let cell = 0;

  function render() {
    const list = mine();
    const must = list.length > 0 && list[0].captured.length > 0;
    const movable = new Set(state.steps.length > 1 ? [] : list.map((m) => m.path[0]));
    const goes = targets();
    squares.forEach((el, square) => {
      el.classList.toggle('is-last', state.last.includes(square));
      el.classList.toggle('is-picked', state.steps.includes(square));
      el.classList.toggle('is-target', goes.includes(square));
      el.classList.toggle('is-movable', movable.has(square));
      el.classList.toggle('is-forced', must && movable.has(square) && !state.steps.length);
    });

    const shown = state.steps.length > 1 ? partway(state.board, state.steps) : state.board;
    const seen = new Set();
    shown.forEach((piece, square) => {
      if (!piece) return;
      seen.add(piece.id);
      let el = pieces.get(piece.id);
      if (!el) {
        el = document.createElement('div');
        el.innerHTML = '<span class="disc"></span>';
        boardEl.append(el);
        pieces.set(piece.id, el);
      }
      el.className = `piece piece-${piece.side}`;
      el.style.width = el.style.height = `${cell}px`;
      el.style.transform = `translate(${E.colOf(square) * cell}px, ${E.rowOf(square) * cell}px)`;
      const disc = el.firstChild;
      if (piece.king !== !!disc.firstChild) disc.innerHTML = piece.king ? CROWN : '';
    });
    for (const [id, el] of pieces) if (!seen.has(id)) (el.remove(), pieces.delete(id));

    const yours = state.turn === PERSON && !state.busy && !state.result;
    $('card-red').classList.toggle('is-active', !state.result && state.turn === PERSON);
    $('card-white').classList.toggle('is-active', !state.result && state.turn === CASS);
    $('status-red').textContent = yours ? (state.steps.length > 1 ? 'Keep jumping.' : must ? 'You must jump.' : 'Your move.') : '';
    $('status-white').textContent = state.note || (!state.result && (state.turn === CASS || state.busy) ? 'Cass is making a move.' : '');
    $('draw').disabled = !yours;
    $('resign').disabled = !!state.result;
    $('banner').hidden = !state.result;
    $('banner-text').textContent = state.result === PERSON ? 'You win!' : state.result === CASS ? 'Cass wins.' : "It's a draw.";
  }

  // The board: the biggest square that fits, in whole pixels per square.
  new ResizeObserver(() => {
    cell = Math.max(1, Math.floor(Math.min(area.clientWidth, area.clientHeight) / 8));
    boardEl.style.width = boardEl.style.height = `${cell * 8}px`;
    render();
  }).observe(area);

  function finish(outcome, quietly = false) {
    state.result = outcome;
    const stats = read(STATS_KEY, { wins: 0, losses: 0, draws: 0 });
    if (outcome === PERSON) stats.wins++;
    else if (outcome === CASS) stats.losses++;
    else stats.draws++;
    keep(STATS_KEY, stats);
    render();
    if (quietly) return;
    tell(
      outcome === CASS
        ? 'ganaste la partida.'
        : outcome === PERSON
          ? 'la persona te ganó la partida.'
          : 'la partida quedó en tablas.',
    );
  }

  /** Plays `move` for `side`, a jump at a time if `animate`, then hands the turn over. */
  async function commit(move, side, animate) {
    const id = state.game;
    const before = state.board;
    state.busy = true;
    render();
    if (animate) {
      for (let i = 2; i <= move.path.length; i++) {
        state.board = partway(before, move.path.slice(0, i));
        render();
        await wait(STEP_MS);
        if (state.game !== id) return;
      }
    }
    state.board = E.play(before, move);
    state.quiet = E.isProgress(before, move) ? 0 : state.quiet + 1;
    state.steps = [];
    state.last = move.path;
    state.turn = E.other(side);
    state.busy = false;
    state.note = '';
    render();

    const left = (s) => state.board.filter((p) => p && p.side === s).length;
    if (!E.legalMoves(state.board, state.turn).length) return finish(side);
    if (state.quiet >= QUIET_LIMIT) return finish('draw');
    // The moments worth a word: a double jump, a crowning.
    const crowned = E.crowning(before, move);
    const who = side === CASS ? 'tú' : 'la persona';
    if (move.captured.length > 1)
      tell(`${who} comió ${move.captured.length} fichas de un salto. Quedan ${left(PERSON)} rojas de la persona y ${left(CASS)} blancas tuyas.`);
    else if (crowned) tell(side === CASS ? 'coronaste una ficha.' : 'la persona coronó una ficha.');
    if (state.turn === CASS) cassMoves();
  }

  function cassMoves() {
    const id = state.game;
    setTimeout(() => {
      if (state.game !== id || state.result) return;
      const move = E.chooseMove(state.board, CASS, state.level);
      if (move) commit(move, CASS, true);
    }, THINK_MS);
  }

  function pick(square) {
    const list = mine();
    if (!list.length) return;
    // Midway through a double jump the piece is committed; otherwise any of the
    // person's movable pieces can be picked up instead.
    if (list.some((m) => m.path[0] === square) && state.steps.length <= 1) {
      state.steps = state.steps[0] === square ? [] : [square];
      return render();
    }
    if (!targets().includes(square)) return;
    const path = [...state.steps, square];
    const done = matching().find((m) => m.path.length === path.length && m.path.every((s, i) => s === path[i]));
    if (done) commit(done, PERSON, false);
    else {
      state.steps = path;
      render();
    }
  }

  function newGame() {
    state.game++;
    Object.assign(state, { board: E.newBoard(), turn: PERSON, steps: [], last: [], quiet: 0, result: null, busy: false, note: '' });
    render();
  }
  const started = () => state.last.length > 0 && !state.result;
  async function askNewGame() {
    if (!started() || (await window.cassiel.dialog.confirm('New Game', 'Leave this game and start a new one?', 'New Game'))) newGame();
  }
  /** Cass takes a draw when it isn't ahead. */
  function offerDraw() {
    if (state.result || state.turn !== PERSON || state.busy) return false;
    if (E.standing(state.board, CASS) <= 20) {
      finish('draw', true);
      return true;
    }
    state.note = 'Cass declined the draw.';
    render();
    setTimeout(() => {
      if (state.note === 'Cass declined the draw.') (state.note = ''), render();
    }, 3000);
    return false;
  }
  function resign() {
    state.game++;
    state.busy = false;
    finish(CASS, true);
  }
  async function askResign() {
    if (!state.result && (await window.cassiel.dialog.confirm('Resign', 'Resign this game? Cass wins it.', 'Resign'))) resign();
  }
  function setLevel(level) {
    state.level = level;
    keep(LEVEL_KEY, level);
  }

  $('draw').addEventListener('click', offerDraw);
  $('resign').addEventListener('click', askResign);
  $('again').addEventListener('click', newGame);
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.steps.length === 1) (state.steps = []), render();
  });

  const LEVEL_LABEL = { easy: '&Easy', medium: '&Medium', hard: '&Hard' };
  window.cassiel.menu.set([
    {
      label: '&Game',
      items: [
        { label: '&New Game', shortcut: 'F2', action: askNewGame },
        'separator',
        ...LEVELS.map((level) => ({ label: LEVEL_LABEL[level], checked: () => state.level === level, action: () => setLevel(level) })),
        'separator',
        { label: 'Offer a &Draw', enabled: () => !state.result && state.turn === PERSON && !state.busy, action: offerDraw },
        { label: '&Resign', enabled: () => !state.result, action: askResign },
        'separator',
        {
          label: '&Statistics',
          action: () => {
            const s = read(STATS_KEY, { wins: 0, losses: 0, draws: 0 });
            window.cassiel.dialog.alert('Statistics', `Won: ${s.wins}\nLost: ${s.losses}\nDrawn: ${s.draws}`);
          },
        },
      ],
    },
    {
      label: '&Help',
      items: [
        {
          label: '&How to Play',
          action: () =>
            window.cassiel.dialog.alert(
              'How to Play',
              'You play red and move first. Pieces move one square diagonally forward; click a piece, then where it goes.\n\n' +
                "Jump over a piece of Cass's to capture it. Jumping is compulsory, and a jump keeps going while it can: click each landing in turn.\n\n" +
                "A piece that reaches the far row becomes a king and can move backward too. Whoever can't move loses.\n\n" +
                'You can also tell Cass your move out loud, by its squares: "c3 to d4".',
            ),
        },
        { label: '&About Checkers', action: () => window.cassiel.dialog.alert('About Checkers', 'Checkers 1.0\n\nPlay checkers against Cass.') },
      ],
    },
  ]);

  // What Cass can do here. Its words go to the model, so they are in its language.
  const describe = () => {
    const list = (side) =>
      state.board
        .map((p, square) => p && p.side === side && E.nameOf(square) + (p.king ? ' (reina)' : ''))
        .filter(Boolean)
        .join(', ');
    const turn = state.result
      ? `terminó: ${state.result === CASS ? 'ganaste tú' : state.result === PERSON ? 'ganó la persona' : 'tablas'}`
      : state.turn === PERSON
        ? 'le toca a la persona'
        : 'te toca a ti (el motor ya está eligiendo tu jugada)';
    const options = state.turn === PERSON && !state.result ? moves().map((m) => moveName(m.path)) : [];
    return [
      'Partida de damas: tú juegas con las blancas (arriba), la persona con las rojas (abajo). Tus jugadas las elige el motor del juego, no tú.',
      `Nivel: ${state.level}. Estado: ${turn}.`,
      `Rojas de la persona: ${list(PERSON) || 'ninguna'}.`,
      `Blancas tuyas: ${list(CASS) || 'ninguna'}.`,
      state.last.length ? `Última jugada: ${moveName(state.last)}.` : '',
      options.length ? `Jugadas posibles de la persona${options[0].includes('x') ? ' (comer es obligatorio)' : ''}: ${options.join(', ')}.` : '',
      'Columnas a-h de izquierda a derecha, filas 1-8 desde el lado de la persona.',
    ]
      .filter(Boolean)
      .join('\n');
  };
  const actions = {
    state: {
      description: 'Cómo va la partida de damas: fichas de cada quien, turno, nivel y las jugadas que puede hacer la persona.',
      params: {},
      run: describe,
    },
    move: {
      description: 'Mueve una ficha de la persona por ella, cuando te dice su jugada. Casillas como c3-d4; un salto doble, c3-e5-c7.',
      params: { move: 'casillas separadas por guiones, como c3-d4' },
      run: ({ move }) => {
        if (state.result) throw new Error('la partida ya terminó');
        if (state.turn !== PERSON || state.busy) throw new Error('no es el turno de la persona');
        const path = String(move ?? '').toLowerCase().split(/[^a-h1-8]+/).filter(Boolean).map(E.squareOf);
        if (path.length < 2 || path.includes(-1)) throw new Error(`no entendí la jugada ${move}`);
        const list = moves();
        const fits = list.filter((m) =>
          path.length === m.path.length ? m.path.every((s, i) => s === path[i]) : m.path[0] === path[0] && m.path[m.path.length - 1] === path[path.length - 1],
        );
        if (fits.length !== 1)
          throw new Error(
            `${fits.length ? 'esa jugada es ambigua' : 'esa jugada no es válida'}; las posibles son: ${list.map((m) => moveName(m.path)).join(', ')}`,
          );
        commit(fits[0], PERSON, true);
        return `movida ${moveName(fits[0].path)}`;
      },
    },
    new_game: {
      description: 'Empieza una partida nueva de damas.',
      params: {},
      run: () => (newGame(), 'partida nueva; la persona mueve primero'),
    },
    level: {
      description: 'Cambia tu nivel en las damas.',
      params: { level: 'easy, medium o hard' },
      run: ({ level }) => {
        if (!LEVELS.includes(level)) throw new Error('el nivel es easy, medium o hard');
        setLevel(level);
        return `nivel ${level}`;
      },
    },
    offer_draw: {
      description: 'La persona te ofrece tablas; tú (el motor) aceptas solo si no vas ganando.',
      params: {},
      run: () => (offerDraw() ? 'aceptaste las tablas' : 'rechazaste las tablas: vas ganando o no es el turno de la persona'),
    },
    resign: {
      description: 'La persona se rinde en las damas (solo si te lo pide).',
      params: {},
      run: () => {
        if (state.result) throw new Error('la partida ya terminó');
        resign();
        return 'la persona se rindió; ganaste';
      },
    },
  };
  for (const [name, action] of Object.entries(actions)) window.cassiel.actions.register(name, action);

  // F2 (a new game) is the menu's; settings are read once the SDK's storage is in.
  window.cassiel.ready.then(() => {
    const level = read(LEVEL_KEY, 'medium');
    if (LEVELS.includes(level)) state.level = level;
    render();
  });
  render();
})();
