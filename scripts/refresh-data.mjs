#!/usr/bin/env node
/**
 * refresh-data.mjs — Lichess Explorer 빅데이터 + Stockfish 평가로 openings.json 생성.
 *
 * 핵심: 리체스에서 "이미 두어진 수들"의 통계를 그대로 가져온다.
 *   - 각 포지션마다 https://explorer.lichess.org/lichess 를 호출해
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
import { writeFileSync, readFileSync } from "node:fs";

const LICHESS = "https://explorer.lichess.org/lichess";
const MAX_PLY = +(process.env.MAX_PLY || 10);
const BREADTH = +(process.env.BREADTH || 5);
const DELAY_MS = +(process.env.DELAY_MS || 700);
const SF = process.env.STOCKFISH_PATH || "stockfish";
const RATINGS = "1600,1800,2000,2200,2500";
const SPEEDS = "blitz,rapid,classical";
// 전체 누적(수백만 표본) 대신 "최근 N개월간 실제로 두어진 대국"만 집계 — 앱의 라이브 조회와 동일 기준
const STATS_WINDOW_MONTHS = +(process.env.STATS_WINDOW_MONTHS || 12);
function sinceParam(monthsBack) {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - monthsBack);
  return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0");
}
const SINCE = sinceParam(STATS_WINDOW_MONTHS);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// src/App.jsx 에 인라인된 "const SNAP = ...DATA 마커... {...};" 블록을 최신 데이터로 교체.
// 앱은 src/data/openings.json 을 런타임에 읽지 않고 이 인라인 블록만 사용하므로,
// 이 동기화가 없으면 refresh 를 아무리 돌려도 화면에는 절대 반영되지 않는다(과거 버그의 원인).
// Windows 체크아웃 시 CRLF로 바뀌어도(core.autocrlf) 안전하게 파싱되도록 \r\n/\n 모두 처리.
function readAppSnap() {
  const src = readFileSync("src/App.jsx", "utf8");
  const lines = src.split(/\r?\n/);
  const idx = lines.findIndex((l) => l.startsWith("const SNAP = "));
  if (idx === -1) return { error: "src/App.jsx 에서 'const SNAP = ' 라인을 찾지 못함" };
  const marker = "/*__DATA__*/ ";
  const mi = lines[idx].indexOf(marker);
  if (mi === -1) return { error: "/*__DATA__*/ 마커를 찾지 못함" };
  const jsonPart = lines[idx].slice(mi + marker.length).trimEnd().replace(/;$/, "");
  try { return { data: JSON.parse(jsonPart) }; } catch (e) { return { error: "SNAP JSON 파싱 실패: " + e.message }; }
}
function injectIntoApp(data) {
  const appPath = "src/App.jsx";
  const src = readFileSync(appPath, "utf8");
  const lines = src.split(/\r?\n/);
  const idx = lines.findIndex((l) => l.startsWith("const SNAP = "));
  if (idx === -1) { console.error("경고: src/App.jsx 에서 'const SNAP = ' 라인을 찾지 못해 인라인 동기화를 건너뜀"); return; }
  const marker = "/*__DATA__*/ ";
  const mi = lines[idx].indexOf(marker);
  if (mi === -1) { console.error("경고: /*__DATA__*/ 마커를 찾지 못해 인라인 동기화를 건너뜀"); return; }
  const prefix = lines[idx].slice(0, mi + marker.length);
  lines[idx] = prefix + JSON.stringify(data) + ";";
  writeFileSync(appPath, lines.join("\n"));
}
// 안전장치: Lichess 조회가 (레이트리밋·인증 오류 등으로) 대부분/전부 실패하면 tree 가 텅 비거나
// 기존보다 훨씬 작아진다. 이 경우 절대 기존 정상 데이터를 덮어쓰지 않는다(과거 데이터 유실 사고 재발 방지).
// 기존 스냅샷을 아예 읽지/파싱하지 못하는 경우도 "안전 비교 불가"로 보고 똑같이 저장을 막는다
// (silent fail-open으로 안전장치가 무력화됐던 사고 재발 방지). FORCE=1 로 강제 저장 가능.
function guardedSave(snapshot, { label }) {
  const newCount = Object.keys(snapshot.tree).length;
  if (!process.env.FORCE) {
    const baseline = readAppSnap();
    if (baseline.error) {
      console.error(
        `중단(${label}): 기존 src/App.jsx 스냅샷을 읽지 못해 안전 비교를 할 수 없습니다 (${baseline.error}). ` +
        `데이터 유실을 막기 위해 저장을 건너뜁니다. 정말로 이 결과로 덮어쓰려면 FORCE=1 환경변수를 설정하고 다시 실행하세요.`
      );
      return false;
    }
    const baselineCount = Object.keys(baseline.data.tree || {}).length;
    if (baselineCount > 0 && newCount < baselineCount * 0.5) {
      console.error(
        `중단(${label}): 새 데이터가 ${newCount}개 노드로, 기존 ${baselineCount}개보다 너무 작습니다. ` +
        `Lichess 조회가 대부분 실패했을 가능성이 큽니다 — 기존 데이터를 보호하기 위해 저장을 건너뜁니다. ` +
        `정말로 이 결과로 덮어쓰려면 FORCE=1 환경변수를 설정하고 다시 실행하세요.`
      );
      return false;
    }
  }
  writeFileSync("src/data/openings.json", JSON.stringify(snapshot));
  injectIntoApp(snapshot);
  return true;
}

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
// Lichess Explorer가 로그인(OAuth 토큰)을 요구함 — https://lichess.org/account/oauth/token/create
// 에서 토큰을 발급받아 LICHESS_TOKEN 환경변수로 넘기면 인증 헤더를 붙여 호출한다.
const EXPLORER_HEADERS = { "User-Agent": "opening-trainer/1.0" };
if (process.env.LICHESS_TOKEN) EXPLORER_HEADERS.Authorization = "Bearer " + process.env.LICHESS_TOKEN;

