// Checkers rules (American: men move and capture forward only, kings one square in any
// diagonal direction, capturing is compulsory, a jump continues while it can, and a man
// that reaches the far row is crowned and ends its move) and Cass's play: alpha-beta
// search over the moves, as deep as the level asks.
//
// A board is 64 squares, row by row from the top: null, or a piece { id, side, king }.
// A move is { path, captured }: the squares the piece stands on, start to end, and those
// it jumps. Red sits at the bottom and moves up (the person); white at the top (Cass).
(() => {
  const FORWARD = { red: -1, white: 1 };
  const other = (side) => (side === 'red' ? 'white' : 'red');

  const rowOf = (square) => Math.floor(square / 8);
  const colOf = (square) => square % 8;
  const isDark = (square) => (rowOf(square) + colOf(square)) % 2 === 1;

  function newBoard() {
    const board = Array(64).fill(null);
    let id = 0;
    for (let square = 0; square < 64; square++) {
      if (!isDark(square)) continue;
      if (rowOf(square) < 3) board[square] = { id: id++, side: 'white', king: false };
      else if (rowOf(square) > 4) board[square] = { id: id++, side: 'red', king: false };
    }
    return board;
  }

  const at = (row, col) => (row < 0 || row > 7 || col < 0 || col > 7 ? -1 : row * 8 + col);

  const directions = (piece) =>
    piece.king ? [-1, 1].flatMap((dr) => [-1, 1].map((dc) => [dr, dc])) : [-1, 1].map((dc) => [FORWARD[piece.side], dc]);

  const crowns = (piece, square) => !piece.king && rowOf(square) === (piece.side === 'red' ? 0 : 7);

  /** Every jump sequence from `square`, followed to its end. */
  function jumps(board, square, piece, path, captured, out) {
    let extended = false;
    for (const [dr, dc] of directions(piece)) {
      const over = at(rowOf(square) + dr, colOf(square) + dc);
      const to = at(rowOf(square) + 2 * dr, colOf(square) + 2 * dc);
      if (over < 0 || to < 0) continue;
      const victim = board[over];
      if (!victim || victim.side === piece.side || captured.includes(over) || (board[to] && to !== path[0])) continue;
      extended = true;
      // A man crowned by this jump stops there.
      if (crowns(piece, to)) out.push({ path: [...path, to], captured: [...captured, over] });
      else jumps(board, to, piece, [...path, to], [...captured, over], out);
    }
    if (!extended && captured.length) out.push({ path, captured });
  }

  /** The moves `side` may make: only captures when there is any. */
  function legalMoves(board, side) {
    const captures = [];
    const steps = [];
    for (let square = 0; square < 64; square++) {
      const piece = board[square];
      if (!piece || piece.side !== side) continue;
      jumps(board, square, piece, [square], [], captures);
      if (captures.length) continue;
      for (const [dr, dc] of directions(piece)) {
        const to = at(rowOf(square) + dr, colOf(square) + dc);
        if (to >= 0 && !board[to]) steps.push({ path: [square, to], captured: [] });
      }
    }
    return captures.length ? captures : steps;
  }

  /** The board after `move` (a new one; the old stays as it was). */
  function play(board, move) {
    const next = board.slice();
    const from = move.path[0];
    const to = move.path[move.path.length - 1];
    const piece = next[from];
    next[from] = null;
    for (const square of move.captured) next[square] = null;
    next[to] = crowns(piece, to) ? { ...piece, king: true } : piece;
    return next;
  }

  /** Whether a move crowns its piece. */
  const crowning = (board, move) => crowns(board[move.path[0]], move.path[move.path.length - 1]);
  /** Whether a move changes the material (a capture or a crowning): resets the draw count. */
  const isProgress = (board, move) => move.captured.length > 0 || crowning(board, move);

  // Cass's play.

  const MAN = 100;
  const KING = 165;

  /** How good the board is for `side`: material, men nearer the crown, kings and men
   * holding the middle, and the back row kept (it stops the other side's crowning). */
  function evaluate(board, side) {
    let score = 0;
    for (let square = 0; square < 64; square++) {
      const piece = board[square];
      if (!piece) continue;
      const row = rowOf(square);
      const col = colOf(square);
      let value = piece.king ? KING : MAN;
      if (!piece.king) {
        value += (piece.side === 'red' ? 7 - row : row) * 3;
        if (row === (piece.side === 'red' ? 7 : 0)) value += 6;
      }
      if (col >= 2 && col <= 5 && row >= 2 && row <= 5) value += 4;
      score += piece.side === side ? value : -value;
    }
    return score;
  }

  const WIN = 100000;

  function search(board, side, depth, alpha, beta, budget) {
    const moves = legalMoves(board, side);
    if (!moves.length) return -WIN - depth; // no move: lost (sooner is worse)
    // Keep following captures past the horizon, so a trade is never cut in half.
    if ((depth <= 0 && !moves[0].captured.length) || --budget.nodes <= 0) return evaluate(board, side);
    for (const move of moves) {
      const score = -search(play(board, move), other(side), depth - 1, -beta, -alpha, budget);
      if (score > alpha) alpha = score;
      if (alpha >= beta) break;
    }
    return alpha;
  }

  const DEPTH = { easy: 2, medium: 4, hard: 8 };

  /** The move Cass makes at `level` (easy, medium, hard). Easy sometimes takes a
   * good-enough move instead of the best. */
  function chooseMove(board, side, level) {
    const moves = legalMoves(board, side);
    if (moves.length <= 1) return moves[0] ?? null;
    // Each move gets its share of the search, so none is judged blind.
    const share = Math.floor((level === 'hard' ? 400000 : 60000) / moves.length);
    const scored = moves.map((move) => ({
      move,
      score: -search(play(board, move), other(side), DEPTH[level] - 1, -Infinity, Infinity, { nodes: share }),
    }));
    scored.sort((a, b) => b.score - a.score);
    const best = scored[0].score;
    const slack = level === 'easy' ? 60 : level === 'medium' ? 8 : 0;
    const good = scored.filter((s) => s.score >= best - slack);
    return good[Math.floor(Math.random() * good.length)].move;
  }

  /** How `side` stands right now: above 0 is ahead (for whether Cass takes a draw). */
  const standing = (board, side) => evaluate(board, side);

  // Squares as people name them: columns a-h from the left, rows 1-8 from the person's side.
  const nameOf = (square) => 'abcdefgh'[colOf(square)] + (8 - rowOf(square));
  const squareOf = (name) => {
    const m = /^([a-h])([1-8])$/i.exec(String(name).trim());
    return m ? (8 - Number(m[2])) * 8 + 'abcdefgh'.indexOf(m[1].toLowerCase()) : -1;
  };

  window.CheckersEngine = {
    other,
    rowOf,
    colOf,
    isDark,
    newBoard,
    legalMoves,
    play,
    crowning,
    isProgress,
    chooseMove,
    standing,
    nameOf,
    squareOf,
  };
})();
