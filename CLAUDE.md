# Labyrinth — project notes

A faithful digital version of Ravensburger's Labyrinth board game, plus a chess-style
puzzle mode. Built collaboratively with Claude (Cowork). Live at
https://whaaaaaaaaaaaaa.github.io/Labyrinth/ · repo: whaaaaaaaaaaaaa/Labyrinth.

## Files
- **labyrinth.html** — the entire game, single file. Two scripts:
  - `<script id="engine">` — pure game logic, zero DOM. Designed to run in Node
    (has `module.exports`) so a future multiplayer server can reuse it verbatim.
  - second `<script>` — UI layer (render loop, animations, puzzle mode).
- **puzzles.js** — `window.PUZZLES`, library v4 (380 puzzles: 220 classic 7×7 +
  80 5×5 + 80 9×9). Loaded via script tag so the game works over file:// .
  Must ship alongside labyrinth.html.
- **puzzles.json** — same data, for tooling.
- **tools/generate_puzzles.js** — puzzle miner (self-play, hard AI). Run:
  `node generate_puzzles.js --seeds 1-20 --size 9 --out part.json` (loads engine
  from ../labyrinth.html, or `ENGINE=path` to override). `--size 5|7|9`, default 7.
- **tools/verify_puzzles.js** — independent verifier; re-proves every puzzle's solution
  set from JSON alone. `node verify_puzzles.js puzzles.json [from] [to]`.
- **index.html** — redirect for the clean GitHub Pages URL.
- **backups/** — manual snapshots (pre-git era).

## Game rules implemented
Faithful 7×7 board: 16 fixed tiles (now red brick), 34 movable (13 I, 15 L, 6 T),
24 treasures, 12 insertion arrows, no-reverse-push rule, pawn wraparound.
**Board sizes** (engine fully N-parameterized; `state.size`, default 7):
- 5×5: 9 fixed, 17 movable (6 I, 3 treasure-T, 4 treasure-L, 4 plain L), 12 treasures.
- 9×9: 25 fixed, 57 movable (22 I, 10 treasure-T, 5 treasure-L, 20 plain L), 36 treasures.
- `fixedLayout(n)` generates fixed tiles: corners point inward, edges/interior are
  Ts missing the outward/orbit-rule side (4-fold rotational symmetry; reproduces the
  original exactly for n=7, verified). 5×5 and 9×9 centre tile is a CROSS (all four
  open) — the only way to keep perfect symmetry; deliberate vocabulary deviation.
- TREASURES has 36 entries; sizes use ids 0..count-1 (7×7 ids unchanged).
- 7×7 games are seed-identical to the pre-parameterization engine (verified).
**Equal-turns ending** (deliberate house rule): when someone finishes, the round
completes so all players get equal turns; all finishers share the win (draws possible).
**Public targets** (deliberate deviation): every player's current objective pulses
in their colour on the board.

## AI (engine)
- `aiChooseMove(state, level)` — level 'hard' (default in UI) or standard (greedy).
- Both provably never miss a reachable objective (tested).
- Hard adds: opponent denial (counts opponent's goal-reaching replies, minimizes),
  next-turn-potential fallback (stands where most own follow-up pushes reconnect),
  hostage penalty (avoids pushing own target onto the spare = opponent's hand).
- Tunable weights: denial full-block bonus 400, per-option -12, hostage -350.

## Puzzle data format (v4)
v4 adds `size: 5|9` on non-classic puzzles (absent = 7×7) and id prefixes
`s5-`/`s9-`; board array is size²×[open,treasure]. Everything else as v3:
A "solution" = a distinct push arrow (side+index); workable rotations are grouped:
`sols: [{insert:{side,index}, opens:[...], dest}]`, `solutions: count`,
`solution: sols[0]`, `wrap: true` if every solution wraps a pawn off-board.
Board: 49×[open,treasure] row-major (fixed derivable from even/even position),
`me`/`opp` {row,col,start,target} (target -1 = go home), `lastInsert`.
Quality bars: collect1 paths must bend ≥2 times for EVERY solution; ≤3 solution
lines; wrap-locked puzzles capped <20% per type at assembly.
Puzzle types: collect1, collect2 (solitaire, keyed by first push), block1.
UI completion: multi-solution puzzles require finding ALL lines (foundSols set).

## UI conventions
- `render(opts)` full re-render; opts: {slide:{side,index}, hidePawn:idx, deal:true}.
- Globals: `busy` (input lock), `dealing`, `puzzle` (null = game mode), `aiLevel`.
- Puzzle mode hides #sidebar entirely; body.puzzleMode enlarges --cell.
- Animations: slide .8s; pawn glide 260ms/cell with SVG trail (draws behind pawn,
  fades 5.5s); spare tile flies off-board to panel; deal-in cascade ~2.4s.
- Keyboard: Space/→/↓/R rotate spare CW, ←/↑ CCW.
- localStorage: `labyrinthPuzzlesSolved` (ids).
- Daily: date-hashed pick per type (`dailyFor`), cycles only today's 3 — 7×7 only
  (deliberate: streak continuity). Picker groups puzzles by size (7×7, 5×5, 9×9).
- Board size: `boardSize` global (menu sizeBtns) → `newGame(.., boardSize)`;
  render() sets CSS `--bn` + inline grid-template from `state.size`. Cell size,
  panel heights and puzzleMode all derive from --bn. Deal stagger is adaptive
  (`min(0.045, 1.45/movables)`) so 9×9 deals in the same ~2.4s window.
- HAZARD: engine + UI scripts share the page's global scope — an engine
  function name colliding with a UI `let` (e.g. boardSize) is a page-killing
  SyntaxError. Engine's size helper is therefore named `sizeOf`.

## Testing workflow
Engine tests live as throwaway scripts (see history): extract engine via regex
`<script id="engine">([\s\S]*?)</script>`, require in Node. Key invariants tested:
tile counts, push/wrap mechanics, equal-turns, AI perfect-play property, full
AI-vs-AI games complete, puzzle verifier passes 100%.

## Session quirk (for Claude/Cowork)
The sandbox mount's view of labyrinth.html goes STALE after repeated edits in one
session (read-side lag; can show truncated old versions). The Windows-side file is
always authoritative — verify via the Read tool, and syntax-check by maintaining
patched mirror copies in /tmp or writing fresh files (fresh writes sync fine).
sandbox→Windows `cp` into the mount works for new/whole files.

## Publish workflow
GitHub Desktop → commit to main → Push origin → Pages redeploys in ~1 min.
CDN + browser cache can serve stale for ~10 min: hard refresh (Ctrl+F5).

## Roadmap / parked ideas
1. Mobile-responsive layout (PWA) — edge-tap pushing already touch-friendly.
2. Correspondence multiplayer (server reuses engine; turn-based, DB + notifications).
3. Daily challenge polish: streaks, shareable results, curated calendar.
4. ~~Variable board sizes~~ DONE (5×5/9×9 shipped; 11×11 would only need a
   CONFIG entry + puzzle mining — engine/UI/miner are fully N-generic).
5. Block-AND-reach puzzle variant (data supports it).
6. AI that exploits public targets as a difficulty tier above Hard.
7. Win celebration animation.
