#!/usr/bin/env node
/* ============================================================
   LABYRINTH PUZZLE MINER v2
   - accepts 1..3 equally valid solutions (stored in `sols`,
     count in `solutions`, primary in `solution`)
   - flags puzzles whose every solution wraps a pawn off the
     board (`wrap: true`) so assembly can cap them at <20%
   - collect1 quality filter: every solution's walking path must
     bend at least twice (no straight-line trivia)
   Usage: node generate_puzzles.js --seeds 1-10 --out part.json
   ============================================================ */
const fs = require('fs'), path = require('path'), vm = require('vm');

function loadEngine(){
  if(process.env.ENGINE) return require(process.env.ENGINE);
  const html = fs.readFileSync(path.join(__dirname, '..', 'labyrinth.html'), 'utf8');
  const m = html.match(/<script id="engine">([\s\S]*?)<\/script>/);
  if(!m) throw new Error('engine script not found');
  const mod = {exports:{}};
  vm.runInNewContext(m[1], {module: mod, console});
  return mod.exports;
}
const E = loadEngine();

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
/* a "solution" is a distinct push arrow; rotations group under it */
function distinctIns(list){
  return new Set(list.map(h=>h.insert.side+h.insert.index)).size;
}
function groupSols(sols){
  const map = new Map();
  for(const s of sols){
    const k = s.insert.side + s.insert.index;
    if(!map.has(k)) map.set(k, {insert: s.insert, opens: [], dest: s.dest||null, wrap: s.wrap});
    map.get(k).opens.push(s.open);
  }
  return [...map.values()];
}

function pathTurns(p){
  let t = 0;
  for(let i=2;i<p.length;i++){
    if(p[i][0]-p[i-1][0] !== p[i-1][0]-p[i-2][0] ||
       p[i][1]-p[i-1][1] !== p[i-1][1]-p[i-2][1]) t++;
  }
  return t;
}

/* full-detail solutions for "reach goal this turn" */
function reachingPushes(state, pIdx, cap){
  const tid = E.currentTargetId(state.players[pIdx]);
  const p0 = state.players[pIdx];
  const hits = [];
  for(const ph of allPushes(state)){
    const s2 = E.cloneState(state);
    E.applyPush(s2, ph.insert, ph.open);
    const q = s2.players[pIdx];
    const g = tid===null ? q.start : E.findTreasure(s2, tid);
    if(!g) continue;
    const reach = E.bfs(s2, q.row, q.col);
    if(reach.set[g[0]][g[1]]){
      const walk = E.pathTo(reach, g);
      hits.push({
        insert: ph.insert, open: ph.open, dest: g,
        dist: reach.dist[g[0]][g[1]],
        turns: pathTurns(walk),
        wrap: Math.abs(q.row-p0.row)===6 || Math.abs(q.col-p0.col)===6,
      });
      if(cap && distinctIns(hits)>cap) return hits;
    }
  }
  return hits;
}
function countReaching(state, pIdx){
  const tid = E.currentTargetId(state.players[pIdx]);
  let n = 0;
  for(const ph of allPushes(state)){
    const s2 = E.cloneState(state);
    E.applyPush(s2, ph.insert, ph.open);
    const q = s2.players[pIdx];
    const g = tid===null ? q.start : E.findTreasure(s2, tid);
    if(g && E.bfs(s2, q.row, q.col).set[g[0]][g[1]]) n++;
  }
  return n;
}

function twoTurnPushes(state, meIdx, cap){
  const tid = E.currentTargetId(state.players[meIdx]);
  const me0 = state.players[meIdx];
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
      const back = E.bfs(s3, g[0], g[1]);
      for(let r=0;r<7;r++) for(let c=0;c<7;c++) if(reach.set[r][c]){
        const [sr,sc] = shiftCell([r,c], ph2.insert);
        if(back.set[sr][sc]){ ok = true; break outer; }
      }
    }
    if(ok){
      works.push({insert: ph.insert, open: ph.open, dest: null,
        wrap: Math.abs(me.row-me0.row)===6 || Math.abs(me.col-me0.col)===6});
      if(cap && distinctIns(works)>cap) return works;
    }
  }
  return works;
}

