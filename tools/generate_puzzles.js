#!/usr/bin/env node
/* ============================================================
   LABYRINTH PUZZLE MINER
   Simulates hard-vs-hard self-play and mines positions that make
   good puzzles, chess-style: the solution must be UNIQUE.

   Puzzle types:
   - collect1: exactly one push(+rotation) lets the mover reach
     their target this turn.
   - collect2: no push reaches the target this turn, but exactly
     one first push preserves a guaranteed two-turn collection
     (solitaire convention: opponent replies are ignored).
   - block1: the opponent is about to finish; exactly one push
     cuts off ALL of their reaching replies.

   Usage:
     node generate_puzzles.js --seeds 1-10 --out puzzles_part.json
   The engine is loaded from ../labyrinth.html, or from the path in
   the ENGINE environment variable (used for testing).
   ============================================================ */
const fs = require('fs'), path = require('path'), vm = require('vm');

function loadEngine(){
  if(process.env.ENGINE) return require(process.env.ENGINE);
  const html = fs.readFileSync(path.join(__dirname, '..', 'labyrinth.html'), 'utf8');
  const m = html.match(/<script id="engine">([\s\S]*?)<\/script>/);
  if(!m) throw new Error('engine script not found in labyrinth.html');
  const mod = {exports:{}};
  vm.runInNewContext(m[1], {module: mod, console});
  return mod.exports;
}
const E = loadEngine();

/* ---------- helpers built on exported engine primitives ---------- */

function shiftCell(cell, insert){
  let [r,c] = cell;
  const {side, index} = insert;
  if(side==='N' && c===index){ r++; if(r>6) r=0; }
  else if(side==='S' && c===index){ r--; if(r<0) r=6; }
  else if(side==='W' && r===index){ c++; if(c>6) c=0; }
  else if(side==='E' && r===index){ c--; if(c<0) c=6; }
  return [r,c];
}

function allPushes(state){
  const out = [];
  for(const insert of E.legalInserts(state))
    for(const open of E.distinctRotations(state.spare.open))
      out.push({insert, open});
  return out;
}

/* pushes after which player pIdx can reach their current objective */
function reachingPushes(state, pIdx){
  const tid = E.currentTargetId(state.players[pIdx]);
  const hits = [];
  for(const ph of allPushes(state)){
    const s2 = E.cloneState(state);
    E.applyPush(s2, ph.insert, ph.open);
    const q = s2.players[pIdx];
    const g = tid===null ? q.start : E.findTreasure(s2, tid);
    if(g && E.bfs(s2, q.row, q.col).set[g[0]][g[1]]){
      const reach = E.bfs(s2, q.row, q.col);
      hits.push({insert: ph.insert, open: ph.open, dest: g, dist: reach.dist[g[0]][g[1]]});
    }
  }
  return hits;
}

/* first pushes that preserve a guaranteed own-2-turn collection;
   early-exits as soon as uniqueness is impossible (>limit found) */
function twoTurnPushes(state, meIdx, limit){
  const tid = E.currentTargetId(state.players[meIdx]);
  const works = [];
  for(const ph of allPushes(state)){
    const s2 = E.cloneState(state);
    E.applyPush(s2, ph.insert, ph.open);
    const me = s2.players[meIdx];
    const reach = E.bfs(s2, me.row, me.col);
    let ok = false;
    outer:
    for(const ph2 of allPushes(s2)){
      const s3 = E.cloneState(s2);
      E.applyPush(s3, ph2.insert, ph2.open);
      const g = tid===null ? me.start : E.findTreasure(s3, tid);
      if(!g) continue;
      const back = E.bfs(s3, g[0], g[1]); /* connectivity is symmetric */
      for(let r=0;r<7;r++) for(let c=0;c<7;c++) if(reach.set[r][c]){
        const [sr,sc] = shiftCell([r,c], ph2.insert);
        if(back.set[sr][sc]){ ok = true; break outer; }
      }
    }
    if(ok){
      works.push(ph);
      if(works.length > limit) return works;
    }
  }
  return works;
}

