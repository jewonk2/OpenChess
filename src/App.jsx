import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  GraduationCap, Library, Settings, ChevronLeft, ChevronRight, ChevronsLeft,
  Lock, Crown, Sparkles, Info, Book, BookOpen, ArrowUpDown, Cpu, Wifi, WifiOff,
  ChevronRight as Crumb, Star, ThumbsUp, Check, Play, ArrowLeft, RotateCcw,
} from "lucide-react";
import __SNAPSHOT__ from "./data/openings.json";

/* ============================================================ 디자인 토큰 ============================================================ */
const T = {
  ebony: "#21130B", ebony2: "#2E1B10", ebony3: "#3D2616",
  ivory: "#EBDDC4", ivoryHi: "#FAF2E2", paper: "#F1E6D0",
  ink: "#2A1A0E", inkSoft: "#7A6650",
  boardLight: "#E8D2A6", boardDark: "#7C4F2E",
  brass: "#C49A50", brassHi: "#E6C57C",
  brilliant: "#16B5A6", only: "#3E7CC4",
  best: "#3F7A3A", excellent: "#5C8A52", good: "#8FB55E",
  inaccuracy: "#E0B53A", mistake: "#D9822B", blunder: "#C8453B",
  book: "#8A5A2B", arrow: "#2F6DB0",
};
const PIECE = { K: "\u265A\uFE0E", Q: "\u265B\uFE0E", R: "\u265C\uFE0E", B: "\u265D\uFE0E", N: "\u265E\uFE0E", P: "\u265F\uFE0E" };
const FILES = "abcdefgh";

const ENGINE_BASE = (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.BASE_URL) ? import.meta.env.BASE_URL : "/";
const ENGINE_URLS = [
  ENGINE_BASE + "engine/stockfish-nnue-16-single.js",
  "https://cdn.jsdelivr.net/npm/stockfish@16.0.0/src/stockfish-nnue-16-single.js",
];
const LICHESS_API = "https://explorer.lichess.ovh/lichess";
const WIKI_API = "https://en.wikipedia.org/api/rest_v1/page/summary/";

/* ===== Supabase 백엔드 (선택) — Vite 환경변수로 주입, 미설정 시 자동으로 localStorage 폴백 =====
   VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY 를 .env / 호스트 환경변수에 넣으면 활성화됨 */
const SB_URL = (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_SUPABASE_URL) || "";
const SB_KEY = (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_SUPABASE_ANON_KEY) || "";
const SB_ON = !!(SB_URL && SB_KEY);
const sbHeaders = () => ({ apikey: SB_KEY, Authorization: "Bearer " + SB_KEY, "Content-Type": "application/json" });
async function sbRpc(fn, args) { const r = await fetch(SB_URL + "/rest/v1/rpc/" + fn, { method: "POST", headers: sbHeaders(), body: JSON.stringify(args || {}) }); if (!r.ok) throw new Error("rpc " + r.status); return await r.json(); }
async function sbSelect(path) { const r = await fetch(SB_URL + "/rest/v1/" + path, { headers: sbHeaders() }); if (!r.ok) throw new Error("sel " + r.status); return await r.json(); }
async function sbUpsert(table, row) { const r = await fetch(SB_URL + "/rest/v1/" + table, { method: "POST", headers: { ...sbHeaders(), Prefer: "resolution=merge-duplicates" }, body: JSON.stringify(row) }); if (!r.ok) throw new Error("up " + r.status); }

/* 실제 ECO 트리 스냅샷. 라이브(Lichess/엔진) 가능 시 덮어씀. */
const SNAP = __SNAPSHOT__;

/* 편집 오버레이 — 주요분기·마스코트·집중학습 상세 */
const OVERLAY = {
  "": { mascot: "백의 첫 수예요. e4는 개방적·공격적, d4는 전략적·폐쇄적 경향이 있어요." },
  "e4 e5 Nf3 Nc6 Bc4": {
    majorBranch: true,
    branchNote: "이탈리안 게임의 성격이 갈리는 주요 분기. 흑의 …Bc5(지우코 피아노, 조용한 전략전)와 …Nf6(투 나이츠, 날카로운 전술전)로 나뉘며 채택률이 비슷하다.",
  },
  "e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5": {
    branchNote: "4.Ng5는 f7을 직접 위협한다. 평가를 유지하는 사실상 유일한 정수는 4...d5뿐.",
    mascotByMove: { "Bc5": "트랙슬러 카운터어택! f7을 내주고 백의 f2를 맞받아치는 함정 수예요." },
  },
};

/* ============================================================ 기보(SAN) 엔진 ============================================================ */
function startBoard() {
  const b = Array.from({ length: 8 }, () => Array(8).fill(null));
  const back = ["R", "N", "B", "Q", "K", "B", "N", "R"];
  for (let c = 0; c < 8; c++) { b[0][c] = { c: "b", t: back[c] }; b[1][c] = { c: "b", t: "P" }; b[6][c] = { c: "w", t: "P" }; b[7][c] = { c: "w", t: back[c] }; }
  return b;
}
function clearPath(b, r, c, dr, dc) {
  const sr = Math.sign(dr - r), sc = Math.sign(dc - c); let rr = r + sr, cc = c + sc;
  while (rr !== dr || cc !== dc) { if (b[rr][cc]) return false; rr += sr; cc += sc; } return true;
}
function canMove(b, piece, color, r, c, dr, dc, isCap) {
  const ddr = dr - r, ddc = dc - c;
  if (piece === "N") { const a = Math.abs(ddr), bb = Math.abs(ddc); return (a === 1 && bb === 2) || (a === 2 && bb === 1); }
  if (piece === "B") return Math.abs(ddr) === Math.abs(ddc) && clearPath(b, r, c, dr, dc);
  if (piece === "R") return (ddr === 0 || ddc === 0) && clearPath(b, r, c, dr, dc);
  if (piece === "Q") return (ddr === 0 || ddc === 0 || Math.abs(ddr) === Math.abs(ddc)) && clearPath(b, r, c, dr, dc);
  if (piece === "K") return Math.abs(ddr) <= 1 && Math.abs(ddc) <= 1;
  if (piece === "P") {
    const dir = color === "w" ? -1 : 1, start = color === "w" ? 6 : 1;
    if (isCap) return ddr === dir && Math.abs(ddc) === 1;
    if (ddc !== 0) return false;
    if (ddr === dir) return !b[dr][dc];
    if (ddr === 2 * dir && r === start) return !b[r + dir][c] && !b[dr][dc];
    return false;
  }
  return false;
}
function sanSrc(board, sanRaw, color) {
  let san = sanRaw.replace(/[+#!?]/g, "");
  const rank = color === "w" ? 7 : 0;
  if (san === "O-O") return { castle: "k", from: [rank, 4], to: [rank, 6] };
  if (san === "O-O-O") return { castle: "q", from: [rank, 4], to: [rank, 2] };
  let promo = null; const pm = san.match(/=([QRBN])$/); if (pm) { promo = pm[1]; san = san.replace(/=[QRBN]$/, ""); }
  let piece = "P", s = san; if ("KQRBN".includes(s[0])) { piece = s[0]; s = s.slice(1); }
  const isCap = s.includes("x"); s = s.replace("x", "");
  const dest = s.slice(-2); s = s.slice(0, -2);
  const dc = FILES.indexOf(dest[0]), dr = 8 - parseInt(dest[1], 10);
  let fHint = null, rHint = null;
  for (const ch of s) { if (FILES.includes(ch)) fHint = FILES.indexOf(ch); else if ("12345678".includes(ch)) rHint = 8 - parseInt(ch, 10); }
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const p = board[r][c];
    if (!p || p.c !== color || p.t !== piece) continue;
    if (fHint !== null && c !== fHint) continue;
    if (rHint !== null && r !== rHint) continue;
    if (canMove(board, piece, color, r, c, dr, dc, isCap)) return { from: [r, c], to: [dr, dc], piece, promo, isCap };
  }
  return null;
}
function applySan(board, sanRaw, color) {
  const info = sanSrc(board, sanRaw, color); const b = board.map((row) => row.slice()); if (!info) return b;
  if (info.castle) {
    const rank = color === "w" ? 7 : 0;
    if (info.castle === "k") { b[rank][6] = b[rank][4]; b[rank][4] = null; b[rank][5] = b[rank][7]; b[rank][7] = null; }
    else { b[rank][2] = b[rank][4]; b[rank][4] = null; b[rank][3] = b[rank][0]; b[rank][0] = null; }
    return b;
  }
  const [sr, sc] = info.from, [dr, dc] = info.to; const moving = b[sr][sc];
  if (info.piece === "P" && info.isCap && !b[dr][dc]) b[color === "w" ? dr + 1 : dr - 1][dc] = null;
  b[dr][dc] = info.promo ? { c: color, t: info.promo } : moving; b[sr][sc] = null; return b;
}
function boardFromSans(sans) { let b = startBoard(); sans.forEach((s, i) => { b = applySan(b, s, i % 2 === 0 ? "w" : "b"); }); return b; }
/* 직전 더블 푸시로 생기는 앙파상 타깃 칸 (없으면 null) */
function epTarget(sans) {
  if (!sans || !sans.length) return null;
  const last = sans[sans.length - 1].replace(/[+#!?]/g, "");
  if (!/^[a-h][1-8]$/.test(last)) return null;       // 기물 문자/캡처 없는 폰 전진만
  const file = FILES.indexOf(last[0]), row = 8 - parseInt(last[1], 10);
  const moverWhite = (sans.length - 1) % 2 === 0;
  if (moverWhite && row === 4) return [5, file];
  if (!moverWhite && row === 3) return [2, file];
  return null;
}
function sansToUci(sans) {
  let b = startBoard(); const out = [];
  sans.forEach((s, i) => {
    const color = i % 2 === 0 ? "w" : "b"; const info = sanSrc(b, s, color);
    if (info) {
      if (info.castle) { const rank = color === "w" ? 7 : 0; out.push(FILES[4] + (8 - rank) + FILES[info.castle === "k" ? 6 : 2] + (8 - rank)); }
      else { const [fr, fc] = info.from, [tr, tc] = info.to; out.push(FILES[fc] + (8 - fr) + FILES[tc] + (8 - tr) + (info.promo ? info.promo.toLowerCase() : "")); }
    }
    b = applySan(b, s, color);
  });
  return out;
}
function sansToFen(sans) {
  const b = boardFromSans(sans); const rows = [];
  for (let r = 0; r < 8; r++) {
    let row = "", empty = 0;
    for (let c = 0; c < 8; c++) { const p = b[r][c]; if (!p) empty++; else { if (empty) { row += empty; empty = 0; } const ch = p.t; row += p.c === "w" ? ch : ch.toLowerCase(); } }
    if (empty) row += empty; rows.push(row);
  }
  return rows.join("/") + " " + (sans.length % 2 === 0 ? "w" : "b") + " KQkq - 0 " + (Math.floor(sans.length / 2) + 1);
}
function snapNode(sans) { return SNAP.tree[sans.join(" ")] || null; }
function overlayAt(sans) { return OVERLAY[sans.join(" ")] || null; }

/* ============================================================ 라이브 Stockfish (Web Worker) ============================================================ */
function useEngine() {
  const ref = useRef(null);
  const [status, setStatus] = useState("loading");
  const queue = useRef([]);
  const running = useRef(false);
  const offRef = useRef(false);
  const pump = useCallback(() => {
    if (running.current) return;
    const job = queue.current[0]; if (!job) return;
    if (!ref.current) { if (offRef.current) { queue.current.shift(); job.resolve(job.multi ? [] : null); pump(); } return; }
    running.current = true;
    job.cmds.forEach((c) => ref.current.postMessage(c));
  }, []);
  useEffect(() => {
    let worker = null, killed = false, idx = 0;
    function handleLine(line) {
      const cb = queue.current[0]; if (!cb) return;
      const sc = line.match(/score (cp|mate) (-?\d+)/);
      if (line.startsWith("info") && cb.multi) {
        const mp = line.match(/multipv (\d+)/); const pv = line.match(/ pv ([a-h][1-8][a-h][1-8][qrbn]?)/);
        if (mp && pv && sc) cb.lines[parseInt(mp[1], 10)] = { uci: pv[1], cp: sc[1] === "cp" ? parseInt(sc[2], 10) : null, mate: sc[1] === "mate" ? parseInt(sc[2], 10) : null };
      } else if (sc && !cb.multi) cb.last = sc[1] === "mate" ? { mate: parseInt(sc[2], 10) } : { cp: parseInt(sc[2], 10) };
      if (line.startsWith("bestmove")) {
        const bm = (line.split(" ")[1] || "").trim(); const d = queue.current.shift(); running.current = false;
        if (d) { if (d.multi) d.resolve(Object.keys(d.lines).sort((a, b) => a - b).map((k) => d.lines[k])); else d.resolve(d.last ? { ...d.last, best: bm } : (bm ? { best: bm } : null)); }
        pump();
      }
    }
    function tryNext() {
      if (idx >= ENGINE_URLS.length) { offRef.current = true; setStatus("off"); pump(); return; }
      const url = ENGINE_URLS[idx++];
      try {
        let w;
        if (url.startsWith("/")) w = new Worker(url);
        else { const blob = new Blob(["importScripts('" + url + "');"], { type: "text/javascript" }); w = new Worker(URL.createObjectURL(blob)); }
        let booted = false;
        w.onmessage = (e) => { const line = typeof e.data === "string" ? e.data : ""; if (!booted && (line.includes("uciok") || line.includes("Stockfish"))) { booted = true; ref.current = w; setStatus("ready"); pump(); } handleLine(line); };
        w.onerror = () => { try { w.terminate(); } catch (_) {} if (!booted && !killed) tryNext(); };
        w.postMessage("uci"); w.postMessage("isready"); worker = w;
        setTimeout(() => { if (!booted && !killed) { try { w.terminate(); } catch (_) {} tryNext(); } }, 4000);
      } catch (_) { tryNext(); }
    }
    tryNext();
    return () => { killed = true; try { worker && worker.terminate(); } catch (_) {} };
  }, [pump]);
  const evaluate = useCallback((fen, depth = 14) => new Promise((resolve) => {
    queue.current.push({ resolve, last: null, cmds: ["setoption name MultiPV value 1", "position fen " + fen, "go depth " + depth] }); pump();
  }), [pump]);
  const evaluateMulti = useCallback((fen, depth = 12, multipv = 5) => new Promise((resolve) => {
    queue.current.push({ resolve, multi: true, lines: {}, cmds: ["setoption name MultiPV value " + multipv, "position fen " + fen, "go depth " + depth] }); pump();
  }), [pump]);
  return { status, evaluate, evaluateMulti };
}
/* UCI -> SAN (보드 기준) */
function uciToSan(board, uci, color) {
  if (!uci || uci.length < 4) return null;
  const fc = FILES.indexOf(uci[0]), fr = 8 - parseInt(uci[1], 10), tc = FILES.indexOf(uci[2]), tr = 8 - parseInt(uci[3], 10);
  if (fc < 0 || tc < 0 || !board[fr] || !board[fr][fc]) return null;
  return buildSan(board, fr, fc, tr, tc, color);
}
/* 실수/블런더 이후 N수 응징 라인 생성 (엔진 best 연쇄) */
async function genPunishLine(engine, sans, plies = 3) {
  let cur = sans.slice(); const out = [];
  for (let i = 0; i < plies; i++) {
    const ev = await engine.evaluate(sansToFen(cur), 14);
    if (!ev || !ev.best) break;
    const san = uciToSan(boardFromSans(cur), ev.best, cur.length % 2 === 0 ? "w" : "b");
    if (!san) break;
    out.push(san); cur = [...cur, san];
  }
  return out;
}
/* 풀이 라인을 '해결자(시작 시 둘 차례)가 확실한 우위를 점할 때까지' 연장.
   각 사용자 수 뒤 결과 포지션을 평가(상대 최선 응수 반영)해 사용자 관점 평가가 target(cp) 이상이면 종료.
   희생 콤비처럼 일시적으로 불리해도 보상이 실현되는 지점까지 이어진다. 항상 사용자 수로 끝맺음. */
async function genAdvantageLine(engine, startSans, opts) {
  const { maxPlies = 8, target = 160 } = opts || {};
  const userWhite = startSans.length % 2 === 0;   // 시작 시 둘 차례 = 해결자
  let cur = startSans.slice(); const out = [];
  for (let i = 0; i < maxPlies; i++) {
    const ev = await engine.evaluate(sansToFen(cur), 8);
    if (!ev || !ev.best) break;
    const movingWhite = cur.length % 2 === 0;
    const san = uciToSan(boardFromSans(cur), ev.best, movingWhite ? "w" : "b");
    if (!san) break;
    out.push(san); cur = [...cur, san];
    if (movingWhite === userWhite) {              // 방금 둔 것이 사용자 수 → 우위 판정
      const ev2 = await engine.evaluate(sansToFen(cur), 8);
      let userCp;
      if (!ev2) userCp = 0;
      else if (ev2.mate != null) { if (ev2.mate < 0) break; userCp = -100000; }   // 상대가 메이트당함 = 사용자 승
      else userCp = -(ev2.cp || 0);               // ev2는 상대 관점 → 부호 반전
      if (userCp >= target) break;
    }
  }
  if (out.length) { const lastMoverWhite = (startSans.length + out.length - 1) % 2 === 0; if (lastMoverWhite !== userWhite) out.pop(); }   // 사용자 수로 끝맺음
  return out;
}

/* ============================================================ 라이브 Lichess Explorer ============================================================ */
const _lichessCache = new Map(); // url -> { t, data }
const _sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function fetchLichess(sans, master) {
  const uci = sansToUci(sans).join(",");
  const url = master
    ? "https://explorer.lichess.ovh/masters?play=" + uci + "&moves=14&topGames=0"
    : LICHESS_API + "?play=" + uci + "&moves=14&topGames=0&recentGames=0&speeds=blitz,rapid,classical&ratings=1600,1800,2000,2200,2500";
  const hit = _lichessCache.get(url);
  if (hit && Date.now() - hit.t < 10 * 60 * 1000) return hit.data; // 10분 캐시(되돌리기·재방문 시 재요청·레이트리밋 방지)
  let res = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch(url);
    if (res.status === 429) { // 레이트리밋: 백오프 후 재시도
      const ra = parseFloat(res.headers.get("Retry-After"));
      await _sleep(Number.isFinite(ra) ? ra * 1000 : 1200 * (attempt + 1));
      continue;
    }
    break;
  }
  if (!res || !res.ok) throw new Error("lichess " + (res ? res.status : "no-response"));
  const j = await res.json();
  const posTotal = (j.white || 0) + (j.draws || 0) + (j.black || 0);
  const moves = (j.moves || []).map((m) => {
    const tot = (m.white || 0) + (m.draws || 0) + (m.black || 0);
    return { san: m.san, games: tot, adopt: posTotal ? +(100 * tot / posTotal).toFixed(1) : 0, eco: m.opening ? m.opening.eco : null, name: m.opening ? m.opening.name : null, wdl: { w: m.white || 0, d: m.draws || 0, b: m.black || 0 } };
  });
  const data = { posTotal, opening: j.opening || null, moves, wdl: { w: j.white || 0, d: j.draws || 0, b: j.black || 0 }, master: !!master };
  _lichessCache.set(url, { t: Date.now(), data });
  return data;
}
async function fetchWiki(name) {
  if (!name) return null;
  const tries = [name, name.split(":").pop().trim(), name.split(",")[0].trim()];
  for (const t of tries) {
    try {
      const res = await fetch(WIKI_API + encodeURIComponent(t.replace(/ /g, "_")));
      if (!res.ok) continue;
      const j = await res.json();
      if (j.extract && j.type !== "disambiguation") return { title: j.title, extract: j.extract, url: j.content_urls && j.content_urls.desktop ? j.content_urls.desktop.page : null };
    } catch (_) {}
  }
  return null;
}


/* ============================================================ 기물 가치 · 희생 · 합법수 · SAN 생성 ============================================================ */
const VAL = { P: 1, N: 3, B: 3, R: 5, Q: 9, K: 100 };
function enemyMinAttacker(board, r, c, byColor) {
  let min = null;
  for (let pr = 0; pr < 8; pr++) for (let pc = 0; pc < 8; pc++) {
    const p = board[pr][pc];
    if (!p || p.c !== byColor) continue;
    if (canMove(board, p.t, byColor, pr, pc, r, c, true)) { const v = VAL[p.t]; if (min == null || v < min) min = v; }
  }
  return min;
}
function ownDefenders(board, r, c, color) {
  let n = 0;
  for (let pr = 0; pr < 8; pr++) for (let pc = 0; pc < 8; pc++) {
    const p = board[pr][pc];
    if (!p || p.c !== color || (pr === r && pc === c)) continue;
    if (canMove(board, p.t, color, pr, pc, r, c, true)) n++;
  }
  return n;
}
/* ── 정적 교환 평가(SEE, Static Exchange Evaluation) ──
   한 칸에서 일어나는 연속 교환을 '최소 가치 공격자' 규칙으로 끝까지 풀어
   side(둘 차례)가 그 칸을 공격해서 얻는 순이득(≥0)을 반환한다.
   보드를 실제로 복제·이동하며 풀기 때문에 슬라이딩 기물의 x-ray(가려졌다 열리는 공격)가 자연히 반영된다. */
function lva(board, tr, tc, side) {
  let best = null;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const p = board[r][c]; if (!p || p.c !== side) continue;
    let can;
    if (p.t === "P") { const dir = side === "w" ? -1 : 1; can = (tr - r === dir && Math.abs(tc - c) === 1); }
    else if (p.t === "K") can = Math.abs(tr - r) <= 1 && Math.abs(tc - c) <= 1;
    else can = canMove(board, p.t, side, r, c, tr, tc, true);
    if (can && (best == null || VAL[p.t] < best.val)) best = { r, c, t: p.t, val: VAL[p.t] };
  }
  return best;
}
function seeSquare(board, tr, tc, side) {
  const occ = board[tr][tc]; if (!occ) return 0;        // 잡을 대상이 없으면 0
  const att = lva(board, tr, tc, side); if (!att) return 0;
  const b = board.map((row) => row.slice());
  b[tr][tc] = { c: side, t: att.t }; b[att.r][att.c] = null;   // 최소 가치 공격자로 잡음
  const gain = VAL[occ.t] - seeSquare(b, tr, tc, side === "w" ? "b" : "w");
  return Math.max(0, gain);                              // 손해면 잡지 않음(=0)
}
/* 진짜 '희생'인가: 폰 제외, 이 수로 인해 정적 교환상 실질 손실(≥2점)이 발생하는 경우만.
   (예: ...Bb4+ 차단용 Nbd2/Nc3/Bd2 는 동가치 교환이라 SEE 손실 0 → 희생 아님) */
function isSacrifice(board, sanRaw, color) {
  const info = sanSrc(board, sanRaw, color);
  if (!info || info.castle) return false;
  if (info.piece === "P") return false;                 // 폰 희생은 탁월한 수로 보지 않음
  const [tr, tc] = info.to;
  const capturedVal = info.isCap ? (board[tr][tc] ? VAL[board[tr][tc].t] : 1) : 0;
  const after = applySan(board, sanRaw, color);
  const enemy = color === "w" ? "b" : "w";
  const oppGain = seeSquare(after, tr, tc, enemy);       // 상대가 이 칸에서 얻는 순이득
  const net = capturedVal - oppGain;                     // 내 관점 순손익
  return net <= -2;                                      // 최소 경(輕)기물 가치 이상을 내준 경우만
}
function kingPos(board, color) { for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) { const p = board[r][c]; if (p && p.c === color && p.t === "K") return [r, c]; } return null; }
function isAttacked(board, tr, tc, byColor) {
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const p = board[r][c]; if (!p || p.c !== byColor) continue;
    if (p.t === "P") { const dir = byColor === "w" ? -1 : 1; if (tr - r === dir && Math.abs(tc - c) === 1) return true; continue; }
    if (p.t === "K") { if (Math.abs(tr - r) <= 1 && Math.abs(tc - c) <= 1) return true; continue; }
    if (canMove(board, p.t, byColor, r, c, tr, tc, true)) return true;
  }
  return false;
}
function exposesKing(board, fr, fc, tr, tc, color, ep) {
  const b = board.map((r) => r.slice()); const p = b[fr][fc];
  if (p.t === "P" && fc !== tc && !b[tr][tc] && ep && tr === ep[0] && tc === ep[1]) b[color === "w" ? tr + 1 : tr - 1][tc] = null;
  b[tr][tc] = p; b[fr][fc] = null;
  const kp = kingPos(b, color); if (!kp) return false;
  return isAttacked(b, kp[0], kp[1], color === "w" ? "b" : "w");
}
function legalDests(board, fr, fc, color, ep) {
  const p = board[fr][fc]; if (!p || p.c !== color) return [];
  const opp = color === "w" ? "b" : "w";
  let out = [];
  for (let tr = 0; tr < 8; tr++) for (let tc = 0; tc < 8; tc++) {
    const tgt = board[tr][tc];
    if (tgt && tgt.c === color) continue;
    const isCap = !!tgt && tgt.c !== color;
    if (canMove(board, p.t, color, fr, fc, tr, tc, isCap)) out.push([tr, tc]);
    else if (p.t === "P" && !tgt && fc !== tc && ep && tr === ep[0] && tc === ep[1] && canMove(board, "P", color, fr, fc, tr, tc, true)) out.push([tr, tc]);
  }
  // 자기 킹을 체크에 노출시키는 수 제거
  out = out.filter(([tr, tc]) => !exposesKing(board, fr, fc, tr, tc, color, ep));
  // 캐슬링: 킹/룩 원위치 + 경로 비어있음 + 체크 통과/진입 금지
  if (p.t === "K" && fc === 4 && (fr === 7 || fr === 0) && !isAttacked(board, fr, 4, opp)) {
    if (board[fr][5] == null && board[fr][6] == null && board[fr][7] && board[fr][7].t === "R" && board[fr][7].c === color && !isAttacked(board, fr, 5, opp) && !isAttacked(board, fr, 6, opp)) out.push([fr, 6]);
    if (board[fr][3] == null && board[fr][2] == null && board[fr][1] == null && board[fr][0] && board[fr][0].t === "R" && board[fr][0].c === color && !isAttacked(board, fr, 3, opp) && !isAttacked(board, fr, 2, opp)) out.push([fr, 2]);
  }
  return out;
}
function buildSanBare(board, fr, fc, tr, tc, color, ep) {
  const p = board[fr][fc]; if (!p) return null;
  if (p.t === "K" && Math.abs(tc - fc) === 2) return tc > fc ? "O-O" : "O-O-O";
  const tgt = board[tr][tc];
  const isCap = (!!tgt && tgt.c !== color) || (p.t === "P" && fc !== tc && !tgt && !!ep && tr === ep[0] && tc === ep[1]);
  const dest = FILES[tc] + (8 - tr);
  if (p.t === "P") {
    let san = (isCap ? FILES[fc] + "x" : "") + dest;
    if ((color === "w" && tr === 0) || (color === "b" && tr === 7)) san += "=Q";
    return san;
  }
  let disamb = "";
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    if ((r === fr && c === fc)) continue;
    const o = board[r][c];
    if (o && o.c === color && o.t === p.t && canMove(board, p.t, color, r, c, tr, tc, isCap)) {
      disamb = (c !== fc) ? FILES[fc] : (8 - fr) + "";
    }
  }
  return p.t + disamb + (isCap ? "x" : "") + dest;
}
/* 상대에게 어떤 합법수라도 남아있는가 (체크메이트 판정용) */
function hasAnyLegalMove(board, color) {
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const p = board[r][c]; if (!p || p.c !== color) continue;
    if (legalDests(board, r, c, color, null).length) return true;
  }
  return false;
}
/* 수가 만드는 체크(+)·체크메이트(#) 기호 */
function checkSuffix(boardBefore, sanBare, color) {
  const after = applySan(boardBefore, sanBare, color);
  const enemy = color === "w" ? "b" : "w";
  const kp = kingPos(after, enemy); if (!kp) return "";
  if (!isAttacked(after, kp[0], kp[1], color)) return "";
  return hasAnyLegalMove(after, enemy) ? "+" : "#";
}
const stripSuffix = (s) => (s || "").replace(/[+#]/g, "");
/* 임의의 SAN 에 현재 보드 기준 체크/체크메이트 기호를 부여(표기·매칭 일관성) */
function decorateSan(boardBefore, sanRaw, color) {
  const bare = stripSuffix(sanRaw);
  const info = sanSrc(boardBefore, sanRaw, color);
  if (!info) return bare;
  return bare + checkSuffix(boardBefore, bare, color);
}
function buildSan(board, fr, fc, tr, tc, color, ep) {
  const bare = buildSanBare(board, fr, fc, tr, tc, color, ep);
  if (!bare) return null;
  return bare + checkSuffix(board, bare, color);
}


/* ============================================================ 내부 해설 데이터 (한글) ============================================================ */
const EXPLAIN = {
  "": "백의 첫 수. e4·d4가 압도적이지만, 그 외 전개도 이론적으로 존재한다. b4(폴란드)·f4(버드)처럼 평가가 다소 떨어지는 수는 부정확으로 분류된다.",
  "e4": "킹 폰 오프닝. 중앙을 즉시 점유하고 비숍·퀸의 길을 열어 빠른 전개와 공격을 노린다.",
  "d4": "퀸 폰 오프닝. e4보다 폐쇄적·전략적이며 안정적인 중앙 장악을 추구한다.",
  "e4 e5 Nf3 Nc6 Bc4": "이탈리안 게임. 비숍을 c4로 보내 f7 약점을 겨눈다. 흑의 …Bc5(지우코 피아노)와 …Nf6(투 나이츠)로 성격이 갈린다.",
  "e4 e5 Nf3 Nc6 Bb5": "루이 로페즈(스패니시). 흑의 c6 나이트를 압박해 e5 폰의 수비를 흔드는, 가장 깊이 연구된 오프닝 중 하나.",
  "e4 c5": "시칠리안 디펜스. 흑이 비대칭 구조로 반격을 노리는, 최상위에서 가장 인기 있는 e4 대응.",
  "d4 Nf6 c4 e6": "님조/퀸즈 인디언 계열로 가는 관문. 흑이 유연하게 중앙을 통제한다.",
};
const BRANCH = {
  "": "백의 첫 수 — 게임 전체 성격(개방/폐쇄·전술/전략)을 결정하는 최상위 분기.",
  "e4": "흑의 1...e5(오픈게임)·c5(시칠리안)·e6(프렌치)·c6(카로칸) 선택지가 갈리는, e4 진영의 방어 체계 분기.",
  "e4 e5 Nf3": "흑의 e5 방어: 2...Nc6(정통)·Nf6(페트로프)·d6(필리도르)로 나뉜다.",
  "e4 e5 Nf3 Nc6": "백의 공격 플랜 분기 — 3.Bb5(루이 로페즈, 구조적 압박) vs 3.Bc4(이탈리안, 빠른 f7 겨냥).",
  "e4 e5 Nf3 Nc6 Bc4": "이탈리안의 성격 분기 — 3...Bc5(지우코 피아노, 전략전) vs 3...Nf6(투 나이츠, 전술전).",
  "e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5": "프라이드 리버 분기 — f7 위협에 4...d5만이 사실상 유일한 정수.",
  "e4 e5 Nf3 Nc6 Bb5": "루이 로페즈 핵심 분기 — 3...a6(모펀 메인) vs 3...Nf6(베를린 디펜스).",
  "e4 c5": "안티-시칠리안 분기 — 2.Nf3(오픈 시칠리안) vs 2.Nc3/c3/Bc4(폐쇄·알라핀 등).",
  "e4 c5 Nf3": "오픈 시칠리안 대분기 — 2...d6(나이도르프/드래곤)·Nc6(스벤니/클래식)·e6(타이마노프/카안) 계열.",
  "e4 e6 d4 d5": "프렌치 구조 분기 — 3.Nc3·Nd2(타라쉬)·e5(어드밴스)·exd5(익스체인지)로 폰 구조가 갈린다.",
  "e4 c6 d4 d5": "카로칸 구조 분기 — 3.Nc3/Nd2(클래시컬)·e5(어드밴스)·exd5(익스체인지)·f3(핀란드).",
  "d4": "흑의 응수 분기 — 1...d5(정통 폐쇄) vs 1...Nf6(인디언, 초현대적 중앙 양보).",
  "d4 d5 c4": "퀸스 갬빗 핵심 분기 — 2...e6(QGD)·c6(슬라브)·dxc4(QGA).",
  "d4 Nf6 c4": "인디언 디펜스 대분기 — 2...e6(님조/QID)·g6(KID/그륀펠트)·c5(베노니).",
  "d4 Nf6 c4 e6 Nc3": "3...Bb4(님조-인디언, 핀) vs 3...d5(QGD 전환)의 분기.",
  "d4 Nf6 c4 g6 Nc3": "3...d5(그륀펠트, 중앙 반격) vs 3...Bg7→d6(킹스 인디언, 폐쇄 공격) 분기.",
};
function explainFor(sans) {
  const k = sans.join(" ");
  if (CONTENT.explains[k]) return CONTENT.explains[k];
  if (EXPLAIN[k]) return EXPLAIN[k];
  const n = snapNode(sans);
  if (n && n.opening) return n.opening.name + " 라인. 정석 이론에 따라 전개되는 포지션입니다.";
  return null;
}
function explainMove(sans, san) {
  const mk = sans.join(" ") + "|" + san;
  if (CONTENT.explains[mk]) return CONTENT.explains[mk];
  return explainFor([...sans, san]) || explainFor(sans);
}

/* ============================================================ 퍼즐: 실수 응징 시퀀스 ============================================================ */
/* key = "<경로 SAN 공백연결>|<실수 SAN>" ; line = 실수 이후 수순(첫 수가 응징하는 쪽) */
const PUNISH = {
  "e4 e5 Nf3|f6": {
    opening: "Damiano Defense", mistake: "f6",
    why: "2...f6는 f7-킹 대각선을 약화시키고 나이트의 출구를 막는 대표적 악수입니다. 백은 즉시 e5 폰을 희생해 응징할 수 있습니다.",
    line: ["Nxe5", "fxe5", "Qh5+"],
    steps: ["3.Nxe5! — 나이트를 내주고 폰을 잡으며 f7-h5 대각선을 노린다.", "3...fxe5 — 받으면(거의 강제) e8-h5 대각선이 완전히 열린다.", "4.Qh5+ — 더블 어택. 4...Ke7 5.Qxe5+ 로 룩까지 따내며 백 대승."],
  },
  "e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 d5 exd5|Nxd5": {
    opening: "Fried Liver Attack", mistake: "Nxd5",
    why: "5...Nxd5?는 욕심내어 폰을 되찾지만 f7이 무방비가 됩니다. 백은 나이트를 희생하는 프라이드 리버로 응징합니다.",
    line: ["Nxf7", "Kxf7", "Qf3+"],
    steps: ["6.Nxf7! — 나이트를 희생하며 킹을 끌어낸다.", "6...Kxf7 — 받으면 킹이 노출된다.", "7.Qf3+ — 킹과 d5 나이트를 동시에 노린다. 백이 강력한 주도권."],
  },
};
function punishFor(sans, san) { return PUNISH[sans.join(" ") + "|" + san] || null; }

/* ============================================================ 개발자 콘텐츠 오버레이 (공용 서버 저장) ============================================================ */
const DEV_ACCOUNT = "jewonk2";
const SYM2KIND = [["??", "blunder"], ["?!", "inaccuracy"], ["!!", "brilliant"], ["☆", "best"], ["★", "best"], ["👍", "excellent"], ["✅️", "good"], ["✅", "good"], ["?", "mistake"], ["!", "only"]];
function splitSym(tok) { for (const [sym, kind] of SYM2KIND) { if (tok.endsWith(sym)) return { san: tok.slice(0, -sym.length), kind }; } return { san: tok, kind: null }; }
let CONTENT = { treeAdds: {}, forceKind: {}, branches: {}, explains: {}, keywords: {}, names: {}, unbook: {}, mainline: {}, codev: [] };
let CONTENT_SEEDED = false;
function seedContent() {
  if (CONTENT_SEEDED) return; CONTENT_SEEDED = true;
  const addMove = (posKey, san, kind) => {
    if (!CONTENT.treeAdds[posKey]) CONTENT.treeAdds[posKey] = [];
    if (!CONTENT.treeAdds[posKey].some((x) => x.san === san)) CONTENT.treeAdds[posKey].push({ san });
    const fk = posKey + "|" + san; if (kind && !(fk in CONTENT.forceKind)) CONTENT.forceKind[fk] = kind;
  };
  // 다미아노 디펜스: 1.e4 e5 2.Nf3 f6 3.Nxe5 fxe5 4.Qh5+  (2.Nc3는 3.Nxe5가 불가능하므로 정수인 Nf3로 수록)
  addMove("e4 e5 Nf3", "f6", "mistake");
  addMove("e4 e5 Nf3 f6", "Nxe5", "brilliant");
  addMove("e4 e5 Nf3 f6 Nxe5", "fxe5", "inaccuracy");
  addMove("e4 e5 Nf3 f6 Nxe5 fxe5", "Qh5+", "best");
  if (!("e4 e5 Nf3 f6 Nxe5 fxe5|Qh5+" in CONTENT.mainline)) CONTENT.mainline["e4 e5 Nf3 f6 Nxe5 fxe5|Qh5+"] = true;
  if (!("e4 e5 Nf3 f6 Nxe5|fxe5" in CONTENT.mainline)) CONTENT.mainline["e4 e5 Nf3 f6 Nxe5|fxe5"] = true;
  if (!("e4 e5 Nf3 f6|Nxe5" in CONTENT.mainline)) CONTENT.mainline["e4 e5 Nf3 f6|Nxe5"] = true;
  if (!("e4 e5 Nf3 f6 Nxe5 fxe5|Qh5+" in CONTENT.explains)) CONTENT.explains["e4 e5 Nf3 f6 Nxe5 fxe5|Qh5+"] = "다미아노 디펜스 응징의 핵심. 4.Qh5+ 더블 어택으로 e5 폰을 회수하고 흑 킹을 노출시켜 백이 대승.";
  // 폴란드 오프닝(1.b4)·폰지아니(1.e4 e5 2.Nf3 Nc6 3.c3) 이론 수 지정
  if (!("|b4" in CONTENT.forceKind)) CONTENT.forceKind["|b4"] = "book";
  addMove("e4 e5 Nf3 Nc6", "c3", "book");
  if (!("e4 e5 Nf3 Nc6|c3" in CONTENT.explains)) CONTENT.explains["e4 e5 Nf3 Nc6|c3"] = "폰지아니 오프닝. d4를 준비하며 중앙을 노리는 고전 정석.";
  // 카로칸: 백의 3번째 수를 분기점으로, 3.Nc3를 메인 라인으로
  if (!("e4 c6 d4 d5" in CONTENT.branches)) CONTENT.branches["e4 c6 d4 d5"] = "카로칸 구조 분기 — 3.Nc3(메인 라인)·Nd2·e5(어드밴스)·exd5(익스체인지)로 갈린다.";
  CONTENT.mainline["e4 c6 d4 d5|Nc3"] = true;
  // 스칸디나비안 디펜스(1.e4 d5) — 스냅샷에서 누락되어 보강
  addMove("e4", "d5", "book");
  addMove("e4 d5", "exd5", "book");
  addMove("e4 d5 exd5", "Qxd5"); addMove("e4 d5 exd5", "Nf6");
  addMove("e4 d5 exd5 Qxd5", "Nc3", "book");
  addMove("e4 d5 exd5 Qxd5 Nc3", "Qa5"); addMove("e4 d5 exd5 Qxd5 Nc3", "Qd6"); addMove("e4 d5 exd5 Qxd5 Nc3", "Qd8");
  CONTENT.mainline["e4 d5|exd5"] = true; CONTENT.mainline["e4 d5 exd5|Qxd5"] = true; CONTENT.mainline["e4 d5 exd5 Qxd5|Nc3"] = true;
  if (!("e4 d5" in CONTENT.explains)) CONTENT.explains["e4 d5"] = "스칸디나비안 디펜스. 흑이 즉시 d5로 중앙을 교환해 빠른 전개를 노린다. 백은 2.exd5 후 퀸/나이트 회수 라인으로 분기.";
  if (!("e4 d5 exd5" in CONTENT.branches)) CONTENT.branches["e4 d5 exd5"] = "스칸디나비안 분기 — 2…Qxd5(고전, 즉시 회수) vs 2…Nf6(모던, 폰 회수 지연).";
}
seedContent();
async function loadContent() {
  const defaults = { treeAdds: {}, forceKind: {}, branches: {}, explains: {}, keywords: {}, names: {}, unbook: {}, mainline: {}, codev: [] };
  try {
    if (SB_ON) {
      try { const rows = await sbSelect("app_content?key=eq.global&select=value"); if (rows && rows.length && rows[0].value) { CONTENT = { ...defaults, ...rows[0].value }; CONTENT_SEEDED = false; seedContent(); try { window.localStorage.setItem("occ_content", JSON.stringify(rows[0].value)); } catch { } return; } } catch { }
    }
    let raw = null;
    if (typeof window !== "undefined" && window.storage) { const r = await window.storage.get("occ_content", true); raw = r && r.value; }
    if (!raw) { try { raw = window.localStorage.getItem("occ_content"); } catch { } }
    if (raw) { const d = JSON.parse(raw); CONTENT = { ...defaults, ...d }; CONTENT_SEEDED = false; seedContent(); }
  } catch { }
}
async function saveContent() {
  const v = CONTENT;
  if (SB_ON) { try { await sbUpsert("app_content", { key: "global", value: v }); } catch { } }
  try { window.localStorage.setItem("occ_content", JSON.stringify(v)); } catch { }
  if (!SB_ON) { try { if (typeof window !== "undefined" && window.storage) await window.storage.set("occ_content", JSON.stringify(v), true); } catch { } }
}
function branchFor(key) { return key in CONTENT.branches ? CONTENT.branches[key] : (BRANCH[key] || null); }
function isMainline(key, san) { return !!CONTENT.mainline[key + "|" + san]; }
function forceKindFor(key, san) { return CONTENT.forceKind[key + "|" + san] || null; }
function addsFor(key) { return CONTENT.treeAdds[key] || []; }
/* 개발자 오버라이드: 수 이름 / 키워드 / '이론 수에서 삭제' */
function nameOverride(key, san) { const v = CONTENT.names[key + "|" + stripSuffix(san)]; return v === undefined ? null : v; }
function kwOverride(key, san) { const v = CONTENT.keywords[key + "|" + stripSuffix(san)]; return Array.isArray(v) ? v : null; }
function isUnbooked(key, san) { return !!CONTENT.unbook[key + "|" + stripSuffix(san)]; }

/* ============================================================ chess.com 프로필 빅데이터 ============================================================ */
function parsePgnSans(pgn) {
  const body = pgn.replace(/\[[^\]]*\]/g, " ").replace(/\{[^}]*\}/g, " ").replace(/\$\d+/g, " ");
  const toks = body.split(/\s+/);
  const out = [];
  for (let t of toks) {
    if (!t) continue;
    if (/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t)) break;
    t = t.replace(/^\d+\.(\.\.)?/, "");
    if (!t) continue;
    if (/^[a-hKQRBNO][a-h1-8xKQRBNO\-+#=]*$/.test(t)) out.push(t.replace(/[+#]/g, ""));
  }
  return out;
}
async function fetchChesscomProfile(username) {
  const u = username.toLowerCase().trim();
  const pr = await fetch("https://api.chess.com/pub/player/" + u);
  if (!pr.ok) throw new Error("no-player");
  const p = await pr.json();
  let rapid = null, blitz = null, bullet = null, games = 0;
  try {
    const sr = await fetch("https://api.chess.com/pub/player/" + u + "/stats");
    if (sr.ok) {
      const s = await sr.json();
      const rec = (x) => x && x.record ? (x.record.win || 0) + (x.record.loss || 0) + (x.record.draw || 0) : 0;
      rapid = s.chess_rapid && s.chess_rapid.last ? s.chess_rapid.last.rating : null;
      blitz = s.chess_blitz && s.chess_blitz.last ? s.chess_blitz.last.rating : null;
      bullet = s.chess_bullet && s.chess_bullet.last ? s.chess_bullet.last.rating : null;
      games = rec(s.chess_rapid) + rec(s.chess_blitz) + rec(s.chess_bullet);
    }
  } catch (_) { }
  return { username: p.username || u, avatar: p.avatar || null, name: p.name || null, country: p.country ? p.country.split("/").pop() : null, rapid, blitz, bullet, games };
}
function countryFlag(code) { if (!code || code.length !== 2) return ""; return code.toUpperCase().replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0))); }
function useChessCom(username) {
  const [state, setState] = useState({ status: "idle", games: [] });
  useEffect(() => {
    if (!username) { setState({ status: "idle", games: [] }); return; }
    let cancelled = false;
    (async () => {
      setState({ status: "loading", games: [] });
      try {
        const u = username.toLowerCase().trim();
        const arc = await fetch("https://api.chess.com/pub/player/" + u + "/games/archives");
        if (!arc.ok) throw new Error("archives " + arc.status);
        const aj = await arc.json();
        const months = (aj.archives || []).slice(-12);
        const games = [];
        for (const url of months) {
          if (cancelled) return;
          try {
            const r = await fetch(url); if (!r.ok) continue;
            const j = await r.json();
            for (const g of (j.games || [])) {
              if (!g.pgn) continue;
              const userIsWhite = g.white && g.white.username && g.white.username.toLowerCase() === u;
              const side = userIsWhite ? g.white : g.black;
              const res = side && side.result;
              const result = res === "win" ? "win" : (["checkmated", "resigned", "timeout", "lose", "abandoned"].includes(res) ? "loss" : "draw");
              games.push({ moves: parsePgnSans(g.pgn), color: userIsWhite ? "w" : "b", result });
            }
          } catch (_) {}
        }
        if (!cancelled) setState({ status: "ready", games });
      } catch (e) { if (!cancelled) setState({ status: "error", games: [] }); }
    })();
    return () => { cancelled = true; };
  }, [username]);
  const analyze = useCallback((pathSans) => {
    const gs = state.games.filter((g) => g.moves.length >= pathSans.length && pathSans.every((s, i) => g.moves[i] === s));
    if (!gs.length) return null;
    let w = 0, d = 0, l = 0; const next = {}, nextRes = {};
    for (const g of gs) {
      if (g.result === "win") w++; else if (g.result === "loss") l++; else d++;
      const nx = g.moves[pathSans.length];
      if (nx) { next[nx] = (next[nx] || 0) + 1; if (!nextRes[nx]) nextRes[nx] = { w: 0, d: 0, l: 0 }; if (g.result === "win") nextRes[nx].w++; else if (g.result === "loss") nextRes[nx].l++; else nextRes[nx].d++; }
    }
    const top = Object.entries(next).map(([s, n]) => ({ san: s, n, w: nextRes[s].w, d: nextRes[s].d, l: nextRes[s].l, wr: Math.round(100 * nextRes[s].w / n) })).sort((a, b) => b.n - a.n).slice(0, 3);
    // 오프닝 실수 분석용: 이 수순 이후의 실제 진행 라인(최대 15수)을 빈도순으로
    const lines = {};
    for (const g of gs) { const seq = g.moves.slice(pathSans.length, 15); if (!seq.length) continue; const k = seq.join(" "); if (!lines[k]) lines[k] = { seq, count: 0, color: g.color }; lines[k].count++; }
    const topLines = Object.values(lines).sort((a, b) => b.count - a.count).slice(0, 5);
    return { total: gs.length, w, d, l, winRate: Math.round(100 * w / gs.length), top, lines: topLines };
  }, [state.games]);
  return { ...state, analyze };
}

