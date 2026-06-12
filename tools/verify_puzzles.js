/* Independent verifier v3: rebuilds each puzzle from JSON alone (any board
   size; `size` field, default 7) and re-proves: solution set is exactly
   `sols` (count + membership), collect1 paths all bend >=2 times, block
   threat is real.
   Usage: node verify_puzzles.js file.json [fromIdx] [toIdx] */
const fs = require('fs');
const path = require('path'), vm = require('vm');
function loadEngine(){
  if(process.env.ENGINE) return require(process.env.ENGINE);
  const html = fs.readFileSync(path.join(__dirname, '..', 'labyrinth.html'), 'utf8');
  const m = html.match(/<script id="engine">([\s\S]*?)<\/script>/);
  const mod = {exports:{}};
  vm.runInNewContext(m[1], {module: mod, console});
  return mod.exports;
}
const E = loadEngine();

function allPushes(s){
  const out=[];
  for(const insert of E.legalInserts(s))
    for(const open of E.distinctRotations(s.spare.open)) out.push({insert,open});
  return out;
}
function pathTurns(p){
  let t=0;
  for(let i=2;i<p.length;i++)
    if(p[i][0]-p[i-1][0]!==p[i-1][0]-p[i-2][0] || p[i][1]-p[i-1][1]!==p[i-1][1]-p[i-2][1]) t++;
  return t;
}
function rebuild(p){
  const n = p.size || 7;
  const board=[]; let k=0;
  for(let r=0;r<n;r++){ const row=[];
    for(let c=0;c<n;c++){ const [open,tr]=p.board[k++];
      row.push({open, treasure:tr<0?null:tr, fixed:r%2===0&&c%2===0}); }
    board.push(row); }
  const mk=(q,idx)=>({idx,name:'',color:'',row:q.row,col:q.col,start:[...q.start],
    cards:q.target<0?[]:[q.target],found:[],turns:0,done:false,isAI:true});
  return {size:n, board, spare:{open:p.spare[0],treasure:p.spare[1]<0?null:p.spare[1],fixed:false},
    players:[mk(p.me,0),mk(p.opp,1)], current:0, phase:'push',
    lastInsert:p.lastInsert?{...p.lastInsert}:null, winners:null, finished:[], seed:0};
}
function reachSols(s, pIdx){
  const tid=E.currentTargetId(s.players[pIdx]); const hits=[];
  for(const ph of allPushes(s)){
    const s2=E.cloneState(s); E.applyPush(s2,ph.insert,ph.open);
    const q=s2.players[pIdx];
    const g=tid===null?q.start:E.findTreasure(s2,tid);
    if(!g) continue;
    const reach=E.bfs(s2,q.row,q.col);
    if(reach.set[g[0]][g[1]]) hits.push({...ph, turns:pathTurns(E.pathTo(reach,g))});
  }
  return hits;
}
function twoTurnSols(s, meIdx){
  const n = s.size || 7;
  const tid=E.currentTargetId(s.players[meIdx]); const works=[];
  for(const ph of allPushes(s)){
    const s2=E.cloneState(s); E.applyPush(s2,ph.insert,ph.open);
    const me=s2.players[meIdx];
    const reach=E.bfs(s2,me.row,me.col);
    let ok=false;
    outer: for(const ph2 of allPushes(s2)){
      const s3=E.cloneState(s2); E.applyPush(s3,ph2.insert,ph2.open);
      const g=tid===null?me.start:E.findTreasure(s3,tid);
      if(!g) continue;
      const back=E.bfs(s3,g[0],g[1]);
      for(let r=0;r<n;r++) for(let c=0;c<n;c++) if(reach.set[r][c]){
        const [sr,sc]=E.shiftCell([r,c],ph2.insert,n);
        if(back.set[sr][sc]){ ok=true; break outer; }
      }
    }
    if(ok) works.push(ph);
  }
  return works;
}
function blockSols(s, oppIdx){
  const blocks=[]; let maxThreat=0;
  const tid=E.currentTargetId(s.players[oppIdx]);
  for(const ph of allPushes(s)){
    const s2=E.cloneState(s); E.applyPush(s2,ph.insert,ph.open);
    let n=0;
    for(const ph2 of allPushes(s2)){
      const s3=E.cloneState(s2); E.applyPush(s3,ph2.insert,ph2.open);
      const q=s3.players[oppIdx];
      const g=tid===null?q.start:E.findTreasure(s3,tid);
      if(g && E.bfs(s3,q.row,q.col).set[g[0]][g[1]]) n++;
    }
    if(n===0) blocks.push(ph);
    if(n>maxThreat) maxThreat=n;
  }
  return {blocks, maxThreat};
}
/* group raw (insert,open) hits by push arrow, mirroring the miner */
function groupSols(sols){
  const map = new Map();
  for(const s of sols){
    const k = s.insert.side + s.insert.index;
    if(!map.has(k)) map.set(k, {insert: s.insert, opens: []});
    map.get(k).opens.push(s.open);
  }
  return [...map.values()];
}
const gkey = g => g.insert.side+g.insert.index+'/'+[...g.opens].sort((a,b)=>a-b).join(',');
const sameSet = (a,b)=>{
  const A=new Set(groupSols(a).map(gkey)), B=new Set(b.map(gkey));
  return A.size===B.size && [...A].every(x=>B.has(x));
};

const data = JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const all = data.puzzles || data;
const list = all.slice(+(process.argv[3]||0), +(process.argv[4]||all.length));
let ok=0, bad=0;
for(const p of list){
  const s = rebuild(p);
  let found, extra=true;
  if(p.type==='collect1'){
    found = reachSols(s, 0);
    extra = found.every(h=>h.turns>=2);
  } else if(p.type==='collect2'){
    found = twoTurnSols(s, 0);
  } else {
    const r = blockSols(s, 1);
    found = r.blocks;
    extra = r.maxThreat>=3;
  }
  const groups = groupSols(found);
  if(groups.length===p.solutions && sameSet(found, p.sols) && extra) ok++;
  else { bad++; console.log(`${p.id}: expected ${p.solutions} lines, found ${groups.length}, extra=${extra}`); }
}
console.log(`${ok} verified, ${bad} failed of ${list.length}`);
process.exit(bad?1:0);
