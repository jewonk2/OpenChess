#!/usr/bin/env node
/**
 * refresh-data.mjs — Lichess Explorer 빅데이터 + Stockfish 평가로 openings.json 생성.
 *
 * 핵심: 리체스에서 "이미 두어진 수들"의 통계를 그대로 가져온다.
 *   - 각 포지션마다 https://explorer.lichess.ovh/lichess 를 호출해
 *     실제 대국 수(games)·채택률(adopt)·ECO/오프닝 이름을 수집한다.
 *   - 각 후보 수는 Stockfish 로 평가(평가치·loss 기반 품질)한다.
 *   - ECO(오프닝 이름)가 붙는 수 = 이론 수(book) → 평가와 무관하게 book.
 *
 * 사용법:
 *   STOCKFISH_PATH=/usr/games/stockfish node scripts/refresh-data.mjs
 *   (STOCKFISH_PATH 미지정 시 'stockfish' 를 PATH 에서 찾음)
 *   옵션: MAX_PLY(기본10) BREADTH(기본5) DELAY_MS(기본 700, 리체스 예의)
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const LICHESS = "https://explorer.lichess.ovh/lichess";
const MAX_PLY = +(process.env.MAX_PLY || 10);
const BREADTH = +(process.env.BREADTH || 5);
const DELAY_MS = +(process.env.DELAY_MS || 700);
const SF = process.env.STOCKFISH_PATH || "stockfish";
const RATINGS = "1600,1800,2000,2200,2500";
const SPEEDS = "blitz,rapid,classical";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---- 최소 UCI 드라이버 (로컬 Stockfish 바이너리) ---- */
function makeEngine() {
  const p = spawn(SF, [], { stdio: ["pipe", "pipe", "ignore"] });
  let buf = "";
  const waiters = [];
  p.stdout.on("data", (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      const w = waiters[0];
      if (!w) continue;
      const sc = line.match(/score (cp|mate) (-?\d+)/);
      if (sc) w.last = sc[1] === "mate" ? { mate: +sc[2] } : { cp: +sc[2] };
      if (line.startsWith("bestmove")) { waiters.shift().resolve(w.last || null); }
    }
  });
  const send = (s) => p.stdin.write(s + "\n");
  send("uci"); send("setoption name Threads value 2"); send("setoption name Hash value 256"); send("isready");
  return {
    eval: (fen, depth = 14) => new Promise((resolve) => { waiters.push({ resolve, last: null }); send("position fen " + fen); send("go depth " + depth); }),
    quit: () => send("quit"),
  };
}

/* ---- Lichess Explorer ---- */
const cache = new Map();
async function explorer(uciList) {
  const play = uciList.join(",");
  if (cache.has(play)) return cache.get(play);
  const url = `${LICHESS}?play=${play}&moves=12&topGames=0&recentGames=0&speeds=${SPEEDS}&ratings=${RATINGS}`;
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": "opening-trainer/1.0" } });
    if (res.status === 429) { await sleep(60000); continue; }
    if (!res.ok) throw new Error("lichess " + res.status);
    const j = await res.json();
    cache.set(play, j);
    await sleep(DELAY_MS);
    return j;
  }
  throw new Error("lichess rate limited");
}

/* ---- chess.js 없이 가벼운 SAN→UCI 변환은 복잡하므로, 여기선 리체스가 주는 uci 를 그대로 사용 ---- */
function classify(loss) { if (loss <= 25) return "good"; if (loss <= 60) return "inaccuracy"; if (loss <= 130) return "mistake"; return "blunder"; }

async function main() {
  const eng = makeEngine();
  await eng.eval("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", 8); // warmup
  const tree = {};
  // BFS: 노드 = {sans, uci}
  const queue = [{ sans: [], uci: [] }];
  let count = 0;
  while (queue.length) {
    const { sans, uci } = queue.shift();
    const key = sans.join(" ");
    if (tree[key]) continue;
    let data;
    try { data = await explorer(uci); } catch (e) { console.error("skip", key, e.message); continue; }
    const posTotal = (data.white || 0) + (data.draws || 0) + (data.black || 0);
    if (posTotal < 200 && sans.length > 0) { tree[key] = { opening: data.opening || null, moves: [] }; continue; }
    // 후보: 루트는 e4/d4 만, 그 외는 리체스 실제 빈도순 top BREADTH
    const cand = sans.length === 0
      ? (data.moves || []).slice(0, 8)
      : (data.moves || []).slice(0, BREADTH);
    const moves = [];
    for (const mv of cand) {
      const tot = (mv.white || 0) + (mv.draws || 0) + (mv.black || 0);
      // 자식 포지션 오프닝(ECO) 조회로 book 판정
      let childOpening = null;
      try { const cj = await explorer([...uci, mv.uci]); childOpening = cj.opening || null; } catch (_) {}
      const book = !!childOpening;
      // FEN 은 리체스 fen 필드 사용(자식 포지션). 평가치 계산.
      let ev = null, quality = null;
      try {
        const cj = cache.get([...uci, mv.uci].join(","));
        if (cj && cj.fen) ev = await eng.eval(cj.fen, 13);
      } catch (_) {}
      if (!book && ev) {
        // loss 계산용 부모 평가
        let parentEv = null;
        try { if (data.fen) parentEv = await eng.eval(data.fen, 14); } catch (_) {}
        const mover = sans.length % 2 === 0 ? 1 : -1;
        const cpW = ev.mate != null ? (ev.mate > 0 ? 100000 : -100000) : ev.cp;
        const pW = parentEv ? (parentEv.mate != null ? (parentEv.mate > 0 ? 100000 : -100000) : parentEv.cp) : cpW;
        quality = classify((pW * mover) - (cpW * mover));
      }
      moves.push({
        san: mv.san, book,
        eco: childOpening ? childOpening.eco : undefined,
        name: childOpening ? childOpening.name : undefined,
        evalCp: ev && ev.mate == null ? ev.cp : undefined,
        mate: ev && ev.mate != null ? ev.mate : undefined,
        quality: quality || undefined,
        adopt: posTotal ? +(100 * tot / posTotal).toFixed(1) : 0,
        games: tot,
      });
      count++;
      if (sans.length + 1 < MAX_PLY) queue.push({ sans: [...sans, mv.san], uci: [...uci, mv.uci] });
    }
    // 메인 라인(이름 없는 최다 채택 수)
    const mainIdx = moves.reduce((bi, m, i, a) => (m.games > (a[bi]?.games || -1) ? i : bi), 0);
    if (moves[mainIdx] && !moves[mainIdx].name) moves[mainIdx].isMain = true;
    tree[key] = { opening: data.opening || null, moves };
    if (count % 20 === 0) { console.error("evaluated", count, "moves,", Object.keys(tree).length, "nodes"); writeFileSync("src/data/openings.json", JSON.stringify({ tree, roots: ["e4", "d4"], maxPly: MAX_PLY })); }
  }
  eng.quit();
  writeFileSync("src/data/openings.json", JSON.stringify({ tree, roots: ["e4", "d4"], maxPly: MAX_PLY }));
  console.error("DONE:", Object.keys(tree).length, "nodes,", count, "moves -> src/data/openings.json");
}
main().catch((e) => { console.error(e); process.exit(1); });