/* ============================================================ 품질·키워드 ============================================================ */
function fmtEvalCp(cp, mate) {
  if (mate != null) return (mate > 0 ? "#" : "-#") + Math.abs(mate);
  if (cp == null) return null;
  const v = cp / 100; return (v >= 0 ? "+" : "") + v.toFixed(2);
}
function tierOf(loss) {
  if (loss <= 10) return "best";
  if (loss <= 35) return "excellent";
  if (loss <= 70) return "good";
  if (loss <= 100) return "inaccuracy";
  if (loss <= 200) return "mistake";
  return "blunder";
}
const QLABEL = { brilliant: "탁월한 수", best: "최선의 수", only: "유일한 수", excellent: "우수한 수", good: "좋은 수", inaccuracy: "부정확한 수", mistake: "실수", blunder: "블런더", book: "이론적인 수", pending: "분석 중" };
const QCOLOR = { brilliant: T.brilliant, best: T.best, only: T.only, excellent: T.excellent, good: T.good, inaccuracy: T.inaccuracy, mistake: T.mistake, blunder: T.blunder, book: T.book, pending: T.inkSoft };
const QSYM = { brilliant: "!!", best: "★", only: "!", excellent: "👍", good: "✓", inaccuracy: "?!", mistake: "?", blunder: "??", book: "▦" };
const KW = {
  "NORMAL": { bg: "#E3EDD9", fg: "#3F5B33", desc: "가장 일반적으로 두어지는 수" },
  "TOP LEVEL": { bg: "#F3E6C2", fg: "#7A5A14", desc: "마스터가 압도적으로 선택" },
  "TRICKY": { bg: "#E8D8C4", fg: "#7A4E22", desc: "함정을 노리는 까다로운 수" },
  "SIDESTEPPING": { bg: "#E0DAEC", fg: "#574A78", desc: "잘 알려지지 않은 사이드라인" },
  "INTUITIVE": { bg: "#DCE8EC", fg: "#3C5A63", desc: "의도가 직관적으로 보이는 수" },
  "STRAIGHT-LINE": { bg: "#E6E2D8", fg: "#5C564A", desc: "이후가 단순·강제적인 수" },
};
function deriveKeywords(m) {
  if (m.kw && m.kw.length) return m.kw;
  const ks = []; const a = m.adopt || 0; const ma = m.masterAdopt; const nm = m.name || "";
  // TOP LEVEL: 마스터 통계 기준 상위권(상위 3수) 또는 마스터 채택률 25% 이상일 때만
  if (m.masterTop || (ma != null && ma >= 25)) ks.push("TOP LEVEL");
  if (a >= 12 || (ma != null && ma >= 12)) { if (!ks.includes("NORMAL")) ks.push("NORMAL"); }
  else if (!ks.length) ks.push("SIDESTEPPING");
  if (/Gambit|Attack|Countergambit|Traxler|Wing|Sacrifice/.test(nm) && !ks.includes("TRICKY")) ks.push("TRICKY");
  if (/^[NB]/.test(m.san) && !m.san.includes("x") && !ks.includes("INTUITIVE")) ks.push("INTUITIVE");
  if (m.san.includes("x") && !ks.includes("STRAIGHT-LINE")) ks.push("STRAIGHT-LINE");
  if (!ks.length) ks.push("NORMAL");
  return ks.slice(0, 3);
}
function moveNumber(ply) { return Math.floor(ply / 2) + 1 + (ply % 2 === 0 ? "." : "..."); }
function fmtFull(n) { return n == null ? "—" : Number(n).toLocaleString("en-US"); }
function moverEval(m, ply) {
  const sgn = ply % 2 === 0 ? 1 : -1;
  if (m.live) return (m.live.mate != null ? (m.live.mate > 0 ? 1e5 : -1e5) : m.live.cp) * sgn;
  if (m.evalCp != null) return m.evalCp * sgn;
  if (m.mate != null) return (m.mate > 0 ? 1e5 : -1e5) * sgn;
  return null;
}
function whiteEval(m) { if (m.live) return m.live.mate != null ? null : m.live.cp; return m.evalCp != null ? m.evalCp : null; }
function hasRealEval(m) { return !!m.live || m.evalCp != null || m.mate != null; }
function assignTiers(moves, ply, board, keyStr) {
  const color = ply % 2 === 0 ? "w" : "b";
  const evals = moves.map((m) => moverEval(m, ply)).filter((v) => v != null);
  const best = evals.length ? Math.max(...evals) : null;
  let out = moves.map((m) => {
    const forced = keyStr != null ? forceKindFor(keyStr, m.san) : null;
    if (forced) return { ...m, kind: forced, book: forced === "book", forced: true };
    const mv = moverEval(m, ply);
    const loss = (mv == null || best == null) ? null : best - mv;
    const unbooked = keyStr != null && isUnbooked(keyStr, m.san);
    const isBook = !unbooked && !!m.eco && (loss == null || loss <= 60);
    if (isBook) return { ...m, kind: "book", book: true };
    if (mv == null || best == null) return { ...m, kind: hasRealEval(m) ? "good" : "pending", book: false };
    let kind = tierOf(loss);
    if (["best", "excellent", "good"].includes(kind) && board && isSacrifice(board, m.san, color) && mv >= -40) kind = "brilliant";
    return { ...m, kind, book: false };
  });
  // (기능4) 최선의 수는 반드시 1개 이하. 평가치가 가장 좋은 '비이론' 수 1개에만 '최선'을 부여하고
  // 나머지 'best' 는 '우수'로 강등. 평가치 최댓값이 이론 수이면 '최선'은 어떤 수에도 표기하지 않는다.
  let argmaxIdx = -1, argmaxVal = null;
  out.forEach((m, i) => { const v = moverEval(m, ply); if (v != null && (argmaxVal == null || v > argmaxVal)) { argmaxVal = v; argmaxIdx = i; } });
  if (argmaxIdx >= 0) {
    const topIsBook = out[argmaxIdx].book;
    const keepBest = (!topIsBook && out[argmaxIdx].kind === "best") ? argmaxIdx : -1;
    out = out.map((m, i) => (m.kind === "best" && i !== keepBest) ? { ...m, kind: "excellent" } : m);
  }
  // 유일한 수(#6): 이 위치에 이론 수가 없고, '나쁘지 않은' 수가 정확히 1개이며,
  // 나머지 분석된 수가 전부 부정확/실수/블런더일 때만. 유일+탁월이면 탁월로 표기.
  const anyBook = out.some((m) => m.kind === "book");
  const goodSet = ["brilliant", "best", "excellent", "good"];
  const goods = out.filter((m) => goodSet.includes(m.kind));
  const others = out.filter((m) => !goodSet.includes(m.kind));
  const allOthersBad = others.length > 0 && others.every((m) => ["inaccuracy", "mistake", "blunder"].includes(m.kind));
  if (!anyBook && goods.length === 1 && allOthersBad) {
    const i = out.indexOf(goods[0]);
    out[i] = { ...out[i], kind: out[i].kind === "brilliant" ? "brilliant" : "only" };
  }
  return out;
}
/* (UI7) 수 체계 아이콘 — '이론 수'=펼친 책, '우수한 수'=따봉. 업로드한 두 이미지(흑색 실루엣)를
   흰색으로 변환한 형태를 인라인 SVG로 충실히 재현(모든 크기에서 또렷·테마색 적용 가능).
   원본 PNG를 그대로 쓰려면 ICON_ART에 data URI를 넣으면 자동 교체됩니다. */
const ICON_ART = { book: "", excellent: "" };   // 예: book: "data:image/png;base64,...."
function IconBook({ size = 14 }) {
  if (ICON_ART.book) return <img src={ICON_ART.book} alt="" width={size} height={size} style={{ objectFit: "contain", filter: "brightness(0) invert(1)" }} />;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="#fff" aria-hidden>
      <path d="M2 6.4c0-.7.5-1.2 1.2-1.2 1.6 0 4.6.3 6.8 1.7.5.3.8.9.8 1.5v11.2c-2-1.3-4.8-1.6-6.4-1.6-.6 0-1.1-.3-1.4-.8-.4-.6-1-1-1-2z" />
      <path d="M22 6.4c0-.7-.5-1.2-1.2-1.2-1.6 0-4.6.3-6.8 1.7-.5.3-.8.9-.8 1.5v11.2c2-1.3 4.8-1.6 6.4-1.6.6 0 1.1-.3 1.4-.8.4-.6 1-1 1-2z" />
    </svg>
  );
}
function IconExcellent({ size = 14 }) {
  if (ICON_ART.excellent) return <img src={ICON_ART.excellent} alt="" width={size} height={size} style={{ objectFit: "contain", filter: "brightness(0) invert(1)" }} />;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="#fff" aria-hidden>
      <rect x="2" y="10.5" width="4.2" height="11" rx="1" />
      <path d="M8 10.6 13 4.2c.5-.7 1.5-.6 2.2-.2.9.5 1.3 1.6 1.1 2.6L15.7 10h4.6c1.4 0 2.4 1.3 2 2.6-.1.4-.1.7 0 1.1.3 1-.1 2-1 2.5.3.9-.1 1.9-1 2.4.2.9-.3 1.8-1.2 2-.5.1-1 .2-1.6.2H11c-1.1 0-2.1-.3-3-.9z" />
    </svg>
  );
}
function badgeIcon(kind, size = 14) {
  if (kind === "book") return <IconBook size={size} />;
  if (kind === "brilliant") return <span style={{ fontWeight: 800, fontSize: size }}>!!</span>;
  if (kind === "only") return <span style={{ fontWeight: 800, fontSize: size + 1 }}>!</span>;
  if (kind === "best") return <Star size={size} fill="#fff" />;
  if (kind === "excellent") return <IconExcellent size={size} />;
  if (kind === "good") return <Check size={size} />;
  if (kind === "pending") return <span style={{ fontWeight: 800, fontSize: size - 2 }}>…</span>;
  return <span style={{ fontWeight: 800, fontSize: size - 1 }}>{kind === "inaccuracy" ? "?!" : kind === "mistake" ? "?" : "??"}</span>;
}

/* ============================================================ 평가 막대 (백=왼쪽, 숫자 항상 보이게) ============================================================ */
function EvalBar({ cp, width }) {
  const e = cp == null ? 0 : Math.max(-4, Math.min(4, cp / 100));
  const whitePct = ((4 + e) / 8) * 100;
  const txt = cp == null ? "0.00" : fmtEvalCp(cp);
  return (
    <div style={{ width, margin: "0 auto 8px", position: "relative" }}>
      <div style={{ display: "flex", height: 18, borderRadius: 5, overflow: "hidden", border: "1px solid #000" }}>
        <div style={{ width: whitePct + "%", background: T.ivoryHi }} />
        <div style={{ width: (100 - whitePct) + "%", background: "#140C07" }} />
      </div>
      <span style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", padding: "1px 8px", borderRadius: 6, background: "rgba(247,240,225,.92)", color: T.ink, fontSize: 11, fontWeight: 800, fontFamily: "ui-monospace,monospace", border: "1px solid rgba(0,0,0,.25)", boxShadow: "0 1px 2px rgba(0,0,0,.3)" }}>{txt}</span>
    </div>
  );
}

/* (UI2) 화면 폭에 맞춰 보드 크기를 산출 — 모바일에서 보드가 잘리지 않게 함 */
function useBoardSize(max = 360) {
  const ref = useRef(null);
  const [size, setSize] = useState(Math.min(max, 320));
  useEffect(() => {
    const measure = () => { const el = ref.current; if (!el) return; const w = el.clientWidth; if (w > 0) setSize(Math.max(160, Math.floor(Math.min(max, w) / 8) * 8)); };
    measure();
    let ro = null;
    if (typeof ResizeObserver !== "undefined" && ref.current) { ro = new ResizeObserver(measure); ro.observe(ref.current); }
    window.addEventListener("resize", measure);
    return () => { if (ro) ro.disconnect(); window.removeEventListener("resize", measure); };
  }, [max]);
  return [size, ref];
}

