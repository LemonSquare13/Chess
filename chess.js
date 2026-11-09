class Chess {
  constructor() { this.reset(); }

  reset() {
    this.board = [
      ['br', 'bn', 'bb', 'bq', 'bk', 'bb', 'bn', 'br'],
      ['bp', 'bp', 'bp', 'bp', 'bp', 'bp', 'bp', 'bp'],
      [null, null, null, null, null, null, null, null],
      [null, null, null, null, null, null, null, null],
      [null, null, null, null, null, null, null, null],
      [null, null, null, null, null, null, null, null],
      ['wp', 'wp', 'wp', 'wp', 'wp', 'wp', 'wp', 'wp'],
      ['wr', 'wn', 'wb', 'wq', 'wk', 'wb', 'wn', 'wr']
    ];
    this.turn = 'w';
    this.castling = { wK: true, wQ: true, bK: true, bQ: true };
    this.epTarget = null;
    this.halfMoves = 0;
    this.fullMoves = 1;
    this.history = []; 
    this.moveHistory = []; 
    this.lastMove = null; // Idinagdag para sa previous move highlight
    this.status = 'playing';
    this.winner = null;
  }

  inBounds(x, y) { return x >= 0 && x < 8 && y >= 0 && y < 8; }
  getPiece(x, y) { return this.inBounds(x, y) ? this.board[y][x] : null; }

  isAttacked(x, y, byColor) {
    const pawnDir = byColor === 'w' ? 1 : -1;
    if (this.getPiece(x - 1, y + pawnDir) === byColor + 'p' || this.getPiece(x + 1, y + pawnDir) === byColor + 'p') return true;
    const knightMoves = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
    for (const [dx, dy] of knightMoves) if (this.getPiece(x + dx, y + dy) === byColor + 'n') return true;
    const kingMoves = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
    for (const [dx, dy] of kingMoves) if (this.getPiece(x + dx, y + dy) === byColor + 'k') return true;
    const slide = (dx, dy, types) => {
      let nx = x + dx, ny = y + dy;
      while (this.inBounds(nx, ny)) {
        const p = this.getPiece(nx, ny);
        if (p) { if (p[0] === byColor && types.includes(p[1])) return true; break; }
        nx += dx; ny += dy;
      }
      return false;
    };
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) if (slide(dx, dy, ['r','q'])) return true;
    for (const [dx, dy] of [[1,1],[1,-1],[-1,1],[-1,-1]]) if (slide(dx, dy, ['b','q'])) return true;
    return false;
  }

  isCheck(color) {
    let kx = -1, ky = -1;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      if (this.board[y][x] === color + 'k') { kx = x; ky = y; break; }
    }
    if (kx === -1) return false;
    return this.isAttacked(kx, ky, color === 'w' ? 'b' : 'w');
  }

  generateMoves(color) {
    const pseudo = [];
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const p = this.board[y][x];
      if (!p || p[0] !== color) continue;
      const type = p[1];

      if (type === 'p') {
        const dir = color === 'w' ? -1 : 1;
        const startY = color === 'w' ? 6 : 1;
        const promoY = color === 'w' ? 0 : 7;
        if (!this.getPiece(x, y + dir)) {
          if (y + dir === promoY) { for (const pr of ['q','r','b','n']) pseudo.push({ from: [x,y], to: [x,y+dir], promotion: pr }); }
          else {
            pseudo.push({ from: [x,y], to: [x,y+dir] });
            if (y === startY && !this.getPiece(x, y + dir*2)) pseudo.push({ from: [x,y], to: [x,y+dir*2] });
          }
        }
        for (const dx of [-1, 1]) {
          const target = this.getPiece(x + dx, y + dir);
          if (target && target[0] !== color) {
            if (y + dir === promoY) { for (const pr of ['q','r','b','n']) pseudo.push({ from: [x,y], to: [x+dx,y+dir], promotion: pr }); }
            else pseudo.push({ from: [x,y], to: [x+dx,y+dir] });
          }
          if (this.epTarget && this.epTarget.x === x + dx && this.epTarget.y === y + dir) pseudo.push({ from: [x,y], to: [x+dx,y+dir], isEp: true });
        }
      }
      else if (type === 'n') {
        for (const [dx, dy] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) {
          const tx = x + dx, ty = y + dy;
          if (this.inBounds(tx, ty)) { const target = this.getPiece(tx, ty); if (!target || target[0] !== color) pseudo.push({ from: [x,y], to: [tx,ty] }); }
        }
      }
      else if (type === 'k') {
        for (const [dx, dy] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]) {
          const tx = x + dx, ty = y + dy;
          if (this.inBounds(tx, ty)) { const target = this.getPiece(tx, ty); if (!target || target[0] !== color) pseudo.push({ from: [x,y], to: [tx,ty] }); }
        }
        const rights = this.castling, enemy = color === 'w' ? 'b' : 'w';
        if (color === 'w' && y === 7 && x === 4) {
          if (rights.wK && !this.getPiece(5,7) && !this.getPiece(6,7) && this.getPiece(7,7) === 'wr' && !this.isAttacked(4,7,enemy) && !this.isAttacked(5,7,enemy) && !this.isAttacked(6,7,enemy)) pseudo.push({ from: [4,7], to: [6,7], isCastle: 'k' });
          if (rights.wQ && !this.getPiece(3,7) && !this.getPiece(2,7) && !this.getPiece(1,7) && this.getPiece(0,7) === 'wr' && !this.isAttacked(4,7,enemy) && !this.isAttacked(3,7,enemy) && !this.isAttacked(2,7,enemy)) pseudo.push({ from: [4,7], to: [2,7], isCastle: 'q' });
        }
        if (color === 'b' && y === 0 && x === 4) {
          if (rights.bK && !this.getPiece(5,0) && !this.getPiece(6,0) && this.getPiece(7,0) === 'br' && !this.isAttacked(4,0,enemy) && !this.isAttacked(5,0,enemy) && !this.isAttacked(6,0,enemy)) pseudo.push({ from: [4,0], to: [6,0], isCastle: 'k' });
          if (rights.bQ && !this.getPiece(3,0) && !this.getPiece(2,0) && !this.getPiece(1,0) && this.getPiece(0,0) === 'br' && !this.isAttacked(4,0,enemy) && !this.isAttacked(3,0,enemy) && !this.isAttacked(2,0,enemy)) pseudo.push({ from: [4,0], to: [2,0], isCastle: 'q' });
        }
      }
      else if (type === 'r' || type === 'b' || type === 'q') {
        const dirs = [];
        if (type === 'r' || type === 'q') dirs.push([1,0],[-1,0],[0,1],[0,-1]);
        if (type === 'b' || type === 'q') dirs.push([1,1],[1,-1],[-1,1],[-1,-1]);
        for (const [dx, dy] of dirs) {
          let nx = x + dx, ny = y + dy;
          while (this.inBounds(nx, ny)) {
            const target = this.getPiece(nx, ny);
            if (!target) pseudo.push({ from: [x,y], to: [nx,ny] });
            else { if (target[0] !== color) pseudo.push({ from: [x,y], to: [nx,ny] }); break; }
            nx += dx; ny += dy;
          }
        }
      }
    }
    const legal = [];
    for (const move of pseudo) {
      const undo = this.makeMoveInternal(move);
      if (!this.isCheck(color)) legal.push(move);
      this.undoMoveInternal(undo);
    }
    return legal;
  }

  makeMoveInternal(move) {
    const [fx, fy] = move.from, [tx, ty] = move.to, piece = this.board[fy][fx];
    const undo = { move: JSON.parse(JSON.stringify(move)), piece, captured: this.board[ty][tx], epTarget: this.epTarget ? { ...this.epTarget } : null, castling: { ...this.castling }, halfMoves: this.halfMoves };
    if (move.isEp) { undo.capturedEp = this.board[fy][tx]; this.board[fy][tx] = null; }
    this.board[ty][tx] = piece; this.board[fy][fx] = null;
    if (move.promotion) this.board[ty][tx] = piece[0] + move.promotion;
    if (move.isCastle) {
      if (move.isCastle === 'k') { this.board[fy][5] = this.board[fy][7]; this.board[fy][7] = null; }
      else { this.board[fy][3] = this.board[fy][0]; this.board[fy][0] = null; }
    }
    this.epTarget = (piece[1] === 'p' && Math.abs(ty - fy) === 2) ? { x: fx, y: (fy + ty) / 2 } : null;
    this.halfMoves = (piece[1] === 'p' || undo.captured || move.isEp) ? 0 : this.halfMoves + 1;
    if (piece === 'wk') { this.castling.wK = false; this.castling.wQ = false; }
    if (piece === 'bk') { this.castling.bK = false; this.castling.bQ = false; }
    if (piece === 'wr' && fx === 0 && fy === 7) this.castling.wQ = false;
    if (piece === 'wr' && fx === 7 && fy === 7) this.castling.wK = false;
    if (piece === 'br' && fx === 0 && fy === 0) this.castling.bQ = false;
    if (piece === 'br' && fx === 7 && fy === 0) this.castling.bK = false;
    if (undo.captured === 'wr' && tx === 0 && ty === 7) this.castling.wQ = false;
    if (undo.captured === 'wr' && tx === 7 && ty === 7) this.castling.wK = false;
    if (undo.captured === 'br' && tx === 0 && ty === 0) this.castling.bQ = false;
    if (undo.captured === 'br' && tx === 7 && ty === 0) this.castling.bK = false;
    return undo;
  }

  undoMoveInternal(undo) {
    const [fx, fy] = undo.move.from, [tx, ty] = undo.move.to;
    this.board[fy][fx] = undo.piece; this.board[ty][tx] = undo.captured;
    if (undo.move.isEp) { this.board[fy][tx] = undo.capturedEp; this.board[ty][tx] = null; }
    if (undo.move.isCastle) {
      if (undo.move.isCastle === 'k') { this.board[fy][7] = this.board[fy][5]; this.board[fy][5] = null; }
      else { this.board[fy][0] = this.board[fy][3]; this.board[fy][3] = null; }
    }
    this.epTarget = undo.epTarget; this.castling = undo.castling; this.halfMoves = undo.halfMoves;
  }

  toAlgebraic(x, y) { return String.fromCharCode(97 + x) + (8 - y); }

  makeMove(from, to, promotion) {
    if (this.status !== 'playing') return false;
    if (!Array.isArray(from) || from.length !== 2 || !this.inBounds(from[0], from[1])) return false;
    if (!Array.isArray(to) || to.length !== 2 || !this.inBounds(to[0], to[1])) return false;

    const legal = this.generateMoves(this.turn);
    const move = legal.find(m => m.from[0] === from[0] && m.from[1] === from[1] && m.to[0] === to[0] && m.to[1] === to[1] && (!m.promotion || m.promotion === promotion));
    if (!move) return false;

    this.makeMoveInternal(move);
    this.lastMove = { from: move.from, to: move.to };
    
    let moveStr = this.toAlgebraic(from[0], from[1]) + '-' + this.toAlgebraic(to[0], to[1]);
    if (move.isCastle) moveStr = move.isCastle === 'k' ? 'O-O' : 'O-O-O';
    if (move.promotion) moveStr += '=' + move.promotion.toUpperCase();
    this.moveHistory.push(moveStr);

    this.turn = this.turn === 'w' ? 'b' : 'w';
    this.history.push(move);
    
    const oppMoves = this.generateMoves(this.turn), isInCheck = this.isCheck(this.turn);
    if (oppMoves.length === 0) {
      if (isInCheck) { this.status = 'checkmate'; this.winner = this.turn === 'w' ? 'b' : 'w'; }
      else this.status = 'stalemate';
    } else if (this.halfMoves >= 100) this.status = 'draw';
    return true;
  }

  resign(color) { this.status = 'resigned'; this.winner = color === 'w' ? 'b' : 'w'; }
  acceptDraw() { this.status = 'draw'; }
}
module.exports = Chess;