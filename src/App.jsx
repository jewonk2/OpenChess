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
    const ev = await engine.evaluate(sansToFen(cur), 13);
    if (!ev || !ev.best) break;
    const movingWhite = cur.length % 2 === 0;
    const san = uciToSan(boardFromSans(cur), ev.best, movingWhite ? "w" : "b");
    if (!san) break;
    out.push(san); cur = [...cur, san];
    if (movingWhite === userWhite) {              // 방금 둔 것이 사용자 수 → 우위 판정
      const ev2 = await engine.evaluate(sansToFen(cur), 12);
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
  return { username: p.username || u, avatar: p.avatar || null, rapid, blitz, bullet, games };
}
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
function useBoardSize(max = 360, margin = 40) {
  const [w, setW] = useState(typeof window !== "undefined" ? window.innerWidth : 768);
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener("resize", on); return () => window.removeEventListener("resize", on);
  }, []);
  const avail = Math.max(160, Math.min(max, w - margin));
  return Math.floor(avail / 8) * 8;   // 8의 배수로 맞춰 셀 정렬
}

/* ============================================================ 보드 ============================================================ */
function Board({ board, flip, size = 336, arrows = [], legalTargets = [], selected, onSquareClick, onPieceDrag, onDrop, onMove, evalCp, showCoords = true, showEval = true, interactive = true, lastQ, wrongAt }) {
  const cell = Math.floor(size / 8);
  const inner = cell * 8;
  const rows = flip ? [...board].reverse().map((r) => [...r].reverse()) : board;
  const tx = (r, c) => (flip ? [7 - r, 7 - c] : [r, c]);
  const px = (r, c) => { const [vr, vc] = flip ? [7 - r, 7 - c] : [r, c]; return [vc * cell + cell / 2, vr * cell + cell / 2]; };
  const targetSet = new Set(legalTargets.map(([r, c]) => r + "," + c));
  const boardRef = useRef(null);
  // (UX3) 모바일 드래그: 탭은 선택, 일정 거리 이동 또는 꾹 누름이 있어야 드래그가 시작되고,
  //       드래그가 도중 취소되면 기물이 원래 크기·좌표로 복귀한다.
  const [tdrag, setTdrag] = useState(null);   // 실제로 들어올린 상태 { from:[r,c], piece, x, y }
  const pend = useRef(null);                  // 시작 대기 { from, piece, sx, sy, t0, engaged }
  const DRAG_MOVE = 8;                         // px: 이 이상 움직이면 드래그로 인정
  const DRAG_HOLD = 130;                       // ms: 이 이상 누르고 있으면 드래그로 인정
  const local = (clientX, clientY) => { const el = boardRef.current; if (!el) return null; const rect = el.getBoundingClientRect(); return [clientX - rect.left, clientY - rect.top]; };
  const sqFromXY = (lx, ly) => { const vc = Math.floor(lx / cell), vr = Math.floor(ly / cell); if (vr < 0 || vr > 7 || vc < 0 || vc > 7) return null; return tx(vr, vc); };
  const engage = (lc) => { const pr = pend.current; if (!pr || pr.engaged) return; pr.engaged = true; setTdrag({ from: pr.from, piece: pr.piece, x: lc ? lc[0] : pr.sx, y: lc ? lc[1] : pr.sy }); onPieceDrag && onPieceDrag(pr.from); };
  const onTStart = interactive ? (e) => {
    const t = e.touches[0]; const lc = local(t.clientX, t.clientY); if (!lc) { pend.current = null; return; }
    const sq = sqFromXY(lc[0], lc[1]); if (!sq) { pend.current = null; return; }
    const p = board[sq[0]][sq[1]];
    if (!(p && onPieceDrag)) { pend.current = null; return; }   // 빈 칸/상대 기물: 탭은 onClick이 처리
    e.preventDefault();
    pend.current = { from: sq, piece: p, sx: lc[0], sy: lc[1], t0: Date.now(), engaged: false };
  } : undefined;
  const onTMove = interactive ? (e) => {
    const pr = pend.current; if (!pr) return; e.preventDefault();
    const t = e.touches[0]; const lc = local(t.clientX, t.clientY); if (!lc) return;
    if (!pr.engaged) {
      const moved = Math.hypot(lc[0] - pr.sx, lc[1] - pr.sy);
      if (moved >= DRAG_MOVE || Date.now() - pr.t0 >= DRAG_HOLD) engage(lc); else return;
    }
    setTdrag((d) => d ? { ...d, x: lc[0], y: lc[1] } : d);
  } : undefined;
  const onTEnd = interactive ? (e) => {
    const pr = pend.current; pend.current = null;
    if (!pr) return; e.preventDefault();
    const t = e.changedTouches[0]; const lc = local(t.clientX, t.clientY); const end = lc ? sqFromXY(lc[0], lc[1]) : null;
    const from = pr.from;
    if (pr.engaged) {
      setTdrag(null);   // 손을 떼면 기물 원래 크기로 복귀
      if (end && (end[0] !== from[0] || end[1] !== from[1])) { if (onMove) onMove(from, end); else onDrop && onDrop(end); }
      else if (onSquareClick) onSquareClick(from);   // 제자리에 내려놓음 = 원위치(선택 유지)
    } else if (onSquareClick) onSquareClick(from);     // 드래그 미발동 = 탭(선택/해제)
  } : undefined;
  const onTCancel = interactive ? () => { pend.current = null; setTdrag(null); } : undefined;   // 드래그 취소 → 원래 크기·좌표 복귀
  return (
    <div className="mx-auto select-none" style={{ width: inner + 20, maxWidth: "100%", padding: 10, borderRadius: 12, background: "linear-gradient(160deg,#3A2516,#241509)", boxShadow: "0 18px 40px -18px rgba(0,0,0,.8), inset 0 1px 0 rgba(255,255,255,.06)", border: "1px solid #000" }}>
      {showEval && <EvalBar cp={evalCp} width={inner} />}
      <div ref={boardRef} onTouchStart={onTStart} onTouchMove={onTMove} onTouchEnd={onTEnd} onTouchCancel={onTCancel} style={{ position: "relative", borderRadius: 4, overflow: "visible", border: "2px solid " + T.brass, touchAction: "none" }}>
        {rows.map((row, ri) => (
          <div key={ri} style={{ display: "flex" }}>
            {row.map((p, ci) => {
              const [r, c] = tx(ri, ci); const light = (r + c) % 2 === 0;
              const isSel = selected && selected[0] === r && selected[1] === c;
              const isTarget = targetSet.has(r + "," + c);
              const coordCol = light ? T.boardDark : T.boardLight;
              const lifted = tdrag && tdrag.from[0] === r && tdrag.from[1] === c;
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
                  {p && !lifted && <span draggable={interactive && !!onPieceDrag} onDragStart={interactive && onPieceDrag ? () => onPieceDrag([r, c]) : undefined}
                    style={{ fontSize: cell * 0.74, lineHeight: 1, color: p.c === "w" ? T.ivoryHi : "#0E0907", cursor: interactive && onPieceDrag ? "grab" : "default", filter: p.c === "w" ? "drop-shadow(0 1px 1px rgba(0,0,0,.55))" : "drop-shadow(0 2px 2px rgba(0,0,0,.5))" }}>{PIECE[p.t]}</span>}
                </div>
              );
            })}
          </div>
        ))}
        {tdrag && (
          <span style={{ position: "absolute", left: tdrag.x, top: tdrag.y, transform: "translate(-50%,-50%) scale(1.32)", fontSize: cell * 0.74, lineHeight: 1, color: tdrag.piece.c === "w" ? T.ivoryHi : "#0E0907", pointerEvents: "none", zIndex: 40, filter: "drop-shadow(0 6px 7px rgba(0,0,0,.6))" }}>{PIECE[tdrag.piece.t]}</span>
        )}
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
  const kws = m.book ? deriveKeywords(m) : [];   // (UI6) 비이론 수는 키워드 미표기
  const evTxt = m.live ? fmtEvalCp(m.live.cp, m.live.mate) : (m.evalCp != null || m.mate != null ? fmtEvalCp(m.evalCp, m.mate) : null);
  return (
    <div style={{ borderRadius: 12, marginBottom: 9, background: "linear-gradient(180deg," + T.ivoryHi + " 0%," + T.ivory + " 60%,#DFD0B2 100%)", borderLeft: "5px solid " + color, boxShadow: "0 4px 0 #B59A6E, 0 9px 16px -9px rgba(0,0,0,.55)", padding: "10px 12px", overflow: "visible", position: "relative" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
        <span onClick={(e) => e.stopPropagation()}><CircleBadge kind={kind} /></span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
            <div style={{ minWidth: 0, flex: 1, cursor: "pointer" }} onClick={onClick}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 3 }}>
                {kws.map((k) => KW[k] && <span key={k} title={KW[k].desc} style={{ fontSize: 9, fontWeight: 800, letterSpacing: ".04em", padding: "1px 5px", borderRadius: 3, background: KW[k].bg, color: KW[k].fg }}>{k}</span>)}
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 16, fontWeight: 800, color: T.ink }}>{moveNumber(ply)}{m.disp || m.san}</span>
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
  kokoa_celebrate: "data:image/webp;base64,UklGRogmAABXRUJQVlA4IHwmAAAQkQCdASrpAOgAPmEqkUYkIqGhKTSMaIAMCU1wDs63kIoYqAILS6cA1V19/513Hfg79Cyo+C3YPmz+U/wvnp/zP66+6r9JewB42HqZ8wX7Y+rf/0vVL/evUE/wHUc+ht5dnsu/2n/xful7YfX786fGN048Q/xj6v/L/3/9uv8H7nNvT9+6kHyr7/frP8R6e/7jxp+S/+L6hH5H/QP9D+bXGnb1/vPQI9s/sv/L/wvkB/6XpZ9h/YE/WL/r8hLQF8ln/H/+H+v9M35//q/YS/nn96/65zbpiJ/k3v6ImQ9HeZHxZQEswSOMF0tbbXnx3Exf67aRpXMVV2Crl5xpEYfYh2eJJvJfWskKBi/MiTy+miiWtR0tvLAoc2Uc1qQf494UxPAHS0hP16X3HEpZwiYaJFh7aiIoHLcbhokZuQCPkevUUVaSn1g3xy65mKbijkmcEnvtpBcQz1AGUUTFWvjS3zBnfDaln2HqA3KzjHAqbpDmVMMSGgNCwjHBnd7b+UAlo5v8A3TIX2cpthK87dVUxNpKRH/uVeWaQDqeXY0nCFfA/LRihwqawn1pDJzzJ2xEmyvtYKvLVAHEdfblTkp63gqjIWdLLZlKE7amkqlJtk6Xp1wXWWF2SP5XvqHLEn2hynaP5u0TW0YO4Y3/giZPMz0MN+gxwcISpxXhVfWUupatFQSdhg2xy+z5/GWfyecufv9y+FEfiyXZMLJIEACoF3abJ65erfdqODGeuTpQGL7ugZqcZsxBazhngqSGQjKJWRDwnl2QPHo6ieRzMAzT4raOGS8V39XcsCgBhjubJfbN5ffD6wiiH7Zfj9A6/jZF4938e8K9SPpwjCgV4cy0phb+Mi8wKJJ5om0Q4PSAtPOOVI3MMPGwgepIHmZwfainEDtsrc9d4eSGtFxgQNdmYnoRToewv6QVFKPB+9T4/CpFZ7mkzH+hR9yGBTKdLPFDaYjOEFzH6PcMQiZsHZsf9S3JmoQg5EDqlrwHIZnez1jclhOy9IECXT0joyeRBkaAg/SXaNtVII5Sjpxf4YiVqOiov4BSZHc+qIu8AywI2ge7lGjZKZGrvQTIngWpnqfUrphmMmbak4Dyieb9rOjgwg6rXfJUg1fjK29bzWBIp5OieMAVePJQluxH55uVx4jdcjw62+gOi7tTh0Pz1t9lgEipP0ougLUerwANPDgpDQr4rKuQAukTBm/zWq6PiYGoD1+KtYYGJS2/2ZrO9MHtATj2J3OptKr8kskKKKV3jLjw5cD6migVplDQfy6DNiLoWC5llV7tsbH9w4y0R44q9WXhMJ5P+H0Ew5og4g0HfS9wdeIUogHayQ1+6FwN4RVc+4fnG6ucFt8VurHMXUSmvv3jzbmZSIQHW0NMAFrPKpJn3Q1OcNpEi0jzIKOdoThjW43i+EIDib8v4lO+Q8VjkeJ4xPyLSu+rtaTpG+2tY1IBawOuVxtTLqB33H6r/nTyA6BPP6Cx95q19g0/ub9J+KOgzQc1+4HLVJLvY3ZGcnczj3xTFi0Okw0ecgpnE6VlZafbvvvuEWq6Z1y1fPzOAAD++nYSAMP3MPEqEe3mHx+NGn1luhep5V4bt7oWwaW/dB3JtyBqUYMhdVjMxEECI2gjBBpZWenfchdA7l0vSe1yzjr/SyrcdGC85RVdG3xvx5yx80fNlyHjmvj8DKAn2R9klbfmNgfvqtbUyqRsJ4PWY8J4uf36ZRMZT/IfICVjXCV4/oFOuuJUl/tXXsQyOSKLmKyzT9tG9hCt5htwP7LqoPSHbr4YPRaFkkxH8R29/m45OBIbWV8RAWxq+8FHbunQx3p80uFZb3AJrRQs/KMuuIOzHXbQW8jDe60nd9oXm1l57Pkk/NAAvn0aINQIerQTpNitpPyFQ+Ow+uGnftucujaeqjiF9jTrn9n27QNuL4SDiwxtuRrnpgX7kZhEMgCdtCQqgMEr+eFGWWDxf4gD3QBg/P+6wUoruk7beVsOuiBsnnptxm5BxrTbLanWKo0tGUi1QsJL4IUoxxpcM5X/BH1Qb4jIwt2R3sm7U9s8qNhcFXVsymmNL0OslWFZTYNerpSOoNn2QA15SzYKnuwdNCAcJqxGHHar9Bzzm+GUXdV5kKqVFGreKUIi3U3il628iYeeGWa06lnG9at/+dNt+l7/PrZkTJ3DPpr2zWRco0ZLxLuoO7zNHujdirkuHcWfy2aYPQhNGSW7andOvcV7GHeWCb93MzG99qnFl2O/mx3n3H6ChB5npmuonq+ilHrjidWKbFCo//hFzhMUFXeowSnAFutbOaTdOCfJad48hS4ABXieMYQA0g2jkJyRDgwQ2MX28z/Uu4+wUXWQuOftNppOcRT6bRPcISIPX23FHH25GVtzag0m/zRfSPR/EBAEPoOAUW3B1OrPbgLgK6ueiSXMrQ5nehtB6OJuClBy1OfkHffISGuxuU+YwxBa6pTmGNSmuTmdA5VzvqnhRjhjO1KPTy74detZ9Hrl1F3Jh/x3+MxOR+L8gXJXUZ7yGHILUQyRxoNGHMnKjFarac6IkRQqZlDwckX65Md3NiSZ5Xw/YeuCHErQFo2MDXXUCag2IpocsU3SFhCKblI9HiMH6zmfGFEe46eFlY7wB3VDoJhB2tte3LduMg8NZWdTYNAcCyqskrAKbrz5aquC88q9/XF5SI8h3KoFcpUV5dSOT8f7iBIkdO79WYOaNybrBLw7Vcl6xlAURN/w26/KRp2l01ElTf+liZx0hg44ZFusvkCxbV2fRIC2hmZ/hSZT7HdtYg0VlKRUi4ihAVSMMurXnnRjKu864KNA/wDoWzbUxedpBk0cDvD7JfhCW8gx2Z9l8dg/eQUxzSQqQusS2LwfxTy3DfhzFQeJKR6u8S1Cb0EX2Or4nWPgryeQenMzfxfJ32kedASk2nyCz2LcoLOdYpBikFV/Ug6NaUkS0Y1VtwKj3xIROmZk2tM3YBOw2qUu02U5i65DQYW589VXZ8qX2AAW1DU3PgTu8/HVhL3aWZilRNgyQYghK+v7589Q85o5SNntKUlTr8oO8A0PhAf6VgAlKrbIrmDr3OpoPzgQVXUb+H8fYIZN4kj+JAkqrny/kQWadpTA4uaIOVdk0VSDIAQHji7iws4B88Uss+hd7TbJMqkjCpCu465LS9oyryjC72OxAfo9G5jZId8pXCAkxwoWHTvGON8CkKjYhVWGeY84fUuzdI/Xiw9n59I0PwUKeiRe2WfNRP8FvkRxqL6yqYAa7rhykkifgPlkh554m3MrRYLOMPEbpM59iF8bOWcWo0pkeDJihVyayYM+7P9APf/7svwRkvDq9gbdCJFkuoPsc67RLsAnc7s/mNKK8s/0duqGOYKy7DLHxGXDQbIJI9EhraIK8a0BoIiBzAbcTS32icJ6rX12RLbB64H0pIVLUsrr9/s8/KR/4mHI7y9mUk8vMk4VqPli69GLsX3d0gVkIFwBjqDCBXvYBW9/+N8Rat1ZSAmwqby6rGv3LSWEW07IcrsUCaRfzeAjtwvsWYJ4+J+O2WMR91d9DR5t8Oiqija9CX2L8j/tXymK9Y3yC3yT2MdySuOaqRMj1djfe/gbXwO2qFIbc0RXdWd1EbpduaSXeZuR/w2FNrU4u1RGPzoeY4pQibu3+UKihgrAr0MNHlXQZnvL99QdfmwjOqRp/zp6g4i2Dau8e1o0mZiBWcKUm12pi7BLhEM2B9g/l+pCkay+xENUYd1MX+9yC1bG/gYB06+qhR66vUy/9okb6Tv2dnba36T3iy0PgMb7J/4UyrcEqXtHrKcgc0oi3qXAIWPPKSkLuC5XH94ylL8P4uQ/CsCGH8u6sfPBYojaoEZUiPN2gu33SYrZ3w0qkosMYIuIthjizee8ImjqRZ8El1Kdk3wf7UowyWzqnzKsMy5gnCuZA7x5egxM7ozLrX7vH2JeSYpgVLzGdaOv7fjTenz3/8ipb9lL1ESeBNXlGi1Roxv+7SXQcTwZnLwFAjNjAmnVdlliHcX1FaqEkE/4V8Q+A0Tr8VMUdAGf9NkI5lXrMw6cdRdn/il+x/wOvBmPC0VGOkswWmqLIcAWtl5Hwg5MjLQfCToLQerroMhvJIWbShZc4uLk/AoOoHzCp5Zkr/Ysf5teDU5vGV5Xa8AO3MzKaBh5bE/6Q6f+ukfci/Xs8Bo8wnvR/Wal1B869CDtVUeA0+VOfRUMYlYPud9A0Rc+4vvcz9MyinVkaxUcy7O6HzbRl04c6IRAXS/XfzMGyVNWDzQUu2lq4x4fJXXA8Iuta5X7W1zrS32/ePkjd/4ptL45YorVnpdmsAI4LTZ5jjCRa0LSWZj88AVHzmdurAohZV/TPjpjxBsNEbx2CzC1TX91VLPrzJu7tlWlDQgUdBpxLw/PF+95FwtdQYUvYj7hvpcZ8F0LYzvrZh8Aw9BFRrRyDATBdyIFZcqWx4RMwxis02M4UlgO744Z+p+/VSFn0fYe3nAY0Dyx0uT2ccOXf5tweXR59PkKn+VBsO98SPgJX4nLur89GKRwAqcKgeDkK2VcbslRpA6REYw86ww5ApqrDozLCR3AMhqfM3aPfUjyOOS+P7r9Pq/LTO1dADewrrI/uWiOnLISlRFFGdp+7z1rpOHJGiaj1SVx2Ba5EwWClG3DLMUaZHZZWkGhEYhh8dOQx0NJaBsP/aATWHCceLoY6AGqyQLyYkhvV6j6s+DYlpyhWQ6yRPZT6ADXiKwI35fcp97M59AfjIWL42aqQRWYAAfy08PViLy5Klab5FBMbvPuBzDcKAEy8lhSRf8lxNsMOM2QI3lT0cQHmflFGMMLSfPVjoJv9IDG26RJdda101nKYmj+LlK4qvcC1LjZGN+tB59c8Zz3DMPsbbjzZU996kNeu8hikT6O5cn0n/uJanKUf8OuDq93BHI0cdTIyhxKOhIUy3e6bZxwj6y90sz6+wGjxyyt9gCr0sBIcTX8G/8uSCcz+IaKUTWSU5hG6OTic34AKVV/bvmwRQNNen3j5RkVzRHeOMpiHmZKy31Ib0bkfiJ0aizyia7IqeJcZPWi3lM2JpOg86eyTqkkOatti+zhvarq4zmaOJDvlG7dRhbhddjd9i5yBNODzEX4cWmTSfua9HkOO/bBbsiZOcIxjRr0SvsOG7EQA6A6VDtiNB/gH/w1qfLznw4Svph9MiHwWPQOIcBhu+9PmNClCREpyTOSgcpsdVPIb2MicPfjeg5UO6kw8Lms/pmRLPnubIaGKvm+kjB8H8wUvM3a+ZJ6FNf1l2U+Kla6oBlAkb4suBMGPgh+N+dRQv+wjcWsbMm2mq5s5jY09eETNQj6DzkJ6q0z0B1C/Nr6t/dubDmauxD9wb+IfoN3QI9ko6+u7MO8wEMEk1uaQofwdVDbI0f6XEPRQMtez+scZQMMCdx0cRgI+1KRPQcPu3ihIiWFDrUIq+7qzXIjfEbZdjs6hfFAXxdjOy33eehSNUTsPd+dR32VQdMgO8yv6/GNltTqMVg05j5+kca6FXadT1QkrtssV3SC4i5BgZLoj7glAuGNXY+QyGxGTZiYYsaNwbcv87qgmK5JHv1dxeipe4xi6jZdx38G5ET2okviJrS5QnmTyzcfHWLubgROIiHji7Xjmb0S6wPQLb7Uo2j0lVyES8fncdMrmoZHeXmtoXqT2CGiCzMAXHU/PQ5pBws7xIyw5HT4gebqtsWsmk63LsK8dztFizrjGEWLF/PaU6916JJXwbJS+/wOdsc0P/QMXzyJXwgRXh7C82mLZQwNJqK5LcRqbhr2K+7b/dXq1QskdflDtVw4d+w6EdKP0Zu3vk9UCyb4j1fX7aqC4y5jzba5GecCVGV3HGzBnO+fyF5xsXp52n3sgZH3rjr2WtUdFH85z65CkWPWfWuNl/Q54cimUKVHrKF8kKpnbMq2m6Dtl0Nxf/hFTce6URy0+s0Xl90mU2AopliqleNUdrKx9akf3TORx6pT1P9aEldd49DhlmTsrTXksoz/Da4F28rv3XVp2PWLol8L/7yflZMlOx9i/bacU8PsHuJqTxwDtW2P+zTQbL8Pa+UU7/jKO66mOoWN6k4AFw0YA5BNZL93R4GFPm2WBOM4Ppv0TTO+8zdqV+PyNA7k8k7GFIXt9WpbEYGwoBmFVYok/+MBphLUpKK/YgmoQzyrZvcT04hb9fCmSckOGvz/j+YyVAKTOZ7PF82y3sZ+LH1iKbmx+hCEVs80ZcRInlb7EY8ax0a5V9+9W1QEo4Z+ZFFWiRBlD9LwksEmevAPRk5puFnb+395xOx9TR9nlLhVKpsHTRXTyBGrlp6t8De1pZXaA5/0HYlHNubn5PzWqJ15ktEgd7QdXhuIuLt+nCJqorfssxe6K2qXmO0BBGiqIpVKOD/sLwkX3So5YGxka/3ed7/Z9tljFxERpzz0hctjlp47E1cmaLX3kZrYKemf8T+s5bI1Wpa2Qwz+bwAaQE3epDHxbKSd82JnDKBvU5YPaZIaXhTQ0mvKHkeTOdQmkid1yvM2Xv2S2TmLEeyQFvHEzI0d+6ou6Z+MTnTPjH6E1cI9Zni441g0PUEVE5rdNMz6JurnQJhu1/8lsRbuXAsXgtOJlF+ZYTXXUo9vf7VjIQI9uk3Y4Bq/3VbW2c1g72c2bYqK9XiOFmA0tM+65VBInWwdxrwceAraNbHNmM49jpwNv4R6TXzixX/lkEvzhshK3JXjNyAKfawUWnOQRhWxlx+Z9z3iCP8Gz0RBbrdxp4KmTvP1wH6dkFopl7Mq+c47epqDtpPH1LSLI9wFB6+XzpEvknRa3wipWaqgqEU0Bb21V/+XAGLr2TVGnDIfLraoqTBgBVXXcBDQU4sL+nvhKUgmm+NqzKiuaAKBm+21say9CvgGoy/0XqVKTh0jauKJfhfqJn/SZu5KIjI/AApbEfGjv/vRv456+hb+ps7dPfogpgzwFMuPDZqPD4zg3FfrsN0H4keXNRejLXPpLqhD+XGfs9dfk15HH0VqYdpnKyyUEyuGTiycleqnrjqR/KZWetTFCTpGseeNHiHT3qfniCTxoy6oMvm0uhCv4xUPSMGpA4OaI2nGBly9N0knhfl86+PQoG5Pgm+rGdiWXrCHP0SJn9GBcHAtJa3oYrgjuXPgsn3WW7kDc1KcdrtsEofgp28SUPsSVXtrApVhwtczd2OZxoeCgDrXiVITR09XrkYhmTgPApZa8V5CYP/y0WWmnTwQ4LP7qHV6i+P91F1R6RZNZtV5fRYtRpTRqgZVYk9BYhBIYZKEjFsNGLHkrQCfOV/CiuEefzR1oQ65mCE43AY0anVpCTnJkJh+aDJ0so7A7zNGdFShZ9ccOjCss6ISRVk5DBOUBinvUvROawX/BkpkLbyol8hh9qnY0EVXx2wZL2YWPaTzvRMSOLHmCMLYDDkiy/Vf9apSh4+sizltTivZz32UbUoj6BeO/nnDCsb1ga9oG6FJL9VudRo2bECaJMPiDwYVNiK2D//Vc+9yprY5ZO5AoBY5lerLAoS9HtSON3zsGD3Ee8fDdZE2NXRbpohjw86z90lqfP+53J8yybpC2DAd5Fnhx1J2+egasNQOvo1z2tu0EzONbOrWs4REoVAKYvBTn/p+VGrIX00MnixZrx5/rOUUruyqt38h8friZ4kDliLJ49RCLe/CeclasJgSn5lPK8bej1IH8utTkPHaffGL9taRWNGXH6sA8P4z8TgtRd8I69FFWlr9UQ/LDd0xzwd2Sd3TEQSwdcOsgs/uvwfn/VDshy79NO7/wqpheAvFKTrVGKd7+k6pu1PZqRaQqPcp3MZjLr9RYkijcs7z8ujGclXF9MHqjOtHTwEV3xTv+JUJt3g9/bl6vRl2v3AkfmExJnOcX27K4DIZZZJeFWgz4Isg2KHM/EW+eRfUbDLdJ7ecKO5myeNH+0oq+ol14koN0KCvxet6cNsLy3KFQfBvcqAKY8JVxQnF2bsnmxf1ydNaxAkmNW+lC0xBs+bpzlvvaL6OROUh433tH+c+C9HO1GIZ9Nvv5+qpuxXxR+5pK2xxYMH982QfzXS0fx1MysBLh/5hSGav+Y6ZagaU9fzzA/Ot5KDgwenECJu/4adatlcr8MrwvGKsmGbaBD0rE+dwHRlb58+ctzOKgbBBNmpV+Vn8BE0MkqfbDV71zQkqj0P2lZWQZjBJWE9KdTMEFK6pWL6POg24IPmPP2852/WgCsNMRJHV5KlAkIsOUW++tE3sk6PqdlKB8PiaZhVG3ujNjd2S2bxP+1GL6iJUG1BhtFzXLJvad3PU9FWZoRZO6kcbV9Yk0Sfzm5HQBKTXTbwAZsaG+ZCEyvMDsOAgZBgoO8aMoLL7l3Saf4ATJm9+8SsdruBWktWQ2JB9Enaz9qLJt+LiA5+oaxr2SUZIqDs9ox0VfRXG0vQZMNB0SLHrjRItMUJqfB0MLu5hYNesSqg88N36TK8mrJSbhUmYHQToDwBcIdsFekfChLKKh8JeCwxBxwXPutXAFf56H+Ax+W+A0mcqeXjnJWqUY8HJmjxPIx6gQrKYhmCOBQBLbqGxmhnELIcmXn00gZ361alzUcYMdsGBwg15erNJK0ipq0MrI8WzQQQE/GaMI/lhY72BgSBhbScHw1EAldLWG28HltZOuzUh2cUM+GcwmEZvmZjGFGDX0jDvq1k1K11QP12IRyx1nH2s3pbAIpNci4eHR0dTehVfZhJFjz5mIDVsEsmbfvUAGN6g9CSYqJ6k5qHcT/XPjG4eXIetrRSZNUBImoDaH4Csg6KOiM726qhgcZBnzYkfiVkFbdyK+kdRegsNOXqwcTG7H/we0be8gqbpkegDZ3WjDgAdUmmIWQNg7ieXQGDVgjBdPGlbu0tzf8on9LJqH38qUi/hq9K/exBUMR+kIoqEUXdBj6D+As96At/qgTalVjofzHT84g0QTd7R1pJKe85/+FStqTCD1a6Z50Fngr8R39UDWJZNADwq08fS66pMYBuHaq/JKDHhWrsyXBczAgP7Mi50Dj5IHHEVpEOX9xkxWNYRd1Bluc7+Uqu2M5o+OPid+ejWXN8rz+BHeBp6IQHMAdrUwJszE3Fj0gKphWhfsNCkGSifpCRMga3/XF5PerGx7Yg8iPCslA/VTbsc//dtYo6t9E+KhXEWM6EzyE0ZaciXFPtuVYovym5eNeaRYlTI5bTMaIfuZutd8WGKK+IN38lQ7hQYea6NyY/YL0Lbr1EHP9wFQbmxyZHboHvmQTOSsWll+jJyG3ZmnVWdRQwq2IBRuykEmwTITQg5bbuQAkt1VeLgCGLeAcAvxahv3uVf7FXUmJ2Fmt5GiQiC11TnnocvHlDz9oVXeTjmuZC4jSfePah2erReMXjz90bIEBfm6BDl/s5GZE9kjv2Vyj5WHjGEaBlsnZG2U4VJVkpTWaTIE2Saj+hb3sPQoau9sQhc5fkgIN0r+tNF+MfeJ8T1xd+JdKyc8MOP+r4dUV6SNApOVboNf9yYEVqGkGQfgp6GU3NgIIZQA3UKJ+i15WpE1/5iW8PQ+GaZKeG3aQbBJvUhisLDYvMSuxbT3T96vBzvhA/TtgGuy3J3wvF6hCs+475P8//PAP8hZahiYv7THSjuqMA/qd9vZ11lkkq3xLjZkKsV5sZjN0dul2h0Ua08xAxNrJmvUfBmdop1fGu8fzHX5bwP/LrOv1ixZNKFf04gH58adcCqc0dTIpmTEToocNlMrh30BHfAq8TbbhKTFS0/GUjL5Opo4nJPGQDAb5nxB/NwG3K8Xbat0R+Tnb75hc6d33dTt7ENwoslHwDWwRWu23nmNtzu8KaHMBEnPTTw4vacVSphEV84QXbeAd0IDf9lCo3ojMeKJSMhpcmF6dPL2dYAjdDAVJ3aNtqNFSj27BqcvlHukW6hHg+TZ/OM+HLD04TeNDlva0XrIZSM+vYiAvlvwKYWOfB9mcji7y+b6bC+FgQSpkY8vYXZyD0Viclk1wGqcJNAmuR8eRIJBg9i3lo6TK+yWvSnDMxH5m1wNoqpVf3Vi4r1FvqkNkxPUv7IbsI0p9XN3vr9PAscnt0+0XqGD2D1I7+yS81+OIIfSy8lgxooaCJ0j8wbjPyJPlOOKdKpizRPyFBEA0vj1Im2/KlC90En/02pTc2WW+hu4hsMg9n6TEPqwByh7k7naNxSMx6Ubaep9SHszDoo2562F5xEirDC2BldU6MpXe2Y9bfqcfqN+fwFsHuPB4Ubjcpc3+XyUdxRAwX5O2dkqxyj23XVfqZDbTp4MvRAXh++xQswltwID4E/lPpE8o8UEE3w++yIDNCuHjYLfnSdNiuoVyykvlxVSjGtEHJ40pmJkVWDndyJDCu0KG8SoAf6MSpOtBSXJKCKxbarkU/v4MgRWL5S6hTKruP1oNfDafFz7+T7qUkmjwJD6YG180zD4/e8wz91Fsy9J4130DIERLtnsw6vJUpO/TEIjLYk4O2Ok4eyK9ZkZPLwHxdtDn6qvNfEBEx4PFHlBWUDND1OEuvr/u0qyYFMj/adJHcGJqHpMlwyCfgD7msrzgKNErol3WC3Vm2paWnxQz4yePQqP4gmLhC01TmM2wEtKIFZzboVWEU9il57iz6Lpb1poEj0/QOX8vvfOcmB0szqj0YF30yREjIBujgIeYcZRSEGrqpZd598y9V3HSEupdB+q+mPtpOFOF4xkkXJ/kmwZJvrewPiZQkaGq7lQYpUXSgtmfoB5J+uDKbbJRRwxn0z0Th6NYNgpXF/Ex/6eqb04qt3RUUSRqFQkpRpLtNCLKiKKchOP7z/k2p6XGFlP7dV8+u7ntZp8srK1VI/l86BGQ9uDyYU2miFlRjIN1ODGf2nuFjRv/zXlUMkJ7pJEFIm7CBce0YT22kkX4+tMwZjg/z/VNt4/VRgNYaCAwpTDFd82H1T/TGe/KVak6pUewJDc2gm+PjSWhh0MfvFPzYBNLjSk+DAkir+CLRLgRWwQ6t4b+EZag5lqryqKm07Vyj5zzsfdKHLOdHo/SIZbPl4ckYry5TK+sBa3fhjVLiyB9/7XiqVKsc+8T6UZLZ/43guBJFznKyj3dsf/grZmegFsubGO//Y6dX9iCIwSsQNBjIlxB0qWp2foVoR+SIogMCVAMSbmx+xT+2G8tJCU6cO3nwhcliBoSGeK8xICJKpPT5o0IkryA3fy9kq1So8J7ceR6xxfvHWWjsks9huB2i1poSdcjSi+A2/xOKGPi88sVqrYTah6XOWzdWv4pj3Tu6+zYRDQ5bDXesg1RpdK/fsLZLdsvXg23YKmd2ochLdx88Wycc7S31KjzU3M6xpFUbd533p3iiI+qyUANHhJgdd3ciVG1xaoSJbX0vuAfkE6x4qTO+MiVr5GnUaswSsKpwHHGnAxskfGbjX8mjhDk8vp/A5JuHAli138yv2MX95rrAARgfHtB79YctvZEPzzxA+Boid3kNFoJdOIzjNIT+YofxkxaMx2eQ5HgmF6FKXm+ZqPVUAgCWXGnoPa/+7/RbcOrk2YT/hwwVsO9mlJyBFWibk+8uV+aNf+cLl5hGhnAtrkiGNW4CSvCY+Xxg1aRbn8Hr6RXwHluNSRLA+8EvPGQrX9w4Yzah3QV2AT4tkuVH+e2+JMwptbD+7LRfn+fPe/T70Fc8ugwnu1rJJsVDExsRth9FXZ6NWqonx59AsZsNirKFuH1O1YII1oKNNoc/oq6OSCLozSBR8nx0GfPvQXSEKrLefxKXuC+yZu0MgOA/DkR0VNr8WaXWUtXXs1IA7wu4fwk0Ji3n3Hh/dW0xjXoycPymH2Wy93p43kgcCpcMcidakBRKG6bSE/pcv6M2Mw7dzhxftmAoIjUuJa1++Pm6Z+5+9iqQGOGIa+TqCCaHbciGd2qBZh4XL6LtKJ07YFMraweqZ1QwymxqWXdOV9kfR50cXMF0IT8wy2gyDOZRPwWg8UxfEfKnWvWXb0PKK7odN8KKMTewnHjFw3QNb/Z8oc7veq94SITqkGIWCIwBZ8gvNWR0YofTXNK0578io7E/kNLa1SsLMpvpLdsqp2vhoAfju50wC51AN0eIhthULiyG4qAOkv3RX9pto3/CXG3aAkeSU5012+VY/Kq+GUWcEZ3xwqX7C64mXHpq/nDzdqygjwUFI5FtuSe0wAvNyYRBlzOmL2+w6FKBDfzk/ln+zd/AFsLEqJhzurUStbPSUv46n+gdwx/5qogTmpCve4yWpMkEcmpSgukxbRFutGWob0BRRtzv+9A8xOlSGVKk2kmGXaT4/BPZ38FtFBBZB0lS28qFbYECFfmGgAldek6+6O7ZmuvFQFGMsagOy6maOVZj4E1CAThcbstLsYFpvPBZlgflJ1r8Qs5eyb+6bYcvi0WtRys6r7RuCZPc7ZC8aawn0EvqXgWcLh2koM1Q4tO13Wir/P59DyxA4UOYk//SPbyDm4hEVVO4RV7UqQ2jwj3cdPX6CwGQL2fnU85ibxyaxmAKD3HBWz6a/1bNCz+uxkftJNwpuWxUnX/H9rxM+TkDlo5DrJY+UmsoV0uvrCLoO8M+wX88vcPTQfQ0cuYSmYmaHnlJwrMpicczCn5o7MXne/LlrQ9VvZCkMmZax+RCqfLp75PLZC1J+IIkvo8d2DGCOdXSlrCz+SrJ/fi7ZbtSUHByrBkdofM4cs8OrYhZHo/PuVH+osovjMFIpPxOcPElBWl6aGGJSQ30c4CrQiFgkiERx43AFtCPu8NN/bMh0+Pr8HR4GiKZfIxbLLyGMapLZj88BwBbYVBqggcajE+l15pt0xd3RBne+MiH30InL8uho2lGLLplVLjts5JStPiScmKgFr0VpkefJ5PA+VcFdcwofwhBkOBdOEFkp8PglL0U9OvYuN0TP0pInFtqO2nGdgZJMc/YTCjHcFRvw8ucrkCOhla9ZZepyJ7t0B6SZ8zkf8ZbVYIPC9mY5f7RVdJiauT56wF1M7N98jOMWIaMmcx0HZPK1lrWqd7OEr9B8LJPYF7wd6p+/vuxFhsiIR1mUmCPCCIkDglp4WhLgBaUvy1nZn+EK/5sNRrL+QeJAMxb8H1TcDqbx0sE3lJLhgMIZsH8aE95hhD2iYZMMwyIB/b0/1wF4AABBB7SDgJjDf2zPkAA/8i5skNbVsXjnOMI9iVLJXzKiAKIhyY3zOiVTjVV9OAA=", // 3783 홀 들고 환호+반짝        — 탁월/퍼즐 해결
  kokoa_surprise: "data:image/webp;base64,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",  // 3776 놀람 "!"                — 실수 발생
  kokoa_think: "data:image/webp;base64,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",     // 3778 골똘(먹구름)            — 우위 점하기
  kokoa_angry: "data:image/webp;base64,UklGRmYnAABXRUJQVlA4IFonAABwmQCdASryAPIAPmEqkUYkIqQkqjQr4JAMCU05IZWGoP2hjhoi1ApKL3gKGsvtJ6/z1ra/kuLpsvzP+bvOn/pPVt+nPYH/XfzyvVP/dv+f6hP2h9Yv/qeqP+6eon/cP+N1mXoEeXX7Nn9j/5npddfpqUumH5L+gv479V/lv7v+23+A6L3Vn/N9Cv5V98v1v96/dX24/6vjf8vv7/1BfyL+d/5D82v7r8bMW7p93R9Qj2Y+zf9H/JeOt9AesniA/0r+u/8XkM6An6l9Vz/G/bv0x/oP+t/9P+s+A/+e/3n/mnGbUfawQcPLXcCZG7ez0xMYj/RgvySgI1f/G5FuwWj7XPtiYS3aP12Bf+h9kdsj9mS52tts1WNAd/gM0gGNXVyKWHmmNjO+9NcSYHCXG2EppyHbnkqBVfda4WIIX54ZGx3xwD7+qISJel9sIPt/4VAMij7oHOGgbsuXBgH8lAvkc2/449B3sFFXVsk2PauKPCHPhqlEJcj6LMVUD/9McEVcXpMNYzOveuG+Zg3g29vgEuwpw8WgoHgHfHet6kkk+vFcJIwnt1U94nOrMHIpqzVH6JLfhS/Lwikf6/4vvlPaJbeTcln82YQlbwpuET++p5yU/5U68uah/lS3223kEhm+u/ITC6FRuHsMy5xgglZuuMfurBDRsqAXX04ERss1z/rqvplJINTgtayDg8wM6pcFbrOQLAXMJ9RmuCv+3oka1zdKGfl5YEmKfQFh5MHcYb+kfQHoycWEOMLFh8BoV2CdozBD4q8m+SKqrywAcILrjT80zs8bjzpYqm3dee49M1ZDfHxAljERXxcpkeMyonYZnxI2vjiYktA3f3jei52MiWqCKOm37KOK4lM1XAX0DB7SnV6jn7+qwbBG4ESL012/VKdqBOGkipWXFklH0dZiCv5m5waYmb5fA+wTkMDsLfYaFbqo+OIF+GTj+lE4q11JzNJlH7qPbUfSX99/N6JypjJ2Uzo9ZbHgtBjCUQ1MSwFj/Qywdgmz1erUkrR2ee2E0tSyl4HnUmd+DqNDbfL/kHOiThZJNpvM2vMtcWxQpHfRHoTUhrDKcYESqiaojaOv/7TbzYZCpiHJtgg5rqlVwrFdNgg+55+5qXMEilpy+/8CUx9wu9yCRDSrwK1EiUVaKgq6r8mcYrT9YKRkGR00IS4Symw+NNrYTFVMxLWL+xiuG8ZYh1R6qZ2Pg6gchdYFcuFARdyaH7JdhRa+9UPKfsusnOql+0r583DHmzf8l0kJ/vTRxZz0ktj7NLZrn7V+GqNpJX4XuHybEN1plK5c/9ekognGpXfiSW+Gd2g1nLzEPNIBNtbZnha6A33mFShrqPGWbpW9HhfBI4jAschTZ0BPSev2wx+7q+bvvqLEwllUIsUPq+//3Qr5e83kCHSG1ao+I3LuRpiTdeEWUtNA7PQ3/VGTHPkbXnUBq36gvPUaAvIFvzq/PeexH/4lSrcVJxtP1STttQ4c0MeQz49VbwivMWJtj9egtuUvRAxX1m3/JsM/ny68Q07MkwNoP/yXK5z6OHiIuRv82mUFRgOEU6rTkDY6O/m1YAAnIiggBhLqSLUUqPEBVYi5/SAnILF9ygx/6RjOC62SrTnd8X0hIuOzDJXfHCPxPOx283D+vD/e2QAA/vpkm/fE0+fB+Z88Gw7b3ICFUGqNMdEPY1Cbt08a1y/zmCCqyjxRk3GI/BO0UgsISbaXnY7Zo3FYXsb+8dZ9uycZXI3ft9vVNA9hDHq0wuD4yE3B57k3QSYBKGrFHGLlCw7Jm8WvelDMwmu572U54UwUPhbx0kySdq147Rg5mnLSszCo6snVBZyVdI5pjLtORg599KIzYYER7sVUP/zGKhJqqs9BvsLurq0qrb/5WEbBP/2CAOvOvMx8iMMB1vaU4K26tTLP01DsBQWDbJ6jSU9w0DSv3EhKU2LM5h8tcwr6GtRgufAX5bSh/+UwfKrBvz6jWfqWbYk9/5Zu7L43oRHhb8sy9pet//pIPGZI3bKQ2bKmQ++yl0NPlQq+8hN3MNq1Inrpz3JclKZAXIjU42GfrSLybQIqMBS2aQ/xww/Y4PVMoKD5qOlXn8HNCvVkpXHqYPykyzHTJHaJpXiWvwoN4JacaOkiYNZFDiJ/0/EZeCFjD0P1yY919rPr+8sQdFmJJj7Sk5mvHhuLGEF7kXw7TETTc1wA2AwYQvM5x2gDLqfT/ELGAkd/xG5NFI+GCwpXhixq8lN53u09rT+1K4EJ+dxbvH+uR9R3xIVdiY0+Gaa8W0KikxVTSeWqEf7iUqfBa1FfanvnCe7kXIgm3Gxzpv0+BD+QtKOM1mUSbRbHCN6jmzrzuQ0beoQjWNwXVa+Rn3Kvm975kT4tSutZ+BgOBlg9hRM/gbP6xZ/Xbz9W7/xMaP9B31yj3bzQv+vzwVOg+K3SDouMKpQ/ONsv/dNyBDxO0DM0xKsJB7IuNaSljXw+SEUn7PFieXiNvDwaykVMzPpNxfjC1hW21PMyPahXl/0tjGCEXzqMlNl2t/6M6drBbnf/MhTzeFmRZmOWzfemS5cR3wlYm5hDtyKdyrjxjQdmlzo5yv+IqDexqy1g28IOmznmSS2tM0A/+sFxB2U074sDwUkijZiv3e8XeaV7BxKVJz4FYKIbEYpQi4es891obmoUpTVD2tu6gruE3O6ii1yMoBavY59Fs+MxU4xTzneZfdv+HUnROudyh5bKiBxGSl00koJXzUYuyGa4t3asK0gARD4HkJBkkjs9xivjg571quPCvkFQRQcwsBMFjB4ITnJawpm60+caz9VZCVsPnYPmy9Z/9GaKAcSQteWFYIebXmiY0wek8d396IKVXcAeRHTL2byvZjEnW+roF+n+cVlQ1Y4uLwhlb6fthkXwdIyy0KCcpIoRx8x4swOxV21wv2ngYwLSW7ns9DupX+y/FPrURe/jd2tA/aRIEF3Bmg4T0y/pCPUjuDCnTX8s8XdtyggNPpUeKw2cNmz0xSHWM+z/J12cpsTeSvoI+lQiBc1HYw7402YFhsjHI/bTSRZpvmGK5ferm/gwrohE+5OaMtBoyoBZnr/9W38TezXmE6J7W3TiXpeaTlIuG2tanpajOaEs8V/StF2AfymJxs7ufhCOMDEYYpXQDfBvcirvM+hVs0cYuEmT4Z7QEUU4mh1T8UVHWVya6YZ12iK+KeZOdnDbccEtGaEi+sa9jdUoPYN+Dm4jFA40208exPj5FL+q/QVpysvGlxpKBefPTAknY4DoGbCUB44dKVW2mh48+y7thv9Gna2ebhKgE1cfVZLCwyscDpC2aP1gqkcUxI8f26e6WGtLwqnZjr3tpJCDJmbZCHppROMgcWIZEnkqsmJQ4trPLfCM0Yxm0jLjjk7sdr7+TZUdE45HHABRgN1Q63IASc7EzlAMkG4Iv2Z0d+0CPDZJlmdxxOSm55a40h2N9b/MvmGT0Bgxb2IIe8xhQCT50uKMngd0AR3PT3XX8JiL8LLJ/lCxjIoY9Bzr5MM0jDOnHgubYKAiQE+pS0+cQ93VUlqZRr70RzDB9/Usex+UI9kVRr1yqdLbxoK+YQ76cSAXMI4ry8ebpPHtUsWWsoqofxZykPce017vW5TC4PT5mruJrTAaqpfjOl1Ene8kdI9s95agoZsoFIutr/6nZTTWpEccWzNAbM4My0My4a3xQTl92dUnUlkIFFuBTlawnr/pWjxFA8mtV7otZ9rwieUSZ5oeHlJR6L+x16NWlfiGmXZEo4hvHWpwZxjjwFYtjFythJOxlgIlW9SB1mOsvjWqQOeLHvJFEaNixiDfF83EpJuFiYRfkgZpQcSLDkOvswQ7vA3O1bNqjbnsQK100CdpM7MnVCZ94dBBCaTD0U22lDzT1k65I3QOFNs3RYM7ObyHzhZcSpaKqTiDOr/zHFyL9WWSHa9Lm9zRl01EpPOArY8ZPbTV+sBLKBB1H4VL9JulZI2B89zxt9j46jSu2y1728qG0hBWh9QDpzIK5n/EUeMdenRcgDtGU1ft3Dsvv4kMjfeHfNjGMRXa0ududtncPZ6Ecgr7HLyAm4KEUSVeGQeBl+yI3n1VHIZGkJkZ6gvKp3Y5ab1m/GCwdZlN5xalLykcEswsHfj+7I2VUlX+B8IlIBaPsqF25w0uD4pYE0n0ajLEWmpC0zOYvGoXa2Vj90y6CRNPRb4851ma0YYCxl+fvuZ9Umx2SpPQ1quscYvwdrJjHa42zW9cDgVzvzuIEJ1X2MSE3jpo5o3Lhfh/nUGB9gJVF4njuJ4jL0QujZxFg2BwEdqjNNwjg6ap9M6FD2eMKHZKr6YH4y8NVM63AuZ8cPmqu1sum+cWrSqgXmt8CCilSfhHotGft2eBLJf8S6UpH8/n+kbeYZjzJb52FsxcuIpt0PDv2e69NR2fCJqdU8eGexjE3j3nkeMhsAGPi2mfIfuREjsV0ug4ir+sEIBHwBgTl5DPIhrpEGVk2tZk6sRJQcBd/3Zja4UOVqgI0z4D5vnTVgoL3fO2Kr9I8DIIxRKmFCzhvAQ5S4g1rUt4JuM1M+HYbs0vtMneFeMaJxQ8nkutVKnmFAq3NX27CBUQA8HrsLYPAEpnpLi/a8D/lFsz4a9QAPr1fVkaOrHM8ZaQzfS2XEg8eTvnoP1TJZqHMbXJbzVL/c7NHc+SmUz5O04Hps4RlmyQL7/nENVfev/Y9LaJh8Ob98BJ05DUgJm7tS48ZRT81u61m0C9jB8rL8NY6Tp1oYfBHN4dDV0LU+YsJdauuiPl1Xz8rQzwHikz3VFFDgQN+NvV0FIlqUn2EPs/R7Fud60QsV+49UVCzOUXMtk//XPtxainMLoUODBHutUSH6ASkd2LuysXvKfqLYtR79lgtH6Opdo5Z4kYdjAt41S77R8utC/t93N7PofSGC47gjtS2psyMekqwqRYXm9hS6gO6997vUfuIG13fsx/v2aZnKrkrFBvaU2sulTlBAJM4CeFR3A3HdABfjCqG3SnJOIdDNb9Kn+8Gd97412M6b+3w6WQBiALtg0BDS79J82F5u0o1hzMW9ABwvgfObFDktxs2162RZA7MBojn5qdyGN5aX7k8qXNESpTXrEcEC0p1Jo18F06KTu/rbEwHDjWo/AvcI0BsDVCrGBSSDD1F9jgXu9GalZrmNxEtZ3kGO6vlP13X/d1/7t8L5F3FIOVU6YAylw0Us9EbqBa5c1zNsltB6z/5XRwI/kBUtBs7PQjymwIslRTkkEaJzmvEzpv17UoAEb9rDDVDUjMC0q8m7xDm/Vpc8HJLokhIVMILvC6UC4Uf+lRJsVFomQv8s3CIpKmPdkUT7WdoTvfJf+YXsMGIbpHdhyFJkqFESZuSEKXlbUmUO7FpS+/W9ddXf/YdYteKQbC2jyuvbiEwJgCJjdTsUxETveXosNqWwA+Py5+WzORoJN1ACFhEkqhRy69fuZ1wmb2vNVq9hZ7hN/AsBbrk+KYE54pEXcqs3TVgTBeqz0F2VRL2xMROrB1X+G/lsp6Je6jmI19DgKYJsdsMK/UI+E41+2Zi0TxZUO6se5f/LZZwV9pYqf6AUCWeqVWYS+isB1hKKqjAQD+FmC+rPcrJqfOSYkHq7jWy/Af0cjHJn/AFF7zbTVuaAZy3CleiGrqbsL+yN5bFCjaZ79yxNLw17fA0HS6s8xgIw00zjHqlzIACX0kGCh4PTe4GGBWMf0jRcRp4SJ6fV/SmesTAx3ZgzyXkHxLPxpnav7CHqNRILLDDuMvGaTZhZtd+qZQbjXF0/9enIx8Ic+Y8z/JMa56OIi//UA2FYEuVtm7MeO44rs3VH4RzLuhcKYH9jB4Dd7j/VrqRAkjVGW9cfzM1wc4ftRMlTzdskazIHhWbOpzZRh21uouxgHW5GLVpnPI1jt6l9ah3okuoDYwooPmvs5scEYjcI3gV7DvITI77/dw1vlYAWAEXqunan3AKC5cjNpoeSTRlXUtv3chBViLGNoTFe3CwN+5vPcDbBDsj6S7mkiENRyK6r+UZSlNKGUL1Ld3cf4TJ1GJOJewPJVdAdZ/yWmVRYerkkV9dl0Vh93Pe5hLpq6v+5SzIJngGMZm2+CNEC5TL02BHQF9/25x4k42ZVYz39aT5Q79wzBd8blACQgJRElcRWU4tMebfTDo5HjxEWuEfM1bL/vJqL2j2DbkGHC6p+zFXtxKQL2G03yMN4XqEywivFNWITL6tL7YAipyvp5nGX50LN3MeDMsGbRQkRJed0z34RSt++g1B6uaoUunDrfRnJrPD3Jc+yhJ3JhWBotkoEROy1Xy8q+22D4SF1EvxlXiFMOwrrW+mcRaf+XRTKQ9KM9DVrnCbAgSyvc/yH5pj2BhtNWIjIUbL/Jo07iUMy3OfZOkbVc8YEmlzpU8yB3w0l6Jw8YTYuXiGTVh+oFWs9h0k7ENxwTC6eQKp2tLd5gbcjqHK2cZfR7q7iyRVlminkixM9i5czLhlcS2a2z2B1EmaNGD1f5l+FXhPMmjE0IRhDQJLtknCUsA/lm4bdD3l5EewlQwQP0gOB1pgCjz5TkMEBWeuAiinf4lpBI6FbGJbwrpwm9r4vEZmZUixNyxwG9YFjuFmFYE12uNjvRbnIbF5o8m7fATbKxhThGBOchvNmmAl1zQzO42U99tIoRDGSN5Yo+/CsTISH4dRxcs+6NKPmWgpy3enrTgW/APDULG2QDqHY9kJr6Wi6ELrW1oaoiMS4tIIp5EgJTDNgW8VPXzA/Bn+lYu83ZkOmYZXHVnxRfGnamkFn4ZpIofDVft5PZfI8DdzYOM2RKmC6GpMq2Ybda500zBerMe+Ydd5gMv666xB/krGpKHQiBQm1u55rCR1TJbsrEHpWQyTZj3jCFtcDAIL4ZBHtuNC/oSaUGTpz10yplIp2cNaGBPCo8XZNbbOPR9g3Zy+dpZx1SHGWUHDyG1BDF7cv8ZLvDzDkqB12Vdt30bYtDdvl5RM45aftyTPiRscQTFPuGYBQI0T1eoqOqQZuYdc3cDk/UKPeiqex/yowbiuYttu+l+GZY720yMv1mAee9oW5roYfd1N2Qw0GpIs0VPnYeIZSODtCw66q/NNYo0tOS3JvihonN7VvG0+3Tz8VU2H7MEq0+zct77twFNAL4O/xYVKC1lBJ+UYchI7HwpGG1GKycxGFe0UEK+o2cNEZcELFMZr3bE3Xj1MxUyu1yNiioTn0N1EmALaNKt98zFADkOE1U63AA1yAFNLvz4JAxyVGsS0dD1ue2VIp98S7Ms+ZhwoDH3d5UGKDB+e69tzk/WwOo2zigFbFfhDV7W5A02WpnZmponox8GaCwl7ADe3+961rDnzcA7/ij8ifeIt2/i+d7XIBZJhzSAgo2nIWYtD/1zblMMNauag1EfCuIp+PX51sYIXfsOdxhqu/t9++C+lCKOQrHkf/J3OjYPNtUVmqvqzG6t5wB0jrSfytkgLkglx60Kkry++ANjExvE42qpVfus6RBCDhpZ8Xx101afXtgTq3lKyDf5D4tHD56N8HE7A3BXyX3SZHbMzNcL0efO2apcuwRjBJ0cny/3CQABl/dvJPK01vcDckVtmwOBvn62Y6d/uKlMOfWMpSeAN6+INPs2MZYliPo7U5qd68y80dGDWCCAD5o54oTfkywce/o3CfKZYog6kqnCvzfoa9g/X7RfTqi96HZQdWArhNaizD5hxD8NixDz3hj6A+mE5MsedTGzBefi7mPLCsLwpZiE0qKsvM6vgPfNuLmfbvWuXN0HD/y1TSKkpKb4+RDvcVp3WfZrVcZerP3RO1mRQOHl5dNkfqESGYg7zqOV8cPpdxwTEWX1ionVHMrC35W00Yabsrw6kmBB4T+t6ivnLOfwCMSUp9tLsYPvoeitJNstP82k8o2KPVN/wocusuwsh69y3zdbXM8E1fw8GTTfzNsDp+6pktGehpsB38un+Nvdy5t1USesDfzan3vhOfz65W3UHzptjLOcbg7Iy7h39SASipaKAE+3srtPZLPoMUq4iB605TiaTGpurdIWloROJP7f8W8ZzjSHK0okFk8v9Z72bu/1L4b0QyZgRAsoC5BuChfaUv14I6IMItG19DxuqzwSqf0J1fcQYd+e9yYNZgYbRkHst0V34i99vVe1ulNqL69ZCvLYOVKIpbHbLiRGzoo4n/FkSSSrFr7oQEKSgCYBBPO7V9S5ljWX7KM6h9NQ3e3TfAK+BPY8BBiNwQz1Utg/YuIGvkzQmyMYZ0uyy+FCNV7WszjJONxJXTldDCVykaWDPqIc8u7RG2q7T2UAG7K9BrfcnN7/Ry4WpAIw8Z0pAtiWBzxB12MPU3DjktrW6j0z8j4SuFHNbuS+BN3U0Zd8hesPpXewQIOejH+7lkKffxLv2ytzwl6uIyfU95U6g2yNTBcDCMiM4riwgqQGY1vTsFbmytQfVoWv/FiyridsgQaODmhE82nL1kpR1q8HqRytdf8fFZ169S84Xoth0ySc0MsX2kwV5l1/XAKEQ8ipsuoHqWZO4YUTGKED5FfyuoaTvpMX8uOPKpQ3lelc/6w2Xh/n0tAXUiS/Iqkxcp99WQ3k9pzYLvdblZPR/c4m7Cejcx2vqljxTElA6VO144Lxd2x1AIm0gGDVq8PKzFT58ehnpmY9TQD/oMCUn2WFG7z1hv8hFkk7f3tPNXfcoJm+Z1VoLIVz8A47JQ9SP2Vx0c3/KN6bGXiiAli+5b27j6pLvPH83FzF6C8WZn4Daf6Pv2GoALB4ocTpKZDhWegLrXVtNLbCSsNjqKCod39YrWaFmfKc2lGFyqLBEp4UT0NUrnGbOHjPC9SjuqgdPSRCWGxe+NnSD+oLZXoD4hZX/1mEov8Z6gGK47q40tEWCcu0UQqYWQ4w5jP7mHauj2lY/ApRArWVt15ZmIB+R17ANzhtNsIRKgsPkTycGGFmhbOb2fxzRfZUSG4O/Y6UdVYx7AuwDcJJc+IIwENBCxgoWR1uaC6Ay3axFEz2ijYEs/sEyUMWRXq0EpJrXwWeopN6UH91HJ2U9yYkgIJjKXBYkqcBrm1M21WxKZFDNrV9xSgiS/7vd8C1rWOq6mLWw00QL49iMZBpVScgZxcD2tOFqpOWPWTWWz8kIrFA75tD79HTAE2rXO/TcWel1MZ8MV2Vwu+4BWZUXSzhHYEGie5Q5zxioKP6i/JfwM+v5GXy0GVKqO86+ZuZHuRVel/9MJLFnwn4LlmLAWQfpDscF8k6qZ6Q9+e7qYcvzpfJHsZp20W7zqZd9Omuht4G3daM+iNdD06luh/p4x0Rb8HK67DY7F5be2odBOkATipoIkMskClDTYPEt5MrmL+JHM/B1S1kYSRp23pP5t62vgU9Wi/0kbEUSxZaHGnygL3NYESkP8hPxpOPNU9sK/AIbfG6JzDg5P3lGCt6PXKTTA0Z8gIjczAmRtOJx1gqplTbzrmbzsZ8bPtLnLOCew1CDKtBTJV7vq3JjKi3hgf+VAfUIlv5H1Ptu2ko1xzo/epChbrSkgaUZg9UTQTDTBy6viR3ZW11grIx8ziQNVqIwrQHgp9r6x+4i3Fq3sW/I5vz88tuRO/6oX/jdTySDi8CD78bsTRa4tnIDnROYlBj8WNBnXTcycVT18YZjPzh1ZSpWRrv4Hi7kCR+HsE8SrCNzVhjdcjkXwmX9Z/fkR+wGhpa5XEiamaofO5E0ISlIout5yZ6FxEcNb6HksH6Kg6O4t8M0gN6LKdxsVVaAqWx5j/htdL5KHpatrKUqff9aYmng2umQLjP0zBERT/fCdJypQuYKfR333nb8RfT/kRGWUdDq7mR+meyWxnqIJWZy7lvayxEjRw6W1t3PnlJpKhNCjPFv00dq/xBUoZsFqzGRfYD/YN5No+n4SLo+uBZo69WVAdUObdmgfUsgFROTjg9Gfn9GsgtqC4n/2YwbsqCogM6z5bdeTgL9wyC7BL6qjOA0qLFYx6IOguiRDu5GBIxkDsNN50nS1+w0GzflbI37eNXOiJNp6ZRz3PqU5yzjL1aUKs21Vyy6eWd+wOBKnTqPe6+k+D1bnixvmQl7gZvSS1eQrRSkg241eg9eBO3HvSTr92yBLhukBkHIVjtOngIsc/QxYkLG1DQecD4g7cfoHl+GRHi+2LHXuuHyZAYsLbXm+GL5hWkfujHO2/gyP008WpMC5vjW4IUg1IfbkzYUl+sNqynl7YoVSPP47r3Z5xBb7h6+Fzc7n3wtwzWwL0YPuyIcGBNzNG3NbP/UYF0mdrf+4V8V4j085lJ8ljxQTYzkTR8ysVZvSNI+86R6o8okjuFvKpJzcaD3oP9CXFXK0JaDMQxr0zljLHcdZ21l1JR41UXmvmcO1C7dGnJnkAcMsCg2EkBJwm4hswXp2eE5L8J3z9rqY3/yB1YV1uXW7U38OEFHlQRbwLTZbRubTOMbkGSLHkAKrfINA9tevR0zM8O67Yrp+Vum/XHLnlXEicufoqK5Ob8fMO8hIre40bCawyBN8gO9Gkos3Kd5q9dvk1ANfBS1bMo854+nwnIWdVoAyHMDzlQPwUTJRL9jRQw83j7aOYho0bk/E4Xk6toSW0OV4emUJX27ZdR/gXtsZYlMjLcdKEgBrHkhI4CBpjP2m5KY9rfmhlTT9ujLUP6Kg0fQwMZ5QX8Gzvn8lMlKA+UrnxGNuvG7fkfviM1iGZ3BdYeqKPOeLrWV59ElFjlIk/bbTKumSlAywV7v76ioZFIPMq7R4AO1x962UhTALKe9FRF3fRGxlhCvcU/1gDtINt/AkP0uuA0ITBlO7btzKtBp9xaKXnSV/Weu/EJyDhOOxg6jEl80kVJUieopddqGMldwE7T9i8zhap0upmtdES+6HFp9Ly0uMm1nECrac76uKFeExT/LjkryjgnwD9j4VwigtOKCqUBPRMsB0KTZ/vxsRltKeCRNMwXdBQfUvti8FLVNVfhDSAvd0RInLinXRq8jkSBc0dYgSWPM6yP+fx6dz9dPPg5+7o7geKliaz67OLaE341wDXDbLHALhjz8ke4gRK4um1SeLUHjv57ORpWfDrRoKf6CG/trKGMKS9m4xmWLMc1/UKjtmO+jvjPNog+7FA5L5N35Erka9jJJNIds/3bNC2OS1rR3ofk/WSgkAOayMPqWjDLQ/PSVOy+8HU7SWTbVIMh1vb2kN23nPR5dNnD/4RtZnUV75xRKez/YXhB69TNsH7U1U1i2u1kRWI7wNRnm+BgPa6uO5Rz7q8KlH4FguMLMFlyxTc4elv2nEIhYc8KRjSj3vHKZkPeTrzcJWpgtBh3fNdSDdKfURBfMSH5SGReOD5dqFCxh3FNimHbhjk3aJZ+hI7YQ/Epmtiqx8WC1XmYP9yU3JRjsU+LM0svV/ePxR3Aado5L+jFsXzjA5abznnVRhfvWJg8CnN6sXAWXlYCguPOI/4/LkdBYUmUYxmHmIZbE9vZWd8BK+hVp0esrRzpnJGePNTG6FnI8ZscxdeQhBmgR/lZTiI6epxLTnXGXGBn1zoCuaAHHNVvPNo3fjAWQyJAjUWAySp/NotGoW18uehvk6IK/aJJV507cKQR4ng4Y0HvKpk7u3jf5ujw6wzpx8oQdI2R9OJU6aoJZ7DiDIcAR84DUhxoQ/fGWmP1M4uesK358owoShowBkDLSE9HfqottLC7LAK46QNQoDM0AnRUNL1qQguXCIWUMJoYO/ozz2mMUD6RyVX7PMhNTivKUehWTaAwpFaBc3v+J62eKr89Rq2dj1su9+1mcIooufucq6kgt51NjOdP19vUPOTrCm0vtOc+ZWCXXPhhsnMG/twLJ01uOCEmtFxC14wQ0lXoCKj+sGnH0+1WjJWo+ij2yR5paN0BneaVduT543PTB/DHAeXZs4pHHKeUCo2+vcbd1pAaWlknB0+4WLhh++WDiv83Sz0wyPJN8svHVJqDl41TRU9S5irgqEphepKbbhLjXZ/lXSx5OC96FXtEBxZ9+Kn44v2fsVX0mI+oNIX+HU1GJh9OoJ2f/9hdkGoPXJ8G6MB4V7CJXclaFKjWiX9aIBBA9JJl6G0uGtu6u8ARUoGWaNNIQrpqepzDBC8jPeUytEa3MQa25VURwBmEkx3UOe63+D/P7RmrvJZRQMLR2O2Z0agxq7dpXCvqpHgDONfmD0syOsl3mZ5s15NXxWjiT2wfSH1XUAfUqNENmLUCto/CUS3u8aA+VMFdRp7QBnAEyB0vI3zTPU7UkWMvApFYq20bZm7nHxH1wFzspqGN7t9lLOpYWnax/j5ET0ZBpiVOTCzOa7iMcYXHalFyxcnlHVp8jc7ORagPqgJGLB4MPCXS5qhbm5HwW7MZglTNYrbLXFs+aqeyzvO/UHlh/IOj8sTVy78XB9925zjyx4N5XV33mWtdzhbgyXsL6cI+lf8lgdPAjlN7HQzg+d/vCnx5E5fKrkAACdHuqVTBLLp6bUJoc3RT4Y4/O2iYWSgsineS1PqbZvLjrH4qGTd8AwBbAPJ8jnIhwn4CNeTm3EoHUu/3GiliSaRSoOGa1NBWR/xpDCrxmEGjHoc7pXfk7r2dEgUlzpecXIIe3632SmvtX4cl5GkVh6IFWUqmutrO97Yl03BK1DvvEz22LoUBRJsGLHgOrw5e+lo9T3EAoeaJpeHeWIGOryR7k2lzEZVyNmHgmadGOXFQQA98iBWigLQbh2xa4YWokouGv2jK/EwrAtIPjp3PghYyNJTBzymjc2lPfgfbnWqJvQ6l6UhqXrepTMJka+ngWaL5ZnG/sIky7f6FPgb3l1XVBGf0FJ43/8EPS5T3zhS49CMqfF2T28e5LTWYUIZD7hNfr5ctzOnFQoDYtH9TWt6ypO+ASKxjKlBi6NyP/a+v9lP7NcNGQJ1FvcudwDuBu1+9Gs7I3frWVZCsqCeBTE6ziB4LRDlLyRB6irCZ2yf6TooIdc1OTauCV5MU3BnufWDI2EjCJcoQkq9a2W7lPbPz7jG7ZvZ/sISkgpWsuV9qwA9PH8q/jvXMLxuxi5jj4Xf/UFsO1UEGrxt8O9EJm5cyPHNlHB5d0gVtUKcVHXJor7dD/qLhnhvam0Gee0LYVKbgSOyDVFbFNlsp5ZNfm+6oUpf6zmvc86C61kot2d0XxvFdMnKiL1GrtPSkOD3lGsaeGFJotE8nx+ujwxFWvjpBk3gn5eiQSZvpd+E3DHHikLLFzknpVh6dwl8BCKHelxjrbdavxX09yAr/wCJdhd4ft2X4eU7pyY/2JQ7hDjuTvjsKPmVICfrUo/4L2qN3p6sCihtVOboA0/WR21Hh3U6uxhgRuU6/nt2FTzNyOcwmniI4bKG+jZo6JGfHioooCtPIGxrRxG7eJCRZuysE+4jo7vrFrqtdAIP5vIzo0TeTs/0dqxh2JICNG0hcNOb+300wX5g4Dh7drFifYhCpLB5j47Qx4ZeH4wwwiz9ezQCQvzTa3HgbIzwUlRh3UnGQIAA=",     // 3784 화남(김)                — 블런더/오답
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
function Mascot({ name = "milku", emotion = "great", size = 44, style }) {
  const src = MASCOT_ART[name + "_" + emotion] || "";
  const frame = {
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    width: size, height: size, flexShrink: 0,
    borderRadius: Math.round(size * 0.26), overflow: "hidden",
    background: "linear-gradient(180deg,#FBF4E6,#E7D7BC)",
    border: "1px solid #C2A877",
    boxShadow: "0 3px 0 #B59A6E, 0 7px 12px -7px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.55)",
    ...style,
  };
  return (
    <span style={frame}>
      {src ? <img src={src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
           : <MascotAvatar size={Math.round(size * 0.86)} name={name} />}
    </span>
  );
}
function MascotBubble({ text, ply, mascot = "milku", emotion = "great" }) {
  const label = mascot === "kokoa" ? "KOKOA" : "MILKU";
  return (
    <div className="flex items-start gap-2" style={{ background: "linear-gradient(180deg,#3A2516,#241509)", borderRadius: 14, padding: "11px 13px", border: "1px solid #000", boxShadow: "inset 0 1px 0 rgba(255,255,255,.05)" }}>
      <Mascot name={mascot} emotion={emotion} size={60} />
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
      addsFor(key).forEach((a) => { if (!seen.has(stripSuffix(a.san))) { list.push({ san: a.san, book: false, adopt: null, games: null, dev: true }); seen.add(stripSuffix(a.san)); } });
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
      setEngineNote("엔진 실시간 분석");
      // 비이론 수 9개 보장(일반 모드 한정): 엔진 평가 상위 수로 보충. 마스터 모드는 마스터 빈도 그대로.
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
                          <Mascot name={ply % 2 === 0 ? "milku" : "kokoa"} emotion="think" size={42} />
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
  const boardSize = useBoardSize(360);
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
    setLastQ({ to, kind: sm ? (sm.book ? "book" : "good") : "pending" }); // 즉시 폴백(스냅샷 기준)
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
    const isNew = unlockOpening(childKey, name);
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
  const curName = curMove ? (nameOverride(parentKey, lastSan) ?? curMove.name) : null;
  const curKind = (lastQ && lastQ.kind && lastQ.kind !== "pending") ? lastQ.kind : (curMove ? (curMove.book ? "book" : "good") : null);
  const curKws = (curMove && curMove.book) ? deriveKeywords(curMove) : [];   // (UI6) 비이론 수는 키워드 미표기
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
          <Board board={board} flip={flip} size={boardSize} arrows={arrows} legalTargets={legalTargets} selected={sel} onSquareClick={!focus ? onSquareClick : undefined} onPieceDrag={!focus ? onPieceDrag : undefined} onDrop={!focus ? onDrop : undefined} onMove={!focus ? tryMove : undefined} evalCp={posEval} interactive={!focus} lastQ={lastQ} />
          <div className="flex items-center mt-3" style={{ gap: 10, justifyContent: "center" }}>
            <NavBtn onClick={() => setFlip((v) => !v)} active={flip}><ArrowUpDown size={17} /></NavBtn>
            <NavBtn onClick={reset} disabled={!sans.length}><ChevronsLeft size={17} /></NavBtn>
            <NavBtn onClick={back} disabled={!sans.length}><ChevronLeft size={17} /></NavBtn>
            <NavBtn onClick={fwd} disabled={!future.length}><ChevronRight size={17} /></NavBtn>
          </div>
        </div>
        <p style={{ fontSize: 11, color: T.inkSoft, marginTop: 10, lineHeight: 1.5 }}>기물을 끌거나 눌러 어떤 수든 둘 수 있어요. 제안에 없는 수를 두면 평가해서 블록을 만들어 줍니다. 화살표는 이론 수만, 두께는 채택률 비례.</p>
        <div style={{ marginTop: 12 }}><MascotBubble text={lastMascot} ply={ply} mascot={ply % 2 === 0 ? "milku" : "kokoa"} emotion={(lastQ && lastQ.kind ? mascotForKind(lastQ.kind) : ["milku", "wink"])[1]} /></div>
      </div>
      <div>
        <div>
            <BranchBanner sentKey={key} canEdit={canEdit} canAdd={canAdd} bumpContent={bumpContent} />
            {liveOn && (
              <div className="flex items-center gap-1" style={{ background: T.ebony2, borderRadius: 10, padding: 3, marginBottom: 12, border: "1px solid #000" }}>
                {[["normal", "일반"], ["master", "마스터"]].map(([mv, lb]) => (
                  <button key={mv} onClick={() => setMode(mv)} className="press" style={{ flex: 1, padding: "7px 0", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 12.5, fontWeight: 800, background: mode === mv ? "linear-gradient(180deg," + T.brass + ",#A8842F)" : "transparent", color: mode === mv ? "#241509" : T.brassHi }}>{lb} 통계</button>
                ))}
              </div>
            )}
            <div style={{ background: T.paper, borderRadius: 12, padding: "12px 14px", border: "1px solid #DCCBA8", marginBottom: 12, boxShadow: "0 3px 0 #D7C19A" }}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2"><Sparkles size={15} style={{ color: T.brass }} /><h2 style={{ fontSize: 15, fontWeight: 800, color: T.ink }}>{stageTitle}</h2></div>
                <span style={{ fontSize: 11, color: T.inkSoft, fontFamily: "ui-monospace,monospace" }}>{mode === "master" ? "마스터 " : ""}{fmtFull(posGames)}</span>
              </div>
              {lastSan && curMove && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #E4D5B6" }}>
                  <div className="flex items-center flex-wrap" style={{ gap: 10 }}>
                    {curKind && QCOLOR[curKind] && <CircleBadge kind={curKind} />}
                    <span style={{ fontFamily: "ui-monospace,monospace", fontSize: 16, fontWeight: 800, color: T.ink }}>{moveNumber(ply - 1)}{lastSan}</span>
                    {curName && <span style={{ fontSize: 12.5, fontWeight: 600, color: T.ink, wordBreak: "keep-all" }}>{curName}</span>}
                  </div>
                  <div className="flex items-center flex-wrap" style={{ gap: 14, marginTop: 8 }}>
                    {curKind && <span style={{ fontSize: 12, fontWeight: 800, color: QCOLOR[curKind] || T.inkSoft }}>{QLABEL[curKind]}</span>}
                    {curGames != null && <span style={{ fontSize: 11.5, color: T.inkSoft, fontFamily: "ui-monospace,monospace" }}>{fmtFull(curGames)}회 진행</span>}
                  </div>
                  {curKws.length > 0 && (
                    <div className="flex flex-wrap" style={{ gap: 5, marginTop: 8 }}>
                      {curKws.map((k) => KW[k] && <span key={k} title={KW[k].desc} style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: ".04em", padding: "2px 6px", borderRadius: 4, background: KW[k].bg, color: KW[k].fg }}>{k}</span>)}
                    </div>
                  )}
                </div>
              )}
              {explainFor(sans) && <p style={{ color: T.inkSoft, fontSize: 12, marginTop: 10, lineHeight: 1.55 }}>{explainFor(sans)}</p>}
            </div>
            {moves.length === 0 ? (
              <div style={{ background: T.paper, borderRadius: 12, padding: 16, border: "1px dashed #C9B58C", textAlign: "center" }}>
                <div style={{ display: "flex", justifyContent: "center" }}><Mascot name="milku" emotion="sleep" size={64} /></div>
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
                      {showAllNb ? "접기" : `더보기 (비이론 수 ${Math.min(9, nb.length)}개)`}
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
function CollectionTab({ unlocked, liveOn, contentVer, chesscom }) {
  const [path, setPath] = useState([]);
  const [lc, setLc] = useState(null);
  const ccReady = chesscom && chesscom.status === "ready";
  const node = snapNode(path);
  const baseMoves = node ? node.moves.slice() : (SNAP.tree[""] ? SNAP.tree[""].moves.slice() : []);
  addsFor(path.join(" ")).forEach((a) => { if (!baseMoves.some((x) => x.san === a.san)) baseMoves.push({ san: a.san }); });
  const opening = node && node.opening ? node.opening : null;
  const key = path.join(" ");
  useEffect(() => { let cc = false; setLc(null); if (!liveOn) return; fetchLichess(path).then((r) => { if (!cc) setLc(r); }).catch(() => {}); return () => { cc = true; }; }, [key, liveOn]);
  const wdlFor = (san) => { if (!lc) return null; const mm = lc.moves.find((x) => x.san === san); return mm ? mm.wdl : null; };
  const crumb = ["오프닝", ...path.map((s, i) => moveNumber(i) + s)];
  return (
    <div>
      <div className="flex items-center flex-wrap gap-1" style={{ marginBottom: 14, fontSize: 13 }}>
        {crumb.map((c, i) => <span key={i} className="inline-flex items-center">{i > 0 && <Crumb size={13} style={{ color: T.inkSoft, margin: "0 2px" }} />}<button onClick={() => setPath(path.slice(0, i))} className="press" style={{ color: i === crumb.length - 1 ? T.brass : T.inkSoft, fontWeight: i === crumb.length - 1 ? 800 : 600, fontFamily: i ? "ui-monospace,monospace" : "inherit", background: "none", border: "none", cursor: "pointer" }}>{c}</button></span>)}
      </div>
      {opening && <div className="flex items-center gap-3 flex-wrap" style={{ background: "linear-gradient(135deg,#3A2516,#241509)", border: "1px solid " + T.brass, borderRadius: 14, padding: "12px 16px", marginBottom: 14 }}>
        <Mascot name="kokoa" emotion="happy" size={48} />
        <div><div style={{ fontSize: 16, fontWeight: 800, color: T.ivoryHi }}>{opening.name}</div><div style={{ fontSize: 12, color: T.brassHi, fontFamily: "ui-monospace,monospace" }}>{opening.eco}</div></div>
        {lc && lc.wdl && <div style={{ marginLeft: "auto", width: 150 }}><WinBar wdl={lc.wdl} /></div>}
        {ccReady && (() => { const cc = chesscom.analyze(path); return cc && cc.total > 0 ? <div style={{ fontSize: 11.5, fontFamily: "ui-monospace,monospace", color: T.ivory, background: "rgba(60,138,60,.25)", border: "1px solid rgba(120,200,120,.4)", borderRadius: 8, padding: "5px 9px" }}>내 chess.com 승률 <b style={{ color: "#9FE39F" }}>{cc.winRate}%</b> · {cc.w}/{cc.d}/{cc.l}</div> : null; })()}
      </div>}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {baseMoves.map((m) => {
          const childSans = [...path, m.san]; const child = snapNode(childSans);
          const hasChildren = (child && child.moves && child.moves.length > 0) || addsFor(childSans.join(" ")).length > 0;
          const isUnlocked = unlocked.has(childSans.join(" "));
          const cc = ccReady ? chesscom.analyze(childSans) : null;
          return <DexMoveCard key={m.san} path={path} m={m} child={child} isUnlocked={isUnlocked} hasChildren={hasChildren} wdl={wdlFor(m.san)} cc={cc} onOpen={() => hasChildren && setPath(childSans)} />;
        })}
      </div>
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
function PuzzleSolver({ puzzle, onClose, onSolved, solveCount }) {
  const theme = puzzle.theme || "punish";
  const setup = [...puzzle.setupSans, puzzle.mistakeSan];
  const userColor = setup.length % 2 === 0 ? "w" : "b";   // 보드 방향 고정(상대 응수 때도 반전하지 않음)
  const boardSize = useBoardSize(380);
  const [idx, setIdx] = useState(0);
  const [intro, setIntro] = useState(true);   // (UX7) 진입 시 직전 수를 계속 반복 재생, '풀기 시작'을 누르면 종료
  useEffect(() => { setIntro(true); }, [puzzle.id]);
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
  const restart = () => { setWrong(null); setReply(null); setSel(null); setIdx(0); };
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
  const prompt = intro ? "직전 수를 반복 재생 중 — 준비되면 ‘풀기 시작’을 누르세요."
    : done ? "✓ 완성! 모든 수를 찾았어요."
    : wrong ? "✕ 다른 수예요. ‘재시도’를 눌러 다시 풀어 보세요."
      : reply ? "상대 응수 중…"
        : theme === "sacrifice" ? "당신 차례 — 기물을 희생하는 탁월한 수를 두세요."
          : theme === "advantage" ? "당신 차례 — 우위를 점하는 수를 두세요."
            : "당신 차례 — 실수를 응징하는 최선의 수를 두세요.";
  return (
    <div style={{ background: T.paper, border: "1px solid #DCCBA8", borderRadius: 14, padding: 16, maxWidth: 460, margin: "0 auto" }}>
      <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 10.5, fontWeight: 800, color: T.brass }}>{THEME_LABEL[theme]}</div>
          <div style={{ fontSize: 15, fontWeight: 800, color: T.ink }}>{puzzle.name}</div>
          <div style={{ fontSize: 11, color: T.inkSoft, fontFamily: "ui-monospace,monospace", marginTop: 2 }}>#{puzzleNo(puzzle.id)}{solveCount != null && solveCount > 0 ? " · " + fmtFull(solveCount) + "명이 풀었습니다!" : ""}</div>
        </div>
        <button onClick={onClose} aria-label="닫기" className="press" style={{ flexShrink: 0, width: 30, height: 30, display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 8, background: T.ebony2, color: T.ivory, border: "1px solid #000", fontSize: 15, fontWeight: 800, lineHeight: 1, cursor: "pointer" }}>✕</button>
      </div>
      <div style={{ marginBottom: 10 }}><MascotBubble text={done ? "훌륭해요! 다음 퍼즐도 도전해 보세요." : hint} ply={0} mascot={pm[0]} emotion={pm[1]} /></div>
      {intro
        ? <AnimatedMove sans={puzzle.setupSans} san={puzzle.mistakeSan} size={boardSize} loopMs={1200} flip={userColor === "b"} />
        : reply
          ? <AnimatedMove sans={reply.sans} san={reply.san} size={boardSize} loopMs={0} flip={userColor === "b"} />
        : <Board board={wrong ? wrong.board : board} flip={userColor === "b"} size={boardSize} selected={sel} wrongAt={wrong ? wrong.at : null} onSquareClick={onSquareClick} onPieceDrag={(sq) => { const p = board[sq[0]][sq[1]]; if (userToMove && p && p.c === color) setSel(sq); }} onDrop={(sq) => { if (userToMove && sel) tryUserMove(sel, sq); }} onMove={(from, to) => { if (userToMove) tryUserMove(from, to); }} legalTargets={userToMove && sel ? legalDests(board, sel[0], sel[1], color, ep) : []} showEval={false} interactive={userToMove} />}
      <p style={{ fontSize: 13, color: done ? T.best : wrong ? T.blunder : T.ink, fontWeight: 700, marginTop: 12, textAlign: "center" }}>{prompt}</p>
      <div className="flex justify-center gap-2" style={{ marginTop: 10 }}>
        {intro ? (
          <button onClick={() => setIntro(false)} className="press" style={{ padding: "9px 20px", borderRadius: 9, background: "linear-gradient(180deg," + T.brass + ",#A8842F)", color: "#241509", border: "none", fontWeight: 800, cursor: "pointer", fontSize: 13 }}>풀기 시작 →</button>
        ) : (<>
          <button onClick={restart} className="press" style={{ padding: "6px 14px", borderRadius: 9, background: T.ebony2, color: T.ivory, border: "1px solid #000", fontWeight: 700, cursor: "pointer", fontSize: 12 }}>{done ? "다시 풀기" : "처음부터"}</button>
          {wrong && <button onClick={retry} className="press" style={{ padding: "6px 14px", borderRadius: 9, background: T.brass, color: "#2A1A0E", border: "none", fontWeight: 800, cursor: "pointer", fontSize: 12 }}>재시도</button>}
        </>)}
      </div>
    </div>
  );
}
function PuzzleCard({ p, isSolved, onClick, onDelete, solveCount }) {
  const setupLen = (p.setupSans ? p.setupSans.length : 0) + 1;
  const flip = setupLen % 2 !== 0; // userColor 흑이면 반전
  const hasPreview = p.setupSans && p.mistakeSan;
  return (
    <div onClick={onClick} className="press text-left" style={{ borderRadius: 14, padding: 12, background: isSolved ? "linear-gradient(180deg,#E7F0DC,#D2E2BC)" : "linear-gradient(180deg," + T.ivoryHi + ",#E2D2B2)", boxShadow: "0 4px 0 " + (isSolved ? "#9DB97E" : "#B59A6E"), border: "1px solid " + (isSolved ? "#A9C589" : "#CDB98E"), cursor: "pointer", position: "relative", display: "flex", flexDirection: "column", minHeight: 124, height: "100%" }}>
      {onDelete && <button onClick={(e) => { e.stopPropagation(); onDelete(p.id); }} aria-label="삭제" className="press" style={{ position: "absolute", top: 6, right: 6, zIndex: 10, width: 24, height: 24, borderRadius: 7, background: "rgba(40,24,12,.78)", color: "#F4C8C8", border: "1px solid #000", fontSize: 13, fontWeight: 800, lineHeight: 1, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>✕</button>}
      {hasPreview && <div style={{ marginBottom: 8 }}><AnimatedMove sans={p.setupSans} san={p.mistakeSan} size={116} loopMs={2400} flip={flip} /></div>}
      <div className="flex items-center justify-between" style={{ flexShrink: 0 }}><div style={{ fontSize: 11, color: isSolved ? T.best : T.brass, fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "62%" }}>{p.opening}</div>{isSolved && <span style={{ display: "inline-flex", alignItems: "center", gap: 3, color: T.best, fontSize: 11, fontWeight: 800, flexShrink: 0, marginRight: 22 }}><Check size={14} /> 해결됨</span>}</div>
      <div style={{ fontSize: 13.5, fontWeight: 800, color: T.ink, marginTop: 4, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", lineHeight: 1.3 }}>{p.name}</div>
      <div className="flex items-center justify-between" style={{ marginTop: "auto", paddingTop: 8, gap: 6 }}>
        <span style={{ fontSize: 10.5, color: T.inkSoft }}>{THEME_LABEL[p.theme || "punish"]} · {Math.ceil(p.solution.length / 2) || 1}수</span>
        <span style={{ fontSize: 10, color: T.brass, fontFamily: "ui-monospace,monospace", fontWeight: 700 }}>#{puzzleNo(p.id)}</span>
      </div>
      {solveCount != null && solveCount > 0 && <div style={{ fontSize: 10.5, color: "#2E6E2E", fontWeight: 700, marginTop: 3 }}>{fmtFull(solveCount)}명이 풀었습니다!</div>}
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
      <div className="flex items-center gap-2"><Mascot name="kokoa" emotion="celebrate" size={48} /><h2 style={{ fontSize: 18, fontWeight: 800, color: T.ivoryHi }}>퍼즐</h2></div>
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
      {themed.length === 0 ? <div style={{ background: T.paper, border: "1px dashed #C9B58C", borderRadius: 12, padding: 20, textAlign: "center", color: T.inkSoft, fontSize: 13 }}><div style={{ display: "flex", justifyContent: "center", marginBottom: 8 }}><Mascot name="kokoa" emotion="sleep" size={60} /></div>이 테마의 퍼즐이 아직 없어요.</div>
        : <div>
            {open.length > 0 && <div style={{ marginBottom: 16 }}><div style={{ fontSize: 12.5, fontWeight: 800, color: T.brassHi, marginBottom: 8 }}>미해결 ({open.length})</div><div className="grid sm:grid-cols-2 gap-3">{open.map((p) => <PuzzleCard key={p.id} p={p} isSolved={false} onClick={() => setActive(p)} onDelete={onDeletePuzzle} solveCount={solveCounts ? solveCounts[puzzleNo(p.id)] : null} />)}</div></div>}
            {cleared.length > 0 && <div><div style={{ fontSize: 12.5, fontWeight: 800, color: T.best, marginBottom: 8 }}>해결된 퍼즐 ({cleared.length})</div><div className="grid sm:grid-cols-2 gap-3">{cleared.map((p) => <PuzzleCard key={p.id} p={p} isSolved={true} onClick={() => setActive(p)} onDelete={onDeletePuzzle} solveCount={solveCounts ? solveCounts[puzzleNo(p.id)] : null} />)}</div></div>}
          </div>}
    </div>
  );
}

/* ============================================================ 설정 탭 ============================================================ */
function PgnImport({ bumpContent }) {
  const [pgn, setPgn] = useState(""); const [msg, setMsg] = useState("");
  const run = async () => {
    const body = pgn.replace(/\[[^\]]*\]/g, " ").replace(/\{[^}]*\}/g, " ").replace(/\$\d+/g, " ");
    const toks = body.split(/\s+/).filter(Boolean);
    let path = []; let n = 0; let bad = null;
    for (let t of toks) {
      if (/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t)) break;
      t = t.replace(/^\d+\.(\.\.)?/, ""); if (!t) continue;
      const { san, kind } = splitSym(t);
      if (!/^[a-hKQRBNO]/.test(san)) continue;
      const board = boardFromSans(path); const color = path.length % 2 === 0 ? "w" : "b";
      if (!sanSrc(board, san, color)) { bad = san; break; }
      const posKey = path.join(" ");
      if (!CONTENT.treeAdds[posKey]) CONTENT.treeAdds[posKey] = [];
      if (!CONTENT.treeAdds[posKey].some((x) => x.san === san)) CONTENT.treeAdds[posKey].push({ san });
      CONTENT.forceKind[posKey + "|" + san] = kind || "book";
      path.push(san); n++;
    }
    if (n > 0) await bumpContent();
    setMsg(bad ? ("불법 수 " + bad + " 에서 중단 — " + n + "수까지 추가됨") : (n > 0 ? n + "수를 트리에 추가했습니다." : "인식된 수가 없습니다."));
  };
  return (
    <div>
      <p style={{ fontSize: 11.5, color: T.inkSoft, margin: "0 0 8px", lineHeight: 1.5 }}>수 뒤에 기호를 붙여 품질을 지정합니다: !!(탁월) !(유일) ☆(최선) 👍(우수) ✅(좋음) ?!(부정확) ?(실수) ??(블런더). 기호가 없으면 이론 수로 정의됩니다.<br />예: <code style={{ color: T.cocoa || "#5A3A22" }}>1.e4 e5 2.Nf3 f6? 3.Nxe5!! fxe5?! 4.Qh5+☆</code></p>
      <textarea value={pgn} onChange={(e) => setPgn(e.target.value)} rows={3} placeholder="PGN 입력" style={{ width: "100%", fontSize: 12, padding: 9, borderRadius: 9, border: "1px solid #C9B58C", background: "#fff", color: T.ink, fontFamily: "ui-monospace,monospace" }} />
      <div className="flex items-center gap-2" style={{ marginTop: 8 }}><button onClick={run} className="press" style={{ padding: "8px 16px", borderRadius: 9, background: "linear-gradient(180deg,#3A2516,#241509)", color: T.ivoryHi, fontWeight: 700, border: "none", cursor: "pointer" }}>트리에 추가</button>{msg && <span style={{ fontSize: 12, color: T.inkSoft }}>{msg}</span>}</div>
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
          <div style={{ fontSize: 15, fontWeight: 800, color: T.ink }}>{(prof && prof.username) || username}</div>
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
function SettingsTab({ profile, setProfile, engineStatus, liveOn, setLiveOn, chesscomStatus, chesscom, user, isDev, isCodev, devOn, setDevOn, canAdd, canEdit, bumpContent, contentVer, openAuth }) {
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
      <div className="flex items-center gap-2"><Mascot name="milku" emotion="wink" size={44} /><h2 style={{ fontSize: 18, fontWeight: 800, color: T.ivoryHi }}>설정</h2></div>

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
          <p style={{ fontSize: 12, color: T.inkSoft, marginTop: 8, lineHeight: 1.5 }}>켜면 학습 탭에서 주요 분기점 지정/해제·수 해설 편집, 아래 PGN 추가가 가능합니다. 모든 변경은 공용 서버에 영구 저장됩니다.</p>
        </div>
      )}

      {/* 트리에 라인 추가 (개발자/공동 개발자) */}
      {canAdd && (
        <div style={card}>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.ink, marginBottom: 8 }}>PGN으로 오프닝 트리에 추가</div>
          <PgnImport bumpContent={bumpContent} />
        </div>
      )}

      {/* 공동 개발자 관리 (개발자 모드 한정) */}
      {canEdit && (
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
              {canEdit && <button onClick={() => removeCodev(id)} className="press" style={{ fontSize: 10.5, padding: "2px 8px", borderRadius: 6, border: "1px solid " + T.blunder, background: "transparent", color: T.blunder, cursor: "pointer" }}>해제</button>}
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
          <Mascot name="milku" emotion={mode === "login" ? "wink" : "great"} size={64} />
          <Mascot name="kokoa" emotion={mode === "login" ? "happy" : "celebrate"} size={64} />
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
  const [learnSans, setLearnSans] = useState([]);
  const [learnFuture, setLearnFuture] = useState([]);
  const [learnExtra, setLearnExtra] = useState({});
  const engine = useEngine();
  const chesscom = useChessCom(profile.chesscom);

  useEffect(() => { loadContent().then(() => setContentVer((v) => v + 1)); }, []);
  const bumpContent = useCallback(async () => { await saveContent(); setContentVer((v) => v + 1); }, []);
  const isDev = user === DEV_ACCOUNT;
  const isCodev = !!user && Array.isArray(CONTENT.codev) && CONTENT.codev.includes(user);
  const canEdit = isDev && devOn;
  const canAdd = canEdit || isCodev;
  const openAuth = (mode) => { setAuthMode(mode); setAuthOpen(true); };
  useEffect(() => { (async () => {
    const raw = await store.get("chess_state_v5");
    if (raw) { try { const d = JSON.parse(raw); setUnlocked(new Set(d.unlocked || [])); setProfile(d.profile || { nickname: "", chesscom: "" }); setPuzzles(d.puzzles || []); setSolved(new Set(d.solved || [])); setDeletedPuzzles(new Set(d.deleted || [])); if (typeof d.liveOn === "boolean") setLiveOn(d.liveOn); if (d.user && d.userHash) { setUser(d.user); setUserHash(d.userHash); try { const r = await acctLogin(d.user, d.userHash); if (r && r.ok && r.data) { const pr = r.data.progress || {}; if (pr.unlocked) setUnlocked(new Set(pr.unlocked)); if (pr.puzzles) setPuzzles(pr.puzzles); if (pr.solved) setSolved(new Set(pr.solved)); if (pr.deleted) setDeletedPuzzles(new Set(pr.deleted)); if (r.data.chesscom) setProfile((p) => ({ ...p, chesscom: r.data.chesscom })); } } catch { } } } catch { } }
    try { const counts = await puzzleSolveCounts(); if (counts && Object.keys(counts).length) setSolveCounts(counts); } catch { }
    setLoaded(true);
  })(); }, []);
  useEffect(() => { if (loaded) store.set("chess_state_v5", JSON.stringify({ unlocked: [...unlocked], profile, puzzles, solved: [...solved], deleted: [...deletedPuzzles], liveOn, user, userHash })); }, [unlocked, profile, puzzles, solved, deletedPuzzles, liveOn, loaded, user, userHash]);
  useEffect(() => { if (loaded && user && userHash) acctSave(user, userHash, { progress: { unlocked: [...unlocked], puzzles, solved: [...solved], deleted: [...deletedPuzzles] }, chesscom: profile.chesscom || "" }); }, [unlocked, puzzles, solved, deletedPuzzles, user, userHash, loaded, profile.chesscom]);

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
          <Mascot name="milku" emotion="great" size={44} style={{ filter: "drop-shadow(0 2px 3px rgba(0,0,0,.5))" }} />
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
        <div style={{ position: "fixed", top: 70, left: "50%", transform: "translateX(-50%)", zIndex: 60, animation: "lockpop .4s ease" }}>
          <div className="flex items-center gap-2" style={{ background: "linear-gradient(180deg,#3A2516,#241509)", color: T.ivoryHi, padding: "12px 18px", borderRadius: 12, border: "1px solid " + T.brass, boxShadow: "0 10px 30px -8px rgba(0,0,0,.7)" }}>
            <Mascot name="kokoa" emotion="celebrate" size={42} />
            <div><div style={{ fontWeight: 800, fontSize: 13, color: T.brassHi }}>새로운 오프닝 잠금 해제!</div><div style={{ fontSize: 12 }}>{toast.name}</div></div>
          </div>
        </div>
      )}

      <main style={{ maxWidth: 1080, margin: "0 auto", padding: "22px 18px 110px" }}>
        {tab === "learn" && <LearnTab engine={engine} liveOn={liveOn} onFocusActive={setFocusActive} unlockOpening={unlockOpening} onLearned={onLearned} chesscom={chesscom} onSavePuzzle={onSavePuzzle} contentVer={contentVer} canEdit={canEdit} canAdd={canAdd} bumpContent={bumpContent} sans={learnSans} setSans={setLearnSans} future={learnFuture} setFuture={setLearnFuture} extra={learnExtra} setExtra={setLearnExtra} />}
        {tab === "dex" && <CollectionTab key={"dex-" + navNonce} unlocked={unlocked} liveOn={liveOn} contentVer={contentVer} chesscom={chesscom} />}
        {tab === "puzzle" && <PuzzleTab key={"puzzle-" + navNonce} puzzles={puzzles} solved={solved} onSolved={onSolved} onDeletePuzzle={onDeletePuzzle} solveCounts={solveCounts} />}
        {tab === "set" && <SettingsTab key={"set-" + navNonce} profile={profile} setProfile={setProfile} engineStatus={engine.status} liveOn={liveOn} setLiveOn={setLiveOn} chesscomStatus={chesscom.status} chesscom={chesscom} user={user} isDev={isDev} isCodev={isCodev} devOn={devOn} setDevOn={setDevOn} canAdd={canAdd} canEdit={canEdit} bumpContent={bumpContent} contentVer={contentVer} openAuth={openAuth} />}
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