function blockingPushes(state, oppIdx){
  const o0 = state.players[oppIdx];
  const blocks = [];
  let maxThreat = 0;
  for(const ph of allPushes(state)){
    const s2 = E.cloneState(state);
    E.applyPush(s2, ph.insert, ph.open);
    const n = countReaching(s2, oppIdx);
    if(n===0){
      const q = s2.players[oppIdx];
      blocks.push({insert: ph.insert, open: ph.open, dest: null,
        wrap: Math.abs(q.row-o0.row)===6 || Math.abs(q.col-o0.col)===6});
    }
    if(n>maxThreat) maxThreat = n;
  }
  return {blocks, maxThreat};
}

function snapshotPlayer(p, tid){
  return {row:p.row, col:p.col, start:[...p.start], target: tid===null ? -1 : tid};
}
function serialize(state, type, sols, difficulty, id){
  const meIdx = state.current;
  const oppIdx = (meIdx+1) % state.players.length;
  const me = state.players[meIdx], opp = state.players[oppIdx];
  const groups = groupSols(sols);
  return {
    id, type, difficulty,
    solutions: groups.length,
    wrap: groups.every(g=>g.wrap),
    board: state.board.flat().map(t => [t.open, t.treasure===null ? -1 : t.treasure]),
    spare: [state.spare.open, state.spare.treasure===null ? -1 : state.spare.treasure],
    lastInsert: state.lastInsert ? {...state.lastInsert} : null,
    me:  snapshotPlayer(me,  E.currentTargetId(me)),
    opp: snapshotPlayer(opp, E.currentTargetId(opp)),
    sols: groups,
    solution: groups[0],
  };
}
function boardHash(state){
  return state.board.flat().map(t=>t.open+'.'+t.treasure).join('|')
       + '#' + state.players.map(p=>p.row+','+p.col).join('#');
}

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
        const hits = reachingPushes(s, meIdx, 3);
        if(hits.length>=1 && distinctIns(hits)<=3 && hits.every(x=>x.turns>=2)){
          const minD = Math.min(...hits.map(x=>x.dist));
          puzzles.push(serialize(s, 'collect1', hits,
            minD<=3 ? 'medium' : 'hard', `c1-${seed}-${t}`));
        } else if(hits.length===0){
          const works = twoTurnPushes(s, meIdx, 3);
          if(works.length>=1 && distinctIns(works)<=3)
            puzzles.push(serialize(s, 'collect2', works, 'hard', `c2-${seed}-${t}`));
        }
        if(opp.found.length >= opp.cards.length-1){
          const {blocks, maxThreat} = blockingPushes(s, oppIdx);
          if(blocks.length>=1 && distinctIns(blocks)<=3 && maxThreat>=3)
            puzzles.push(serialize(s, 'block1', blocks,
              maxThreat>=8 ? 'expert' : 'hard', `b1-${seed}-${t}`));
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

function getArg(name, dflt){
  const i = process.argv.indexOf('--'+name);
  return i>=0 ? process.argv[i+1] : dflt;
}
const [a,b] = getArg('seeds','1-2').split('-').map(Number);
const out = getArg('out', 'puzzles_part.json');
const t0 = Date.now();
const puzzles = mine(a, b);
fs.writeFileSync(out, JSON.stringify(puzzles));
const stat = ty => {
  const l = puzzles.filter(p=>p.type===ty);
  return `${l.length} ${ty} (${l.filter(p=>p.wrap).length} wrap, ${l.filter(p=>p.solutions>1).length} multi-line)`;
};
console.log(`seeds ${a}-${b}: ${stat('collect1')}, ${stat('collect2')}, ${stat('block1')} in ${((Date.now()-t0)/1000).toFixed(1)}s`);
