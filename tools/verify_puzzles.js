#!/usr/bin/env node
/* Independent puzzle verifier: rebuilds each puzzle from its JSON
   serialization alone and re-proves the solution is correct AND unique.
   Usage: node verify_puzzles.js puzzles.json */
const fs = require('fs'), path = require('path'), vm = require('vm');

function loadEngine(){
  if(process.env.ENGINE) return require(process.env.ENGINE);
  const html = fs.readFileSync(path.join(__dirname, '..', 'labyrinth.html'), 'utf8');
  const m = html.match(/<script id="engine">([\s\S]*?)<\/script>/);
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

function rebuild(p){
  const board = [];
  let k = 0;
  for(let r=0;r<7;r++){
    const row = [];
    for(let c=0;c<7;c++){
      const [open, tr] = p.board[k++];
      row.push({open, treasure: tr<0?null:tr, fixed: r%2===0 && c%2===0});
    }
    board.push(row);
  }
  const mk = (q, idx)=>({
    idx, name:'', color:'', row:q.row, col:q.col, start:[...q.start],
    cards: q.target<0 ? [] : [q.target], found: [],
    turns:0, done:false, isAI:true,
  });
  return {
    board,
    spare: {open: p.spare[0], treasure: p.spare[1]<0?null:p.spare[1], fixed:false},
    players: [mk(p.me,0), mk(p.opp,1)],
    current: 0, phase: 'push',
    lastInsert: p.lastInsert ? {...p.lastInsert} : null,
    winners: null, finished: [], seed: 0,
  };
}

function reachingPushes(state, pIdx){
  const tid = E.currentTargetId(state.players[pIdx]);
  const hits = [];
  for(const ph of allPushes(state)){
    const s2 = E.cloneState(state);
    E.applyPush(s2, ph.insert, ph.open);
    const q = s2.players[pIdx];
    const g = tid===null ? q.start : E.findTreasure(s2, tid);
    if(g && E.bfs(s2, q.row, q.col).set[g[0]][g[1]]) hits.push(ph);
  }
  return hits;
}
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
      const back = E.bfs(s3, g[0], g[1]);
      for(let r=0;r<7;r++) for(let c=0;c<7;c++) if(reach.set[r][c]){
        const [sr,sc] = shiftCell([r,c], ph2.insert);
        if(back.set[sr][sc]){ ok = true; break outer; }
      }
    }
    if(ok){ works.push(ph); if(works.length>limit) return works; }
  }
  return works;
}
function blockingPushes(state, oppIdx){
  const blocks = [];
  for(const ph of allPushes(state)){
    const s2 = E.cloneState(state);
    E.applyPush(s2, ph.insert, ph.open);
    if(reachingPushes(s2, oppIdx).length===0) blocks.push(ph);
  }
  return blocks;
}
const samePush = (a,b) => a.insert.side===b.insert.side &&
  a.insert.index===b.insert.index && a.open===b.open;

const file = process.argv[2] || 'puzzles.json';
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const puzzles = Array.isArray(data) ? data : data.puzzles;
let ok=0, bad=0;
for(const p of puzzles){
  const s = rebuild(p);
  let sols;
  if(p.type==='collect1')      sols = reachingPushes(s, 0);
  else if(p.type==='collect2') sols = twoTurnPushes(s, 0, 1);
  else if(p.type==='block1')   sols = blockingPushes(s, 1);
  else { console.log(`${p.id}: unknown type`); bad++; continue; }
  if(sols.length===1 && samePush(sols[0], p.solution)) ok++;
  else { console.log(`${p.id}: expected unique solution, got ${sols.length}`); bad++; }
}
console.log(`${ok} verified, ${bad} failed of ${puzzles.length}`);
process.exit(bad?1:0);