/* my pushes after which the opponent has ZERO reaching replies */
function blockingPushes(state, oppIdx){
  const blocks = [];
  let maxThreat = 0;
  for(const ph of allPushes(state)){
    const s2 = E.cloneState(state);
    E.applyPush(s2, ph.insert, ph.open);
    const oppHits = reachingPushes(s2, oppIdx).length;
    if(oppHits===0) blocks.push(ph);
    if(oppHits>maxThreat) maxThreat = oppHits;
  }
  return {blocks, maxThreat};
}

/* ---------- serialization (players normalized: [0]=mover) ---------- */

function snapshotPlayer(p, tid){
  return {row:p.row, col:p.col, start:[...p.start], target: tid===null ? -1 : tid};
}
function serialize(state, type, solution, difficulty, id){
  const meIdx = state.current;
  const oppIdx = (meIdx+1) % state.players.length;
  const me = state.players[meIdx], opp = state.players[oppIdx];
  return {
    id, type, difficulty,
    board: state.board.flat().map(t => [t.open, t.treasure===null ? -1 : t.treasure]),
    spare: [state.spare.open, state.spare.treasure===null ? -1 : state.spare.treasure],
    lastInsert: state.lastInsert ? {...state.lastInsert} : null,
    me:  snapshotPlayer(me,  E.currentTargetId(me)),
    opp: snapshotPlayer(opp, E.currentTargetId(opp)),
    solution,
  };
}
function boardHash(state){
  return state.board.flat().map(t=>t.open+'.'+t.treasure).join('|')
       + '#' + state.players.map(p=>p.row+','+p.col).join('#');
}

/* ---------- mining ---------- */

function mine(seedFrom, seedTo){
  const puzzles = [];
  const seen = new Set();
  for(let seed=seedFrom; seed<=seedTo; seed++){
    const s = E.newGame(2, seed);
    let t = 0;
    while(s.winners===null && t<300){
      const meIdx = s.current;
      const oppIdx = (meIdx+1)%2;
      const opp = s.players[oppIdx];
      const h = boardHash(s);
      if(!seen.has(h)){
        seen.add(h);
        const hits = reachingPushes(s, meIdx);
        if(hits.length===1){
          const sol = hits[0];
          const diff = sol.dist<=2 ? 'easy' : sol.dist<=4 ? 'medium' : 'hard';
          puzzles.push(serialize(s, 'collect1',
            {insert:sol.insert, open:sol.open, dest:sol.dest}, diff,
            `c1-${seed}-${t}`));
        } else if(hits.length===0){
          const works = twoTurnPushes(s, meIdx, 1);
          if(works.length===1){
            puzzles.push(serialize(s, 'collect2',
              {insert:works[0].insert, open:works[0].open, dest:null}, 'hard',
              `c2-${seed}-${t}`));
          }
        }
        /* blocking puzzles: only when the opponent is about to finish */
        if(opp.found.length >= opp.cards.length-1){
          const {blocks, maxThreat} = blockingPushes(s, oppIdx);
          if(blocks.length===1 && maxThreat>=3){
            puzzles.push(serialize(s, 'block1',
              {insert:blocks[0].insert, open:blocks[0].open, dest:null},
              maxThreat>=8 ? 'expert' : 'hard',
              `b1-${seed}-${t}`));
          }
        }
      }
      const ch = E.aiChooseMove(s, 'hard');
      E.applyPush(s, ch.insert, ch.open);
      E.applyMove(s, ch.dest[0], ch.dest[1]);
      t++;
    }
  }
  return puzzles;
}

/* ---------- CLI ---------- */

function getArg(name, dflt){
  const i = process.argv.indexOf('--'+name);
  return i>=0 ? process.argv[i+1] : dflt;
}
const [a,b] = getArg('seeds','1-2').split('-').map(Number);
const out = getArg('out', 'puzzles_part.json');
const t0 = Date.now();
const puzzles = mine(a, b);
fs.writeFileSync(out, JSON.stringify(puzzles));
console.log(`seeds ${a}-${b}: ${puzzles.length} puzzles (`+
  puzzles.filter(p=>p.type==='collect1').length+' c1, '+
  puzzles.filter(p=>p.type==='collect2').length+' c2, '+
  puzzles.filter(p=>p.type==='block1').length+` b1) in ${((Date.now()-t0)/1000).toFixed(1)}s`);