/* ============================================================ 보드 ============================================================ */
function Board({ board, flip, size = 336, arrows = [], legalTargets = [], selected, onSquareClick, onPieceDrag, onDrop, onMove, evalCp, showCoords = true, showEval = true, interactive = true, lastQ, wrongAt }) {
  const cell = Math.floor(size / 8);
  const inner = cell * 8;
  const rows = flip ? [...board].reverse().map((r) => [...r].reverse()) : board;
  const tx = (r, c) => (flip ? [7 - r, 7 - c] : [r, c]);
  const px = (r, c) => { const [vr, vc] = flip ? [7 - r, 7 - c] : [r, c]; return [vc * cell + cell / 2, vr * cell + cell / 2]; };
  const targetSet = new Set(legalTargets.map(([r, c]) => r + "," + c));
  return (
    <div className="mx-auto select-none" style={{ width: inner + 20, maxWidth: "100%", padding: 10, borderRadius: 12, background: "linear-gradient(160deg,#3A2516,#241509)", boxShadow: "0 18px 40px -18px rgba(0,0,0,.8), inset 0 1px 0 rgba(255,255,255,.06)", border: "1px solid #000" }}>
      {showEval && <EvalBar cp={evalCp} width={inner} />}
      <div style={{ position: "relative", borderRadius: 4, overflow: "visible", border: "2px solid " + T.brass }}>
        {rows.map((row, ri) => (
          <div key={ri} style={{ display: "flex" }}>
            {row.map((p, ci) => {
              const [r, c] = tx(ri, ci); const light = (r + c) % 2 === 0;
              const isSel = selected && selected[0] === r && selected[1] === c;
              const isTarget = targetSet.has(r + "," + c);
              const coordCol = light ? T.boardDark : T.boardLight;
              return (
                <div key={ci}
                  onClick={interactive && onSquareClick ? () => onSquareClick([r, c]) : undefined}
                  onDragOver={interactive ? (e) => e.preventDefault() : undefined}
                  onDrop={interactive && onDrop ? (e) => { e.preventDefault(); onDrop([r, c]); } : undefined}
                  style={{ width: cell, height: cell, display: "flex", alignItems: "center", justifyContent: "center", background: light ? T.boardLight : T.boardDark, position: "relative", cursor: interactive && onSquareClick ? "pointer" : "default", boxShadow: isSel ? "inset 0 0 0 3px " + T.only : isTarget ? "inset 0 0 0 3px rgba(62,124,196,.45)" : "none" }}>
                  {showCoords && ci === 0 && <span style={{ position: "absolute", top: 1, left: 2, fontSize: 9, fontWeight: 800, color: coordCol }}>{8 - r}</span>}
                  {showCoords && ri === 7 && <span style={{ position: "absolute", bottom: 0, right: 2, fontSize: 9, fontWeight: 800, color: coordCol }}>{FILES[c]}</span>}
                  {isTarget && <span style={{ position: "absolute", width: cell * 0.3, height: cell * 0.3, borderRadius: "50%", background: "rgba(62,124,196,.4)", pointerEvents: "none" }} />}
                  {lastQ && lastQ.to && lastQ.to[0] === r && lastQ.to[1] === c && QCOLOR[lastQ.kind] && (
                    <>
                      <div style={{ position: "absolute", inset: 0, background: QCOLOR[lastQ.kind], opacity: 0.5, pointerEvents: "none" }} />
                      <div style={{ position: "absolute", top: -cell * 0.18, right: -cell * 0.18, width: cell * 0.44, height: cell * 0.44, borderRadius: "50%", background: QCOLOR[lastQ.kind], color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: cell * (lastQ.kind === "brilliant" || lastQ.kind === "blunder" || lastQ.kind === "inaccuracy" ? 0.17 : 0.22), fontWeight: 900, border: "2px solid #fff", boxShadow: "0 2px 5px rgba(0,0,0,.55)", pointerEvents: "none", zIndex: 6 }}>{QSYM[lastQ.kind] || ""}</div>
                    </>
                  )}
                  {wrongAt && wrongAt[0] === r && wrongAt[1] === c && (
                    <div style={{ position: "absolute", top: -(cell * 0.36) / 2, right: -(cell * 0.36) / 2, width: cell * 0.36, height: cell * 0.36, borderRadius: "50%", background: "#E86A9A", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: cell * 0.24, fontWeight: 900, border: "2px solid #fff", boxShadow: "0 2px 5px rgba(0,0,0,.5)", pointerEvents: "none", zIndex: 8 }}>✕</div>
                  )}
                  {p && <span draggable={interactive && !!onPieceDrag} onDragStart={interactive && onPieceDrag ? () => onPieceDrag([r, c]) : undefined}
                    style={{ fontSize: cell * 0.74, lineHeight: 1, color: p.c === "w" ? T.ivoryHi : "#0E0907", cursor: interactive && onPieceDrag ? "grab" : "default", filter: p.c === "w" ? "drop-shadow(0 1px 1px rgba(0,0,0,.55))" : "drop-shadow(0 2px 2px rgba(0,0,0,.5))" }}>{PIECE[p.t]}</span>}
                </div>
              );
            })}
          </div>
        ))}
        <svg width={inner} height={inner} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
          {arrows.map((a, i) => {
            const [x1, y1] = px(a.from[0], a.from[1]); const [x2, y2] = px(a.to[0], a.to[1]);
            const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
            const ux = dx / len, uy = dy / len;
            const w = 3.5 + ((a.adopt || 0) / 100) * (cell * 0.16);
            const head = cell * 0.34;                       // 화살촉 길이
            const bx = x2 - ux * head, by = y2 - uy * head;  // 샤프트 끝(=화살촉 밑변 중심)
            const nx = -uy, ny = ux;                          // 수직 단위벡터
            const hw = head * 0.62;                           // 화살촉 반폭
            const pts = (x2) + "," + (y2) + " " + (bx + nx * hw) + "," + (by + ny * hw) + " " + (bx - nx * hw) + "," + (by - ny * hw);
            return (
              <g key={i} opacity={0.92}>
                <line x1={x1} y1={y1} x2={bx} y2={by} stroke={T.arrow} strokeWidth={w} strokeLinecap="round" />
                <polygon points={pts} fill={T.arrow} />
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

/* 기보: "기보" 라벨 없이 굵은 흰색 텍스트만 */
function SequenceBar({ sans }) {
  const parts = []; sans.forEach((san, i) => { if (i % 2 === 0) parts.push((i / 2 + 1) + "." + san); else parts[parts.length - 1] += " " + san; });
  return (
    <div style={{ color: T.ivoryHi, fontWeight: 800, fontSize: 13, fontFamily: "ui-monospace, monospace", letterSpacing: ".02em" }}>
      {parts.length === 0 ? <span style={{ opacity: .5 }}>시작 위치</span> : parts.join("  ")}
    </div>
  );
}

function CircleBadge({ kind, big }) {
  const [hover, setHover] = useState(false);
  const sz = big ? 36 : 26;
  return (
    <span style={{ position: "relative", flexShrink: 0, lineHeight: 0 }} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <span style={{ width: sz, height: sz, borderRadius: "50%", background: QCOLOR[kind], color: "#fff", border: "2px solid rgba(255,255,255,.55)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 2px 4px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.4)" }}>{badgeIcon(kind, big ? 18 : 14)}</span>
      {hover && <span style={{ position: "absolute", bottom: sz + 6, left: "50%", transform: "translateX(-50%)", whiteSpace: "nowrap", padding: "4px 9px", borderRadius: 7, background: T.ivoryHi, color: QCOLOR[kind], fontSize: 12, fontWeight: 800, border: "1px solid " + QCOLOR[kind], boxShadow: "0 4px 10px -4px rgba(0,0,0,.5)", zIndex: 30 }}>{QLABEL[kind]}</span>}
    </span>
  );
}

function MoveTile({ m, ply, onClick, onFocus, posGames }) {
  const kind = m.kind || "good";
  const color = QCOLOR[kind];
  const kws = m.book ? deriveKeywords(m) : (Array.isArray(m.kw) ? m.kw : []);   // 비이론 수는 개발자가 추가한 키워드만 표기
  const evTxt = m.live ? fmtEvalCp(m.live.cp, m.live.mate) : (m.evalCp != null || m.mate != null ? fmtEvalCp(m.evalCp, m.mate) : null);
  return (
    <div style={{ borderRadius: 12, marginBottom: 9, background: "linear-gradient(180deg," + T.ivoryHi + " 0%," + T.ivory + " 60%,#DFD0B2 100%)", borderLeft: "5px solid " + color, boxShadow: "0 4px 0 #B59A6E, 0 9px 16px -9px rgba(0,0,0,.55)", padding: "10px 12px", overflow: "visible", position: "relative" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
        <span onClick={(e) => e.stopPropagation()}><CircleBadge kind={kind} /></span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
            <div style={{ minWidth: 0, flex: 1, cursor: "pointer" }} onClick={onClick}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 6 }}>
                {kws.map((k) => KW[k] && <span key={k} title={KW[k].desc} style={{ fontSize: 9, fontWeight: 800, letterSpacing: ".04em", padding: "2px 6px", borderRadius: 4, background: KW[k].bg, color: KW[k].fg }}>{k}</span>)}
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 16, fontWeight: 800, color: T.ink }}>{moveNumber(ply)}{m.disp || m.san}</span>
                {m.name ? <span style={{ fontSize: 12.5, color: T.ink, fontWeight: 600, wordBreak: "keep-all" }}>{m.name}</span> : m.isMain ? <span style={{ fontSize: 12, color: T.inkSoft, fontWeight: 600 }}>Main Line</span> : null}
                <span style={{ fontFamily: "ui-monospace,monospace", fontSize: 13, fontWeight: 700, color }}>{evTxt || (m.book ? "이론" : "…")}</span>
              </div>
            </div>
            <button onClick={(e) => { e.stopPropagation(); onFocus && onFocus(); }} className="press" style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 3, padding: "5px 9px", borderRadius: 8, background: T.ebony2, color: T.brassHi, fontSize: 10.5, fontWeight: 700, border: "1px solid #000", cursor: "pointer", whiteSpace: "nowrap" }}><Play size={11} /> 학습</button>
          </div>
          <div onClick={onClick} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 7, cursor: "pointer" }}>
            <div style={{ flex: 1, minWidth: 0, height: 5, borderRadius: 3, background: "rgba(0,0,0,.12)", overflow: "hidden" }}>
              <div style={{ width: Math.min(100, m.adopt || 0) + "%", height: "100%", background: color, opacity: .85 }} />
            </div>
            <span style={{ fontSize: 10, color: T.inkSoft, fontFamily: "ui-monospace,monospace", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "62%" }}>{m.games != null ? fmtFull(m.games) + " / " + fmtFull(posGames) : "—"} · {m.adopt != null ? m.adopt.toFixed(1) + "%" : "—"}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================ 마스코트 MILKU(흰 머리) · KOKOA(검은 머리) ============================================================
   제원 님이 올린 12개 이모트를 base64 data URI로 채우면 전 화면에 자동 적용됩니다.
   단일 파일 아티팩트라 외부 파일 대신 data URI 사용을 권장합니다. 비우면 벡터 폴백이 표시됩니다.
   파일 추정 매핑은 주석 참고(원하시면 키만 바꿔 끼우면 됩니다). */
const MASCOT_ART = {
  milku_great: "data:image/webp;base64,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",     // 3786 따봉+반짝(자신감)        — 정답/우수
  milku_wink: "data:image/webp;base64,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",      // 3773 윙크/여유                — 이론·정석
  milku_surprise: "data:image/webp;base64,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",  // 3774 놀람 "!"                 — 유일/주의
  milku_think: "data:image/webp;base64,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",     // 3781 갸웃 "?" 땀              — 탐색/분석중
  milku_sad: "data:image/webp;base64,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",       // 3777 눈물                    — 아쉬움
  milku_sleep: "data:image/webp;base64,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",     // 3780 수면 ZZZ                — 대기/빈 상태
  kokoa_happy: "data:image/webp;base64,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",     // 3785 활짝 웃음                — 환영/완료
  kokoa_celebrate: "data:image/webp;base64,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", // 3783 홀 들고 환호+반짝        — 탁월/퍼즐 해결
  kokoa_surprise: "data:image/webp;base64,UklGRuRCAABXRUJQVlA4WAoAAAAQAAAA4AAAwgAAQUxQSOgQAAAB98GgbSTHuU/2eqfwERHfX5k9WMSMBvGSppIKmoYkTCNBksghghpIsgLDYdu2gSRp/62/TfOPHyAiJoDXeO5QlC1TnoMbZUFOe5Bmcok6jLU4xKoNN2CSi1yIzxcHw40o3xu4GTc2vNVGd+Ab0YKD/DkH7WhZuVOpuVwci3/r7dq2uq1t23oBHbBjyZGtFEV2VSNuwr1UuVDUDyGOeN/U9///L9mKc2iq/fQhov8TIDuy7bBt2rKTe07/fRF4eABBf0f0fwK8Xduepdm2bYxslH1Djm6CVkZV6kZVNgu1vvEiSdZ1+f//SwpqsMfXiP5PAPxPvkzWm93ucTfxnP9LlF7VTXM6PZ+ek/f5+NlpJeVvgNJ53QXiq5yvXwfiitLbXOt43slF2Z7OgafX2eI+kQAgs8pa2zVZMtds1w/C5ceBmKmBymQx8V3Xj9aVknWdTv84D+RXbwhnOIlWn0TEzJTUAFCxisLlZl/UACCz16eHkCzWo9fxeOT2geNPkn+n85mZmYgJkhIzQIe9lJLpApALu/+SzbZusjRN07c/9heLltv5e14yMxNdEJGEChgAEQFgakA5E30XZfbUOynropCr5+grKb09PBO6k9SYARAxo4EZJ6/noryy3dEu4uTfKdv+XcvPocR/3ZLs0HvirgTARWYGwMTMF2CSE9FruqhMs398iMJouUrS7eE++gQyL6rAaWe727ob+LbJyrdMoAYw1k6PKd1Ys38oisIPwuVykxX900Yr9VHr1rksdMU3wh6M4ufAH5gWEPN3pd9f7nxdZHEUBL7v+eFy+VEqVaXp29i5jTz4EOrj0m8Qrj9bl/K/SV9zkhFQR05fefO0KA/LKLwIwjgrJQBImU6fxS2SF2YGFfFwMBg+j+fveQkop4lz2gSu/JbseFekh80mCoMg8IM42RYKQFlBbd/dm4QR+Lh+XSze8woAcfDFtF/NMq21VuqbGaZFFkfLKArDMIrWu0LmR4CID2Wxfb1F7C8A9baWdQ0wM/tqonLXW2u7dp8l34kzLep/URCEYRgt42y3LU9HAlhKOsgisW8g3ZVvmRmGE6F5OLdNkcffhRit1WkZuJ4fhNHHcSuP+V4SQJJYlmrn3gAMTmEGox/f+PJwKrX6FkSQFdVn5Nm260dxWpSHvZQMMCQRn5Wc3GI/qY/Juyb7DryVVLSPPMty/EW6zQ9HJiaAmFhKgoxusenfwz3DzENbPpkXHZRsEMNFWpQHEuKDiRmowlv4py5X3s2fTEs2uar2m8h3vPm2ODJZJWKlMu8mn+f+g0yfDXs4yeK0icLQn+8KIsL4PwBAWm1j5wYi2HxSLscAVi/CpKWVqvyIwjCapQURAQoaCJc6860b2sFyz7cDM5D++WVOtA+oPiLfDz/SgogBSJBADECVM+cWziQ+ltcDM7CdC2OyDsH7yPWjpKiZAXCSSEIAQIkvrid+v7xlu9r7MwPpizF7j8T7yPMXW0UEAARoAho2rnVt9evPNN1K+QgABtJnU2o/EO+X4WxX5AQADGK1XDntomV0JdmutrImPE69HpghG//GUm5WSVEXF0yU/yoIEEHHdikq22rre573/PKWSjxYehsYgkws90mh8kIBxESqJIIkQb1a5axH/5zEcfyeajxePRdG7JEZUh6VPgPQBMB/ChHMDDlsJRtkJllVstB4xMXIiMfAzEy10oRLTUr9H5SYgNxrFR359nwCsoEBcNciiA6FUrjURND/qiEGcPLbWWZ+u9JHqrkJkLVKSamaqCCGRiUMAOegFawDE1+Xj8B2ZALkq/V2WygFYiaS1AJggCbtktohPgxakLgmwOBl+pYqpYlYSgYUNYKIoWbtYFE5r65yaTr0TJgA8XJtEV+YmZouiVgyAzNRg7g8VQ8DW8vACIDFHx5fAUh8R0xMBFDUBRZP54chLVg4Zsit869SSrmnJmJIYgAUdrprj4+juRqaAbFxZzoe6SQbiJkIl0VgLSa7FzxOepA4ZsDK2DLPy51UAIjpQGjMvQ4yO9ED6ZZz2wy1qtbb7XadbZVSdDgxAGiFndtheUR+7AygHNntxJNzHyDSl5eX+etksVVKa1kzgwgqsdtFpaO/ODBDpzOnVTFd3gnAr6engesNp3//rtPsRARmqV5Fu8wS/+Uzo87Ggxba7I7iXi7LSOfl9uHPn0S/vHf3MFnWnmcgBF3Of/9qenrZabbva6xkdP8H0ltwdjFtaWkOCOZ6l06fnyzbHU7TQp/F/QFAlFvvbPOQTCs9z0QG6nI1DaZvSVkU6mgGyMKYen0np7U4FwBmoN5KCWaos2Wo0tkyiWCydDw/mQF1MgVkJCVMX/gZ0lgYM5bT1jRTdGySXGh1TSYHnCnVxKSorIpUAoCMlnnd8TxV765JS+NMoZfL5TLbt32YKbuJZZQLfdedDoe26/ue56leOEZlnoZheH15OQ/DwDP1OBFGaU/Mv5iZX3mu5ivPMjp2FHjGMvPhM3LNkhbnDm1Cxyyo/awB0XHl24Ztepw1zOfD+qst7HneUF+VsWGysP2PhntTrX7/MgrkcvdFP5kw+G49F0YBLEaL9fFMP5VxXY1ts0C4wep4u3wZoxwaZlm2t6iIN1XzPQCOvmnW72lGdMxHx7Zhomj+yZ81+ajcN2tVtX/nuatjI0TD0/+Ktjvz543yScjsu5M6Hw0HT0+/X1bD2y+ewZV3d3fG7fI8S3c7/sWzWEf3Jn84BogIP+cPMwAw/wDgjOTe4K7BhoePT46I7y569D+DKeygKbo7uOvUjwFVdhA0oCf3Fz1KBX5UqCjIbGeoUkDl3x+ssxrgPoIDRAWwjJoWqdBKnTwDoiiT/aTyyJbxg4KotBT7ShUftgFgDxeZ7B0GBzIQEJiIzbT/KpLAMlK447esqrhXjp2IKkzaef/v76trhmUJb7T4KuoH9ATHWERpoE384lrmRnc/kpofEIpzJii2biYDYRBE21V1fkBiJzbXS9+2TI6rv2X9iBRZaqfItUyOClvWuC1cCrDInjywTZKZ6StcncFlYaZyypcnTEr2bsC1Ue6DSqG6R0e2ZbAsrOdr45Qg1xjTMKYp9y2TkydPNwF8ouJNGSkrjGRETcWuUXd/w9tMQfEbWVisw+hLLSwSbVDx1uyhdjLtgMTrTCBel9nmhYNpe38LBUXxwsiMDYuH4GslO0+0xOgLOaQI5Nd66JE7fHAtZqfmYXRJmBEVR08tX09FQ8ZLKaVUevVbmCAXG+P//2QNKTDjkwC9s7uHh01tTOAaES1K457/OS2KpXrekQaO0vPz8XjqnfvrmwAgk9zs2zAhDnFO7SuXrtI2MgNApsuHPlyDBy4z4RLsai9WpgDA4vCudZzmDXS89tOknXsfC60cgng6G6rN/ckoWSSRlFFx9NfmC2k5FOccgxtP4f0l63L/o7i/u9+dPF1jlNofkWL3/u4e+7P/+WP3dPJhQkZFlBnHcRXsfHF3IsgUUJVpuqtqtISFMsKMM9bhTfLVtu4v/MLlrq7PNfR3mwsnchn57lkGBB/64nyucFMmqFhnwBqiOE4JfK/OJsIAywnLi7pGR1bWkUk3CE6xHkacR+uBsIx0F1IDkLqDCluAByqTlAT7Mzqe8/nAMjVICqm1RldsZdZMaSsDtrBEROeviWsZa0+yQmn0NyxlsHeJiD6joW0Z7IyTGt25Br5hnfKlJyyjk83REb7npXRcsowdy/R4e3gZ6FMwo6cbarxC74bGQZTlddOeTs//fL3ELnwtjtlAB4qxMA4AosV6s3v66S8dyAK5SK9a2H0AADJZHwa8xDaVym4mWDxNxk5PAMjC0aX2vATBV5+Xbm/Ayl6jqYxVNr2eiTZ+b8hlh1dOpIB3J+Z9JPrC9uP8jhRQ8PYJpw+nL5xwc7hValNuJ+Ls94T0Vl/8DSedzxaWABUyEv0QBVmFBx9bAYjdfljEUj04VApMlHEciT5YPO0UHjmoxkYE63zUA3HZKdDDAlCNcwpPRvZsXt4jAH4AVEAZu18lA9Oe/hbsIpcilcPVQhg23KI7XOnN1ciwiQQvDenJIVwhFaxts6IzrovHwwRc5w1KQU6Mspd8JSUAOQZsB1/OQOKa5B5w92m6JQs0AJATk0b1/SkncRhSk79B5hj0BjM5BQ/HfgrMEWtDlBPwcBTa8CHMSYx5otKGi+wDVShk4eyZM6NWCEcpKA08F9iG45LUKDJnydTmyVlDAAVUwNZdKBOfGawmtin2krmL5rhGWGsHHmeWgSnOigBewNfjTZnp2BTvC2As86I8XkkbFo+OIZO6GyDwlrNRkcGRcmLIK8Boy+Ap91NxkT0qNkMkXRzI83LwkBLuPtlGOFtcFzyBdymPIh5YetcTg/F4/Od5YF/jWV0hPjlB5FVvjK4mnufHPM+TxWhgC9FlfI2jsZWLfVzLHqWFBtV1vVvPJpPh0Gn10kc3/3J67NdMAwABusqyLFtNx3YrNkqEA3KPatgzPEo0MAEEADob2d9NTVNPuKiatfiJZr54hi+gEr8FzJMPQSyu4K2BFgTNMna/mffBMsK9Pp1uIqpBzDyIxVMgmhY9NORW5HXzMoABBo0K4oZ66TXYMX7WFHSLahAAREUlQqMqIk9YtuOtdE9xq3PYSfxDE5o8uAnlV/w8GE6CDfeUXIoj0cWr0BLnxATUu3W6WsdHaiK3kTthZXeZoW0K4MaqLPP8G3IRGNz6w+1yqsRqYGIiournx4nX5VKF30GkFUpzpieaeFEYcadz2OFJVtICElDjM8kV5pfiqMOg2PYtPgGucutlF13ZW/CaXOwo2g3v7I98cNv58pBYT/427LVz60NYgL9N5beL+q9BP5uwmQbtJ3l7xyW9fQQiMyMjIyMjIjMTETPj+BoiMyMiEhIRMk7BT4XI+A4s37HFWxETExMTEd+Wf40QET15uh7CcD6fz/3LS98PQxi7EFxwwblX37uL3nv0455775zrx0MfAhERXvToEfFT4HUiCpd8FU9bh1sxM14kvjH9Ysah74yp2rZtu/Z0OrWntqkP+3Jc13VTN1VTNVXdjOu6rpqmGpvWGFNVVdU0bdM09cWmadtu3FtrjLGddR4/DL27bJ21fd8Pr4PrhzYXk5IT3gQZvffejX2gaxqAbrr0x0NZ5jrP83Jb7rfjLFvGcayUjvXFWMf6vUprned5rnOtc621znSmM621zvNyet10ztOHhKE346qqmupia9q2bYrVNNj0eI0YiZBx/HxsmnpctZ2nQBeaFbQGiLHbZZlWSsVa6zhWWimlQMF0AVMFKBgLoYQCAUKBEEoooUCosVb6cpquVnle1sduoNvh+XQo8zzXWus0TbUQIhVKCKUEvDMprSdmIqSASIEQEb3bb7Nc61jrNC8bF8IFDUAB0NCayR/ukwi+WwVKKSWEEGma52Xddn2gGyAj+uPjVquxUPDBUeUCeU8eg/feB++9dyaLFVxNMuMGatDQ0NBaQ4bgNgsJ37O4nKY63+6bznlPRMTENPZjZ81eawWfVFfOeee8u2qdNatUiGugVsYGvEBMTMQUQnCHOwnfuQChhBCpzsu67axzfuyc7dq2qctcawWfN62MMdZaY4yx1lpTrYSAyaIwjhh5TExMgbzvtkv1rV0UIJRSOl2tiqIaF0WxynOttYLPna6KoqiKcWWqqkgVvFcUxvkxjX0IztkqE0J8e5NlHMdRHEkJX1NMToWAG4q0qIwxxnnvnbOmKlapEAJ+K9PVuKiMqapilQohBPyOKpWmqzQVCn5rBfw/RVZQOCDWMQAAMJoAnQEq4QDDAD49GopDoiGhFcpuTCADxLGFD0u3EDRmWY/Xf3f0kLE/pv7X5te3vrfzTufPNz/l/VL+o/YI/W3zxPVH+53qE/bP9zveH9F/9s9Qn+mf8TrRvQA/cf06P3Q+GL+4/870tP//2d3SX9R/7F/APUD4w/kfyq83/xv5//B/kf/ev/F/qvlC/sPFv1P+y3qP/IfvH+K/u37Sf4n9xvlX/V/lR6I/Hb/A/Mz4Bfxr+df3r+4ftl/bf289aDvRrM/8j1CPZj6F/mP8B/jf+J/k/3X9vf+T9KPsz/vvzF+gL+R/zf/CfmF/ev/39e/6L/oeSR93/2H+4+5L7Av5J/Uf9J/gf81/xv9Z///th/sP+Z/n/8t/6/9b7pPzn/H/8z/KfvV/o/sG/kn9B/zH9y/yX/O/wn///7f3r+zX9s/Yt/Vn73ENunNuvaAQE7bDdRRgnla9muu/4p4bnSd5wc/A1UJjRzxR2Do1UQWuxiAZM5nMVroPWEu5AEo1CXcGPx5hdYTpBHbzs0Mqgk0TbnMgDtX0j2f/vx5t5s9EgkLzLs/IF9Gudltsw0E6zolxi3GrSrVXWjIx01r2vMBXyz11Ije7VjhHXyyI+pr42wiXenk0vyCbLTDb/mUfawSTER/DdNwBS8hRijtmG7fPNh8KYmnqB6OhHEvUQ4kyo4EbMT6azfWgaditwxsSfo3T7wCwU4g/M70MW6B5SE7pWpNFdp9wsrHXZpp50CzOStuoP7WtGcAUCmsEpjzmN4qVE4ag+R1hyQJYk5bLdX64yfGZOQXHslWScbewkTVM8NCwNqqGO9TZ7nXLA6nF99AycMkRruv7J3C31U+nFlAv60lrHh1wcSrpDx2lOB/delZqmeQw1IxTbuhbwBEgTrMxLBdjSsV5KFhOWAEU4YZju0EzUBnTUvED/91AU2mkEQvUjCJ3eoPxUGi4R5+tX0CZhzyVRnYr+9x/Z+d9PZy22jBY8lY4I8w9h6fNwcYKcLxviQl9UPQrAM6TDQ6xI9vBBNuOdEs7jc2U7vCEpYsJeM/6sl0HBdsZAl6+NQVVDHvITYY+0xa3TWFRM5KeYmSNBFr/1MenBR4aHpv5gp0xpG/pA9kKBT1cBGlDHyI1R3B16f9ZXYMWoCZtadvWcSjYusMTQlOILXmOX/B6oKYquH7CTjmSYNPuEzvcdEo81ZDjrnjQ+hNOkdmKd7KL0rxFdpsJqkLNTb6kxjpMTlYJ7PpcW+Bi3BIhxCCfXy0W+pF1MMFS7vunhEDMG+K2gWVaoLogbw1ijoeej76d/mm9T7kOhthcuGIeMhVNeqLIdBeGvanR7R+t9oeohN1GMFnrPRtn5my5rb8aBE2fpa97BBsGLE+jRTr8WagM+gwcSb+VwM0scOicu8E44NwQaeS/AFm1rIoc53uiPvRtMaQ6SWchqxduxVLiY7Y0/m9ne7W4hXFluooGFkjacMxtSHdsadP0/BLn1VTPEj3FoKhVaO1vYwnuUcYioVGo3MYyG1wi69/kd42liW5ePJtAYlD13tS56ULDZrWnmJvyxNHcItdl/BoWwZN4UXhauSxOZ1wvz8MUmMhW2FwAsqS7dHUPVIkKAywjavv5oMoRciMP6jcbqNTRSmFGp/IFD/QnedtYUYylnkEQAP5oJYmyAW3AjV8JrmaNPlMFd9GPnP3/Mf+WbD6HyhFeQCDS0XJvbaFiW4OaUDRG0GqD5tGcdOpDg1Nm3JND8NWkwpxhwzPh/S7931kzteXo1T0yi3qI4mSeWYMGcGyakNV79xMpIvAcdS03gEdBl4yTamYHMQ9Msil65YBbv8jY0mYHBh7JcuF4wfRmX0FTaAThF370kocxovkvj6/qDF7yOaRgtXKPmxiKm1m30QNsETzX8s/1ijfAELdn6F0C2Q1I+P5HXOPE4mEZPNbKLzFDL/r9Gma4z/fJbOiI37JnZ1A2kfP6lJRvx9P67F82X/WVUStl5NBF0SPvuozsENQGoJdWnAb/Nbd74T4PMa9hW39gxV6/uGgylXDvjBOivVR1pWc8+VWX1WWOnPfeJzMy6Y6DF4KuWRI3YkYwvmQWCt3fvFW+9twMON6aEyuH27jKtyGdxm0huyJsRtJwd1HGKCaNFqq6KweA/AcXdzg05ryriGEbcNZcMatLLYoOr4s+P4QH3P6v+d2hV/ZnGr4F/p+m2MZBLtb2mu5Un/6mntAALdjamHdRiCQOvslLne0l2l9v0bmWyIzooRtSBVTGdrAwhqygydg8EG9qY9Y5PK/qzZA2PWb+ZLrLQCZ7goG4RY/IQZ+h+kJARRaszBQlQdG2RzBRou5tbXKwi6cEH8ahlytNQAK78IA3ePBc3eVTxyHhv/8EXwRvsuzK88ht0PHO9Xm3V36yao2YLNHRY5vhw8rt7rfvCt3Lteu3gUJt0djo275w7Mt1bdwbh9Nd41eFh/aEOSdsi91EZXWsk2sLkrCmixhlbjHUE/L54HOzgilEFjhjaPoGXc9p043viG5hJ9gjGKEJ9mz8L7q6u7DW42pGZX5fhXXpvwqtzioz41QobPgG45IPZQI0wF6UZF3MqWCvVaw05mn7FNXiuE639+sSASvxF0MrleNK8VwJZm3Dj+gmSjuygCCrVrvNzGDVew/BAgxKpy7Rt0IDyjFBEwgAaukegYgAAawkiylk8RQ6NGRqXObW3bW2ZWiKGIHhHfhKx3iAHopmPiSQ2VxHzq5aLmeKRvyyTw73Y+e1jdDbk7S+6U8xHX1zBDT309lnMlYyV95R71fhEPaDstV67s8yk3xP+LQxSX6YiwENnMX9uwwVP76baKoiORuKmtT2JpDWBvfVj7FnbkKZvWy103JrCt/+53xNJClulsLb5MeO7SP+WZtOkP6VHRZe8iFTkS4khsXmcNJVUowKfNe6/ZF1JxvJRcANKV3o5tkAO4iRZ7T2Fw/9hn3/uPKlKN5s7EoCHxaop/13/nICt7zvzwn7bwr3VPcAGliP00YyokMAx1A93iLtWrva//gmyiy8YmFZ0V0VaqvhRO5RG6umZtoA4l0IukBba96LLKYXcLWe57C86anvE7gzKWeaHqXOpve4peDz5kcRJaVXjwZIEKWguNfSH/gDWzDmMLd2Zp2VsxZiPflxbge3tZMjzCWJk04YINTGYu/BUbkirfqfQBv5TZxSKn76gwui7xHoSQFRYoCFePRtLkng/de74n5S8QRXmV0pT70lS/210KG7c9oW4ZpQGe7QlAndf3QfvSt1+M+TFHud+KWe+E+KRnv5R5PrZG43dEbqo05cUEvZ6YDLidETQcguMHgtQ4guY9cLiyv2dLj6j9Hu/jZ8XWuPBcmKZuqXf1god61xiSQLqqMfUOmhkQrOYg9rRt9tCa/r/xFU2X5E1+sCHKgJO3fvI6VmGGF46IjoG+/4rnVGYNhADDgjnjGQSCN6C1vZ9oDg3muwkbIk6hRjo+CGp6OMoXQI13sOYlxwfFye5MPySEmQTKEzfoHJ+yorx0YbZVs+17pQy6TThwFMaduE1LO4TIEuvcopiksNH33RtS+tfik8cIq4tNC/4FV1dGOUQ8Ftmii5NsvhTPcSw3qU9M/AUlvMcn5eYuAStzOB5bWkNHMr3SzcrjP8M4TJ0RFJIpk/tZtKAbYSLf06xZC/LQ3XSPa8bwdoZS4uld+tBwXg3zimLNDh/d3lShxtbue9RhIeEOK/EMxzKJZA8mUVqeKjT+GSnQ4vyPQYsXQCKedazf3LnJISeybydWQJfJQhMRvQHQCpLW+cXXE+k9TqptvcY9R5/fr9LhRiG3omdVwJNBn7l3TI4HD5+wK4ZkGuRuqTtWu1OacDOsrd2dH1vGj+B/o72bgPuLHoU9AR+ggFsQ2jhO3u6g+hgf879bhWhDikBwAGEYrRW7zjytJEeLnq1fg/3BC0TVgIjwEEgopZ0hngmY7p9CjHxsIbJJPFKEZMIhCiBuXfAFKmn0OZBqTWPUocJ39JJHn2/1Ou7/zxIW+VzTl31/8S53R3oOJ7AA2WqgjMZWgEkzT5NDNAx1tOhBrcG/JlvAQjgezfUJixyvaL7+M2ByEvKRtuZ7QPq9my9uOQkGOplQy+CVAFkfSe3HRNPHeT9LEAHRR57in3L8GnxmYPWZJbWqllSdVF7uLlGIEF6mAyTNv8whWb2T0wpEqqpD3HY9jCZjOYdcbrq4PF1SrQnM/x6KRVQNPk/PTZwrKpwhv6rEripGmKx+nHDC7h/82FDqaCNZlmqUlC1QzorCOsktHMRz0k5okOjihBzDuNWLphdZ34IKN8irRRl375NZPYciMtpk5MVx87bmFBKsoaWYkcn5Urz966CET66yLYZgGsltCn1kS1dQ3sAZUb1pIJDO8+5HFt97MvgxwdPu0ecmvjEpQTACMYCzCfjuyam8/LhU3CniwCyZVq0EtpFHe7E7KEVR2SzGHkn70LUhPU2uHyLilmN0d1dOp2It13qJsIWXa7Yvrl8YpEPS2tfzlolRo9yO1ZMSlvpk0IL/qGN1QBxbHUxFoDCg+rs0Yh8l9Qd2tSEHDZ8V3lk3PFrrR97URNCUHqYJt5rtlnN6uQTvTuOD8tVYfViOJV/FVIYK4gLt6zQaXND9Im5AhUF5N/DF9Ibm8RbdGhC5zhVjbbYdmd0CGGb/5qyIC8NFhX+Yxzmo+7A0NqnnpSHRoBk0TUqA/AZL3NR4BOrg+6+WEvII9WrqzuhenlcpAR+XBedRKGavrdOC+OQOjY0hIjyharmH2TDxlLS+7KkzeZpChK/lAiGaziufbnYJERM0yAqjzkXfs3ikJx9YaPvzU9kQffx0VcpShD8XKJ7kdae2/Xy17CmnFH8dYlkow7kUgI5S3m9ou5N11rxN3DT7RqIJHhyOOWN0knPubflrv7Kyj/vEoRipgCpYdqj8todl2mfXr5em+9i7sz1I2kvo2cPmaD5HoPx2KyK9rlEnQzl/i0JeLtuL7tyTV4M+16En3r+v1mfgNjJr8GXHFl2CFvDkOQ0FNtuUaOWjNEYVH5FhiuzELKJdpcMe6gbIXxbdLxWitq14GiTMXFouJXseFCmUfi1A1zkkvLzFuLB3TgdmOv1xA5fb7VsZUekpuxe9c1xCKnRDzslYSRTnDfWm9tZ7X6/ud82El43xliHykmIsS8jEPbZqArken8p5y8qVHV9i3YB+jBkgvQl3mAeKAHCkP44vejmfpgasZnkCVowb+FJVeBP6ACRfqabj1DfMay2trwmbezyes1s9EfKpNSnS2mWKFTiMe0pOnCEIaRg1ahzSH0A57LScWaIpf4gdvqu/DEt8zlg1049KUxpugCcDmUzfr2oQ51/afcigjeepprTddUCpK7mNbflczki08617B2sFcC6Lie5+9/32n2HPR9KYVSlx8B1kN8d3joWRaBpYNmVF+bF15Kg+LEhlAACACuSksEQZefhy+QLflsRKZPpdT7iwJ3AAEirJKwbErnyaZL8z2Y51Ku6v8o+z15I0vv7DVXAT9NsISnWKfxB5uEEJ3FtOBfZntol8Fkox2mpaUTA3kETdDa7cJrD1KrEc8GTlKoignVXL1iWip1HUc+W1RUs0pmnnMS+tNpxmvupHHumr605ic63SDHA2D+5A8cislJBPy/O+KxiaUDAsJcgINw64cDtGiRcMjEi5wTEsxWz1xsd1OkhMNHnKa8lbXO0htL6jobUxG0gftGH1DBI3ycpZqOz5EsTp3otjJrxGhQEXonbZTIyczytN6IEIv9tJYgNWwP1NQJkmDUL188nT7JXcbdqmEkRflAgzTYvqRpTMMYU6S+Og0Uygi+gseJBgT4X44e5EG+zCEqiwzyXiCgwqiBnoUz5kdKzEv5GTCjA7tAyKxPhs9cFZiOOD76fbFiLx7Hr7tUZOo9rap30f/w9aOG5X+ooj9hMnT0HzW4S5e85bhdOLOBudNeM3vZcNbucy+rCQqBsPqFAe8HtCouOMG7WKAU6vEdTyKvBM5Qc6mWBwJINuxcUt9r8sL/whWvrHvP/OdZLWMAD2MPs6DriPbLLvcuQpU06KXW143R4ECeq/KgVERxgDNdxfKNNo2Nv8kjPJ6TLfKKipS/o6AZoZY2xnjPpC1C8HPjSAixgkogFlKdoCJTWDUYCF7JFjnBayxY31jDwRaNxDwv0umMdrD2L5ttpb5yzgAvVMsuqp7fRrZQeFogZmow4kH6oKo1MvoFPPvBhwluZRV1J+5afi09Rvy8tJA800Fj+Ohhty68yI7m5P/evWRT7LhMT04U5UN81gnycqkSXPpUntvu4QGI4sgEUHlxSA82XlKxjKiimA/CkpijgmSokEmmTTpQ4RqJdjAYl766CDBiFZntYQri6pllEEXPMrKPh1uLxdReVenspmUqr9eLOJY3AHZNeTqbnOHC7gR89VgKPerurwuOhajR+vUFksbTkOsWmrl+3akzzE2cObjOWSo3Yba5yKesARGIK0Pba50ygAl0UtNtenP43khxSxafiHe1piq4rAI5BvBqhWLijeQSifK8ZXoTmgarM/Gac2iyJwbvBzeWfuZhWQVKBM79K7uilobLuRbDL8HNQ/ZQDpMish8/pJFIRwwRF+el/oG5PAWOWq/q/i0mMnEzHT5unpisnhkFjttP3ZiwIuvxMfuauk+YJygqO6ebDWcVE/v74qQzzElb5SgZvCzdbdDDkgPyMiHedOb+hQTRDkuThwqa24QirBfLVGfp0xCIvWfmbOuApDi2uv0gnQpD4TaI8lV6rOvL5Wj+J/5x0ir0GURrTHkHFL3kF3rcUqlIu2SHxve3Umshc6rXPBNiikimyCYoeBXw9UUzAx0fxYPkpIUb2YmGtw3O5c5sDZc+9l58eg+/Svz5Hb9p12WxiRQnOeVVObb3fkl/hJ7+FtqwQ8U3LndikRuaJTV/BwWBAmdk+D0nXdnP4lQ/8MsExK/cYuWSYwBEpzK0CWuS4fFeW6DIA6LtGusq4NepsoKEDWKTGa8jfAKzc4kYjLBf6qhuFU0EMLsvZm2x6oR2s96mALZd1djaecy9Ac863czL0t4v0P7acV1Pk18tnm8d9OpPysph6jVpa0BcXvaivSqLVzCpUtoubkTGaiFjFTOk9p8xWCScRJH23O5EX+TMph+GCjqV5tS1lR8wm7oBGy49oZg0ocdFc7oCZwW4p6O6WrGYZeufCbOkojj71ycdOPZbvVr+SjqHYMDbTQnUGFZhXAj4HsIjvTJ8ZqxOe74b7T94wY9BFhdNxTdwqbrDLUNPZEAb9Gnf4mk7cblFuUJIjNdm3YKjqmhdwTMh14soNwhDsUXwozSUEEqRMmPwnLu7gtV/nHGzMDvyAjgRtF8cHQTReiViO6e/Mwgq3Ge/oORcHO7NV8oVEXklsRv2EgcD97r6D1VBzXGuYrTQJNCRFVVgo6+8RU22NDHaMPqtmmkwQWHjtYQEhPxHsFFHf+mq+JKilDkoH7gAz2OBde8OSdxQPQ2+XSfY6lF0o3DEo0OByFIaHhRW5gJWdAjM0aQ8GoVgv4Ftf+++80avnhOe+lqwCHWxXYuNF8uRC0ncGkBSH/a9xUpVwvgu9VBGGiV1A2XV8FFiPV438TVjbYEuoxs9ECEZ/WaLWMGikIbTs+ijKvIBTkkFwmVutaevYAvYLSh5JUrvKu9tr5HTWOCJFjdFfIIMq8MNGS2U7z1L9yBK4hkYDlw3d4Ea7ocHN3Vyorl3pdqlifCxCy7KJp6ePisIMOCi7nmB0BEGRztL5eOTktF2DhMj3hJJQRZV87Kh//EoCuGHefC+Y6a04w1UlwvYYY5QKPqJm9lK8JNGKtYSMKzxJHNt1vZKjctkWS5KxiAH8V8+JU/loTErMiaXs5n1f9s+kxkXyk+0NCfon9WsES6VcO8Cakyqp0fZvdwkDyRDbdVfuqHMgS6LE9n8P3JasLbbg5aGKSXX8SECVx0/N+HTAaYXtRLxlLNiOc0hQ82bLiq9WBSB7Rttxx10sb1ttlCprw8hPXChkH0FI05Kqy3gNxKUv9X4kcVLp78FvCyencsUxxJokwDm/VYNWxC04G6/+9ScTduf0+cRwGsn5KuiuVTe2/R/F5vtmHxf1ZQn+FiyBz4qlhAirHJoJ4buDjk3kfxoWrT5cYUnG9vpfHh5gSgqopQ+dN3BfuHVoHMlnljrqxqPAOzLOMn7XnIIPtUT/7C6ocy3hqX8JtB947muu4tlwP8srnIvFdlqftViEKP1v+FF9fQ8K1XscjVyWRn+xvsqSglAYK9i5jMDCzy4G18cnjlxi1K2W3QCoViaM7KZjEr7TmE8zstKwhfMG+iG2zxbIGk7UKGYW/D8EjWSXsIuA9UWAKWuIOZ+svrh/dIiLdmNGmwYKmhhCfc80vwixJm2WpOSmHSz3Ig+w1bSmwMXDz/Ym8tNFzxAXUKu4kXcn517sHHIi1iGqGjYHi6xVpvYlHd9B//wR5mlrST8fC+WDtBnITiRD8EmZ5VMU1e3qpqJpiJg0nB5+kqIGgghf2ICLWTNeMhGPIYP+R8/ILWjoBAFJPd2NrZkJVJ6JSFoA3bDlJa4sc+LuRRqbXZqlKRnyT7VN5lHGCmdbwGWFaTrMaQgG6wTLUzLsGRvuyRLhegQz44MQS1l/BQhgLtO1M9TFdXZxuNJlpD0Lt2tDiPYDhXVpCA1tkWi1XRFKCKkDayIsxsuUGdps5QAIM6qXXpW/IL5dkHwFxOpKKzswY/cYS7l0JeQIFntz9kzIRBhId12h/4llso/9NLHJsTjTiX56DDVaYIs2scnYTtq3OHkN3wRw8YN9ffddbAndFU12Ajvi9E/c99Os1QGSURdU+lQOWsGUF8xsOqHs0C9z6h5wWLTFlEBzHGSpyrsqiK/2/R1kws8P6uEq4ykGPS+yw7FiQ7isFG5Tre++8Om3R9jjB7O1VQFscWesRb0rmiPqh3MK01iyVvVDiorld9+xYaixBGMVWpFf4wJ7DSpG345LdeqzI4nhVsUqjmPrQ6lPlup8aoCb1bnFww5PW+Ud7wcVIMi30TuTZtcYkBrEZxQXr/rvG9enp8G4MJasT01pD6nAPcra1xwHJwF5XKPt7+ZymZVEMYiO9BXwqY1yak/GsCXHmcw8k0GxVuwfTODXfL9xz/vHTC67l7Dtl32yd+mZg+WeiJDxKOLWYudxs2u3b330DMwWD3HFISMrhlMVQDoairZwxloQQxstORT6pGEaSKHVts9qIp8MDo+OwLXvCpFFLOorwKohLhVvcFLX0OXB6SZI8rBlQLcWilP+awzyL3XPnMnqSh7iG0X+gLegIFP091UVpSXolPNOzkAjLES/k1mv20K5tHY5yL1mQJrMmFA75fn61pTeDN9ZMLlOTGQMLrKBni+DffFv6EzOp0xI9r32E/jUk9tHiKQRHv9hTZs0eMrMMSBL1M2//EhTMUYPqLfg4ZKieX1k7l1JCzmfJMk9GusIZ2LN2gO5BqIwl/xpkUw3UPVFzQpAvEKn5zSkE1nGvlqycDTvmAujuvzwBjuNCegZKiiwAGvPmCY3nL27dmFVbT4FelnBylqUWINAx2a8VVwT1UPrPdWf0brnAfZrIUR3lmBZpwdY44zuoZVVx+Cy59YpKRKxYmUjz/kMJRTiPt+L6YzfxYr5G0dJ3IEex58LBjqiZsJIm0L5m5pQv9hXYyo7SZNyJJr+8ZUQlh4AzWzsbwHueBtptBX/aqu8OGOmynIMiSWJB1+9rF9wzRB4uezH3EB9ZwXnTocuepU06RX650Z0BjenqW5+LIFO705XMbq9UWa2UrmuqYQgIgffGSDtufFC65zoMGhUzEWh3B8TQrAoorcEU+oL0wPHBNYsIpFC4ikVovauRxNRBNeZcdmAhX86KzO2lOyNAvZ9VONNn+j6YccHQhjyvxkpep7DhbZjZCvu0UXDbjnDlySA7QKAoOTDC6ViIpjP1eA+W1fq1PQapC57g/icKoLQDcqMsN9YGhKuhRiWHBT0I+aZa+KmHzaaql+1ab8oFRs9e2KUUZ7CEZgPQMneKPlkHzG7NcI1el7YnLM1XO4lCrNIwaDP8Cl7VjE3x0Wzyg/gemhAFg14Vp3MDTLaSJSI51gl6OlaRiXBX5yP3O24FL2Mkr5hpFOBxCs0Wmssp9jixVbW63+5EHRT+VQVW+fTrZt1g3cipzrjjx29SLOOCnJZ//xiNFseotahbfdXOHfmpacl243bAvdgSrxhIxRl0ttDGCCVSkJcDFFak5hIawdh49UMed8iTo6BmxsI1ZEsqY8m15HB/GiBCaTtC4vSNLoBtsDJeen266Q7M27LPzr1+taoBkt+zz/jDocyuCkuin3LY3AV7q33n8uMrSmUWcUzpbyw8nTJ2Un6KMZy5Gp66rkYEfqkdfn6shhcJSnrAwPD61I+854X8BucmHqLT6Te3fVisHBU9XSImUzhmThZIqHkXiTetldeZtNEJJ6ooU93cMFpEZrFn9LW+V8j2XBGS1NyHkvjqXKDboizxoJh0AqZGFD3fZQ5/iHv1Aj6llKl9W/YCLz+2DkI+WPLIjKbIOuNM9ac0NmQDCa6njN77kEYDk4gx0bU3YKQZwY4nk2dViYWCBWA0QDG9/1KoOUAnIPoDUTKcFK+8DRAxz7k4zmz+Cr8GTCFsa577V4IvQ2i+h59mVjuddfLrpPgiPWmiah5IWkeyxAyQA7bfIUqX29WqDxGZBGaSKYSvhpeEU6JswrQRY4ksUQukdbGqpHm7ObtITz93HUQcbq/2mU5S422rTowCah8fPepj9EoqOJSi5idzgLo9I4dFFX+eGD8EB2OhXzQnWoC6Ak7KdFRqR45Iqdkwa9b4Vbf2nBGXBs+BDD7yG8NB8KFJj+qyXIfyCeLRNK+NkhWXKjHkn/AYO+W3wImwFh5EBYmwyD4UYrr9LQFH19A2ZIXAPNS6RL6SwOG/Z1e9OK1RETrbZXXAmQK9oD8jAgJYMGF69cQcNNQRcmDEH4MFuBnMJz39Ewm4FN2IjU9PLmKxBDJS1ZCTEzg8w5vOe1txdd+hGkqmhEXY8bKHhz0+jhKoQhfBM6frJW/XJ0y3OsMQfFG/XsB/D19ptYha+rPnRPzmUQ0GEy3C+C7ZrWZIPb16ijZmInfHKPFvbG5pcMwrx4tGZkiYbMhlkJZxbYF5g5iwl0lblha+pD59pVWoWkW1z9NJwiRPgw0dHir4Pzc0MW1SF0F9NtptHDjIfvCRa63SDFi5zEdaAfE4oFpXkAWfyT42DTTbbL996yJc9xVJt7kXJ4eUm84WOhAOg01S1YBHEP4nIHXdDMnqULUrSWj1TUokZZK+itTMPvV2l130iVmnivlxp9tyIvbXy881pr6Tn2+BIHznIIv4r82F7tndzOEK8cZw/Xf+Qq7h35Wxj+6ZYZxq+ZQIvHOay27uSEUxoK6n8rcIc4vD2MofRUtYGF+Xb0iT1idjF32UUUocj1E36SOvU+CsDR1uSaA+w9aQFA61ZMKLric20WY8NpnBsMdTDjBU91CHekjIjJyAsqscl1BDdVl3OwYKNSaH3FdwVNl0rky6TXPp7Gy3xhqq6Sfg4JlDhsPSDxCJva2PlaC92iZocw+qQUzkCVS1GPMsa6aUzwqoFDrUwMY2IWlLQHwvGFevuLM9r+7sr2hm+OKHXFNteunix9GyQm7sBNr0MYjubkdEYLGdDl9hBf2rzzFpx1mhDMAa6UKyGCdp7v6kMemgtUBGAHDNzfYsCIisGNi6cTrKbE8rtvin4nmtZkRdgo64Mcy5IHN7+VkDWtihgE1DfC7TMlS7Sztg7qn2NHQKG9PjEswilnfe6nlnFbVbmdtKuouTkxePfTU3Z7n0gBH32CDV3TdwiQQ85imUm/dDQZoKx2rESMqtfk2G1e5WpDzgYh34Eqpg9nGuZeQlx6Fpye4d1kWGG4iPboSOJryQ9Hnin58UerWQlgeZ77g1dZgBLWewrmRJpUNrBRGSWwu/Bb8GOUzf5S2LCVhgrw/rhO7epsyNe6uowPfBTY77bHdIbr1TJstgRy4+6jB3zSmsOItt3i3dK2yuKdiL2VY2KL8zibMGtb6Hft3YsQf6lu+LTZXHM8Y4UWJVPHDBkjPcVtpdN2y9DH2RqG0zY24Rf3Fs8BUZI3hLqAG8NHC7NjJ5CH36n2N6Gwt4Mxk9NBrNgwiuQn7vF7ButRcJwdXsQLmutEEQ4MF9JO0Mh8W9SvEfFs6Qc0C8hVuAeJouZRyVA/pgH1S6OLjH2lgMA/l8edN7h+DrPbmmbE5xXzN/gS9q5LeonjE774FxNRLto8Zbn7tY4aj2SqiEpbm7DQeOE4pdVt9W7gZCkz1y6tD8v85iCxY9FX2aBazo5GX8xXNI61ZSNTYMT/K3qQtXHAiKu9cTHmNVp2MTXsdK6DpAxb6H3kn3Azh/ugqd4ghaArhZsMtbrQTmLAXOvlDSrRKgQAdNdsbxmMTA56ufjBJZRos5w73fzeje786Ru5zdx6NloA0IGMP7hlOzV8JZBFTYGt8Vg75YwmpkaiJYt8wR1h35SsjPaxgLJfUZo8z8usw8tVIfvZqMrBfMGkzNu64V7KSbr3g33AYOq0r6vLMt78F8twZucHJ8jrK3WSGmTX2lBEHV9057YK9bSs100ix/NWRUqLYH6xPkXB5EEyfNYSK6cHH5tHqr9RoVUJQfVypizv7VWWETj6ujx9cLV8JUSN0iLOOOdOUeiHiqUo0ydIHxTaeJKtZh6KTa2vBqMeIW3/4l8pRO7+FXtUMzxjb/a5i1p37y5bU0SLZ3Juxd/9Ex1Knf8tu+ho/HdSo0HpQcSlJb5iYOSan+NhoXlHB6Xtq2+RLm92JorBupJCWJVYBZA0L12HS9Q9lAf1bcizZe3u81y6KwSCuO/qqgUBc88vViVjuS68DqTtSMVpCRVAoG8uRd5kDs4j1dMS9eN/c4g9qxWAnlvhkefxr5o4d72KsdJIKbzM05Z+5Wvhr3JPMT9aJ8uZOLRldPphdE4XfiJAnHsZelKLEGKxN3CBiI2bOFPZmfRueyKvwd19V1JM+a+hy71VO78yYswP6DrCXaEkqOsIlfV7son0SgGiwSukcgDi05A0ebXf9A4OzSUPSRhWQG6mvvABy4qXcodB86SOR2mz3fi/++v49h1fN6unNm+PqC5cf8AuRdXi/qXwdeScuUb7C3jf27E81e+lV4m0M6x9obiNZzdblyjX3CpQ3cp98udxpy20e1Fggl5DaeT9OiEeRTaEgo2z0yD3RBDs3SXQdNF/EOBuGJgR10UfjFKxg1ClihYS/xEau0v2VgT8ofeyi9xf95QGAVly2sgVVhoiR4NLBdsD6YqO5bpq5cyhXFl4uS+lHR+5FySeD5f6yjC+lxemiOzWhMvCCif+9GShzMfnyIp3UHg3ReFVtNd4wMKH+oWUxP2UUiydIxsaRhGxa2LbpUjAWqlqhP/O/XuYUmiNMleyJ0ZyvRYuhRYxPD7RNpzUDTGcthV/3dtrR+jhJLUMSfQ1rKDQL4JS3lhIqfz/4lqPS0dcBQwxyTdmb3KKkZt+8FO2ThHX0Cw7EAL6eX63oWaauV+41e/FV21x6G9ZWEDBZwTsLJ/8RHda2jKZesDMsdZytqAV8oTslcxmjkz4HkYDluJcgtsy3fzYQGunE2DZW/lDh7a+UcrQNobFTxfMnzOCLc8tsX6laqDRwcY8ALNAG7Cj243bto6eHSLqpOA+0sroGJHUfZt5LX/rcVj2dZKfjI5TBv0JLFVcG4iAR1rVEWA0e1mZizVDnwrsBtw1CYpXUMXWJGL7H2qU07i9jbcQLPk0TwcQszEbfDcMMML6z9X830PbhM12mdejr7AV0PGsMRMvWvVH8C7DJebvAKLkC664P6kNnDux1udZhFAmdy3ed+TYxcrDbR2x2rMT9c/b23UbRW47TbVdyqbKtPYIEY7s47g1+PD0PUMWmmMLNmyC8tmn1PV0ln0sTrtGGJGEpXdXzKwBPVUIYxeI0KRsc+49f/YF1qeQ+lynj0fwgmaU6MjKl0dJfWeC1AqgLTFAmmM4d8NbBb20ao5MbaZmo7AvRzeEpX5Q2E098Lx773xRXWFyeN4cJSinLZoD0WBBNZrEVDIYlRrLkOr9mGsKl+MHzSENPYZceAbpXkM+lvLw7WywVwfkq6vt80ZsHKyJCfrs2/Puvh/3EC+oXumRNUb3BL9pV0uo9TRfKi7ut1m7TczZ1zM+ip5J0oAylSrnkz4tzK0k1NZuJatD+PXf3Rk+QrJG7BlvRJ3yj5dCg4XPTNp/4addeSIR8lD4cGNWDNZZ5o0keUZKSvW7k3+BCJ15yDn7XnxEcYUA0mraTQC0XXvqP5I2n88A2rF/ZS/BhFnwySd4vhUV4vVCqejdLx1M5x4CufnTIIt+vAT0K3o6sBcMtQ3urSKhDKV9TXI7UOi06iLgH9EafpkMEKwDr1MUr4P7O78N6qYam4e2xYYSINy+rkrU32Q54qqMSKmmWOaxMOxJC8Y0eu1nlrxtkO2rtbqXloDqXRCfaxWVFSda6vIMPtuud3566YEyQE0mSP8MFT2dqBu5PtsBppc4O5OonHqyI/BaRGJzquduffdm5s9UPY6cvGJtq+vUO8BxYe+slRXz5e3GduVrF2wr0oG/sk29jBY4qCMBZypWAY4HlDNBrW8MDjyBKEaNShmXJSnrGAPPGLRYlsaNFoe8gnVTxjyPdL0WBFqKgMHojU0aL/cd64pMnukLXoPAfoX3PjTHkRc+LEDewyyHgTxjYaV+r0ozMHE+3jLWiCi8WVoxVDvNj2x0D0X+fesidHak4F+eRJq84RUDJVH1hFdqvPt/oMecYaoyJfWSX5sL41vQf5F1AQIVdK6Asc+aBjQCwuyzN7YmHCyeeKjPo/IM/6tt58j4tqaJ0MOE4fNMlUKbPAX9PxAZdMJg0wulPaEjnHjw92+5UpEyfWqiWyuzvhgmst/tfqtGlvY9ZSFlHjUR4Je89171x9oQvP8xEPScAZZfPOVn92OHA9p8GoRo+WSb98OHcnpXQqqYu95s6mmy9ItiSXYpmxLuC1MoQUpZ3F9cd/BevHXiv7He9lnhpOIlcOdVhtBJviYmrluUIIsvcwZgGR0LG15L3Bqqwe6+HDd6RnW7uQDUCgnawPf31ci1wzM5vgvk5ZHAy8lEJHRN3kCSwIdMOTCNgIcJmKmMz/Mwp9EtyS6NkRFiMcFvieS30Xev2qcoZroQn00QJnxFoAFKPHRkXABUjyM6t6Zenfp92jxTv2UIcIN5+Mgr78sqZAzioZcBq+/iUkUJ+Nl5bR1+MXrVMe5nO8V7y+Qi0aGCtQnXPsm3RFpNYPP07wzY99PSeSVHBU2yJFgLhMHJmKoP/YkYVO5w0UMT5pXqnUmh5Xb9xdYM1+7zCekNN1Mmffs/tJfVTZb+yRG4QrGIWCpUM6gS7pGskquXWrpfVKYyb+d1dlYvKwu81GGWcutsglhgHS0HLQ/0Jyyb01EJo16z6mkW8OSzEeWKP/3410jHPbGcnGdw722tZszMCJEJZNzV25RTqlhkwczOZzazaHZLkPxgCSHPp0/t2zkfOA9dyxmXu7TFYfNzCBja8qV7CdBs1KFuL3PpXUgvykoBER4gdwOLf8F62vRT9B3aYqrjNyUD8iTF5AevwJ+oDHUxerBgNaEwsEfvMVLmB0JjuccTJHV0qZjydPW1P2hBm9MP56g+4PMOMVmtuyRkm1blw9+4FNUjwnOgkRd+lvgXAkoSNzqvOxh4peFlULt3dj7WQXITu0xnS2aZt4WUkIguv7ijomQ8Py0SyVtdiDljtp3fOzRNfTsGW0gDMiBK05wW9KE0IEJh8hYfnnIkT4Ll4kfX+m3aa8XsKXWXvCmb0PkGivUmRLkQPUQh4RhKp/gBZmJeLDD7SyCLHaMwGNbMnWHowQ6okVSQLNA7RuFuWWYTHKGPfIhzG/zuC8l6pk+Aseb4cwpbzKWS0ohlGBsLTn4ODop6X9mhbteRrl6KrtEU8tIxNX1sm9N0DiLd/WQDMXSbsrpf5NnrTY3xPbqw6Mnx52S8F6N4IiLoEJp7/apO3vfm4CcxsIehAMc/XCShNVY0wSjGOipelrf0vmshar9R3Eu0gDXA0F9ywRyxp9LBBguNUPy6Fn6uCJcbXgoKCZuir0+T6lfO6EOL9wBnJzb+Ky2v2I3/yNc24MF72rzWTbue3/0/Hik3qbTryBF5egqjf69aVjLsKvHI7sawGepllVPgaRDTXtIpDdEdwkSOPmoXnPW+typEafZwVAvnbLMhdwC0j5E41ckA4kdQ/fr9EMKMiE2ACsU97cSvTA3Bry2Fya5SYAwvqxSregHqNd392NRsWzhsUJJLJ8s+ZUi7LDkfIyfqt+gg3u2MKCvED6IHOv2zTiDZyanWO4iaTRlptVZLPqZl1CsCXXr417qGlUZCusQNT/WtIMr+bPddXCKiDGwLs1L0R6tmTZAUdek72PU9BwdluWaDVhZrIXkvRiuanuED7uWYHWBzipmVj3JDCBz9n9/Bgsrm6AL5qt4gCbccp1bVQl6bCWpyWgnI9Q6F9V5qvN5ryr0mDbk9vaUwo73XuZOX5L3FHIhXq/a4wWxVlL8n7UGxPPMKoZd0ZfjObU98jBRL6VzodqVi9XWl9OZsKkiRxFYmpHAr8TL0n7PJzR07354V4aUajTAVeJlr7GAyEbqoG3FNsfaG9nfF00+XsrqexyPEK2bnISZPGwzPn3R50bA0RgInju6PZdiSN12Q2i4hnhbVN4A77rlcCZ7htOMYhyZe957e1fkl+C/JgkMUClQuO6cGHUtJfNko7J61PQED5aFQO0zyZHgXknxROExmAOqNxnuDRTnk0yoNr2mHb7L+WHr5EDEHB17C7e6CroGUh7zDaNhpNB035VV1CmZnsNhe45+PN6HZjDIvZb0AR8qZc89GjZUEs5jhlBUmvnz5BOtrb2ztnbADU3aAAAAAAAAAAAAAAAA=",  // 3776 놀람 "!"                — 실수 발생
  kokoa_think: "data:image/webp;base64,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",     // 3778 골똘(먹구름)            — 우위 점하기
  kokoa_angry: "data:image/webp;base64,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",     // 3784 화남(김)                — 블런더/오답
  kokoa_sleep: "data:image/webp;base64,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",     // 3775 수면 ZZZ                — 대기
};
const HAS_MASCOT_ART = Object.values(MASCOT_ART).some(Boolean);
/* 수 품질·상황 → 마스코트 이모트 */
const Q_MASCOT = { brilliant: ["kokoa", "celebrate"], best: ["milku", "great"], excellent: ["milku", "wink"], good: ["milku", "great"], book: ["milku", "wink"], only: ["milku", "surprise"], pending: ["milku", "think"], inaccuracy: ["kokoa", "think"], mistake: ["kokoa", "surprise"], blunder: ["kokoa", "angry"] };
function mascotForKind(kind) { return Q_MASCOT[kind] || ["milku", "great"]; }

function MascotAvatar({ size = 44, name = "milku" }) {
  const milku = name === "milku";
  const hair = milku ? "#EFE7D8" : "#3A2A1E";
  const skin = "#F3D8B8";
  const jacket = milku ? "#EDE6D8" : "#2A1C12";
  const line = "#2A1A0E";
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" style={{ flexShrink: 0, filter: "drop-shadow(0 3px 4px rgba(0,0,0,.35))" }}>
      <ellipse cx="24" cy="45" rx="12" ry="2.6" fill="rgba(0,0,0,.25)" />
      <path d="M14 44 h20 l-2-9 h-16 z" fill={jacket} stroke={line} strokeWidth="1.1" />
      <path d="M24 35 l-3 9 h6 z" fill={milku ? "#fff" : "#1C120B"} />
      <circle cx="24" cy="20" r="9" fill={skin} stroke={line} strokeWidth="1" />
      <path d="M15 19 c-1-8 5-12 9-12 c4 0 10 4 9 12 c-2-3-4-4-4-4 c-3 2-7 2-10 1 c0 0-2 1-4 3z" fill={hair} stroke={line} strokeWidth="1" />
      <path d="M16 12 l3 3 l3-4 l3 4 l3-3 l1 4 l-14 0z" fill={milku ? "#F4EFE6" : "#C9A23A"} stroke={line} strokeWidth=".9" strokeLinejoin="round" />
      <circle cx="20.5" cy="20.5" r="1.3" fill={line} /><circle cx="27.5" cy="20.5" r="1.3" fill={line} />
      <path d="M21 25 q3 2 6 0" fill="none" stroke={line} strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}
const EMO_FALLBACK = { milku: { happy: "wink", celebrate: "great", angry: "surprise" }, kokoa: { wink: "happy", great: "celebrate", sad: "surprise" } };
function Mascot({ name = "milku", emotion = "great", size = 44, style }) {
  let emo = emotion;
  if (!MASCOT_ART[name + "_" + emo]) emo = (EMO_FALLBACK[name] && EMO_FALLBACK[name][emo]) || (name === "kokoa" ? "happy" : "wink");
  const src = MASCOT_ART[name + "_" + emo] || "";
  if (src) return <img src={src} alt="" style={{ width: size, height: size, objectFit: "contain", flexShrink: 0, filter: "drop-shadow(0 2px 3px rgba(0,0,0,.35))", ...style }} />;
  return <MascotAvatar size={Math.round(size * 0.92)} name={name} />;
}
function MascotBubble({ text, ply, mascot = "milku", emotion = "great" }) {
  const label = mascot === "kokoa" ? "KOKOA" : "MILKU";
  return (
    <div className="flex items-start gap-2" style={{ background: "linear-gradient(180deg,#3A2516,#241509)", borderRadius: 14, padding: "11px 13px", border: "1px solid #000", boxShadow: "inset 0 1px 0 rgba(255,255,255,.05)" }}>
      <Mascot name={mascot} emotion={emotion} size={88} />
      <div style={{ minWidth: 0 }}>
        <div style={{ color: T.brassHi, fontSize: 11, fontWeight: 800, marginBottom: 3 }}>{ply > 0 ? moveNumber(ply - 1) + " 진행 · " + label : label + " 코치"}</div>
        <p style={{ color: T.ivory, fontSize: 12.5, lineHeight: 1.5 }}>{text}</p>
      </div>
    </div>
  );
}

/* ============================================================ 병합 훅 (Lichess 우선 + 사용자 착수 블록 + 백관점 평가) ============================================================ */
function useMergedMoves(sans, engine, liveOn, extraSans, contentVer, mode) {
  const node = snapNode(sans);
  const key = sans.join(" ");
  const ply = sans.length;
  const color = ply % 2 === 0 ? "w" : "b";
  const [moves, setMoves] = useState([]);
  const [posGames, setPosGames] = useState(node ? node.posGames : null);
  const [posEval, setPosEval] = useState(null);
  const [engineNote, setEngineNote] = useState("");
  const [masterEmpty, setMasterEmpty] = useState(false); // 마스터 기보가 실제로 없는 경우(엔진 추천 허용)
  const extraKey = (extraSans || []).join(",");
  const isMaster = mode === "master";

  useEffect(() => {
    let cancelled = false;
    const base = node ? node.moves.map((m) => ({ ...m })) : [];
    const withExtra = (list) => {
      const seen = new Set(list.map((m) => stripSuffix(m.san)));
      addsFor(key).forEach((a) => { if (!seen.has(stripSuffix(a.san))) { list.push({ san: a.san, book: !!a.theory, adopt: null, games: null, dev: true, name: a.name || undefined }); seen.add(stripSuffix(a.san)); } });
      (extraSans || []).forEach((s) => { if (!seen.has(stripSuffix(s))) { list.push({ san: s, book: false, adopt: null, games: null, user: true }); seen.add(stripSuffix(s)); } });
      return list;
    };
    setMoves(withExtra(base.map((m) => ({ ...m })))); setPosGames(node ? node.posGames : null); setPosEval(null); setEngineNote(""); setMasterEmpty(false);
    if (!liveOn) return;
    (async () => {
      try {
        const [nr, mr] = await Promise.allSettled([fetchLichess(sans, false), fetchLichess(sans, true)]);
        const normal = nr.status === "fulfilled" ? nr.value : null;
        const master = mr.status === "fulfilled" ? mr.value : null;
        if (cancelled) return;
        // (기능1) 마스터/일반 통계 반영. 마스터 fetch 실패와 "기보 없음"을 구분.
        let active = null, emptyMaster = false;
        if (isMaster) {
          if (master && master.moves.length) { active = master; }
          else if (master && !master.moves.length) { setPosGames(master.posTotal); setEngineNote("이 포지션의 마스터 기보 없음 · 엔진 추천 수"); emptyMaster = true; }
          else { active = normal; setEngineNote(normal && normal.moves.length ? "마스터 기보 로드 실패 · 일반 통계 표시" : "기보를 불러오지 못했습니다"); }
        } else {
          active = normal || master;
        }
        setMasterEmpty(emptyMaster);
        if (!active || !active.moves.length) { if (emptyMaster) setMoves(withExtra([])); return; }
        setPosGames(active.posTotal);
        const snapBy = Object.fromEntries(base.map((m) => [stripSuffix(m.san), m]));
        const masterAdoptBy = master ? Object.fromEntries(master.moves.map((m) => [stripSuffix(m.san), m.adopt])) : {};
        const masterTopSans = master ? master.moves.slice(0, 3).map((m) => stripSuffix(m.san)) : [];
        const mk = (l) => { const s = snapBy[stripSuffix(l.san)] || {}; const unb = isUnbooked(key, l.san); return { san: l.san, adopt: l.adopt, games: l.games, wdl: l.wdl, book: !unb && (!!l.eco || !!s.book), eco: l.eco || s.eco, name: (l.eco ? l.name : s.name), kw: s.kw, evalCp: s.evalCp, isMain: s.isMain, masterAdopt: masterAdoptBy[stripSuffix(l.san)] ?? null, masterTop: masterTopSans.includes(stripSuffix(l.san)) }; };
        const all = active.moves.map(mk);
        const books = all.filter((m) => m.book);
        const nonbook = all.filter((m) => !m.book);
        // 일반/마스터: 비이론 수를 최대 9개까지 확보(더보기에서 9개까지 노출). 일반은 엔진 effect가 부족분 보충.
        const out = isMaster ? [...books, ...nonbook.slice(0, 9)] : [...books, ...nonbook.slice(0, 9)];
        setMoves(withExtra(out));
      } catch (_) { /* 차단 시 스냅샷 유지 */ }
    })();
    return () => { cancelled = true; };
  }, [key, liveOn, extraKey, contentVer, isMaster]);

  useEffect(() => {
    let cancelled = false;
    if (!liveOn || engine.status !== "ready") return;
    const baseWhite = ply % 2 === 0 ? 1 : -1;
    const childWhite = (ply + 1) % 2 === 0 ? 1 : -1;
    (async () => {
      const be = await engine.evaluate(sansToFen(sans), 16);
      if (cancelled || !be) return;
      setPosEval(be.mate != null ? (be.mate > 0 ? 1000 : -1000) * baseWhite : be.cp * baseWhite);
      // 비이론 수 9개 보장: 엔진 평가 상위 수로 보충.
      let cur = moves;
      const curNonbook = () => cur.filter((m) => !m.book && !m.eco).length;
      if ((!isMaster || masterEmpty) && curNonbook() < 9) {
        const brd = boardFromSans(sans);
        const snapBy = node ? Object.fromEntries(node.moves.map((m) => [m.san, m])) : {};
        const pvs = await engine.evaluateMulti(sansToFen(sans), 13, 10);
        if (!cancelled && pvs && pvs.length) {
          const have = new Set(cur.map((m) => m.san));
          const add = [];
          for (const pv of pvs) {
            const san = uciToSan(brd, pv.uci, ply % 2 === 0 ? "w" : "b");
            if (san && !have.has(san)) { const s = snapBy[san] || {}; add.push({ san, book: !!s.book || !!s.eco, eco: s.eco, name: s.name, evalCp: s.evalCp, adopt: null, games: null, engine: true }); have.add(san); }
            if (curNonbook() + add.filter((a) => !a.book && !a.eco).length >= 9) break;
          }
          if (add.length) { setMoves((prev) => { const have2 = new Set(prev.map((m) => m.san)); const fresh = add.filter((a) => !have2.has(a.san)); return fresh.length ? [...prev, ...fresh] : prev; }); cur = [...cur, ...add]; }
        }
      }
      const list = cur.map((m) => m.san);
      for (const san of list) {
        if (cancelled) break;
        const ev = await engine.evaluate(sansToFen([...sans, san]), 15);
        if (cancelled || !ev) continue;
        const live = ev.mate != null ? { mate: ev.mate * childWhite } : { cp: ev.cp * childWhite };
        setMoves((prev) => prev.map((x) => x.san === san ? { ...x, live } : x));
      }
    })();
    return () => { cancelled = true; };
  }, [key, liveOn, engine.status, moves.length, isMaster, masterEmpty]);

  const fallbackEval = useMemo(() => {
    const whites = moves.map((m) => whiteEval(m)).filter((v) => v != null);
    if (!whites.length) return null;
    return ply % 2 === 0 ? Math.max(...whites) : Math.min(...whites);
  }, [moves, ply]);

  const board = useMemo(() => boardFromSans(sans), [key]);
  const tiled = useMemo(() => {
    const seen = new Set();
    const uniq = moves.filter((m) => { const k = stripSuffix(m.san); if (seen.has(k)) return false; seen.add(k); return true; });
    let t = assignTiers(uniq, ply, board, key).map((m) => {
      const mainMain = isMainline(key, m.san) ? { isMain: true } : {};
      const nm = nameOverride(key, m.san); const kwo = kwOverride(key, m.san);
      return { ...m, ...mainMain, ...(nm !== null ? { name: nm } : {}), ...(kwo ? { kw: kwo } : {}), disp: decorateSan(board, m.san, color) };
    });
    // (UI6) 비이론 수는 둘 차례 관점 평가치가 좋은 순으로 정렬(최선이 항상 맨 위). 평가치 없는 수는 뒤로.
    const ev = (m) => { const v = moverEval(m, ply); return v == null ? -Infinity : v; };
    const books = t.filter((m) => m.book);
    const nonbooks = t.filter((m) => !m.book).sort((a, b) => ev(b) - ev(a));
    return [...books, ...nonbooks];
  }, [moves, ply, board, key, contentVer]);
  return { moves: tiled, posGames, engineNote, posEval: posEval != null ? posEval : fallbackEval, node };
}

/* ============================================================ 집중 학습 모드 ============================================================ */
function AnimatedMove({ sans, san, size = 140, extraArrows = [], loopMs = 2000, flip = false }) {
  const cell = Math.floor(size / 8);
  const before = useMemo(() => boardFromSans(sans), [sans.join(" ")]);
  const color = sans.length % 2 === 0 ? "w" : "b";
  const geo = useMemo(() => sanSrc(before, san, color), [before, san, color]);
  const [cyc, setCyc] = useState(0);     // 재생 사이클
  const [slid, setSlid] = useState(false);
  // 사이클마다: 원위치(전환 없음)로 두고 → 다음 두 프레임 뒤 목표로 슬라이드 → 항상 원좌표에서 시작
  useEffect(() => {
    setSlid(false); let r1 = 0, r2 = 0;
    r1 = requestAnimationFrame(() => { r2 = requestAnimationFrame(() => setSlid(true)); });
    return () => { cancelAnimationFrame(r1); cancelAnimationFrame(r2); };
  }, [cyc, san, sans.join(" ")]);
  useEffect(() => { if (!loopMs) return; const id = setInterval(() => setCyc((c) => c + 1), loopMs); return () => clearInterval(id); }, [loopMs, san, sans.join(" ")]);
  if (!geo || !geo.from) return <Board board={boardFromSans([...sans, san])} flip={flip} size={size} showEval={false} showCoords={false} interactive={false} />;
  const fr = geo.from, to = geo.to; const mp = before[fr[0]][fr[1]];
  const dv = (r, c) => (flip ? [7 - r, 7 - c] : [r, c]);   // 보드좌표 → 표시좌표
  const tx = (vr, vc) => (flip ? [7 - vr, 7 - vc] : [vr, vc]);
  const rows = flip ? [...before].reverse().map((r) => [...r].reverse()) : before;
  const [dfr0, dfr1] = dv(fr[0], fr[1]); const [dto0, dto1] = dv(to[0], to[1]);
  const dx = (dto1 - dfr1) * cell, dy = (dto0 - dfr0) * cell;
  const px = (r, c) => { const [vr, vc] = dv(r, c); return [vc * cell + cell / 2, vr * cell + cell / 2]; };
  return (
    <div>
      <div style={{ width: cell * 8 + 12, maxWidth: "100%", padding: 6, borderRadius: 9, background: "linear-gradient(160deg,#3A2516,#241509)", border: "1px solid #000", margin: "0 auto" }}>
        <div style={{ position: "relative", borderRadius: 3, overflow: "hidden", border: "2px solid " + T.brass }}>
          {rows.map((row, vr) => (
            <div key={vr} style={{ display: "flex" }}>
              {row.map((p, vc) => { const [r, c] = tx(vr, vc); const light = (r + c) % 2 === 0; const hideFrom = r === fr[0] && c === fr[1]; const isTo = r === to[0] && c === to[1];
                return <div key={vc} style={{ width: cell, height: cell, display: "flex", alignItems: "center", justifyContent: "center", background: light ? T.boardLight : T.boardDark, boxShadow: (hideFrom || isTo) ? "inset 0 0 0 2px rgba(62,124,196,.6)" : "none" }}>{p && !hideFrom && <span style={{ fontSize: cell * 0.72, lineHeight: 1, opacity: isTo && slid ? 0 : 1, transform: isTo && slid ? "scale(.55)" : "scale(1)", transition: isTo ? "opacity .4s ease .2s, transform .4s ease .2s" : "none", color: p.c === "w" ? T.ivoryHi : "#0E0907" }}>{PIECE[p.t]}</span>}</div>; })}
            </div>
          ))}
          {mp && <span key={cyc} style={{ position: "absolute", top: dfr0 * cell, left: dfr1 * cell, width: cell, height: cell, display: "flex", alignItems: "center", justifyContent: "center", fontSize: cell * 0.72, lineHeight: 1, color: mp.c === "w" ? T.ivoryHi : "#0E0907", transform: slid ? "translate(" + dx + "px," + dy + "px)" : "translate(0,0)", transition: slid ? "transform .6s cubic-bezier(.4,1.1,.5,1)" : "none", filter: "drop-shadow(0 2px 3px rgba(0,0,0,.5))", zIndex: 5 }}>{PIECE[mp.t]}</span>}
          <svg width={cell * 8} height={cell * 8} style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "visible", opacity: slid ? 1 : 0, transition: "opacity .3s .5s" }}>
            <defs><marker id="dgr" markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="9" refX="8.5" refY="4.5" orient="auto"><path d="M0,0 L9,4.5 L0,9 Z" fill={T.blunder} /></marker><marker id="idea" markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="9" refX="8.5" refY="4.5" orient="auto"><path d="M0,0 L9,4.5 L0,9 Z" fill={T.brass} /></marker></defs>
            {extraArrows.map((a, i) => { const [x1, y1] = px(a.from[0], a.from[1]); const [x2, y2] = px(a.to[0], a.to[1]); return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={a.kind === "danger" ? T.blunder : T.brass} strokeWidth={Math.max(3, cell * 0.1)} strokeLinecap="round" markerEnd={"url(#" + (a.kind === "danger" ? "dgr" : "idea") + ")"} />; })}
          </svg>
        </div>
      </div>
    </div>
  );
}
function brilliantArrows(sans, san) {
  const color = sans.length % 2 === 0 ? "w" : "b"; const enemy = color === "w" ? "b" : "w";
  const before = boardFromSans(sans); const info = sanSrc(before, san, color);
  if (!info || info.castle) return [];
  const after = boardFromSans([...sans, san]); const [tr, tc] = info.to; const out = [];
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) { const p = after[r][c]; if (p && p.c === enemy && canMove(after, p.t, enemy, r, c, tr, tc, true)) out.push({ from: [r, c], to: [tr, tc], kind: "danger" }); }
  const mover = after[tr][tc];
  if (mover) for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) { const t = after[r][c]; if (t && t.c === enemy && t.t !== "P" && canMove(after, mover.t, color, tr, tc, r, c, true)) out.push({ from: [tr, tc], to: [r, c], kind: "idea" }); }
  return out.slice(0, 6);
}