async function explorer(uciList) {
  const play = uciList.join(",");
  if (cache.has(play)) return cache.get(play);
  const url = `${LICHESS}?play=${play}&moves=12&topGames=0&recentGames=0&speeds=${SPEEDS}&ratings=${RATINGS}&since=${SINCE}`;
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, { headers: EXPLORER_HEADERS });
    if (res.status === 429) { await sleep(60000); continue; }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error("lichess " + res.status + (body ? " — " + body.slice(0, 300) : ""));
    }
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
    // 메인 라인(이름 없는 최다 채택 수) — games는 이 판정에만 내부적으로 쓰고 결과물엔 남기지 않는다.
    // 정적 스냅샷에 실시간 표본 수치를 박아두면 시간이 지나며 실제 값과 어긋나 "인위적인 숫자"로
    // 보이게 되므로(과거에 실제로 문제가 됨), 통계는 항상 라이브 조회로만 표시하고 스냅샷은
    // 이름/ECO/키워드 같은 구조적 정보만 담는다.
    const mainIdx = moves.reduce((bi, m, i, a) => (m.games > (a[bi]?.games || -1) ? i : bi), 0);
    if (moves[mainIdx] && !moves[mainIdx].name) moves[mainIdx].isMain = true;
    const exportMoves = moves.map(({ adopt, games, ...rest }) => rest);
    tree[key] = { opening: data.opening || null, moves: exportMoves };
    if (count % 20 === 0) {
      console.error("evaluated", count, "moves,", Object.keys(tree).length, "nodes");
      guardedSave({ tree, roots: ["e4", "d4"], maxPly: MAX_PLY }, { label: "중간 저장" });
    }
  }
  eng.quit();
  const finalSnapshot = { tree, roots: ["e4", "d4"], maxPly: MAX_PLY };
  const saved = guardedSave(finalSnapshot, { label: "최종 저장" });
  if (!saved) { console.error("실패: 데이터가 저장되지 않았습니다. 위 원인(주로 Lichess 응답 오류)을 먼저 해결하세요."); process.exit(1); }
  console.error("DONE:", Object.keys(tree).length, "nodes,", count, "moves -> src/data/openings.json + src/App.jsx 인라인 동기화 완료");
}
main().catch((e) => { console.error(e); process.exit(1); });