function FocusMode({ sans, san, m, ply, onBack, chesscom, onSavePuzzle, engine, canEdit, canAdd, bumpContent, onJump }) {
  const node = snapNode(sans);
  const title = m.name || (node && node.opening ? node.opening.name : null);
  const kind = m.kind || (m.book ? "book" : "good");
  const evTxt = m.live ? fmtEvalCp(m.live.cp, m.live.mate) : (m.evalCp != null || m.mate != null ? fmtEvalCp(m.evalCp, m.mate) : null);
  const extra = kind === "brilliant" ? brilliantArrows(sans, san) : [];
  const mkKey = sans.join(" ") + "|" + san;
  const ownExplain = CONTENT.explains[mkKey];
  const explain = explainMove(sans, san);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(ownExplain || "");
  const canEditExpl = canEdit || (canAdd && !ownExplain);
  const saveExpl = async () => { CONTENT.explains[mkKey] = draft.trim(); await bumpContent(); setEditing(false); };
  const delExpl = async () => { delete CONTENT.explains[mkKey]; await bumpContent(); setEditing(false); setDraft(""); };
  const isPunishable = ["mistake", "blunder"].includes(kind);
  const curated = isPunishable ? punishFor(sans, san) : null;
  const stats = chesscom && chesscom.status === "ready" ? chesscom.analyze([...sans, san]) : null;
  const [showExpl, setShowExpl] = useState(false);
  // (UI1) 개발자: 수 이름·키워드 편집 + 이론 수에서 삭제
  const editKey = sans.join(" ");
  const [devEdit, setDevEdit] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [kwDraft, setKwDraft] = useState([]);
  const openDevEdit = () => { setNameDraft(nameOverride(editKey, san) ?? (m.name || "")); setKwDraft(kwOverride(editKey, san) || deriveKeywords(m)); setDevEdit(true); };
  const saveMeta = async () => { const k = editKey + "|" + stripSuffix(san); CONTENT.names[k] = nameDraft.trim(); CONTENT.keywords[k] = kwDraft; await bumpContent(); setDevEdit(false); };
  const toggleUnbook = async () => { const k = editKey + "|" + stripSuffix(san); if (CONTENT.unbook[k]) delete CONTENT.unbook[k]; else CONTENT.unbook[k] = true; await bumpContent(); };
  const toggleKw = (kw) => setKwDraft((d) => d.includes(kw) ? d.filter((x) => x !== kw) : [...d, kw]);
  const explainLong = !!explain && explain.length > 90;
  const [mistakes, setMistakes] = useState([]);
  const [analyzing, setAnalyzing] = useState(false);   // (UI8) 실수 분석 진행 표시
  useEffect(() => {
    setMistakes([]); setAnalyzing(false);
    if (!engine || engine.status !== "ready" || !stats || !stats.lines || !stats.lines.length) return;
    let cancelled = false;
    setAnalyzing(true);
    (async () => {
      const base = [...sans, san]; const found = [];
      for (const ln of stats.lines) {
        if (cancelled) return;
        const full = [...base, ...ln.seq];
        let prev = await engine.evaluate(sansToFen(base), 11);
        for (let i = base.length; i < full.length; i++) {
          if (cancelled) return;
          const after = await engine.evaluate(sansToFen(full.slice(0, i + 1)), 11);
          if (!prev || !after) { prev = after; continue; }
          const moverWhite = i % 2 === 0;
          const isUser = (moverWhite && ln.color === "w") || (!moverWhite && ln.color === "b");
          const pcp = prev.mate != null ? (prev.mate > 0 ? 1000 : -1000) : prev.cp;
          const acp = after.mate != null ? (after.mate > 0 ? 1000 : -1000) : after.cp;
          const drop = pcp + acp;   // prev=착수자 POV, after=상대 POV → 착수자 손실 = pcp-(-acp)
          if (isUser && drop >= 100) { found.push({ seq: full.slice(base.length, i + 1), kind: drop >= 250 ? "blunder" : "inaccuracy", count: ln.count, color: ln.color }); break; }
          prev = after;
        }
      }
      if (!cancelled) { found.sort((a, b) => b.count - a.count); setMistakes(found.slice(0, 5)); setAnalyzing(false); }
    })();
    return () => { cancelled = true; setAnalyzing(false); };
  }, [sans.join(" "), san, engine.status, chesscom && chesscom.status, stats && stats.total]);
  useEffect(() => {
    if (!onSavePuzzle) return;
    const id = sans.join(" ") + "|" + san;
    // 실수/블런더 → 실수 응징하기
    if (isPunishable) {
      if (curated) { onSavePuzzle({ id, theme: "punish", name: puzzleName("punish", [...sans], san), opening: curated.opening, setupSans: [...sans], mistakeSan: san, solution: curated.line, steps: curated.steps }); return; }
      if (engine && engine.status === "ready") {
        let cancelled = false;
        genAdvantageLine(engine, [...sans, san], { target: 170 }).then((line) => { if (!cancelled && line.length >= 1) { const op = title || "오프닝"; onSavePuzzle({ id, theme: "punish", name: puzzleName("punish", [...sans], san), opening: op, setupSans: [...sans], mistakeSan: san, solution: line, steps: [], auto: true }); } });
        return () => { cancelled = true; };
      }
      return;
    }
    // 부정확한 수 → 우위 점하기 (실수 응징과 동일 방식)
    if (kind === "inaccuracy" && engine && engine.status === "ready") {
      let cancelled = false;
      genAdvantageLine(engine, [...sans, san], { target: 120 }).then((line) => { if (!cancelled && line.length >= 1) { const op = title || "오프닝"; onSavePuzzle({ id: "adv|" + id, theme: "advantage", name: puzzleName("advantage", [...sans], san), opening: op, setupSans: [...sans], mistakeSan: san, solution: line, steps: [], auto: true }); } });
      return () => { cancelled = true; };
    }
    // 탁월한 수 → 기물 희생하기 (직전 수 애니메이션 후 탁월한 수 + 보상 실현까지 이어지는 라인)
    if (kind === "brilliant" && sans.length >= 1 && engine && engine.status === "ready") {
      const op = title || "오프닝";
      let cancelled = false;
      genAdvantageLine(engine, [...sans, san], { target: 110 }).then((line) => {
        if (!cancelled) onSavePuzzle({ id: "sac|" + id, theme: "sacrifice", name: puzzleName("sacrifice", sans.slice(0, -1), sans[sans.length - 1]), opening: op, setupSans: sans.slice(0, -1), mistakeSan: sans[sans.length - 1], solution: [san, ...line], steps: [], auto: true });
      });
      return () => { cancelled = true; };
    }
  }, [sans.join(" "), san, kind, engine && engine.status]);
  const punish = curated;
  return (
    <div>
      <button onClick={onBack} className="press" style={{ width: 36, height: 36, borderRadius: 10, background: T.ebony2, color: T.ivoryHi, border: "1px solid #000", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", marginBottom: 10 }}><ArrowLeft size={18} /></button>
      {/* 헤더: 아이콘 · 수/이름(크게) · 평가치 */}
      <div className="flex items-center gap-3" style={{ marginBottom: 12 }}>
        <CircleBadge kind={kind} big />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: "ui-monospace,monospace", fontSize: 30, fontWeight: 800, color: T.ivoryHi, lineHeight: 1.05, textShadow: "0 1px 2px rgba(0,0,0,.5)" }}>{moveNumber(ply)}{m.san}</div>
          {title && <div style={{ fontSize: 16, color: T.brassHi, fontWeight: 800, marginTop: 4, lineHeight: 1.25 }}>{title}</div>}
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontFamily: "ui-monospace,monospace", fontSize: 20, fontWeight: 800, color: QCOLOR[kind] }}>{evTxt || (kind === "book" ? "이론" : "—")}</div>
          <div style={{ fontSize: 11, color: QCOLOR[kind], fontWeight: 700 }}>{QLABEL[kind]}</div>
        </div>
      </div>
      {/* 미니보드(좌) + 해설(우) */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flexShrink: 0 }}>
          <AnimatedMove sans={sans} san={san} size={132} extraArrows={extra} />
          {kind === "brilliant" && <p style={{ fontSize: 10, color: T.inkSoft, textAlign: "center", marginTop: 4, lineHeight: 1.4, maxWidth: 150 }}><span style={{ color: T.blunder }}>빨강</span> 잡힐 경로 · <span style={{ color: T.brass }}>금색</span> 노리는 표적</p>}
        </div>
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ background: T.paper, border: "1px solid #DCCBA8", borderRadius: 12, padding: 12, height: "100%" }}>
            <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
              <div className="flex items-center gap-2"><BookOpen size={14} style={{ color: T.brass }} /><span style={{ fontSize: 12.5, fontWeight: 800, color: T.ink }}>해설</span></div>
              {canEditExpl && !editing && <button onClick={() => { setDraft(ownExplain || ""); setEditing(true); }} className="press" style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 7px", borderRadius: 6, border: "1px solid " + T.brass, background: "transparent", color: T.cocoa || "#5A3A22", cursor: "pointer" }}>✎ 편집</button>}
            </div>
            {editing ? (
              <div>
                <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={4} style={{ width: "100%", fontSize: 12, padding: 8, borderRadius: 8, border: "1px solid #C9B58C", background: "#fff", color: T.ink, resize: "vertical" }} />
                <div className="flex gap-2" style={{ marginTop: 6 }}>
                  <button onClick={saveExpl} className="press" style={{ fontSize: 11, fontWeight: 700, padding: "5px 12px", borderRadius: 7, border: "none", background: T.brass, color: "#241509", cursor: "pointer" }}>저장</button>
                  {canEdit && ownExplain && <button onClick={delExpl} className="press" style={{ fontSize: 11, padding: "5px 12px", borderRadius: 7, border: "1px solid " + T.blunder, background: "transparent", color: T.blunder, cursor: "pointer" }}>삭제</button>}
                  <button onClick={() => setEditing(false)} className="press" style={{ fontSize: 11, padding: "5px 12px", borderRadius: 7, border: "1px solid #C9B58C", background: "transparent", color: T.inkSoft, cursor: "pointer" }}>취소</button>
                </div>
              </div>
            ) : <p style={{ fontSize: 12.5, color: T.ink, lineHeight: 1.6 }}>{explain ? (explainLong ? explain.slice(0, 88) + "… " : explain) : (title ? title + " 라인입니다." : "이 수에 대한 해설 데이터가 아직 없습니다.")}{explainLong && <button onClick={() => setShowExpl(true)} className="press" style={{ fontSize: 11.5, fontWeight: 800, color: T.brass, background: "none", border: "none", cursor: "pointer", padding: 0 }}>더보기</button>}</p>}
          </div>
        </div>
      </div>
      {/* 키워드 */}
      <div className="flex flex-wrap gap-1" style={{ marginTop: 12 }}>{deriveKeywords(m).map((k) => KW[k] && <span key={k} style={{ fontSize: 9.5, fontWeight: 800, padding: "2px 6px", borderRadius: 4, background: KW[k].bg, color: KW[k].fg }}>{k}</span>)}</div>
      {(canEdit || canAdd) && (
        <div style={{ background: "linear-gradient(180deg,#3A2516,#241509)", border: "1px solid " + T.brass, borderRadius: 12, padding: 12, marginTop: 12 }}>
          <div className="flex items-center justify-between" style={{ marginBottom: devEdit ? 8 : 0 }}>
            <div className="flex items-center gap-2" style={{ color: T.brassHi, fontWeight: 800, fontSize: 12.5 }}><Crown size={14} /> 개발자 편집</div>
            {!devEdit && <div className="flex gap-2">
              <button onClick={openDevEdit} className="press" style={{ fontSize: 10.5, fontWeight: 700, padding: "3px 9px", borderRadius: 7, border: "1px solid " + T.brass, background: "transparent", color: T.brassHi, cursor: "pointer" }}>이름·키워드 편집</button>
              {canEdit && (m.book || isUnbooked(editKey, san)) && <button onClick={toggleUnbook} className="press" style={{ fontSize: 10.5, fontWeight: 700, padding: "3px 9px", borderRadius: 7, border: "1px solid " + (isUnbooked(editKey, san) ? T.excellent : T.blunder), background: "transparent", color: isUnbooked(editKey, san) ? T.excellent : T.blunder, cursor: "pointer" }}>{isUnbooked(editKey, san) ? "이론 수로 복구" : "이론 수에서 삭제"}</button>}
            </div>}
          </div>
          {devEdit && (
            <div>
              <input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} placeholder="수 이름 (예: 이탈리안 게임)" style={{ width: "100%", fontSize: 12, padding: 8, borderRadius: 8, border: "1px solid #C9B58C", background: "#fff", color: T.ink, marginBottom: 8 }} />
              <div className="flex flex-wrap gap-1" style={{ marginBottom: 8 }}>
                {Object.keys(KW).map((k) => { const on = kwDraft.includes(k); return <button key={k} onClick={() => toggleKw(k)} className="press" style={{ fontSize: 9.5, fontWeight: 800, padding: "3px 7px", borderRadius: 5, border: "1px solid " + (on ? KW[k].fg : "transparent"), background: on ? KW[k].bg : "rgba(255,255,255,.08)", color: on ? KW[k].fg : T.ivory, cursor: "pointer" }}>{k}</button>; })}
              </div>
              <div className="flex gap-2">
                <button onClick={saveMeta} className="press" style={{ fontSize: 11, fontWeight: 700, padding: "5px 12px", borderRadius: 7, border: "none", background: T.brass, color: "#241509", cursor: "pointer" }}>저장</button>
                <button onClick={() => setDevEdit(false)} className="press" style={{ fontSize: 11, padding: "5px 12px", borderRadius: 7, border: "1px solid #C9B58C", background: "transparent", color: T.ivory, cursor: "pointer" }}>취소</button>
              </div>
            </div>
          )}
        </div>
      )}
      {/* 응징 시퀀스(퍼즐) */}
      {punish && (
        <div style={{ background: "linear-gradient(180deg,#3A2516,#241509)", border: "1px solid " + T.brass, borderRadius: 12, padding: 13, marginTop: 12 }}>
          <div className="flex items-center gap-2" style={{ color: T.brassHi, fontWeight: 800, fontSize: 13, marginBottom: 6 }}><Sparkles size={15} /> 응징 시퀀스 · 퍼즐로 저장됨</div>
          <p style={{ color: T.ivory, fontSize: 12.5, lineHeight: 1.55, marginBottom: 8 }}>{punish.why}</p>
          <ol style={{ margin: 0, paddingLeft: 18, color: T.ivory, fontSize: 12.5, lineHeight: 1.7 }}>{punish.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
        </div>
      )}
      {isPunishable && !curated && (
        <div style={{ background: "linear-gradient(180deg,#3A2516,#241509)", border: "1px solid " + T.brass, borderRadius: 12, padding: 12, marginTop: 12, color: T.ivory, fontSize: 12.5 }}>
          <div className="flex items-center gap-2" style={{ color: T.brassHi, fontWeight: 800, marginBottom: 4 }}><Sparkles size={14} /> 퍼즐로 저장됨</div>
          {engine && engine.status === "ready" ? "이 실수를 엔진이 분석해 응징 수순을 퍼즐 탭에 추가했습니다." : "엔진이 준비되면 이 실수의 응징 수순이 퍼즐로 저장됩니다."}
        </div>
      )}
      {/* chess.com 통계 */}
      <div style={{ background: T.paper, border: "1px solid #DCCBA8", borderRadius: 12, padding: 13, marginTop: 12 }}>
        <div className="flex items-center gap-2" style={{ marginBottom: 8 }}><span style={{ fontSize: 12.5, fontWeight: 800, color: T.ink }}>내 chess.com 전적</span></div>
        {!chesscom || chesscom.status === "idle" ? <p style={{ fontSize: 12, color: T.inkSoft }}>설정 탭에서 chess.com 계정을 연동하면 이 수로 진행된 내 실제 대국 통계가 표시됩니다.</p>
          : chesscom.status === "loading" ? <p style={{ fontSize: 12, color: T.inkSoft }}>기보를 불러오는 중…</p>
            : chesscom.status === "error" ? <p style={{ fontSize: 12, color: T.blunder }}>기보를 불러오지 못했습니다. 계정을 확인하세요.</p>
              : !stats ? <p style={{ fontSize: 12, color: T.inkSoft }}>이 수순으로 둔 대국이 없습니다.</p>
                : (
                  <div style={{ fontSize: 12.5, color: T.ink, lineHeight: 1.7 }}>
                    <div><b>{fmtFull(stats.total)} 게임</b> · <span style={{ color: T.best }}>{stats.w}승</span> {stats.d}무 <span style={{ color: T.blunder }}>{stats.l}패</span> · 승률 <b>{stats.winRate}%</b></div>
                    {stats.top.length > 0 && (
                      <div style={{ marginTop: 6 }}>
                        <div style={{ fontWeight: 800, color: T.inkSoft, fontSize: 11.5, marginBottom: 2 }}>자주 둔 다음 수</div>
                        {stats.top.map((t) => (
                          <div key={t.san} style={{ fontFamily: "ui-monospace,monospace", fontSize: 12 }}>{moveNumber(ply + 1)}{t.san}({t.n} 게임) • 총 {t.w}승 {t.d}무 {t.l}패 • 승률 {t.wr}%</div>
                        ))}
                      </div>
                    )}
                    <div style={{ marginTop: 8 }}>
                      <div style={{ fontWeight: 800, color: T.mistake, fontSize: 11.5, marginBottom: 4 }}>오프닝 실수 <span style={{ color: T.inkSoft, fontWeight: 600 }}>(연동 계정이 둔 수만 굵게)</span></div>
                      {analyzing ? (
                        <div className="flex items-center gap-2" style={{ padding: "4px 0" }}>
                          <Mascot name={ply % 2 === 0 ? "milku" : "kokoa"} emotion="think" size={62} />
                          <span style={{ fontSize: 11.5, color: T.inkSoft }}>내 대국 기보를 분석하는 중…</span>
                        </div>
                      ) : mistakes.length === 0 ? <div style={{ fontSize: 11.5, color: T.inkSoft }}>{engine && engine.status === "ready" ? "15수 이내에서 두드러진 실수가 발견되지 않았습니다." : "엔진이 준비되면 분석합니다."}</div>
                        : mistakes.map((mt, idx) => {
                          const seqStr = [san, ...mt.seq]; // 표기: 집중 학습 수부터
                          return (
                            <button key={idx} onClick={() => { const pre = [...sans, san, ...mt.seq.slice(0, -1)]; onJump && onJump(pre, mt.seq[mt.seq.length - 1]); }} className="press text-left" style={{ display: "block", width: "100%", textAlign: "left", fontFamily: "ui-monospace,monospace", fontSize: 12, color: T.ink, background: "none", border: "none", cursor: "pointer", padding: "3px 0", lineHeight: 1.6, whiteSpace: "normal" }}>
                              {seqStr.map((mv, i) => {
                                const isMistake = i === seqStr.length - 1;
                                const moverWhite = (ply + i) % 2 === 0;
                                const isUserMove = (moverWhite && mt.color === "w") || (!moverWhite && mt.color === "b");
                                const num = moveNumber(ply + i);
                                const st = isMistake ? { fontWeight: 900, textDecoration: "underline", color: mt.kind === "blunder" ? T.blunder : T.inaccuracy }
                                  : isUserMove ? { fontWeight: 800, color: T.ink } : { color: T.inkSoft, fontWeight: 500 };
                                return <span key={i} style={st}>{num}{mv} </span>;
                              })}
                              <span style={{ color: T.inkSoft }}>({mt.count}회)</span>
                            </button>
                          );
                        })}
                    </div>
                  </div>
                )}
      </div>
      {showExpl && (
        <div onClick={() => setShowExpl(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 90, display: "flex", alignItems: "center", justifyContent: "center", padding: 18 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420, width: "100%", maxHeight: "80vh", overflowY: "auto", background: "linear-gradient(180deg,#F6EEDD,#E6D6B6)", borderRadius: 16, padding: 20, border: "1px solid #CDB98E", boxShadow: "0 24px 60px -12px rgba(0,0,0,.7)" }}>
            <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
              <div className="flex items-center gap-2"><BookOpen size={16} style={{ color: T.brass }} /><span style={{ fontSize: 14, fontWeight: 800, color: T.ink }}>{moveNumber(ply)}{san} 해설</span></div>
              <button onClick={() => setShowExpl(false)} className="press" style={{ fontSize: 13, fontWeight: 800, color: T.inkSoft, background: "none", border: "none", cursor: "pointer" }}>✕</button>
            </div>
            <p style={{ fontSize: 13.5, color: T.ink, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{explain}</p>
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================================================ 학습 탭 ============================================================ */
function NavBtn({ children, onClick, disabled, active }) {
  return <button onClick={onClick} disabled={disabled} className="press" style={{ width: 40, height: 40, borderRadius: 11, display: "flex", alignItems: "center", justifyContent: "center", background: active ? "linear-gradient(180deg," + T.brass + ",#A8842F)" : "linear-gradient(180deg,#3A2516,#241509)", color: disabled ? "#6A5A45" : T.ivoryHi, border: "1px solid #000", boxShadow: disabled ? "none" : "0 3px 0 #000", cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.55 : 1 }}>{children}</button>;
}
function mascotFor(sans, san) {
  const n = snapNode([...sans, san]); const om = n && n.opening ? n.opening.name : null;
  if (om) return om + " 라인에 들어섰어요. 보드에서 직접 두며 전개를 살펴보세요.";
  return moveNumber(sans.length) + san + " — 보드에서 자유롭게 두며 탐구해 보세요.";
}

function BranchBanner({ sentKey, canEdit, canAdd, bumpContent }) {
  const reason = branchFor(sentKey);
  const own = sentKey in CONTENT.branches;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  useEffect(() => { setEditing(false); }, [sentKey]);
  const save = async () => { CONTENT.branches[sentKey] = draft.trim() || "주요 분기점"; await bumpContent(); setEditing(false); setDraft(""); };
  const remove = async () => { CONTENT.branches[sentKey] = null; await bumpContent(); };
  if (!reason && !editing) {
    if (canEdit || canAdd) return <button onClick={() => { setDraft(""); setEditing(true); }} className="press" style={{ marginBottom: 12, fontSize: 11.5, fontWeight: 700, padding: "6px 12px", borderRadius: 9, border: "1px dashed " + T.brass, background: "transparent", color: T.brassHi, cursor: "pointer" }}>+ 이 위치를 주요 분기점으로 지정</button>;
    return null;
  }
  if (editing) return (
    <div style={{ background: "linear-gradient(180deg,#3A2516,#241509)", borderRadius: 12, padding: 12, border: "1px solid " + T.brass, marginBottom: 12 }}>
      <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} placeholder="분기점 설명" style={{ width: "100%", fontSize: 12, padding: 8, borderRadius: 8, border: "1px solid #C9B58C", background: "#fff", color: T.ink }} />
      <div className="flex gap-2" style={{ marginTop: 6 }}><button onClick={save} className="press" style={{ fontSize: 11, fontWeight: 700, padding: "5px 12px", borderRadius: 7, border: "none", background: T.brass, color: "#241509", cursor: "pointer" }}>저장</button><button onClick={() => setEditing(false)} className="press" style={{ fontSize: 11, padding: "5px 12px", borderRadius: 7, border: "1px solid #C9B58C", background: "transparent", color: T.ivory, cursor: "pointer" }}>취소</button></div>
    </div>
  );
  return (
    <div style={{ background: "linear-gradient(180deg,#3A2516,#241509)", borderRadius: 12, padding: "11px 14px", border: "1px solid " + T.brass, marginBottom: 12 }}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2" style={{ color: T.brassHi, fontSize: 13, fontWeight: 800 }}><Sparkles size={15} /> 주요 분기점</div>
        {canEdit && <div className="flex gap-2"><button onClick={() => { setDraft(reason); setEditing(true); }} className="press" style={{ fontSize: 10.5, padding: "2px 7px", borderRadius: 6, border: "1px solid " + T.brass, background: "transparent", color: T.brassHi, cursor: "pointer" }}>편집</button><button onClick={remove} className="press" style={{ fontSize: 10.5, padding: "2px 7px", borderRadius: 6, border: "1px solid " + T.blunder, background: "transparent", color: T.blunder, cursor: "pointer" }}>해제</button></div>}
      </div>
      <p style={{ color: T.ivory, fontSize: 12.5, marginTop: 5, lineHeight: 1.55 }}>{reason}</p>
    </div>
  );
}
function LearnTab({ engine, liveOn, onFocusActive, unlockOpening, onLearned, chesscom, onSavePuzzle, contentVer, canEdit, canAdd, bumpContent, sans, setSans, future, setFuture, extra, setExtra }) {
  const [flip, setFlip] = useState(false);
  const [boardSize, boardRef] = useBoardSize(360);
  const [sel, setSel] = useState(null);
  const [drag, setDrag] = useState(null);
  const [lastMascot, setLastMascot] = useState(EXPLAIN[""]);
  const [focus, setFocus] = useState(null);
  const [lastQ, setLastQ] = useState(null);
  const [showAllNb, setShowAllNb] = useState(false);   // (UX1) 비이론 수 더보기(최대 9)
  const key = sans.join(" ");
  const board = useMemo(() => boardFromSans(sans), [key]);
  const color = sans.length % 2 === 0 ? "w" : "b";
  const ply = sans.length;
  const ep = useMemo(() => epTarget(sans), [key]);
  const [mode, setMode] = useState("normal");
  const { moves, posGames, engineNote, posEval } = useMergedMoves(sans, engine, liveOn, extra[key], contentVer, mode);
  useEffect(() => { onFocusActive && onFocusActive(!!focus); }, [focus]);
  useEffect(() => { setShowAllNb(false); }, [key]);   // (UX1) 위치가 바뀌면 더보기 접기
  // 각 단계에서 탁월한 수→기물 희생, 부정확한 수→우위 점하기, 실수/블런더→실수 응징 퍼즐 자동 생성
  const autoRef = useRef(new Set());
  useEffect(() => {
    if (!liveOn || engine.status !== "ready" || autoRef.current.has(key)) return;
    const brilliants = moves.filter((m) => m.kind === "brilliant");
    const inacc = moves.filter((m) => m.kind === "inaccuracy");
    const bad = moves.filter((m) => m.kind === "mistake" || m.kind === "blunder");
    if (!brilliants.length && !inacc.length && !bad.length) return;
    autoRef.current.add(key);
    let cancelled = false;
    // (기물 희생하기) 탁월한 수: 직전 수를 애니메이션으로 보여주고 그 포지션에서 탁월한 수를 찾게 함
    if (brilliants.length && sans.length >= 1) {
      const b = brilliants[0];
      const op = b.name || (snapNode([...sans, b.san]) || {}).opening?.name || "오프닝";
      genAdvantageLine(engine, [...sans, b.san], { target: 110 }).then((line) => {
        if (cancelled) return;
        onSavePuzzle({ id: "sac|" + key + "|" + stripSuffix(b.san), theme: "sacrifice", name: puzzleName("sacrifice", sans.slice(0, -1), sans[sans.length - 1]), opening: op, setupSans: sans.slice(0, -1), mistakeSan: sans[sans.length - 1], solution: [b.san, ...line], steps: [], auto: true });
      });
    }
    // (우위 점하기) 부정확한 수: 실수 응징과 같은 방식으로 우위 점하는 수순 생성
    if (inacc.length) {
      const pick = inacc[Math.floor(Math.random() * inacc.length)];
      genAdvantageLine(engine, [...sans, pick.san], { target: 120 }).then((line) => {
        if (cancelled || line.length < 1) return;
        const op = pick.name || (snapNode([...sans, pick.san]) || {}).opening?.name || "오프닝";
        onSavePuzzle({ id: "adv|" + key + "|" + stripSuffix(pick.san), theme: "advantage", name: puzzleName("advantage", [...sans], pick.san), opening: op, setupSans: [...sans], mistakeSan: pick.san, solution: line, steps: [], auto: true });
      });
    }
    // (실수 응징하기) 실수/블런더
    if (bad.length) {
      const pick = bad[Math.floor(Math.random() * bad.length)];
      genAdvantageLine(engine, [...sans, pick.san], { target: 170 }).then((line) => {
        if (cancelled || line.length < 1) return;
        const op = pick.name || (snapNode([...sans, pick.san]) || {}).opening?.name || "오프닝";
        onSavePuzzle({ id: key + "|" + pick.san, theme: "punish", name: puzzleName("punish", [...sans], pick.san), opening: op, setupSans: [...sans], mistakeSan: pick.san, solution: line, steps: [], auto: true });
      });
    }
    return () => { cancelled = true; };
  }, [key, moves, engine.status, liveOn]);

  const arrows = useMemo(() => moves.filter((m) => m.book).map((m) => { const info = sanSrc(board, m.san, color); return info && info.from ? { from: info.from, to: info.to, adopt: m.adopt } : null; }).filter(Boolean), [moves, board, color]);
  const legalTargets = useMemo(() => sel ? legalDests(board, sel[0], sel[1], color, ep) : [], [sel, board, color, ep]);

  // 수를 두면 항상 도착 칸에 수 체계 아이콘을 띄운다(블록에 없거나 아직 미평가면 우선 '분석 중', 엔진으로 갱신)
  const evalMoveKind = useCallback(async (prevSans, san) => {
    if (!liveOn || engine.status !== "ready") return null;
    const best = await engine.evaluate(sansToFen(prevSans), 13);
    const after = await engine.evaluate(sansToFen([...prevSans, san]), 13);
    if (!best || !after) return null;
    const bestCp = best.mate != null ? (best.mate > 0 ? 1e5 : -1e5) : best.cp;     // 둘 차례(=우리) 관점 최선
    const afterOpp = after.mate != null ? (after.mate > 0 ? 1e5 : -1e5) : after.cp; // 상대 관점
    const ourCp = -afterOpp;
    const loss = bestCp - ourCp;
    let kind = tierOf(loss);
    const mw = prevSans.length % 2 === 0; const col = mw ? "w" : "b";
    if (["best", "excellent", "good"].includes(kind) && isSacrifice(boardFromSans(prevSans), san, col) && ourCp >= -40) kind = "brilliant";
    return kind;
  }, [liveOn, engine.status]);

  const stampQ = useCallback((prevSans, brd, col, san, mm) => {
    const src = sanSrc(brd, san, col); const to = src && src.to ? src.to : null;
    if (!to) { setLastQ(null); return; }
    const known = !!mm && mm.kind && mm.kind !== "pending";
    setLastQ({ to, kind: known ? mm.kind : "pending" });
    if (!known) evalMoveKind(prevSans, san).then((k) => { if (k) setLastQ((q) => (q && q.to && q.to[0] === to[0] && q.to[1] === to[1]) ? { ...q, kind: k } : q); });
  }, [evalMoveKind]);

  // (수 아이콘 지속 + UI5 정확도) 현재 포지션에 도달한 '마지막 수'의 품질을 항상 재계산.
  // 되돌리기/앞으로 등 어떤 방식으로 도달하든 보드 도착칸 아이콘과 헤더 수 체계가 정확히 표시되도록 엔진으로 티어를 다시 평가한다.
  useEffect(() => {
    if (!sans.length) { setLastQ(null); return; }
    const prev = sans.slice(0, -1);
    const lastSan = sans[sans.length - 1];
    const brd = boardFromSans(prev);
    const col = prev.length % 2 === 0 ? "w" : "b";
    const src = sanSrc(brd, lastSan, col);
    const to = src && src.to ? src.to : null;
    if (!to) { setLastQ(null); return; }
    const pnode = snapNode(prev);
    const sm = pnode ? pnode.moves.find((m) => stripSuffix(m.san) === stripSuffix(lastSan)) : null;
    if (sm && sm.book) { setLastQ({ to, kind: "book" }); return; } // 이론 수는 항상 책 아이콘(평가치 아이콘으로 덮어쓰지 않음)
    setLastQ({ to, kind: "pending" });
    let cancelled = false;
    if (liveOn && engine.status === "ready") {
      evalMoveKind(prev, lastSan).then((k) => { if (!cancelled && k) setLastQ((q) => (q && q.to && q.to[0] === to[0] && q.to[1] === to[1]) ? { ...q, kind: k } : q); });
    }
    return () => { cancelled = true; };
  }, [key, liveOn, engine.status]);

  const go = useCallback((san, isExtra) => {
    if (isExtra) setExtra((prev) => { const cur = prev[key] || []; if (cur.includes(san)) return prev; return { ...prev, [key]: [...cur, san] }; });
    const mm = moves.find((x) => stripSuffix(x.san) === stripSuffix(san));
    stampQ(sans, board, color, san, mm);
    const next = [...sans, san]; setSans(next); setFuture([]); setSel(null); setDrag(null);
    setLastMascot(mascotFor(sans, san));
  }, [sans, key, moves, board, color, stampQ]);

  const tryMove = useCallback((from, to) => {
    if (from[0] === to[0] && from[1] === to[1]) return false;
    if (!legalDests(board, from[0], from[1], color, ep).some(([r, c]) => r === to[0] && c === to[1])) return false;
    const san = buildSan(board, from[0], from[1], to[0], to[1], color, ep);
    if (!san) return false;
    const mm = moves.find((x) => stripSuffix(x.san) === stripSuffix(san));
    if (mm) go(mm.san, false); else go(san, true);   // 블록에 있으면 표준 SAN으로, 없으면 사용자 수 블록 생성
    return true;
  }, [board, color, go, moves, ep]);

  const onSquareClick = useCallback((sq) => {
    const p = board[sq[0]][sq[1]];
    if (sel) { if (tryMove(sel, sq)) return; if (p && p.c === color) { setSel(sq); return; } setSel(null); return; }
    if (p && p.c === color) setSel(sq);
  }, [sel, board, color, tryMove]);
  const onPieceDrag = useCallback((sq) => { const p = board[sq[0]][sq[1]]; if (p && p.c === color) { setDrag(sq); setSel(sq); } }, [board, color]);
  const onDrop = useCallback((sq) => { if (drag) { tryMove(drag, sq); setDrag(null); setSel(null); } }, [drag, tryMove]);

  const back = () => {
    if (!sans.length) return;
    const last = sans[sans.length - 1]; const pkey = sans.slice(0, -1).join(" ");
    setExtra((prev) => { if (prev[pkey] && prev[pkey].includes(last)) { const arr = prev[pkey].filter((x) => x !== last); const n = { ...prev }; if (arr.length) n[pkey] = arr; else delete n[pkey]; return n; } return prev; });
    setFuture((f) => [last, ...f]); setSans(sans.slice(0, -1)); setSel(null); setLastQ(null);
  };
  const fwd = () => {
    if (!future.length) return; const h = future[0];
    const mm = moves.find((x) => stripSuffix(x.san) === stripSuffix(h));
    stampQ(sans, board, color, h, mm);
    setSans([...sans, h]); setFuture(future.slice(1)); setSel(null);
  };
  const reset = () => { setSans([]); setFuture([]); setSel(null); setLastQ(null); };

  const enterFocus = (m) => {
    const childKey = [...sans, m.san].join(" ");
    const name = m.name || (snapNode([...sans, m.san]) || {}).opening?.name || m.san;
    const isNew = m.book ? unlockOpening(childKey, name) : false;   // (UX2) 비이론 수는 도감 해금/알림 없음
    setFocus({ sans: [...sans], san: m.san, m, ply, isNew, name });
  };
  const exitFocus = () => { if (focus && focus.isNew) onLearned(focus.name); setFocus(null); };
  const enterFocusAt = (tSans, tSan) => {
    const node2 = snapNode([...tSans, tSan]);
    const name = (node2 && node2.opening) ? node2.opening.name : tSan;
    unlockOpening([...tSans, tSan].join(" "), name);
    setFocus({ sans: [...tSans], san: tSan, m: { san: tSan }, ply: tSans.length, isNew: false, name });
  };

  const node = snapNode(sans);
  const openingName = node && node.opening ? node.opening.name : null;
  const stageTitle = ply === 0 ? "1수 · 백의 첫 수" : (openingName || moveNumber(ply) + " 차례");

  // (UI5) 헤더 블록에 현재 수(직전에 두어진 수) 정보 표기
  const lastSan = sans.length ? sans[sans.length - 1] : null;
  const parentKey = sans.length ? sans.slice(0, -1).join(" ") : "";
  const parentNode = sans.length ? snapNode(sans.slice(0, -1)) : null;
  const curMove = (parentNode && lastSan) ? parentNode.moves.find((mm) => stripSuffix(mm.san) === stripSuffix(lastSan)) : null;
  const curName = (nameOverride(parentKey, lastSan) ?? (curMove ? curMove.name : null));
  const curKind = (lastQ && lastQ.kind && lastQ.kind !== "pending") ? lastQ.kind : (curMove ? (curMove.book ? "book" : "good") : null);
  const curKws = (curMove && curMove.book) ? deriveKeywords(curMove) : (kwOverride(parentKey, lastSan) || []);   // 비이론 수는 개발자 키워드만
  const curGames = curMove && curMove.games != null ? curMove.games : null;

  if (focus) return (
    <FocusMode sans={focus.sans} san={focus.san} m={focus.m} ply={focus.ply} onBack={exitFocus} chesscom={chesscom} onSavePuzzle={onSavePuzzle} engine={engine} canEdit={canEdit} canAdd={canAdd} bumpContent={bumpContent} onJump={enterFocusAt} />
  );

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div>
        <div style={{ background: "linear-gradient(160deg,#2E1B10,#1B0F07)", borderRadius: 14, padding: 14, border: "1px solid #000", boxShadow: "inset 0 1px 0 rgba(255,255,255,.05)" }}>
          <div className="mb-3 flex items-center justify-between gap-2">
            <SequenceBar sans={sans} />
            <span className="inline-flex items-center gap-1" style={{ fontSize: 10, color: liveOn ? T.brassHi : T.inkSoft, whiteSpace: "nowrap" }}>{liveOn ? <Wifi size={12} /> : <WifiOff size={12} />}{engineNote || (liveOn ? "라이브" : "스냅샷")}</span>
          </div>
          <div ref={boardRef} style={{ width: "100%", maxWidth: 360, margin: "0 auto" }}>
            <Board board={board} flip={flip} size={boardSize} arrows={arrows} legalTargets={legalTargets} selected={sel} onSquareClick={!focus ? onSquareClick : undefined} onPieceDrag={!focus ? onPieceDrag : undefined} onDrop={!focus ? onDrop : undefined} onMove={!focus ? tryMove : undefined} evalCp={posEval} interactive={!focus} lastQ={lastQ} />
          </div>
          <div className="flex items-center mt-3" style={{ gap: 10, justifyContent: "center" }}>
            <NavBtn onClick={() => setFlip((v) => !v)} active={flip}><ArrowUpDown size={17} /></NavBtn>
            <NavBtn onClick={reset} disabled={!sans.length}><ChevronsLeft size={17} /></NavBtn>
            <NavBtn onClick={back} disabled={!sans.length}><ChevronLeft size={17} /></NavBtn>
            <NavBtn onClick={fwd} disabled={!future.length}><ChevronRight size={17} /></NavBtn>
          </div>
        </div>
      </div>
      <div>
        <div>
            {/* (UI2) 코치 말풍선 — 주요 분기점 블록을 대체. 라운딩·크기 유지 */}
            <div style={{ position: "relative", background: T.paper, borderRadius: 12, padding: "12px 14px", border: "1px solid #DCCBA8", marginBottom: 16, boxShadow: "0 3px 0 #D7C19A" }}>
              <p style={{ fontSize: 12.5, color: T.ink, lineHeight: 1.6, margin: 0 }}>{branchFor(key) || lastMascot}</p>
              <span style={{ position: "absolute", bottom: -7, right: 30, width: 13, height: 13, background: T.paper, borderRight: "1px solid #DCCBA8", borderBottom: "1px solid #DCCBA8", transform: "rotate(45deg)" }} />
            </div>
            {(canEdit || canAdd) && <BranchBanner sentKey={key} canEdit={canEdit} canAdd={canAdd} bumpContent={bumpContent} />}
            {/* 헤더(현재 수) 블록 — 마스코트 우상단 + 학습 버튼 */}
            <div style={{ position: "relative", background: T.paper, borderRadius: 12, padding: "14px 16px", border: "1px solid #DCCBA8", marginBottom: 14, boxShadow: "0 3px 0 #D7C19A" }}>
              <div style={{ position: "absolute", top: 6, right: 10 }}><Mascot name={ply % 2 === 0 ? "milku" : "kokoa"} emotion={(lastQ && lastQ.kind ? mascotForKind(lastQ.kind) : ["milku", "wink"])[1]} size={58} /></div>
              <div className="flex items-center gap-2" style={{ paddingRight: 64 }}><Sparkles size={15} style={{ color: T.brass }} /><h2 style={{ fontSize: 15, fontWeight: 800, color: T.ink }}>{stageTitle}</h2></div>
              <div style={{ fontSize: 11, color: T.inkSoft, fontFamily: "ui-monospace,monospace", marginTop: 6 }}>{fmtFull(posGames)}</div>
              {lastSan && (
                <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid #E4D5B6" }}>
                  <div className="flex items-center flex-wrap" style={{ gap: 10 }}>
                    {curKind && QCOLOR[curKind] && <CircleBadge kind={curKind} />}
                    <span style={{ fontSize: 16, fontWeight: 800, color: T.ink }}>{moveNumber(ply - 1)}{lastSan}</span>
                    {curName && <span style={{ fontSize: 12.5, fontWeight: 600, color: T.ink, wordBreak: "keep-all" }}>{curName}</span>}
                    <button onClick={() => enterFocusAt(sans.slice(0, -1), lastSan)} className="press" style={{ marginLeft: "auto", flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 4, padding: "5px 11px", borderRadius: 8, background: T.ebony2, color: T.brassHi, fontSize: 11, fontWeight: 800, border: "1px solid #000", cursor: "pointer" }}><Play size={11} /> 학습</button>
                  </div>
                  <div className="flex items-center flex-wrap" style={{ gap: 16, marginTop: 10 }}>
                    {curKind && <span style={{ fontSize: 12, fontWeight: 800, color: QCOLOR[curKind] || T.inkSoft }}>{QLABEL[curKind]}</span>}
                    {curGames != null && <span style={{ fontSize: 11.5, color: T.inkSoft, fontFamily: "ui-monospace,monospace" }}>{fmtFull(curGames)}회 진행</span>}
                  </div>
                  {curKws.length > 0 && (
                    <div className="flex flex-wrap" style={{ gap: 6, marginTop: 10 }}>
                      {curKws.map((k) => KW[k] && <span key={k} title={KW[k].desc} style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: ".04em", padding: "2px 7px", borderRadius: 4, background: KW[k].bg, color: KW[k].fg }}>{k}</span>)}
                    </div>
                  )}
                </div>
              )}
              {explainFor(sans) && <p style={{ color: T.inkSoft, fontSize: 12, marginTop: 12, lineHeight: 1.6 }}>{explainFor(sans)}</p>}
            </div>
            {moves.length === 0 ? (
              <div style={{ background: T.paper, borderRadius: 12, padding: 16, border: "1px dashed #C9B58C", textAlign: "center" }}>
                <div style={{ display: "flex", justifyContent: "center" }}><Mascot name="milku" emotion="sleep" size={92} /></div>
                <p style={{ fontSize: 13, color: T.inkSoft, marginTop: 8 }}>제안된 수가 없어요. 보드에서 직접 두면 그 수가 평가되어 블록으로 추가됩니다.</p>
              </div>
            ) : (() => {
              const bk = moves.filter((m) => m.book);
              const nb = moves.filter((m) => !m.book);
              const shownNb = (showAllNb ? nb.slice(0, 9) : nb.slice(0, 3));
              const shown = [...bk, ...shownNb];
              return (
                <>
                  {shown.map((m) => <MoveTile key={m.san} m={m} ply={ply} posGames={posGames} onClick={() => go(m.san, false)} onFocus={() => enterFocus(m)} />)}
                  {nb.length > 3 && (
                    <button onClick={() => setShowAllNb((v) => !v)} className="press" style={{ width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "8px 0", borderRadius: 10, border: "1px dashed " + T.brass, background: "transparent", color: T.brassHi, fontSize: 12, fontWeight: 800, cursor: "pointer" }}>
                      <ChevronRight size={14} style={{ transform: showAllNb ? "rotate(-90deg)" : "rotate(90deg)", transition: "transform .15s" }} />
                      {showAllNb ? "접기" : "더보기"}
                    </button>
                  )}
                </>
              );
            })()}
          </div>
      </div>
    </div>
  );
}

/* ============================================================ 도감 탭 ============================================================ */
function WinBar({ wdl, height = 8 }) {
  if (!wdl) return null;
  const tot = wdl.w + wdl.d + wdl.b; if (!tot) return null;
  const w = Math.round(100 * wdl.w / tot), d = Math.round(100 * wdl.d / tot), b = 100 - w - d;
  return (
    <div>
      <div style={{ display: "flex", height, borderRadius: 4, overflow: "hidden", border: "1px solid rgba(0,0,0,.25)" }}>
        <div style={{ width: w + "%", background: T.ivoryHi }} />
        <div style={{ width: d + "%", background: "#9C8A6A" }} />
        <div style={{ width: b + "%", background: "#241509" }} />
      </div>
      <div className="flex justify-between" style={{ fontSize: 9.5, color: T.inkSoft, marginTop: 2, fontFamily: "ui-monospace,monospace" }}><span>백 {w}%</span><span>무 {d}%</span><span>흑 {b}%</span></div>
    </div>
  );
}
function DexMoveCard({ path, m, child, isUnlocked, hasChildren, wdl, cc, onOpen }) {
  const label = m.name || (child && child.opening ? child.opening.name : null) || (m.isMain ? "Main Line" : null);
  const childSans = [...path, m.san];
  return (
    <div style={{ borderRadius: 16, padding: 12, background: isUnlocked ? "linear-gradient(180deg,#FBF5E8,#E2D2B2)" : "linear-gradient(180deg,#33261A,#221610)", boxShadow: isUnlocked ? "0 5px 0 #B59A6E, 0 10px 18px -10px rgba(0,0,0,.5)" : "inset 0 1px 0 rgba(255,255,255,.05)", border: "1px solid " + (isUnlocked ? "#CDB98E" : "#000") }}>
      <div style={{ position: "relative" }}>
        {isUnlocked ? <AnimatedMove sans={path} san={m.san} size={150} />
          : <div style={{ width: 150 + 12, height: 150 + 12, margin: "0 auto", borderRadius: 9, background: "repeating-linear-gradient(45deg,#2A1B10,#2A1B10 8px,#33261A 8px,#33261A 16px)", display: "flex", alignItems: "center", justifyContent: "center" }}><Lock size={28} style={{ color: T.brass }} /></div>}
      </div>
      <div className="flex items-center justify-between" style={{ marginTop: 10 }}>
        <span style={{ fontFamily: "ui-monospace,monospace", fontWeight: 800, fontSize: 17, color: isUnlocked ? T.ink : "#8A7458" }}>{moveNumber(path.length)}{m.san}</span>
        {isUnlocked ? <span style={{ display: "inline-flex", alignItems: "center", gap: 3, color: T.best, fontSize: 11.5, fontWeight: 800 }}><Check size={15} /> 학습함</span> : <span style={{ fontSize: 11, color: "#8A7458", fontWeight: 700 }}>미해금</span>}
      </div>
      {isUnlocked && label && <div style={{ fontSize: 12.5, fontWeight: 700, color: T.ink, marginTop: 3, wordBreak: "keep-all" }}>{label}</div>}
      {isUnlocked && wdl && <div style={{ marginTop: 8 }}><WinBar wdl={wdl} /></div>}
      {isUnlocked && cc && cc.total > 0 && (
        <div className="flex items-center justify-between" style={{ marginTop: 8, fontSize: 10.5, fontFamily: "ui-monospace,monospace", color: T.inkSoft, background: "rgba(60,138,60,.12)", border: "1px solid rgba(60,138,60,.3)", borderRadius: 7, padding: "4px 7px" }}>
          <span style={{ fontWeight: 800, color: "#2E6E2E" }}>내 승률 {cc.winRate}%</span>
          <span><span style={{ color: T.best }}>{cc.w}승</span> {cc.d}무 <span style={{ color: T.blunder }}>{cc.l}패</span> · {fmtFull(cc.total)}판</span>
        </div>
      )}
      <button onClick={onOpen} disabled={!hasChildren} className="press" style={{ marginTop: 10, width: "100%", padding: "8px 0", borderRadius: 9, border: "none", cursor: hasChildren ? "pointer" : "default", background: hasChildren ? "linear-gradient(180deg,#3A2516,#241509)" : "rgba(0,0,0,.12)", color: hasChildren ? T.brassHi : (isUnlocked ? "#A8906A" : "#5E4E38"), fontWeight: 700, fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
        {hasChildren ? <>다음 수 살펴보기 <ChevronRight size={14} /></> : "마지막 수록 수"}
      </button>
    </div>
  );
}
function CollectionTab({ unlocked, unlockAll, liveOn, contentVer, chesscom, earnedTitles, titleCounts, currentTitle, onEquipTitle }) {
  const [path, setPath] = useState([]);
  const [lc, setLc] = useState(null);
  const [dexView, setDexView] = useState("openings"); // (기능4) 오프닝 / 칭호
  const ccReady = chesscom && chesscom.status === "ready";
  const node = snapNode(path);
  const baseMoves = node ? node.moves.slice() : (SNAP.tree[""] ? SNAP.tree[""].moves.slice() : []);
  addsFor(path.join(" ")).forEach((a) => { if (!baseMoves.some((x) => x.san === a.san)) baseMoves.push({ san: a.san }); });
  const opening = node && node.opening ? node.opening : null;
  const key = path.join(" ");
  useEffect(() => { let cc = false; setLc(null); if (!liveOn) return; fetchLichess(path).then((r) => { if (!cc) setLc(r); }).catch(() => {}); return () => { cc = true; }; }, [key, liveOn]);
  const wdlFor = (san) => { if (!lc) return null; const mm = lc.moves.find((x) => x.san === san); return mm ? mm.wdl : null; };
  const crumb = ["오프닝", ...path.map((s, i) => moveNumber(i) + s)];
  const earned = earnedTitles || new Set();
  return (
    <div>
      <div className="flex items-center gap-2" style={{ marginBottom: 14 }}>
        {[["openings", "오프닝"], ["titles", "칭호"]].map(([k, lb]) => { const on = dexView === k; return (
          <button key={k} onClick={() => setDexView(k)} className="press" style={{ fontSize: 13, fontWeight: 800, padding: "7px 16px", borderRadius: 999, border: "1px solid " + (on ? T.brass : "#5A4630"), background: on ? "linear-gradient(180deg," + T.brass + ",#A8842F)" : "transparent", color: on ? "#241509" : T.brassHi, cursor: "pointer" }}>{lb}</button>
        ); })}
      </div>
      {dexView === "titles" ? (
        <div>
          <p style={{ fontSize: 12.5, color: T.inkSoft, margin: "0 0 14px", lineHeight: 1.6 }}>여섯 오프닝의 하위 퍼즐을 해결하면 등급별 칭호를 영구히 획득합니다. 획득한 칭호는 ‘장착’해 현재 칭호로 설정할 수 있어요.</p>
          {currentTitle && earned.has(currentTitle) && (
            <div style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: T.brassHi, marginBottom: 8 }}>현재 칭호</div>
              <TitleBadge id={currentTitle} earned equipped onEquip={onEquipTitle} />
            </div>
          )}
          {TITLE_OPENINGS.map((fam) => {
            const n = (titleCounts && titleCounts[fam.key]) || 0;
            return (
              <div key={fam.key} style={{ marginBottom: 18 }}>
                <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 800, color: T.ivoryHi }}>{fam.label}</span>
                  <span style={{ fontSize: 11, color: T.inkSoft, fontFamily: "ui-monospace,monospace" }}>{fmtFull(n)}회 해결</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {TITLE_TIERS.map((t) => { const id = titleId(fam.key, t.rank); return (
                    <TitleBadge key={id} id={id} earned={earned.has(id)} equipped={currentTitle === id} progress={n} onEquip={onEquipTitle} />
                  ); })}
                </div>
              </div>
            );
          })}
        </div>
      ) : (<>
      <div className="flex items-center flex-wrap gap-1" style={{ marginBottom: 14, fontSize: 13 }}>
        {crumb.map((c, i) => <span key={i} className="inline-flex items-center">{i > 0 && <Crumb size={13} style={{ color: T.inkSoft, margin: "0 2px" }} />}<button onClick={() => setPath(path.slice(0, i))} className="press" style={{ color: i === crumb.length - 1 ? T.brass : T.inkSoft, fontWeight: i === crumb.length - 1 ? 800 : 600, fontFamily: i ? "ui-monospace,monospace" : "inherit", background: "none", border: "none", cursor: "pointer" }}>{c}</button></span>)}
      </div>
      {opening && <div className="flex items-center gap-3 flex-wrap" style={{ background: "linear-gradient(135deg,#3A2516,#241509)", border: "1px solid " + T.brass, borderRadius: 14, padding: "12px 16px", marginBottom: 14 }}>
        <Mascot name="kokoa" emotion="happy" size={70} />
        <div><div style={{ fontSize: 16, fontWeight: 800, color: T.ivoryHi }}>{opening.name}</div><div style={{ fontSize: 12, color: T.brassHi, fontFamily: "ui-monospace,monospace" }}>{opening.eco}</div></div>
        {lc && lc.wdl && <div style={{ marginLeft: "auto", width: 150 }}><WinBar wdl={lc.wdl} /></div>}
        {ccReady && (() => { const cc = chesscom.analyze(path); return cc && cc.total > 0 ? <div style={{ fontSize: 11.5, fontFamily: "ui-monospace,monospace", color: T.ivory, background: "rgba(60,138,60,.25)", border: "1px solid rgba(120,200,120,.4)", borderRadius: 8, padding: "5px 9px" }}>내 chess.com 승률 <b style={{ color: "#9FE39F" }}>{cc.winRate}%</b> · {cc.w}/{cc.d}/{cc.l}</div> : null; })()}
      </div>}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {baseMoves.map((m) => {
          const childSans = [...path, m.san]; const child = snapNode(childSans);
          const hasChildren = (child && child.moves && child.moves.length > 0) || addsFor(childSans.join(" ")).length > 0;
          const isUnlocked = unlockAll || unlocked.has(childSans.join(" "));
          const cc = ccReady ? chesscom.analyze(childSans) : null;
          return <DexMoveCard key={m.san} path={path} m={m} child={child} isUnlocked={isUnlocked} hasChildren={hasChildren} wdl={wdlFor(m.san)} cc={cc} onOpen={() => hasChildren && setPath(childSans)} />;
        })}
      </div>
      </>)}
    </div>
  );
}

/* ============================================================ 퍼즐 탭 ============================================================ */
const PIECE_KOR = { K: "킹", Q: "퀸", R: "룩", B: "비숍", N: "나이트", P: "폰" };
const THEME_LABEL = { sacrifice: "기물 희생하기", advantage: "우위 점하기", punish: "실수 응징하기" };
// (UI4) 퍼즐 이름 규칙: 직전 수들 중 '가장 마지막으로 이름이 있는 수'의 오프닝 이름을 기준으로 짓는다.
function lastNamedOpening(sans) {
  let nm = null;
  for (let i = 1; i <= sans.length; i++) { const nd = snapNode(sans.slice(0, i)); if (nd && nd.opening && nd.opening.name) nm = nd.opening.name; }
  return nm;
}
function puzzleName(theme, setupSans, mistakeSan) {
  const base = lastNamedOpening(setupSans) || "오프닝";
  if (theme === "sacrifice") return base + "에서 탁월한 수 찾기";
  if (theme === "advantage") return base + "에서 우위 점하기";
  return base + "에서 " + moveNumber(setupSans.length) + stripSuffix(mistakeSan || "") + " 응징하기";
}
// (UX6) 퍼즐 고유번호: id로부터 안정적으로 도출(같은 위치·수 → 같은 번호, 사용자 간 공통)
function puzzleNo(id) { let h = 2166136261; const s = String(id); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) % 900000 + 100000; } // 6자리
// (UX6) 전역 풀이수: Supabase RPC 'puzzle_solve'(증가, 새 카운트 반환) / 테이블 'puzzle_stats' 조회. 미설정·미생성 시 무해하게 비활성.
async function puzzleSolveInc(no) { if (!SB_ON) return null; try { const r = await sbRpc("puzzle_solve", { p_no: no }); return typeof r === "number" ? r : (r && r.solves) || null; } catch { return null; } }
async function puzzleSolveCounts() { if (!SB_ON) return {}; try { const rows = await sbSelect("puzzle_stats?select=no,solves"); const m = {}; (rows || []).forEach((x) => { m[x.no] = x.solves; }); return m; } catch { return {}; } }
// (UX6 전역 공유) 퍼즐 정의를 번호로 공유 저장/조회. 미설정·미생성 시 무해하게 비활성.
async function puzzleShare(p) { if (!SB_ON || !p || !p.id) return; try { await sbUpsert("puzzles", { no: puzzleNo(p.id), data: p }); } catch { } }
async function puzzleFetch(no) { if (!SB_ON) return null; try { const rows = await sbSelect("puzzles?no=eq." + no + "&select=data&limit=1"); return rows && rows[0] ? rows[0].data : null; } catch { return null; } }

// (기능4) 칭호 시스템 — 6개 오프닝 하위 퍼즐 해결 횟수 → 등급 칭호(영구). UX-8: 등급↔수 체계 디자인 대응.
const TITLE_OPENINGS = [
  { key: "italian", label: "Italian Game", rx: /italian/i },
  { key: "ruylopez", label: "Ruy Lopez", rx: /ruy ?lopez|spanish/i },
  { key: "scotch", label: "Scotch Game", rx: /scotch/i },
  { key: "sicilian", label: "Sicilian Defense", rx: /sicilian/i },
  { key: "carokann", label: "Caro-Kann Defense", rx: /caro.?kann/i },
  { key: "french", label: "French Defense", rx: /french/i },
];
const TITLE_TIERS = [ // 낮은→높은 / 등급↔수 체계
  { rank: "C", min: 10, suffix: "Beginner", q: "good" },
  { rank: "B", min: 50, suffix: "Intermediate", q: "excellent" },
  { rank: "A", min: 100, suffix: "Advanced", q: "best" },
  { rank: "S", min: 1000, suffix: "Master", q: "only" },
  { rank: "SS", min: 10000, suffix: "GrandMaster", q: "brilliant" },
];
function titleId(famKey, rank) { return famKey + ":" + rank; }
const ALL_TITLE_IDS = TITLE_OPENINGS.flatMap((f) => TITLE_TIERS.map((t) => titleId(f.key, t.rank)));
function titleLabel(id) { const [k, r] = id.split(":"); const fam = TITLE_OPENINGS.find((f) => f.key === k); const t = TITLE_TIERS.find((x) => x.rank === r); return fam && t ? fam.label + " " + t.suffix : ""; }
function puzzleFamilyKey(p) {
  if (!p) return null;
  const names = []; const path = [...(p.setupSans || []), ...(p.mistakeSan ? [p.mistakeSan] : [])];
  for (let i = 1; i <= path.length; i++) { const nd = snapNode(path.slice(0, i)); if (nd && nd.opening && nd.opening.name) names.push(nd.opening.name); }
  if (p.opening) names.push(p.opening);
  for (const fam of TITLE_OPENINGS) { if (names.some((n) => fam.rx.test(n))) return fam.key; }
  return null;
}
function familyCounts(puzzles, solved) {
  const c = {}; for (const p of puzzles) { if (!solved.has(p.id)) continue; const k = puzzleFamilyKey(p); if (k) c[k] = (c[k] || 0) + 1; } return c;
}
function achievableTitles(counts) {
  const out = new Set(); for (const fam of TITLE_OPENINGS) { const n = counts[fam.key] || 0; for (const t of TITLE_TIERS) if (n >= t.min) out.add(titleId(fam.key, t.rank)); } return out;
}
const TITLE_TIER_STYLE = {
  C:  { bg: ["#8C9C1E", "#697610"], label: "#EAF0A2" },   // Beginner · olive
  B:  { bg: ["#2F8B3D", "#1B6A2A"], label: "#BBEAB5" },   // Intermediate · green
  A:  { bg: ["#12612C", "#0A3D1D"], label: "#73D073" },   // Advanced · dark green
  S:  { bg: ["#1566BA", "#0B4184"], label: "#62B0F4" },   // Master · blue
  SS: { bg: ["#1BBAA8", "#129A8C"], label: "#0B4F47" },   // GrandMaster · teal
};
function TitleSym({ q, size, color }) {
  if (q === "good") return <Check size={size} strokeWidth={3.4} color={color} />;
  if (q === "excellent") return <ThumbsUp size={size} strokeWidth={2.4} color={color} fill={color} />;
  if (q === "best") return <Star size={size} strokeWidth={2} color={color} fill={color} />;
  if (q === "only") return <span style={{ fontSize: size, fontWeight: 900, lineHeight: 1, color }}>!</span>;
  return <span style={{ fontSize: size * 0.82, fontWeight: 900, lineHeight: 1, letterSpacing: -1, color }}>!!</span>;
}
function TitleBadge({ id, earned = true, equipped = false, progress = null, onEquip, compact = false }) {
  const [famKey, rank] = id.split(":");
  const fam = TITLE_OPENINGS.find((f) => f.key === famKey); const tier = TITLE_TIERS.find((t) => t.rank === rank);
  if (!fam || !tier) return null;
  const st = TITLE_TIER_STYLE[rank] || TITLE_TIER_STYLE.C; const tierIdx = TITLE_TIERS.indexOf(tier);
  const H = compact ? 54 : 66; const VB_W = 360; const deco = "#FFFFFF";
  // 우측 기하학 패턴 — 등급이 높을수록 촘촘 (결정적 생성)
  const shapes = []; let seed = (tierIdx + 1) * 9973;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const N = 4 + tierIdx * 4;
  for (let i = 0; i < N; i++) {
    const x = 150 + rnd() * 195, y = 8 + rnd() * (H - 16), sz = 4 + rnd() * 9, op = 0.4 + rnd() * 0.5, t = rnd();
    if (t < 0.55) shapes.push(<rect key={i} x={x} y={y} width={sz} height={sz} transform={`rotate(45 ${x + sz / 2} ${y + sz / 2})`} fill={rnd() > 0.55 ? deco : "none"} stroke={deco} strokeWidth="1.4" opacity={op} />);
    else shapes.push(<line key={i} x1={x} y1={y + sz} x2={x + sz * 1.8} y2={y - sz * 0.8} stroke={deco} strokeWidth="2.4" opacity={op} strokeLinecap="round" />);
  }
  if (tierIdx >= 3) shapes.push(<rect key="big" x={262} y={H / 2 - 15} width={30} height={30} transform={`rotate(45 277 ${H / 2})`} fill={deco} opacity={tierIdx === 4 ? 0.6 : 0.4} />);
  // 좌측 점 격자
  const dots = []; for (let r = 0; r < 4; r++) for (let c = 0; c < 5; c++) dots.push(<circle key={"d" + r + c} cx={10 + c * 7} cy={8 + r * 7} r="1.5" fill={deco} opacity="0.85" />);
  // 좌측 하단 삼각형
  const tris = []; for (let i = 0; i < 6; i++) { const tx = 8 + (i % 3) * 9, ty = H - 22 + Math.floor(i / 3) * 9; tris.push(<path key={"t" + i} d={`M${tx} ${ty + 6} L${tx + 4} ${ty} L${tx + 8} ${ty + 6} Z`} fill={deco} opacity="0.8" />); }
  const clip = "polygon(0 0, calc(100% - 13px) 0, 100% 13px, 100% 100%, 13px 100%, 0 calc(100% - 13px))";
  const clickable = earned && onEquip;
  return (
    <div onClick={clickable ? () => onEquip(id) : undefined} className={clickable ? "press" : undefined}
      style={{ position: "relative", height: H, width: "100%", clipPath: clip, background: "linear-gradient(120deg," + st.bg[0] + "," + st.bg[1] + ")", cursor: clickable ? "pointer" : "default", filter: earned ? "none" : "grayscale(1)", opacity: earned ? 1 : 0.5, boxShadow: equipped ? "inset 0 0 0 2.5px rgba(255,255,255,.95)" : "inset 0 1px 0 rgba(255,255,255,.18)", display: "flex", alignItems: "center" }}>
      <svg width="100%" height="100%" viewBox={`0 0 ${VB_W} ${H}`} preserveAspectRatio="none" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>{dots}{tris}{shapes}</svg>
      {/* 좌측 다이아몬드 + 기호 */}
      <div style={{ position: "relative", flexShrink: 0, width: H, height: H, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: H * 0.6, height: H * 0.6, transform: "rotate(45deg)", border: "2.4px solid " + deco, borderRadius: 4 }} />
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: deco }}><TitleSym q={tier.q} size={compact ? 16 : 20} color={deco} /></div>
      </div>
      {/* 오프닝 | 등급 */}
      <div style={{ position: "relative", display: "flex", alignItems: "center", gap: compact ? 8 : 11, minWidth: 0, flex: 1, paddingRight: 12 }}>
        <span style={{ fontSize: compact ? 14 : 18, fontWeight: 900, fontStyle: "italic", letterSpacing: "0.5px", color: "#fff", textTransform: "uppercase", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textShadow: "0 1px 2px rgba(0,0,0,.25)" }}>{fam.label}</span>
        <span style={{ width: 2, height: compact ? 18 : 24, background: "rgba(255,255,255,.55)", flexShrink: 0 }} />
        <span style={{ fontSize: compact ? 10.5 : 12.5, fontWeight: 900, letterSpacing: "1px", color: st.label, textTransform: "uppercase", whiteSpace: "nowrap", flexShrink: 0 }}>{tier.suffix}</span>
      </div>
      {equipped && <span style={{ position: "absolute", right: 14, bottom: 5, fontSize: 9.5, fontWeight: 900, letterSpacing: ".05em", color: "#fff", background: "rgba(0,0,0,.28)", borderRadius: 5, padding: "1px 6px", pointerEvents: "none" }}>장착됨</span>}
      {!earned && progress != null && <span style={{ position: "absolute", right: 14, bottom: 5, fontSize: 9.5, fontWeight: 800, fontFamily: "ui-monospace,monospace", color: "#fff", background: "rgba(0,0,0,.4)", borderRadius: 5, padding: "1px 6px", pointerEvents: "none" }}>{fmtFull(Math.min(progress, tier.min))}/{fmtFull(tier.min)}</span>}
    </div>
  );
}
function PuzzleSolver({ puzzle, onClose, onSolved, solveCount }) {
  const theme = puzzle.theme || "punish";
  const setup = [...puzzle.setupSans, puzzle.mistakeSan];
  const userColor = setup.length % 2 === 0 ? "w" : "b";   // 보드 방향 고정(상대 응수 때도 반전하지 않음)
  const [boardSize, boardRef] = useBoardSize(380);
  const [idx, setIdx] = useState(0);
  const [intro, setIntro] = useState(true);   // (UX7) 진입/처음부터 시 직전 수를 1회 재생
  useEffect(() => { setIntro(true); }, [puzzle.id]);
  useEffect(() => { if (!intro) return; const t = setTimeout(() => setIntro(false), 1400); return () => clearTimeout(t); }, [intro, puzzle.id]);
  const [sel, setSel] = useState(null);
  const [wrong, setWrong] = useState(null);     // { board, at:[r,c] }
  const [reply, setReply] = useState(null);      // { sans, san }  상대 응수 애니메이션
  const cur = [...setup, ...puzzle.solution.slice(0, idx)];
  const board = useMemo(() => boardFromSans(cur), [idx]);
  const color = cur.length % 2 === 0 ? "w" : "b";
  const ep = epTarget(cur);
  const done = idx >= puzzle.solution.length;
  const userToMove = !done && idx % 2 === 0 && !wrong && !reply && !intro;
  useEffect(() => { if (done && onSolved) onSolved(puzzle.id); }, [done]);
  // 상대(컴퓨터) 응수: 보드 반전 없이 수 애니메이션을 보여준 뒤 진행
  useEffect(() => {
    if (done || wrong || idx % 2 !== 1) return;
    setReply({ sans: [...setup, ...puzzle.solution.slice(0, idx)], san: puzzle.solution[idx] });
    const t = setTimeout(() => { setReply(null); setIdx((i) => i + 1); }, 950);
    return () => clearTimeout(t);
  }, [idx, done, wrong]);
  const tryUserMove = (from, to) => {
    if (!userToMove) return;
    const san = buildSan(board, from[0], from[1], to[0], to[1], color, ep); if (!san) return;
    if (stripSuffix(san) === stripSuffix(puzzle.solution[idx])) { setSel(null); setIdx((i) => i + 1); }
    else { setWrong({ board: applySan(board, san, color), at: to }); setSel(null); }   // 틀린 수는 취소하지 않고 그대로 두고 ✕ 표시
  };
  const onSquareClick = (sq) => { if (!userToMove) return; const p = board[sq[0]][sq[1]]; if (sel) { if (legalDests(board, sel[0], sel[1], color, ep).some(([r, c]) => r === sq[0] && c === sq[1])) { tryUserMove(sel, sq); return; } if (p && p.c === color) { setSel(sq); return; } setSel(null); } else if (p && p.c === color) setSel(sq); };
  const retry = () => { setWrong(null); setSel(null); };
  const restart = () => { setWrong(null); setReply(null); setSel(null); setIdx(0); setIntro(true); };
  // (기능3) 마스코트 힌트: 왜 좋은/나쁜 수인지 + 무엇을 두어야 할지(기물·목표 칸)
  const hint = useMemo(() => {
    const info = sanSrc(boardFromSans(setup), stripSuffix(puzzle.solution[0]), userColor);
    const pk = info ? PIECE_KOR[info.piece] : null;
    const dest = info ? FILES[info.to[1]] + (8 - info.to[0]) : null;
    if (theme === "sacrifice") return `이 위치에는 기물을 희생하는 탁월한 수가 있어요. 힌트: ${pk || "기물"}을(를) 적극적으로 활용해 보세요.`;
    if (theme === "advantage") return `상대의 부정확한 수예요. 우위를 점할 기회입니다. 힌트: ${pk || "기물"}을(를) ${dest || "유리한 칸"}(으)로 두어 압박하세요.`;
    return `상대의 이 수는 기물을 잃거나 포지션이 나빠지는 실수예요. 힌트: ${pk || "기물"}을(를) 움직여 ${dest || "약점"}을(를) 노리세요.`;
  }, [puzzle.id]);
  // (UX2) 마스코트 캐릭터는 둘 차례(백=MILKU, 흑=KOKOA), 표정은 풀이 상태에 따름
  const pmEmotion = intro ? "think" : done ? "celebrate" : wrong ? "angry" : reply ? "wink"
    : theme === "sacrifice" ? "great" : theme === "advantage" ? "think" : "surprise";
  const pm = [color === "w" ? "milku" : "kokoa", pmEmotion];
  const prompt = intro ? "직전 수 재생 중…"
    : done ? "✓ 완성! 모든 수를 찾았어요."
    : wrong ? "✕ 다른 수예요. ‘재시도’를 눌러 다시 풀어 보세요."
      : reply ? "상대 응수 중…"
        : theme === "sacrifice" ? "당신 차례 — 기물을 희생하는 탁월한 수를 두세요."
          : theme === "advantage" ? "당신 차례 — 우위를 점하는 수를 두세요."
            : "당신 차례 — 실수를 응징하는 최선의 수를 두세요.";
  return (
    <div style={{ position: "relative", background: T.paper, border: "1px solid #DCCBA8", borderRadius: 14, padding: 16, maxWidth: 460, margin: "0 auto" }}>
      <button onClick={onClose} aria-label="닫기" className="press" style={{ position: "absolute", top: 12, right: 12, zIndex: 10, width: 30, height: 30, display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 8, background: T.ebony2, color: T.ivory, border: "1px solid #000", fontSize: 15, fontWeight: 800, lineHeight: 1, cursor: "pointer" }}>✕</button>
      <div style={{ marginBottom: 12, paddingRight: 38 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 10.5, fontWeight: 800, color: T.brass, marginBottom: 2 }}>{THEME_LABEL[theme]}</div>
          <div style={{ fontSize: 15, fontWeight: 800, color: T.ink, lineHeight: 1.35 }}>{puzzle.name}</div>
          <div style={{ fontSize: 11, color: T.inkSoft, fontFamily: "ui-monospace,monospace", marginTop: 4 }}>#{puzzleNo(puzzle.id)}{solveCount != null && solveCount > 0 ? " · " + fmtFull(solveCount) + "명이 풀었습니다!" : ""}</div>
        </div>
      </div>
      <div style={{ marginBottom: 10 }}><MascotBubble text={done ? "훌륭해요! 다음 퍼즐도 도전해 보세요." : hint} ply={0} mascot={pm[0]} emotion={pm[1]} /></div>
      <div ref={boardRef} style={{ width: "100%", maxWidth: 380, margin: "0 auto" }}>
      {intro
        ? <AnimatedMove sans={puzzle.setupSans} san={puzzle.mistakeSan} size={boardSize} loopMs={0} flip={userColor === "b"} />
        : reply
          ? <AnimatedMove sans={reply.sans} san={reply.san} size={boardSize} loopMs={0} flip={userColor === "b"} />
        : <Board board={wrong ? wrong.board : board} flip={userColor === "b"} size={boardSize} selected={sel} wrongAt={wrong ? wrong.at : null} onSquareClick={onSquareClick} onPieceDrag={(sq) => { const p = board[sq[0]][sq[1]]; if (userToMove && p && p.c === color) setSel(sq); }} onDrop={(sq) => { if (userToMove && sel) tryUserMove(sel, sq); }} onMove={(from, to) => { if (userToMove) tryUserMove(from, to); }} legalTargets={userToMove && sel ? legalDests(board, sel[0], sel[1], color, ep) : []} showEval={false} interactive={userToMove} />}
      </div>
      <p style={{ fontSize: 13, color: done ? T.best : wrong ? T.blunder : T.ink, fontWeight: 700, marginTop: 12, textAlign: "center" }}>{prompt}</p>
      <div className="flex justify-center gap-2" style={{ marginTop: 12 }}>
        <button onClick={restart} className="press" style={{ padding: "6px 14px", borderRadius: 9, background: T.ebony2, color: T.ivory, border: "1px solid #000", fontWeight: 700, cursor: "pointer", fontSize: 12 }}>{done ? "다시 풀기" : "처음부터"}</button>
        {wrong && <button onClick={retry} className="press" style={{ padding: "6px 14px", borderRadius: 9, background: T.brass, color: "#2A1A0E", border: "none", fontWeight: 800, cursor: "pointer", fontSize: 12 }}>재시도</button>}
      </div>
    </div>
  );
}
function PuzzleCard({ p, isSolved, onClick, onDelete, solveCount }) {
  const setupLen = (p.setupSans ? p.setupSans.length : 0) + 1;
  const flip = setupLen % 2 !== 0; // userColor 흑이면 반전
  const hasPreview = p.setupSans && p.mistakeSan;
  return (
    <div onClick={onClick} className="press text-left" style={{ borderRadius: 14, padding: 14, background: isSolved ? "linear-gradient(180deg,#E7F0DC,#D2E2BC)" : "linear-gradient(180deg," + T.ivoryHi + ",#E2D2B2)", boxShadow: "0 4px 0 " + (isSolved ? "#9DB97E" : "#B59A6E"), border: "1px solid " + (isSolved ? "#A9C589" : "#CDB98E"), cursor: "pointer", position: "relative", display: "flex", flexDirection: "column", minHeight: 132, height: "100%" }}>
      {onDelete && <button onClick={(e) => { e.stopPropagation(); onDelete(p.id); }} aria-label="삭제" className="press" style={{ position: "absolute", top: 6, right: 6, zIndex: 10, width: 24, height: 24, borderRadius: 7, background: "rgba(40,24,12,.78)", color: "#F4C8C8", border: "1px solid #000", fontSize: 13, fontWeight: 800, lineHeight: 1, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>✕</button>}
      {hasPreview && <div style={{ marginBottom: 10 }}><AnimatedMove sans={p.setupSans} san={p.mistakeSan} size={116} loopMs={2400} flip={flip} /></div>}
      <div className="flex items-center justify-between" style={{ flexShrink: 0 }}><div style={{ fontSize: 11, color: isSolved ? T.best : T.brass, fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "62%" }}>{p.opening}</div>{isSolved && <span style={{ display: "inline-flex", alignItems: "center", gap: 3, color: T.best, fontSize: 11, fontWeight: 800, flexShrink: 0, marginRight: 22 }}><Check size={14} /> 해결됨</span>}</div>
      <div style={{ fontSize: 13.5, fontWeight: 800, color: T.ink, marginTop: 7, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", lineHeight: 1.4 }}>{p.name}</div>
      <div className="flex items-center justify-between" style={{ marginTop: "auto", paddingTop: 12, gap: 6 }}>
        <span style={{ fontSize: 10.5, color: T.inkSoft }}>{THEME_LABEL[p.theme || "punish"]} · {Math.ceil(p.solution.length / 2) || 1}수</span>
        <span style={{ fontSize: 10, color: T.brass, fontFamily: "ui-monospace,monospace", fontWeight: 700 }}>#{puzzleNo(p.id)}</span>
      </div>
      {solveCount != null && solveCount > 0 && <div style={{ fontSize: 10.5, color: "#2E6E2E", fontWeight: 700, marginTop: 6 }}>{fmtFull(solveCount)}명이 풀었습니다!</div>}
    </div>
  );
}
function PuzzleTab({ puzzles, solved, onSolved, onDeletePuzzle, solveCounts }) {
  const [active, setActive] = useState(null);
  const [filter, setFilter] = useState("all");
  const [numInput, setNumInput] = useState("");
  const [numMsg, setNumMsg] = useState("");
  if (active) return <PuzzleSolver puzzle={active} onClose={() => setActive(null)} onSolved={onSolved} solveCount={solveCounts ? solveCounts[puzzleNo(active.id)] : null} />;
  const themed = filter === "all" ? puzzles : puzzles.filter((p) => (p.theme || "punish") === filter);
  const byOpening = (a, b) => (a.opening || "").localeCompare(b.opening || "") || (a.name || "").localeCompare(b.name || ""); // (UX4) 오프닝순 정렬
  const open = themed.filter((p) => !solved.has(p.id)).sort(byOpening);
  const cleared = themed.filter((p) => solved.has(p.id)).sort(byOpening);
  const chips = [["all", "전체"], ["sacrifice", "기물 희생하기"], ["advantage", "우위 점하기"], ["punish", "실수 응징하기"]];
  const count = (k) => (k === "all" ? puzzles.length : puzzles.filter((p) => (p.theme || "punish") === k).length);
  const solveByNumber = async () => {
    const n = parseInt(numInput, 10);
    if (!Number.isFinite(n)) { setNumMsg("번호를 입력하세요."); return; }
    let hit = puzzles.find((p) => puzzleNo(p.id) === n);
    if (!hit) { setNumMsg("불러오는 중…"); const d = await puzzleFetch(n); if (d) hit = d; }
    if (hit) { setNumMsg(""); setNumInput(""); setActive(hit); } else setNumMsg("#" + n + " 번호의 퍼즐을 찾을 수 없습니다.");
  };
  return (
    <div>
      <div className="flex items-center gap-2"><Mascot name="kokoa" emotion="celebrate" size={70} /><h2 style={{ fontSize: 18, fontWeight: 800, color: T.ivoryHi }}>퍼즐</h2></div>
      <p style={{ fontSize: 13, color: T.inkSoft, margin: "6px 0 12px" }}>학습 탭에서 탁월한 수·부정확한 수·실수에 들어가면 기물 희생·우위 점하기·실수 응징 퍼즐이 자동 저장됩니다. ({cleared.length}/{themed.length} 해결)</p>
      <div className="flex items-center gap-2" style={{ marginBottom: 10 }}>
        <input value={numInput} onChange={(e) => setNumInput(e.target.value.replace(/[^0-9]/g, ""))} onKeyDown={(e) => e.key === "Enter" && solveByNumber()} inputMode="numeric" placeholder="퍼즐 번호로 풀기 (예: 123456)" style={{ flex: 1, minWidth: 0, padding: "8px 11px", borderRadius: 9, border: "1px solid #5A4630", background: "rgba(0,0,0,.25)", color: T.ivoryHi, fontFamily: "ui-monospace,monospace", fontSize: 13 }} />
        <button onClick={solveByNumber} className="press" style={{ padding: "8px 14px", borderRadius: 9, background: "linear-gradient(180deg," + T.brass + ",#A8842F)", color: "#241509", fontWeight: 800, border: "none", cursor: "pointer", fontSize: 12, whiteSpace: "nowrap" }}>풀기</button>
      </div>
      {numMsg && <p style={{ fontSize: 11.5, color: T.blunder, margin: "-4px 0 10px" }}>{numMsg}</p>}
      <div className="flex flex-wrap gap-2" style={{ marginBottom: 14 }}>
        {chips.map(([k, lb]) => { const on = filter === k; return (
          <button key={k} onClick={() => setFilter(k)} className="press" style={{ fontSize: 12, fontWeight: 800, padding: "6px 12px", borderRadius: 999, border: "1px solid " + (on ? T.brass : "#5A4630"), background: on ? "linear-gradient(180deg," + T.brass + ",#A8842F)" : "transparent", color: on ? "#241509" : T.brassHi, cursor: "pointer" }}>{lb} <span style={{ opacity: .7 }}>{count(k)}</span></button>
        ); })}
      </div>
      {themed.length === 0 ? <div style={{ background: T.paper, border: "1px dashed #C9B58C", borderRadius: 12, padding: 20, textAlign: "center", color: T.inkSoft, fontSize: 13 }}><div style={{ display: "flex", justifyContent: "center", marginBottom: 8 }}><Mascot name="kokoa" emotion="sleep" size={88} /></div>이 테마의 퍼즐이 아직 없어요.</div>
        : <div>
            {open.length > 0 && <div style={{ marginBottom: 16 }}><div style={{ fontSize: 12.5, fontWeight: 800, color: T.brassHi, marginBottom: 8 }}>미해결 ({open.length})</div><div className="grid sm:grid-cols-2 gap-3">{open.map((p) => <PuzzleCard key={p.id} p={p} isSolved={false} onClick={() => setActive(p)} onDelete={onDeletePuzzle} solveCount={solveCounts ? solveCounts[puzzleNo(p.id)] : null} />)}</div></div>}
            {cleared.length > 0 && <div><div style={{ fontSize: 12.5, fontWeight: 800, color: T.best, marginBottom: 8 }}>해결된 퍼즐 ({cleared.length})</div><div className="grid sm:grid-cols-2 gap-3">{cleared.map((p) => <PuzzleCard key={p.id} p={p} isSolved={true} onClick={() => setActive(p)} onDelete={onDeletePuzzle} solveCount={solveCounts ? solveCounts[puzzleNo(p.id)] : null} />)}</div></div>}
          </div>}
    </div>
  );
}

/* ============================================================ 설정 탭 ============================================================ */
// (기능5) 프로필 편집 — 사진/이름/칭호/자주 두는 첫 수/국적
function ProfileEditor({ profile, setProfile, earnedTitles, currentTitle, onEquipTitle, card }) {
  const set = (patch) => setProfile({ ...profile, ...patch });
  const fm = profile.firstMoves || { white: "", black: {} };
  const setFM = (patch) => set({ firstMoves: { ...fm, ...patch } });
  const earned = [...(earnedTitles || new Set())];
  const onPhotoFile = (e) => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      const img = new Image();
      img.onload = () => {
        const sc = Math.min(1, 256 / Math.max(img.width, img.height));
        const w = Math.round(img.width * sc), h = Math.round(img.height * sc);
        const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
        cv.getContext("2d").drawImage(img, 0, 0, w, h);
        set({ photo: cv.toDataURL("image/jpeg", 0.85) });   // 256px로 축소해 저장 용량 최소화
      };
      img.src = r.result;
    };
    r.readAsDataURL(f);
  };
  const field = { width: "100%", padding: "8px 11px", borderRadius: 9, border: "1px solid #C9B58C", background: "#fff", color: T.ink, fontSize: 13, boxSizing: "border-box" };
  const lab = { fontSize: 12, fontWeight: 800, color: T.ink, margin: "14px 0 6px" };
  return (
    <div style={card}>
      <div style={{ fontSize: 13, fontWeight: 800, color: T.ink }}>프로필 편집</div>
      <div className="flex items-center gap-3" style={{ margin: "12px 0" }}>
        {profile.photo ? <img src={profile.photo} alt="" style={{ width: 56, height: 56, borderRadius: 14, objectFit: "cover", border: "1px solid #C9B58C" }} />
          : <span style={{ width: 56, height: 56, borderRadius: 14, background: "linear-gradient(180deg," + T.brass + ",#A8842F)", color: "#241509", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 24 }}>{(profile.nickname || "?")[0].toUpperCase()}</span>}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: T.ink }}>{profile.nickname || "이름 미설정"}</div>
          {currentTitle && <div style={{ fontSize: 11.5, color: T.brass, fontWeight: 800, marginTop: 2 }}>{titleLabel(currentTitle)}</div>}
        </div>
      </div>
      <div style={lab}>프로필 사진</div>
      <div className="flex items-center gap-2" style={{ marginBottom: 8 }}>
        <label className="press" style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 9, background: "linear-gradient(180deg,#3A2516,#241509)", color: T.ivoryHi, fontWeight: 800, fontSize: 12, cursor: "pointer", border: "none" }}>
          파일에서 선택
          <input type="file" accept="image/*" onChange={onPhotoFile} style={{ display: "none" }} />
        </label>
        {profile.photo && <button onClick={() => set({ photo: "" })} className="press" style={{ padding: "8px 12px", borderRadius: 9, border: "1px solid " + T.blunder, background: "transparent", color: T.blunder, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>제거</button>}
      </div>
      <input value={(profile.photo || "").startsWith("data:") ? "" : (profile.photo || "")} onChange={(e) => set({ photo: e.target.value })} placeholder="또는 이미지 주소(URL) 입력" style={field} />
      <div style={lab}>이름</div>
      <input value={profile.nickname || ""} onChange={(e) => set({ nickname: e.target.value })} placeholder="표시 이름" style={field} />
      <div style={lab}>자주 두는 첫 수 — 백</div>
      <input value={fm.white || ""} onChange={(e) => setFM({ white: e.target.value })} placeholder="예: e4 (생략 가능)" style={{ ...field, fontFamily: "ui-monospace,monospace" }} />
      <div style={lab}>자주 두는 첫 수 — 흑 (백의 첫 수별, 생략 가능)</div>
      <div className="grid sm:grid-cols-2 gap-2">
        {["e4", "d4", "c4", "Nf3"].map((w) => (
          <div key={w} className="flex items-center gap-2">
            <span style={{ fontSize: 12, fontFamily: "ui-monospace,monospace", color: T.inkSoft, width: 56, flexShrink: 0 }}>vs 1.{w}</span>
            <input value={(fm.black || {})[w] || ""} onChange={(e) => setFM({ black: { ...(fm.black || {}), [w]: e.target.value } })} placeholder="응수" style={{ ...field, fontFamily: "ui-monospace,monospace" }} />
          </div>
        ))}
      </div>
      <div style={lab}>칭호 장착</div>
      {earned.length === 0 ? <div style={{ fontSize: 12, color: T.inkSoft }}>아직 획득한 칭호가 없습니다. 퍼즐을 풀어 칭호를 획득하세요.</div>
        : <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{earned.map((id) => <TitleBadge key={id} id={id} earned equipped={currentTitle === id} onEquip={onEquipTitle} compact />)}</div>}
    </div>
  );
}
// (기능6) 이론 수 체계 추가 — 모식도(세로=갈래, 가로=깊이). 이론 수만 추가(엔진 평가 왜곡 방지), 수마다 이름 입력(기존 이름 기본값).
function SchematicEditor({ bumpContent }) {
  const [rows, setRows] = useState([[{ san: "", name: "" }]]);
  const [msg, setMsg] = useState("");
  const existingName = (path, san) => {
    const key = path.join(" ");
    const ov = nameOverride(key, san); if (ov != null) return ov;
    const nd = snapNode(path); const mm = nd && nd.moves.find((x) => stripSuffix(x.san) === stripSuffix(san));
    return mm && mm.name ? mm.name : "";
  };
  const rowInfo = (row) => { // 각 셀 적법성 + prefix
    let path = []; const info = [];
    for (const c of row) {
      const san = (c.san || "").trim(); if (!san) { info.push({ empty: true }); continue; }
      const board = boardFromSans(path); const color = path.length % 2 === 0 ? "w" : "b";
      const ok = !!sanSrc(board, san, color);
      info.push({ san, ok, ply: path.length, existing: ok ? existingName(path, san) : "" });
      if (!ok) break; path = [...path, san];
    }
    return info;
  };
  const setCell = (ri, ci, patch) => setRows((rs) => rs.map((r, i) => i !== ri ? r : r.map((c, j) => j !== ci ? c : { ...c, ...patch })));
  const onSan = (ri, ci, val) => setRows((rs) => rs.map((r, i) => {
    if (i !== ri) return r;
    return r.map((c, j) => {
      if (j !== ci) return c;
      let path = []; for (let k = 0; k < ci; k++) { const s = (r[k].san || "").trim(); if (!s) break; path.push(s); }
      const ex = val.trim() ? existingName(path, val.trim()) : "";
      return { ...c, san: val, name: (!c.name && ex) ? ex : c.name }; // 기존 이름 기본값
    });
  }));
  const addDepth = (ri) => setRows((rs) => rs.map((r, i) => i !== ri ? r : [...r, { san: "", name: "" }]));
  const addBranch = () => setRows((rs) => [...rs, [{ san: "", name: "" }]]);
  const delRow = (ri) => setRows((rs) => rs.length > 1 ? rs.filter((_, i) => i !== ri) : rs);
  const save = async () => {
    let added = 0, bad = null;
    for (const row of rows) {
      let path = [];
      for (const c of row) {
        const san = (c.san || "").trim(); if (!san) break;
        const board = boardFromSans(path); const color = path.length % 2 === 0 ? "w" : "b";
        if (!sanSrc(board, san, color)) { bad = san; break; }
        const key = path.join(" ");
        if (!CONTENT.treeAdds[key]) CONTENT.treeAdds[key] = [];
        if (!CONTENT.treeAdds[key].some((x) => x.san === san)) CONTENT.treeAdds[key].push({ san });
        CONTENT.forceKind[key + "|" + san] = "book"; // 이론 수만
        const nm = (c.name || "").trim(); if (nm) CONTENT.names[key + "|" + stripSuffix(san)] = nm;
        path = [...path, san]; added++;
      }
      if (bad) break;
    }
    if (added > 0) await bumpContent();
    setMsg(bad ? ("불법 수 " + bad + " 에서 중단 — " + added + "수까지 추가됨") : (added > 0 ? added + "개 수를 이론 트리에 추가했습니다." : "입력된 수가 없습니다."));
  };
  const cellInput = { width: 74, padding: "6px 7px", borderRadius: 7, border: "1px solid #C9B58C", background: "#fff", color: T.ink, fontSize: 12.5, fontFamily: "ui-monospace,monospace", boxSizing: "border-box" };
  const nameInput = { width: 92, padding: "5px 7px", borderRadius: 7, border: "1px solid #DCCBA8", background: "#FBF5E8", color: T.ink, fontSize: 11, boxSizing: "border-box" };
  return (
    <div>
      <p style={{ fontSize: 11.5, color: T.inkSoft, margin: "0 0 10px", lineHeight: 1.55 }}>세로(행)는 다른 갈래, 가로(열)는 다음 수입니다. 각 수에 이름을 붙일 수 있고, 이미 이론에 있는 수는 현재 이름이 기본값으로 채워집니다. 추가되는 수는 모두 이론 수로만 등록됩니다.</p>
      <div style={{ overflowX: "auto" }}>
        {rows.map((row, ri) => {
          const info = rowInfo(row);
          return (
            <div key={ri} className="flex items-start gap-2" style={{ marginBottom: 12, minWidth: "min-content" }}>
              {row.map((c, ci) => {
                const inf = info[ci] || {};
                const ply = ci; const label = moveNumber(ply);
                const bad = c.san.trim() && inf.ok === false;
                return (
                  <div key={ci} style={{ flexShrink: 0 }}>
                    <div style={{ fontSize: 9.5, color: T.inkSoft, fontFamily: "ui-monospace,monospace", marginBottom: 2 }}>{label}</div>
                    <input value={c.san} onChange={(e) => onSan(ri, ci, e.target.value)} placeholder="수" style={{ ...cellInput, borderColor: bad ? T.blunder : "#C9B58C" }} />
                    <input value={c.name} onChange={(e) => setCell(ri, ci, { name: e.target.value })} placeholder={inf.existing || "이름"} style={{ ...nameInput, marginTop: 4 }} />
                  </div>
                );
              })}
              <div style={{ display: "flex", flexDirection: "column", gap: 4, paddingTop: 16 }}>
                <button onClick={() => addDepth(ri)} className="press" title="다음 수" style={{ width: 28, height: 28, borderRadius: 7, border: "1px solid " + T.brass, background: "transparent", color: T.brassHi, fontSize: 16, fontWeight: 800, cursor: "pointer", lineHeight: 1 }}>→</button>
                {rows.length > 1 && <button onClick={() => delRow(ri)} className="press" title="갈래 삭제" style={{ width: 28, height: 28, borderRadius: 7, border: "1px solid " + T.blunder, background: "transparent", color: T.blunder, fontSize: 13, fontWeight: 800, cursor: "pointer", lineHeight: 1 }}>✕</button>}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-2" style={{ marginTop: 4 }}>
        <button onClick={addBranch} className="press" style={{ padding: "7px 13px", borderRadius: 9, border: "1px dashed " + T.brass, background: "transparent", color: T.brassHi, fontWeight: 800, fontSize: 12, cursor: "pointer" }}>+ 갈래 추가</button>
        <button onClick={save} className="press" style={{ padding: "8px 16px", borderRadius: 9, background: "linear-gradient(180deg,#3A2516,#241509)", color: T.ivoryHi, fontWeight: 800, border: "none", cursor: "pointer", fontSize: 12 }}>이론 트리에 추가</button>
        {msg && <span style={{ fontSize: 11.5, color: T.inkSoft }}>{msg}</span>}
      </div>
    </div>
  );
}
function AccountChessStats({ chesscom, username }) {
  const [prof, setProf] = useState(null);
  useEffect(() => {
    let cc = false;
    if (!username) { setProf(null); return; }
    fetchChesscomProfile(username).then((p) => { if (!cc) setProf(p); }).catch(() => {});
    return () => { cc = true; };
  }, [username]);
  const ready = chesscom && chesscom.status === "ready";
  const overall = useMemo(() => (ready ? chesscom.analyze([]) : null), [ready, chesscom && chesscom.games]);
  const openingStats = useMemo(() => {
    if (!ready) return [];
    const agg = {};
    for (const g of chesscom.games) {
      let name = null;
      const lim = Math.min(g.moves.length, 16);
      for (let i = 1; i <= lim; i++) { const nd = snapNode(g.moves.slice(0, i)); if (nd && nd.opening) name = nd.opening.name; }
      if (!name) continue;
      if (!agg[name]) agg[name] = { name, n: 0, w: 0, d: 0, l: 0 };
      agg[name].n++; agg[name][g.result === "win" ? "w" : g.result === "loss" ? "l" : "d"]++;
    }
    return Object.values(agg).map((o) => ({ ...o, wr: Math.round(100 * o.w / o.n) }));
  }, [ready, chesscom && chesscom.games]);
  const mostUsed = useMemo(() => [...openingStats].sort((a, b) => b.n - a.n), [openingStats]);
  const byWinrate = useMemo(() => openingStats.filter((o) => o.n >= 3).sort((a, b) => b.wr - a.wr || b.n - a.n), [openingStats]);

  if (chesscom && chesscom.status === "loading") return <p style={{ fontSize: 12, color: T.inkSoft, marginTop: 10 }}>기보를 불러오는 중…</p>;
  if (chesscom && chesscom.status === "error") return <p style={{ fontSize: 12, color: T.blunder, marginTop: 10 }}>기보를 불러오지 못했습니다. 계정을 확인하세요.</p>;
  if (!ready) return null;

  const rowStyle = { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "5px 0", borderTop: "1px solid #E4D5B6", fontSize: 12 };
  return (
    <div style={{ marginTop: 12 }}>
      {/* 프로필 */}
      <div className="flex items-center gap-3" style={{ marginBottom: 12 }}>
        {prof && prof.avatar ? <img src={prof.avatar} alt="" style={{ width: 48, height: 48, borderRadius: 12, border: "1px solid #C9B58C" }} />
          : <span style={{ width: 48, height: 48, borderRadius: 12, background: "linear-gradient(180deg," + T.brass + ",#A8842F)", color: "#241509", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 22 }}>{username[0].toUpperCase()}</span>}
        <div style={{ minWidth: 0 }}>
          <div className="flex items-center gap-2">
            <span style={{ fontSize: 15, fontWeight: 800, color: T.ink }}>{(prof && prof.username) || username}</span>
            {prof && prof.country && <span style={{ fontSize: 12.5, fontWeight: 700, padding: "2px 8px", borderRadius: 7, background: "rgba(0,0,0,.06)", border: "1px solid #DCCBA8", color: T.ink, whiteSpace: "nowrap" }}>{countryFlag(prof.country)} {prof.country}</span>}
          </div>
          <div style={{ fontSize: 11, color: T.inkSoft, fontFamily: "ui-monospace,monospace" }}>{prof ? ["래피드 " + (prof.rapid ?? "—"), "블리츠 " + (prof.blitz ?? "—"), "불릿 " + (prof.bullet ?? "—")].join(" · ") : "레이팅 불러오는 중…"}</div>
        </div>
      </div>
      {/* 전적 */}
      {overall && (
        <div style={{ background: "rgba(0,0,0,.04)", borderRadius: 10, padding: "10px 12px", marginBottom: 12 }}>
          <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
            <span style={{ fontSize: 12.5, fontWeight: 800, color: T.ink }}>최근 12개월 전적</span>
            <span style={{ fontSize: 12, fontFamily: "ui-monospace,monospace", color: T.inkSoft }}>{fmtFull(overall.total)}판</span>
          </div>
          <div style={{ fontSize: 13, fontFamily: "ui-monospace,monospace", color: T.ink }}>
            <span style={{ color: T.best, fontWeight: 800 }}>{overall.w}승</span> {overall.d}무 <span style={{ color: T.blunder, fontWeight: 800 }}>{overall.l}패</span> · 승률 <b>{overall.winRate}%</b>
          </div>
          <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", marginTop: 8, border: "1px solid rgba(0,0,0,.2)" }}>
            <div style={{ width: (100 * overall.w / overall.total) + "%", background: T.best }} />
            <div style={{ width: (100 * overall.d / overall.total) + "%", background: "#9C8A6A" }} />
            <div style={{ width: (100 * overall.l / overall.total) + "%", background: T.blunder }} />
          </div>
        </div>
      )}
      {/* 가장 많이 둔 오프닝 */}
      {mostUsed.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: T.brass, marginBottom: 2 }}>가장 많이 둔 오프닝</div>
          <div style={{ fontSize: 13.5, fontWeight: 800, color: T.ink }}>{mostUsed[0].name}</div>
          <div style={{ fontSize: 11.5, color: T.inkSoft, fontFamily: "ui-monospace,monospace" }}>{mostUsed[0].n}판 · 승률 {mostUsed[0].wr}%</div>
        </div>
      )}
      {/* 오프닝별 승률(높은→낮은) */}
      {byWinrate.length > 0 && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 800, color: T.ink, marginBottom: 2 }}>오프닝별 승률 <span style={{ fontWeight: 600, color: T.inkSoft }}>(3판 이상)</span></div>
          <div>
            {byWinrate.map((o) => (
              <div key={o.name} style={rowStyle}>
                <span style={{ color: T.ink, fontWeight: 600, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "62%" }}>{o.name}</span>
                <span style={{ fontFamily: "ui-monospace,monospace", color: T.inkSoft, whiteSpace: "nowrap" }}><b style={{ color: o.wr >= 55 ? T.best : o.wr >= 45 ? T.brass : T.blunder }}>{o.wr}%</b> · {o.w}/{o.d}/{o.l}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {mostUsed.length === 0 && <p style={{ fontSize: 12, color: T.inkSoft }}>수록된 오프닝과 일치하는 대국을 찾지 못했습니다.</p>}
    </div>
  );
}
function SettingsTab({ profile, setProfile, engineStatus, liveOn, setLiveOn, chesscomStatus, chesscom, user, isDev, isCodev, devOn, setDevOn, codevOn, setCodevOn, canManageCodev, canAdd, canEdit, bumpContent, contentVer, openAuth, earnedTitles, currentTitle, onEquipTitle }) {
  const [cc, setCc] = useState(profile.chesscom || "");
  const [codevId, setCodevId] = useState("");
  const [ccState, setCcState] = useState("idle");   // idle | checking | failed
  const [pending, setPending] = useState(null);
  useEffect(() => { setCc(profile.chesscom || ""); }, [profile.chesscom]);
  const linked = !!profile.chesscom;
  const verifyChesscom = async () => {
    const name = cc.trim(); if (!name) return;
    setCcState("checking");
    try { const p = await fetchChesscomProfile(name); setPending(p); setCcState("idle"); }
    catch { setCcState("failed"); setTimeout(() => setCcState("idle"), 1700); }
  };
  const confirmLink = () => { setProfile({ ...profile, chesscom: pending.username }); setPending(null); };
  const changeChesscom = () => { setProfile({ ...profile, chesscom: "" }); setCc(""); setCcState("idle"); };
  const card = { background: T.paper, borderRadius: 12, padding: 16, border: "1px solid #DCCBA8", marginTop: 14 };
  const addCodev = async () => { const id = codevId.trim(); if (!ALNUM.test(id) || id === DEV_ACCOUNT) return; if (!CONTENT.codev.includes(id)) CONTENT.codev.push(id); await bumpContent(); setCodevId(""); };
  const removeCodev = async (id) => { CONTENT.codev = CONTENT.codev.filter((x) => x !== id); await bumpContent(); };
  return (
    <div className="max-w-xl">
      <div className="flex items-center gap-2"><Mascot name="milku" emotion="wink" size={64} /><h2 style={{ fontSize: 18, fontWeight: 800, color: T.ivoryHi }}>설정</h2></div>

      {/* 계정 정보 */}
      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 700, color: T.ink, marginBottom: 8 }}>계정</div>
        {user ? (
          <div className="flex items-center gap-2">
            <span style={{ width: 34, height: 34, borderRadius: "50%", background: "linear-gradient(180deg," + T.brass + ",#A8842F)", color: "#241509", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800 }}>{user[0].toUpperCase()}</span>
            <div><div style={{ fontSize: 14, fontWeight: 800, color: T.ink }}>{user}{isDev && <span style={{ color: T.brass }}> 👑</span>}</div><div style={{ fontSize: 11, color: T.inkSoft }}>{isDev ? "개발자 계정" : isCodev ? "공동 개발자" : "일반 회원"} · 진도가 서버에 저장됩니다</div></div>
          </div>
        ) : (
          <div className="flex items-center justify-between"><span style={{ fontSize: 12.5, color: T.inkSoft }}>로그인하면 진도가 계정에 저장됩니다.</span><button onClick={() => openAuth("login")} className="press" style={{ padding: "7px 14px", borderRadius: 8, background: "linear-gradient(180deg,#3A2516,#241509)", color: T.ivoryHi, fontWeight: 700, border: "none", cursor: "pointer" }}>로그인 / 회원가입</button></div>
        )}
      </div>

      {/* 개발자 모드 토글 (개발자 계정 한정) */}
      {isDev && (
        <div style={card}>
          <div className="flex items-center justify-between"><div className="flex items-center gap-2"><Crown size={16} style={{ color: T.brass }} /><span style={{ fontSize: 13, fontWeight: 700, color: T.ink }}>개발자 모드</span></div>
            <button onClick={() => setDevOn((v) => !v)} className="press" style={{ width: 46, height: 26, borderRadius: 13, background: devOn ? T.excellent : "#C9B58C", position: "relative", cursor: "pointer", border: "none" }}><span style={{ position: "absolute", top: 3, left: devOn ? 23 : 3, width: 20, height: 20, borderRadius: "50%", background: "#fff", transition: "left .15s" }} /></button>
          </div>
          <p style={{ fontSize: 12, color: T.inkSoft, marginTop: 8, lineHeight: 1.6 }}>켜면 학습 탭에서 주요 분기점 지정·수 해설 편집, 이론 수 체계 추가가 가능합니다. 모든 변경은 공용 서버에 영구 저장됩니다.</p>
        </div>
      )}

      {/* (기능3) 공동 개발자 모드 토글 (공동 개발자 한정) */}
      {isCodev && (
        <div style={card}>
          <div className="flex items-center justify-between"><div className="flex items-center gap-2"><Crown size={16} style={{ color: T.brass }} /><span style={{ fontSize: 13, fontWeight: 700, color: T.ink }}>공동 개발자 모드</span></div>
            <button onClick={() => setCodevOn((v) => !v)} className="press" style={{ width: 46, height: 26, borderRadius: 13, background: codevOn ? T.excellent : "#C9B58C", position: "relative", cursor: "pointer", border: "none" }}><span style={{ position: "absolute", top: 3, left: codevOn ? 23 : 3, width: 20, height: 20, borderRadius: "50%", background: "#fff", transition: "left .15s" }} /></button>
          </div>
          <p style={{ fontSize: 12, color: T.inkSoft, marginTop: 8, lineHeight: 1.6 }}>켜면 분기점 해설·수 설명·수 키워드를 수정하고 이론 수 체계를 추가할 수 있습니다.</p>
        </div>
      )}

      {/* (기능5) 프로필 편집 */}
      {user && <ProfileEditor profile={profile} setProfile={setProfile} earnedTitles={earnedTitles} currentTitle={currentTitle} onEquipTitle={onEquipTitle} card={card} />}

      {/* (기능6) 이론 수 체계 추가 (개발자/공동 개발자 모드) */}
      {canAdd && (
        <div style={card}>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.ink, marginBottom: 8 }}>이론 수 체계 추가</div>
          <SchematicEditor bumpContent={bumpContent} />
        </div>
      )}

      {/* 공동 개발자 관리 (개발자 모드 한정) */}
      {canManageCodev && (
        <div style={card}>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.ink, marginBottom: 8 }}>공동 개발자 지정</div>
          <div className="flex gap-2"><input value={codevId} onChange={(e) => setCodevId(e.target.value)} placeholder="아이디 (영문+숫자)" style={{ flex: 1, padding: "9px 11px", borderRadius: 9, border: "1px solid #C9B58C", background: "#fff", color: T.ink }} /><button onClick={addCodev} className="press" style={{ padding: "9px 16px", borderRadius: 9, background: "linear-gradient(180deg,#3A2516,#241509)", color: T.ivoryHi, fontWeight: 700, border: "none", cursor: "pointer" }}>추가</button></div>
          <p style={{ fontSize: 11, color: T.inkSoft, marginTop: 6 }}>공동 개발자는 트리·분기점·해설을 <b>추가</b>만 할 수 있고 수정·삭제는 불가합니다.</p>
        </div>
      )}

      {/* 개발진 명단 (수 기호 안내 대체) */}
      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 700, color: T.ink, marginBottom: 8 }}>개발진</div>
        <div className="flex items-center gap-2" style={{ marginBottom: 6 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 13.5, fontWeight: 800, color: T.cocoa || "#5A3A22" }}><Crown size={15} style={{ color: T.brass }} /> {DEV_ACCOUNT}</span>
          <span style={{ fontSize: 11, color: T.inkSoft }}>개발자</span>
        </div>
        {(CONTENT.codev || []).length === 0 ? <div style={{ fontSize: 12, color: T.inkSoft }}>등록된 공동 개발자가 없습니다.</div>
          : (CONTENT.codev || []).map((id) => (
            <div key={id} className="flex items-center justify-between" style={{ marginBottom: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: T.ink }}>{id} <span style={{ fontSize: 11, color: T.inkSoft, fontWeight: 500 }}>공동 개발자</span></span>
              {canManageCodev && <button onClick={() => removeCodev(id)} className="press" style={{ fontSize: 10.5, padding: "2px 8px", borderRadius: 6, border: "1px solid " + T.blunder, background: "transparent", color: T.blunder, cursor: "pointer" }}>해제</button>}
            </div>
          ))}
      </div>

      {/* 라이브 엔진 */}
      <div style={card}>
        <div className="flex items-center justify-between"><div className="flex items-center gap-2"><Cpu size={16} style={{ color: T.brass }} /><span style={{ fontSize: 13, fontWeight: 700, color: T.ink }}>라이브 엔진·통계</span></div>
          <button onClick={() => setLiveOn((v) => !v)} className="press" style={{ width: 46, height: 26, borderRadius: 13, background: liveOn ? T.excellent : "#C9B58C", position: "relative", cursor: "pointer", border: "none" }}><span style={{ position: "absolute", top: 3, left: liveOn ? 23 : 3, width: 20, height: 20, borderRadius: "50%", background: "#fff", transition: "left .15s" }} /></button>
        </div>
        <p style={{ fontSize: 12, color: T.inkSoft, marginTop: 8, lineHeight: 1.5 }}>엔진: <b style={{ color: engineStatus === "ready" ? T.excellent : T.inkSoft }}>{engineStatus === "ready" ? "Web Worker 작동 중" : engineStatus === "loading" ? "로딩 중…" : "사용 불가(스냅샷)"}</b>. 라이브 시 Lichess 빈도순으로 비이론 수까지 제안하고 보드 착수도 평가합니다.</p>
      </div>

      {/* chess.com */}
      <div style={card}>
        <label style={{ fontSize: 13, fontWeight: 700, color: T.ink }}>chess.com 계정</label>
        <p style={{ fontSize: 11.5, color: T.inkSoft, margin: "4px 0 10px" }}>최근 기보를 받아 집중 학습 모드에서 수별 전적·승률과 '오프닝 실수'를 분석합니다.</p>
        {linked ? (
          <div className="flex items-center gap-2">
            <button disabled className="flex items-center justify-center gap-2" style={{ flex: 1, padding: "10px 14px", borderRadius: 9, background: "linear-gradient(180deg,#3C8A3C,#2E6E2E)", color: "#fff", fontWeight: 800, border: "none", cursor: "default" }}><Check size={16} /> 연동 완료 · {profile.chesscom}{chesscomStatus === "loading" ? " (불러오는 중…)" : ""}</button>
            <button onClick={changeChesscom} className="press" style={{ padding: "10px 13px", borderRadius: 9, background: "transparent", color: T.ink, fontWeight: 700, border: "1px solid #C9B58C", cursor: "pointer", whiteSpace: "nowrap" }}>계정 변경</button>
          </div>
        ) : (
          <div className="flex gap-2">
            <input value={cc} onChange={(e) => setCc(e.target.value)} onKeyDown={(e) => e.key === "Enter" && verifyChesscom()} placeholder="chess.com 사용자명" style={{ flex: 1, padding: "9px 11px", borderRadius: 9, border: "1px solid #C9B58C", background: "#fff", color: T.ink }} />
            <button onClick={verifyChesscom} disabled={ccState === "checking"} className="press" style={{ padding: "9px 16px", borderRadius: 9, background: ccState === "failed" ? T.blunder : "linear-gradient(180deg,#3A2516,#241509)", color: ccState === "failed" ? "#fff" : T.ivoryHi, fontWeight: 700, border: "none", cursor: "pointer", whiteSpace: "nowrap" }}>{ccState === "checking" ? "확인 중…" : ccState === "failed" ? "연동 실패" : "연동하기"}</button>
          </div>
        )}
        {linked && <AccountChessStats chesscom={chesscom} username={profile.chesscom} />}
      </div>

      {/* chess.com 계정 확인 모달 */}
      {pending && (
        <div onClick={() => setPending(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 90, display: "flex", alignItems: "center", justifyContent: "center", padding: 18 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: 320, width: "100%", background: "linear-gradient(180deg,#F2E8D5,#E2D2B2)", borderRadius: 16, padding: 20, border: "1px solid #CDB98E", boxShadow: "0 20px 50px -10px rgba(0,0,0,.7)" }}>
            <div className="flex items-center gap-3" style={{ marginBottom: 12 }}>
              {pending.avatar ? <img src={pending.avatar} alt="" style={{ width: 46, height: 46, borderRadius: 10 }} /> : <span style={{ width: 46, height: 46, borderRadius: 10, background: T.brass, color: "#241509", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 20 }}>{pending.username[0].toUpperCase()}</span>}
              <div><div style={{ fontSize: 16, fontWeight: 800, color: T.ink }}>{pending.username}</div><div style={{ fontSize: 11.5, color: T.inkSoft }}>플레이한 게임 {fmtFull(pending.games)}국</div></div>
            </div>
            <div className="flex gap-2" style={{ marginBottom: 14 }}>
              {[["래피드", pending.rapid], ["블리츠", pending.blitz], ["불릿", pending.bullet]].map(([lb, v]) => (
                <div key={lb} style={{ flex: 1, textAlign: "center", background: "rgba(0,0,0,.05)", borderRadius: 9, padding: "8px 4px" }}><div style={{ fontSize: 10.5, color: T.inkSoft, fontWeight: 700 }}>{lb}</div><div style={{ fontSize: 17, fontWeight: 800, color: T.ink, fontFamily: "ui-monospace,monospace" }}>{v != null ? v : "—"}</div></div>
              ))}
            </div>
            <p style={{ fontSize: 12.5, color: T.ink, marginBottom: 14 }}>이 계정이 맞나요?</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setPending(null)} className="press" style={{ padding: "8px 14px", borderRadius: 9, border: "1px solid #C9B58C", background: "transparent", color: T.ink, fontWeight: 700, cursor: "pointer" }}>아니요</button>
              <button onClick={confirmLink} className="press" style={{ padding: "8px 16px", borderRadius: 9, border: "none", background: "linear-gradient(180deg,#3C8A3C,#2E6E2E)", color: "#fff", fontWeight: 800, cursor: "pointer" }}>이 계정으로 연동</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================================================ 저장 + 셸 ============================================================ */
const mem = {};
const store = {
  async get(k) {
    try { if (typeof window !== "undefined" && window.storage) { const r = await window.storage.get(k); return r ? r.value : null; } } catch { }
    try { const v = window.localStorage.getItem(k); if (v != null) return v; } catch { }
    return mem[k] ?? null;
  },
  async set(k, v) {
    mem[k] = v;
    try { if (typeof window !== "undefined" && window.storage) { await window.storage.set(k, v); return; } } catch { }
    try { window.localStorage.setItem(k, v); } catch { }
  },
};
const TABS = [{ key: "learn", label: "학습", Icon: GraduationCap }, { key: "dex", label: "도감", Icon: Library }, { key: "puzzle", label: "퍼즐", Icon: Sparkles }, { key: "set", label: "설정", Icon: Settings }];

/* ============================================================ 계정 (회원가입/로그인) ============================================================ */
async function hashPw(s) {
  try { if (typeof window !== "undefined" && window.crypto && window.crypto.subtle) { const buf = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode("occ:" + s)); return "s" + [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join(""); } } catch { }
  let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return "h" + (h >>> 0).toString(16);
}
const ALNUM = /^[A-Za-z0-9]+$/;
/* 계정: Supabase RPC(app_signup/app_login/app_save) 사용, 미설정 시 localStorage 폴백.
   반환 형태 { ok:boolean, data?:{id,progress,chesscom}, error?:string } */
async function acctSignup(id, hash) {
  const lid = id.toLowerCase();
  if (SB_ON) { try { const r = await sbRpc("app_signup", { p_id: lid, p_hash: hash }); return r; } catch { return { ok: false, error: "network" }; } }
  const k = "occ_acct:" + lid;
  try { if (window.localStorage.getItem(k)) return { ok: false, error: "exists" }; } catch { }
  const data = { id: lid, progress: {}, chesscom: "" };
  try { window.localStorage.setItem(k, JSON.stringify({ ...data, pw: hash })); } catch { }
  return { ok: true, data };
}
async function acctLogin(id, hash) {
  const lid = id.toLowerCase();
  if (SB_ON) { try { const r = await sbRpc("app_login", { p_id: lid, p_hash: hash }); return r; } catch { return { ok: false, error: "network" }; } }
  const k = "occ_acct:" + lid;
  try { const v = window.localStorage.getItem(k); if (!v) return { ok: false }; const a = JSON.parse(v); if (a.pw !== hash) return { ok: false }; return { ok: true, data: { id: a.id, progress: a.progress || {}, chesscom: a.chesscom || "" } }; } catch { return { ok: false }; }
}
async function acctSave(id, hash, data) {
  const lid = id.toLowerCase();
  if (SB_ON) { try { await sbRpc("app_save", { p_id: lid, p_hash: hash, p_data: data }); } catch { } return; }
  const k = "occ_acct:" + lid;
  try { const v = window.localStorage.getItem(k); const a = v ? JSON.parse(v) : { id: lid, pw: hash }; window.localStorage.setItem(k, JSON.stringify({ ...a, ...data })); } catch { }
}
function AuthModal({ onClose, onAuth, initialMode }) {
  const [mode, setMode] = useState(initialMode || "login");
  const [id, setId] = useState(""); const [pw, setPw] = useState(""); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const submit = async () => {
    setErr("");
    if (!ALNUM.test(id) || id.length < 3) { setErr("아이디는 영문+숫자 3자 이상이어야 합니다."); return; }
    if (!ALNUM.test(pw) || pw.length < 4) { setErr("비밀번호는 영문+숫자 4자 이상이어야 합니다."); return; }
    setBusy(true);
    try {
      const h = await hashPw(pw);
      if (mode === "signup") {
        const r = await acctSignup(id, h);
        if (!r || !r.ok) { setErr(r && r.error === "exists" ? "이미 존재하는 아이디입니다." : "가입 처리 중 오류가 발생했습니다."); setBusy(false); return; }
        onAuth(id, r.data, h);
      } else {
        const r = await acctLogin(id, h);
        if (!r || !r.ok) { setErr("아이디 또는 비밀번호가 올바르지 않습니다."); setBusy(false); return; }
        onAuth(id, r.data, h);
      }
    } catch { setErr("처리 중 오류가 발생했습니다."); }
    setBusy(false);
  };
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 80, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 340, background: "linear-gradient(180deg,#F2E8D5,#E2D2B2)", borderRadius: 16, padding: 20, border: "1px solid #CDB98E", boxShadow: "0 20px 50px -10px rgba(0,0,0,.7)" }}>
        <div style={{ display: "flex", justifyContent: "center", alignItems: "flex-end", gap: 2, marginBottom: 6, marginTop: -4 }}>
          <Mascot name="milku" emotion={mode === "login" ? "wink" : "great"} size={92} />
          <Mascot name="kokoa" emotion={mode === "login" ? "happy" : "celebrate"} size={92} />
        </div>
        <div className="flex items-center justify-between" style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: T.ink }}>{mode === "login" ? "다시 오신 걸 환영해요" : "OpenChess 시작하기"}</div>
          <button onClick={onClose} className="press" style={{ width: 28, height: 28, borderRadius: 8, border: "none", background: "#0002", color: T.ink, cursor: "pointer" }}>✕</button>
        </div>
        <input value={id} onChange={(e) => setId(e.target.value)} placeholder="아이디 (영문+숫자)" style={{ width: "100%", padding: "10px 12px", borderRadius: 9, border: "1px solid #C9B58C", marginBottom: 8, background: "#fff", color: T.ink }} />
        <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="비밀번호 (영문+숫자)" onKeyDown={(e) => e.key === "Enter" && submit()} style={{ width: "100%", padding: "10px 12px", borderRadius: 9, border: "1px solid #C9B58C", marginBottom: 8, background: "#fff", color: T.ink }} />
        {err && <div style={{ fontSize: 12, color: T.blunder, marginBottom: 8 }}>{err}</div>}
        <button onClick={submit} disabled={busy} className="press" style={{ width: "100%", padding: "11px 0", borderRadius: 10, background: "linear-gradient(180deg,#3A2516,#241509)", color: T.ivoryHi, fontWeight: 800, border: "none", cursor: "pointer", marginBottom: 10 }}>{busy ? "처리 중…" : (mode === "login" ? "로그인" : "가입하고 시작")}</button>
        <div style={{ textAlign: "center", fontSize: 12.5, color: T.inkSoft }}>
          {mode === "login" ? "계정이 없나요? " : "이미 계정이 있나요? "}
          <button onClick={() => { setMode(mode === "login" ? "signup" : "login"); setErr(""); }} style={{ color: T.cocoa || "#5A3A22", fontWeight: 800, background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>{mode === "login" ? "회원가입" : "로그인"}</button>
        </div>
        <p style={{ fontSize: 10.5, color: T.inkSoft, marginTop: 10, lineHeight: 1.4 }}>진도(도감·해결한 퍼즐)가 계정에 저장됩니다. 데모 환경에서는 공용 스토리지/로컬에 저장되며, 실제 서버 연동 시 이 부분만 API로 교체하면 됩니다.</p>
      </div>
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState("learn");
  const [unlocked, setUnlocked] = useState(new Set());
  const [newUnlocks, setNewUnlocks] = useState(0);
  const [puzzles, setPuzzles] = useState([]);
  const [deletedPuzzles, setDeletedPuzzles] = useState(new Set()); // (UX5) 삭제한 퍼즐(자동 재생성 방지)
  const [solveCounts, setSolveCounts] = useState({});              // (UX6) 번호별 전역 풀이수
  const [earnedTitles, setEarnedTitles] = useState(new Set());     // (기능4) 획득 칭호(영구)
  const [currentTitle, setCurrentTitle] = useState(null);         // 장착 칭호
  const [profile, setProfile] = useState({ nickname: "", chesscom: "" });
  const [loaded, setLoaded] = useState(false);
  const [liveOn, setLiveOn] = useState(true);
  const [focusActive, setFocusActive] = useState(false);
  const [toast, setToast] = useState(null);
  const [solved, setSolved] = useState(new Set());
  const [user, setUser] = useState(null);
  const [userHash, setUserHash] = useState(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState("login");
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [contentVer, setContentVer] = useState(0);
  const [navNonce, setNavNonce] = useState(0);
  const [devOn, setDevOn] = useState(false);
  const [codevOn, setCodevOn] = useState(false);   // (기능3) 공동 개발자 모드
  const [learnSans, setLearnSans] = useState([]);
  const [learnFuture, setLearnFuture] = useState([]);
  const [learnExtra, setLearnExtra] = useState({});
  const engine = useEngine();
  const chesscom = useChessCom(profile.chesscom);

  useEffect(() => { loadContent().then(() => setContentVer((v) => v + 1)); }, []);
  const bumpContent = useCallback(async () => { await saveContent(); setContentVer((v) => v + 1); }, []);
  const isDev = user === DEV_ACCOUNT;
  const isCodev = !!user && Array.isArray(CONTENT.codev) && CONTENT.codev.includes(user);
  const canEdit = (isDev && devOn) || (isCodev && codevOn);   // (기능3) 분기점 해설·수 설명·수 키워드 수정 권한
  const canAdd = canEdit;
  const canManageCodev = isDev && devOn;                       // 공동 개발자 지정/해제는 개발자만
  const openAuth = (mode) => { setAuthMode(mode); setAuthOpen(true); };
  useEffect(() => { (async () => {
    const raw = await store.get("chess_state_v5");
    if (raw) { try { const d = JSON.parse(raw); setUnlocked(new Set(d.unlocked || [])); setProfile(d.profile || { nickname: "", chesscom: "" }); setPuzzles(d.puzzles || []); setSolved(new Set(d.solved || [])); setDeletedPuzzles(new Set(d.deleted || [])); setEarnedTitles(new Set(d.titles || [])); if (d.currentTitle) setCurrentTitle(d.currentTitle); if (Array.isArray(d.learnSans)) setLearnSans(d.learnSans); if (d.learnExtra) setLearnExtra(d.learnExtra); if (typeof d.liveOn === "boolean") setLiveOn(d.liveOn); if (d.user && d.userHash) { setUser(d.user); setUserHash(d.userHash); try { const r = await acctLogin(d.user, d.userHash); if (r && r.ok && r.data) { const pr = r.data.progress || {}; if (pr.unlocked) setUnlocked(new Set(pr.unlocked)); if (pr.puzzles) setPuzzles(pr.puzzles); if (pr.solved) setSolved(new Set(pr.solved)); if (pr.deleted) setDeletedPuzzles(new Set(pr.deleted)); if (pr.titles) setEarnedTitles(new Set(pr.titles)); if (pr.currentTitle) setCurrentTitle(pr.currentTitle); if (r.data.chesscom) setProfile((p) => ({ ...p, chesscom: r.data.chesscom })); } } catch { } } } catch { } }
    try { const counts = await puzzleSolveCounts(); if (counts && Object.keys(counts).length) setSolveCounts(counts); } catch { }
    setLoaded(true);
  })(); }, []);
  useEffect(() => { if (loaded) store.set("chess_state_v5", JSON.stringify({ unlocked: [...unlocked], profile, puzzles, solved: [...solved], deleted: [...deletedPuzzles], titles: [...earnedTitles], currentTitle, liveOn, user, userHash, learnSans, learnExtra })); }, [unlocked, profile, puzzles, solved, deletedPuzzles, earnedTitles, currentTitle, liveOn, loaded, user, userHash, learnSans, learnExtra]);
  useEffect(() => { if (loaded && user && userHash) acctSave(user, userHash, { progress: { unlocked: [...unlocked], puzzles, solved: [...solved], deleted: [...deletedPuzzles], titles: [...earnedTitles], currentTitle }, chesscom: profile.chesscom || "" }); }, [unlocked, puzzles, solved, deletedPuzzles, earnedTitles, currentTitle, user, userHash, loaded, profile.chesscom]);
  // (기능4) 해결 횟수로부터 새 칭호 획득 → 영구 저장 + 획득 알림(장착 버튼)
  const titleCounts = useMemo(() => familyCounts(puzzles, solved), [puzzles, solved]);
  useEffect(() => {
    if (!loaded) return;
    const newly = [...achievableTitles(titleCounts)].filter((id) => !earnedTitles.has(id));
    if (!newly.length) return;
    setEarnedTitles((prev) => { const n = new Set(prev); newly.forEach((id) => n.add(id)); return n; });
    const order = TITLE_TIERS.map((t) => t.rank);
    const top = newly.slice().sort((a, b) => order.indexOf(b.split(":")[1]) - order.indexOf(a.split(":")[1]))[0];
    setToast({ type: "title", id: top }); setTimeout(() => setToast((t) => (t && t.type === "title" ? null : t)), 6000);
  }, [titleCounts, loaded]);
  const equipTitle = useCallback((id) => { setCurrentTitle(id); setToast((t) => (t && t.type === "title" ? null : t)); }, []);

  const onAuth = useCallback((id, data, hash) => { setUser(id); setUserHash(hash || null); const pr = (data && data.progress) || {}; if (pr.unlocked) setUnlocked(new Set(pr.unlocked)); if (pr.puzzles) setPuzzles(pr.puzzles); if (pr.solved) setSolved(new Set(pr.solved)); if (data && data.chesscom) setProfile((p) => ({ ...p, chesscom: data.chesscom })); setAuthOpen(false); }, []);
  const logout = useCallback(() => { setUser(null); setUserHash(null); setDevOn(false); setConfirmLogout(false); }, []);
  const unlockOpening = useCallback((keyStr) => { let isNew = false; setUnlocked((p) => { if (p.has(keyStr)) return p; isNew = true; const n = new Set(p); const parts = keyStr.split(" ").filter(Boolean); for (let i = 1; i <= parts.length; i++) n.add(parts.slice(0, i).join(" ")); return n; }); if (isNew) setNewUnlocks((n) => n + 1); return isNew; }, []);
  const onLearned = useCallback((name) => { setToast({ name }); setTimeout(() => setToast(null), 2600); }, []);
  const onSavePuzzle = useCallback((pz) => { if (deletedPuzzles.has(pz.id)) return; setPuzzles((prev) => { if (prev.some((x) => x.id === pz.id)) return prev; puzzleShare(pz); return [...prev, pz]; }); }, [deletedPuzzles]);
  const onDeletePuzzle = useCallback((id) => { setPuzzles((prev) => prev.filter((x) => x.id !== id)); setDeletedPuzzles((p) => { const n = new Set(p); n.add(id); return n; }); setSolved((p) => { if (!p.has(id)) return p; const n = new Set(p); n.delete(id); return n; }); }, []);
  const onSolved = useCallback((id) => { setSolved((p) => { if (p.has(id)) return p; const n = new Set(p); n.add(id); return n; }); const no = puzzleNo(id); puzzleSolveInc(no).then((c) => { if (c != null) setSolveCounts((m) => ({ ...m, [no]: c })); }); }, []);
  const switchTab = (k) => { if (k === "dex") setNewUnlocks(0); setNavNonce((n) => n + 1); setTab(k); };

  return (
    <div style={{ minHeight: "100vh", background: "radial-gradient(130% 120% at 50% -10%, #3A2516 0%, #1B0F07 60%)", fontFamily: "system-ui, -apple-system, 'Noto Sans KR', sans-serif" }}>
      <style>{"button{transition:transform .08s ease, box-shadow .08s ease} button:not(:disabled):active{transform:scale(.94)} @keyframes lockpop{0%{transform:scale(.6);opacity:0}50%{transform:scale(1.1)}100%{transform:scale(1);opacity:1}}"}</style>
      <header className="flex items-center justify-between" style={{ padding: "16px 20px", borderBottom: "1px solid #000", background: "linear-gradient(180deg,#3A2516,#2A1810)" }}>
        <div className="flex items-center gap-3">
          <Mascot name="milku" emotion="great" size={64} style={{ filter: "drop-shadow(0 2px 3px rgba(0,0,0,.5))" }} />
          <div style={{ fontWeight: 900, fontSize: 20, letterSpacing: "-.01em", background: "linear-gradient(180deg,#F3E2C0,#C49A50)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>OpenChess</div>
        </div>
        {user ? (
          <div className="flex items-center gap-2">
            <span style={{ color: T.brassHi, fontSize: 13, fontWeight: 800 }}>{user}</span>
            <button onClick={() => setConfirmLogout(true)} className="press" style={{ padding: "6px 11px", borderRadius: 8, background: T.ebony3, color: T.ivory, border: "1px solid #000", fontSize: 12, cursor: "pointer" }}>로그아웃</button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button onClick={() => openAuth("login")} className="press" style={{ padding: "6px 12px", borderRadius: 8, background: "transparent", color: T.ivory, border: "1px solid " + T.brass, fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>로그인</button>
            <button onClick={() => openAuth("signup")} className="press" style={{ padding: "6px 12px", borderRadius: 8, background: "linear-gradient(180deg," + T.brass + ",#A8842F)", color: "#241509", border: "none", fontSize: 12.5, fontWeight: 800, cursor: "pointer" }}>회원가입</button>
          </div>
        )}
      </header>
      {authOpen && <AuthModal key={authMode} initialMode={authMode} onClose={() => setAuthOpen(false)} onAuth={onAuth} />}
      {confirmLogout && (
        <div onClick={() => setConfirmLogout(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 85, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: 300, width: "100%", background: "linear-gradient(180deg,#F2E8D5,#E2D2B2)", borderRadius: 14, padding: 20, border: "1px solid #CDB98E", boxShadow: "0 20px 50px -10px rgba(0,0,0,.7)" }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: T.ink, marginBottom: 6 }}>로그아웃</div>
            <p style={{ fontSize: 13, color: T.inkSoft, marginBottom: 16 }}>{user} 계정에서 로그아웃할까요?</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirmLogout(false)} className="press" style={{ padding: "8px 14px", borderRadius: 9, border: "1px solid #C9B58C", background: "transparent", color: T.ink, fontWeight: 700, cursor: "pointer" }}>취소</button>
              <button onClick={logout} className="press" style={{ padding: "8px 14px", borderRadius: 9, border: "none", background: T.blunder, color: "#fff", fontWeight: 800, cursor: "pointer" }}>로그아웃</button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div style={{ position: "fixed", top: 70, left: "50%", transform: "translateX(-50%)", zIndex: 60, animation: "lockpop .4s ease", width: "calc(100% - 32px)", maxWidth: 360 }}>
          {toast.type === "title" ? (
            <div style={{ background: "linear-gradient(180deg,#3A2516,#241509)", color: T.ivoryHi, padding: 14, borderRadius: 14, border: "1px solid " + T.brass, boxShadow: "0 10px 30px -8px rgba(0,0,0,.7)" }}>
              <div className="flex items-center gap-2" style={{ marginBottom: 10 }}><Mascot name="kokoa" emotion="celebrate" size={58} /><div style={{ fontWeight: 800, fontSize: 13.5, color: T.brassHi }}>새로운 칭호 획득!</div></div>
              <TitleBadge id={toast.id} earned equipped={currentTitle === toast.id} onEquip={equipTitle} />
            </div>
          ) : (
            <div className="flex items-center gap-2" style={{ background: "linear-gradient(180deg,#3A2516,#241509)", color: T.ivoryHi, padding: "12px 18px", borderRadius: 12, border: "1px solid " + T.brass, boxShadow: "0 10px 30px -8px rgba(0,0,0,.7)" }}>
              <Mascot name="kokoa" emotion="celebrate" size={62} />
              <div><div style={{ fontWeight: 800, fontSize: 13, color: T.brassHi }}>새로운 오프닝 잠금 해제!</div><div style={{ fontSize: 12 }}>{toast.name}</div></div>
            </div>
          )}
        </div>
      )}

      <main style={{ maxWidth: 1080, margin: "0 auto", padding: "22px 18px 110px" }}>
        {tab === "learn" && <LearnTab engine={engine} liveOn={liveOn} onFocusActive={setFocusActive} unlockOpening={unlockOpening} onLearned={onLearned} chesscom={chesscom} onSavePuzzle={onSavePuzzle} contentVer={contentVer} canEdit={canEdit} canAdd={canAdd} bumpContent={bumpContent} sans={learnSans} setSans={setLearnSans} future={learnFuture} setFuture={setLearnFuture} extra={learnExtra} setExtra={setLearnExtra} />}
        {tab === "dex" && <CollectionTab key={"dex-" + navNonce} unlocked={unlocked} unlockAll={user === "adminJ1"} liveOn={liveOn} contentVer={contentVer} chesscom={chesscom} earnedTitles={user === "adminJ1" ? new Set(ALL_TITLE_IDS) : earnedTitles} titleCounts={titleCounts} currentTitle={currentTitle} onEquipTitle={equipTitle} />}
        {tab === "puzzle" && <PuzzleTab key={"puzzle-" + navNonce} puzzles={puzzles} solved={solved} onSolved={onSolved} onDeletePuzzle={onDeletePuzzle} solveCounts={solveCounts} />}
        {tab === "set" && <SettingsTab key={"set-" + navNonce} profile={profile} setProfile={setProfile} engineStatus={engine.status} liveOn={liveOn} setLiveOn={setLiveOn} chesscomStatus={chesscom.status} chesscom={chesscom} user={user} isDev={isDev} isCodev={isCodev} devOn={devOn} setDevOn={setDevOn} codevOn={codevOn} setCodevOn={setCodevOn} canManageCodev={canManageCodev} canAdd={canAdd} canEdit={canEdit} bumpContent={bumpContent} contentVer={contentVer} openAuth={openAuth} earnedTitles={user === "adminJ1" ? new Set(ALL_TITLE_IDS) : earnedTitles} currentTitle={currentTitle} onEquipTitle={equipTitle} />}
      </main>

      <nav style={{ position: "fixed", left: 0, right: 0, bottom: 0, background: "linear-gradient(180deg,#2E1B10,#160C06)", borderTop: "1px solid #000", height: 66, paddingBottom: "env(safe-area-inset-bottom)" }}>
        {(
          <div className="flex" style={{ maxWidth: 480, margin: "0 auto", height: "100%", gap: 16, padding: "0 18px" }}>
            {TABS.map(({ key, label, Icon }) => { const on = tab === key; const badge = key === "dex" ? newUnlocks : 0; return (
              <button key={key} onClick={() => switchTab(key)} className="flex-1 flex flex-col items-center justify-center gap-1" style={{ color: on ? T.brassHi : "#8A7458", position: "relative", background: "none", border: "none", cursor: "pointer" }}>
                {on && <span style={{ position: "absolute", top: 0, height: 3, width: 34, borderRadius: 3, background: T.brass }} />}
                <span style={{ position: "relative" }}><Icon size={21} />{badge > 0 && <span style={{ position: "absolute", top: -5, right: -8, minWidth: 16, height: 16, padding: "0 4px", borderRadius: 8, background: "#D33", color: "#fff", fontSize: 10, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>{badge}</span>}</span>
                <span style={{ fontSize: 11.5, fontWeight: on ? 700 : 500 }}>{label}</span>
              </button>); })}
          </div>
        )}
      </nav>
    </div>
  );
}
