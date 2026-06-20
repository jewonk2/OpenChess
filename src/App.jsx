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

/* ============================================================ 라이브 Lichess Explorer ============================================================ */
async function fetchLichess(sans, master) {
  const uci = sansToUci(sans).join(",");
  const url = master
    ? "https://explorer.lichess.ovh/masters?play=" + uci + "&moves=14&topGames=0"
    : LICHESS_API + "?play=" + uci + "&moves=14&topGames=0&recentGames=0&speeds=blitz,rapid,classical&ratings=1600,1800,2000,2200,2500";
  const res = await fetch(url);
  if (!res.ok) throw new Error("lichess " + res.status);
  const j = await res.json();
  const posTotal = (j.white || 0) + (j.draws || 0) + (j.black || 0);
  const moves = (j.moves || []).map((m) => {
    const tot = (m.white || 0) + (m.draws || 0) + (m.black || 0);
    return { san: m.san, games: tot, adopt: posTotal ? +(100 * tot / posTotal).toFixed(1) : 0, eco: m.opening ? m.opening.eco : null, name: m.opening ? m.opening.name : null, wdl: { w: m.white || 0, d: m.draws || 0, b: m.black || 0 } };
  });
  return { posTotal, opening: j.opening || null, moves, wdl: { w: j.white || 0, d: j.draws || 0, b: j.black || 0 }, master: !!master };
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
function isSacrifice(board, sanRaw, color) {
  const info = sanSrc(board, sanRaw, color);
  if (!info || info.castle) return false;
  if (info.piece === "P") return false;        // 폰 희생은 탁월한 수로 보지 않음
  const movedVal = VAL[info.piece];
  const [tr, tc] = info.to;
  const capturedVal = info.isCap ? (board[tr][tc] ? VAL[board[tr][tc].t] : 1) : 0;
  const after = applySan(board, sanRaw, color);
  const enemy = color === "w" ? "b" : "w";
  const minAtt = enemyMinAttacker(after, tr, tc, enemy);
  if (minAtt == null) return false;            // 잡히지 않으면 희생 아님
  const net = capturedVal - movedVal;          // 되잡힐 때 손익
  const defenders = ownDefenders(after, tr, tc, color);
  return net < 0 || (minAtt < movedVal && defenders === 0 && movedVal >= 3);
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
function buildSan(board, fr, fc, tr, tc, color, ep) {
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
let CONTENT = { treeAdds: {}, forceKind: {}, branches: {}, explains: {}, keywords: {}, mainline: {}, codev: [] };
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
  const defaults = { treeAdds: {}, forceKind: {}, branches: {}, explains: {}, keywords: {}, mainline: {}, codev: [] };
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
    if (forced) return { ...m, kind: forced, book: forced === "book" };
    const mv = moverEval(m, ply);
    const loss = (mv == null || best == null) ? null : best - mv;
    const isBook = !!m.eco && (loss == null || loss <= 60);
    if (isBook) return { ...m, kind: "book", book: true };
    if (mv == null || best == null) return { ...m, kind: hasRealEval(m) ? "good" : "pending", book: false };
    let kind = tierOf(loss);
    if (["best", "excellent", "good"].includes(kind) && board && isSacrifice(board, m.san, color) && mv >= -40) kind = "brilliant";
    return { ...m, kind, book: false };
  });
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
function badgeIcon(kind, size = 14) {
  if (kind === "book") return <Book size={size} />;
  if (kind === "brilliant") return <span style={{ fontWeight: 800, fontSize: size }}>!!</span>;
  if (kind === "only") return <span style={{ fontWeight: 800, fontSize: size + 1 }}>!</span>;
  if (kind === "best") return <Star size={size} fill="#fff" />;
  if (kind === "excellent") return <ThumbsUp size={size} />;
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

/* ============================================================ 보드 ============================================================ */
function Board({ board, flip, size = 336, arrows = [], legalTargets = [], selected, onSquareClick, onPieceDrag, onDrop, onMove, evalCp, showCoords = true, showEval = true, interactive = true, lastQ }) {
  const cell = Math.floor(size / 8);
  const inner = cell * 8;
  const rows = flip ? [...board].reverse().map((r) => [...r].reverse()) : board;
  const tx = (r, c) => (flip ? [7 - r, 7 - c] : [r, c]);
  const px = (r, c) => { const [vr, vc] = flip ? [7 - r, 7 - c] : [r, c]; return [vc * cell + cell / 2, vr * cell + cell / 2]; };
  const targetSet = new Set(legalTargets.map(([r, c]) => r + "," + c));
  const boardRef = useRef(null);
  const touchStart = useRef(null);
  const sqFromTouch = (clientX, clientY) => {
    const el = boardRef.current; if (!el) return null;
    const rect = el.getBoundingClientRect();
    const vc = Math.floor((clientX - rect.left) / (rect.width / 8));
    const vr = Math.floor((clientY - rect.top) / (rect.height / 8));
    if (vr < 0 || vr > 7 || vc < 0 || vc > 7) return null;
    return tx(vr, vc);
  };
  const onTStart = interactive ? (e) => { const t = e.touches[0]; const sq = sqFromTouch(t.clientX, t.clientY); touchStart.current = sq ? { sq, piece: !!(board[sq[0]][sq[1]]) } : null; } : undefined;
  const onTEnd = interactive ? (e) => {
    const st = touchStart.current; touchStart.current = null;
    const t = e.changedTouches[0]; const end = sqFromTouch(t.clientX, t.clientY); if (!end) return;
    e.preventDefault();
    if (st && st.piece && (st.sq[0] !== end[0] || st.sq[1] !== end[1])) { if (onMove) onMove(st.sq, end); else { onPieceDrag && onPieceDrag(st.sq); onDrop && onDrop(end); } }
    else if (onSquareClick) onSquareClick(end);
  } : undefined;
  return (
    <div className="mx-auto select-none" style={{ width: inner + 20, padding: 10, borderRadius: 12, background: "linear-gradient(160deg,#3A2516,#241509)", boxShadow: "0 18px 40px -18px rgba(0,0,0,.8), inset 0 1px 0 rgba(255,255,255,.06)", border: "1px solid #000" }}>
      {showEval && <EvalBar cp={evalCp} width={inner} />}
      <div ref={boardRef} onTouchStart={onTStart} onTouchMove={interactive ? (e) => { if (touchStart.current) e.preventDefault(); } : undefined} onTouchEnd={onTEnd} style={{ position: "relative", borderRadius: 4, overflow: "visible", border: "2px solid " + T.brass, touchAction: "none" }}>
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
                  {lastQ && lastQ.to && lastQ.to[0] === r && lastQ.to[1] === c && QCOLOR[lastQ.kind] && (
                    <>
                      <div style={{ position: "absolute", inset: 0, background: QCOLOR[lastQ.kind], opacity: 0.5, pointerEvents: "none" }} />
                      <div style={{ position: "absolute", top: -cell * 0.18, right: -cell * 0.18, width: cell * 0.44, height: cell * 0.44, borderRadius: "50%", background: QCOLOR[lastQ.kind], color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: cell * (lastQ.kind === "brilliant" || lastQ.kind === "blunder" || lastQ.kind === "inaccuracy" ? 0.17 : 0.22), fontWeight: 900, border: "2px solid #fff", boxShadow: "0 2px 5px rgba(0,0,0,.55)", pointerEvents: "none", zIndex: 6 }}>{QSYM[lastQ.kind] || ""}</div>
                    </>
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
  const kws = deriveKeywords(m);
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
                <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 16, fontWeight: 800, color: T.ink }}>{moveNumber(ply)}{m.san}</span>
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

function MascotAvatar({ size = 44 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" style={{ flexShrink: 0, filter: "drop-shadow(0 3px 4px rgba(0,0,0,.35))" }}>
      <defs><linearGradient id="mg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={T.brassHi} /><stop offset="1" stopColor={T.brass} /></linearGradient></defs>
      <ellipse cx="24" cy="44" rx="12" ry="3" fill="rgba(0,0,0,.25)" />
      <path d="M16 40 h16 l-1.5-6 h-13 z" fill="url(#mg)" stroke={T.ebony} strokeWidth="1.2" />
      <path d="M18 30 c-3-5 0-12 6-12 c6 0 9 7 6 12 z" fill="url(#mg)" stroke={T.ebony} strokeWidth="1.2" />
      <circle cx="24" cy="15" r="6.5" fill="url(#mg)" stroke={T.ebony} strokeWidth="1.2" />
      <circle cx="21.6" cy="14" r="1.2" fill={T.ebony} /><circle cx="26.4" cy="14" r="1.2" fill={T.ebony} />
      <path d="M21.5 18 q2.5 2 5 0" fill="none" stroke={T.ebony} strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}
function MascotBubble({ text, ply }) {
  return (
    <div className="flex items-start gap-2" style={{ background: "linear-gradient(180deg,#3A2516,#241509)", borderRadius: 14, padding: "11px 13px", border: "1px solid #000", boxShadow: "inset 0 1px 0 rgba(255,255,255,.05)" }}>
      <MascotAvatar />
      <div style={{ minWidth: 0 }}>
        <div style={{ color: T.brassHi, fontSize: 11, fontWeight: 800, marginBottom: 3 }}>{ply > 0 ? moveNumber(ply - 1) + " 진행 · 코치" : "코치"}</div>
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
  const [moves, setMoves] = useState([]);
  const [posGames, setPosGames] = useState(node ? node.posGames : null);
  const [posEval, setPosEval] = useState(null);
  const [engineNote, setEngineNote] = useState("");
  const extraKey = (extraSans || []).join(",");
  const isMaster = mode === "master";

  useEffect(() => {
    let cancelled = false;
    const base = node ? node.moves.map((m) => ({ ...m })) : [];
    const withExtra = (list) => {
      const seen = new Set(list.map((m) => m.san));
      addsFor(key).forEach((a) => { if (!seen.has(a.san)) { list.push({ san: a.san, book: false, adopt: null, games: null, dev: true }); seen.add(a.san); } });
      (extraSans || []).forEach((s) => { if (!seen.has(s)) { list.push({ san: s, book: false, adopt: null, games: null, user: true }); seen.add(s); } });
      return list;
    };
    setMoves(withExtra(base.map((m) => ({ ...m })))); setPosGames(node ? node.posGames : null); setPosEval(null); setEngineNote("");
    if (!liveOn) return;
    (async () => {
      try {
        const [nr, mr] = await Promise.allSettled([fetchLichess(sans, false), fetchLichess(sans, true)]);
        const normal = nr.status === "fulfilled" ? nr.value : null;
        const master = mr.status === "fulfilled" ? mr.value : null;
        const active = isMaster ? (master || normal) : (normal || master);
        if (cancelled || !active || !active.moves.length) return;
        setPosGames(active.posTotal);
        const snapBy = Object.fromEntries(base.map((m) => [m.san, m]));
        const masterAdoptBy = master ? Object.fromEntries(master.moves.map((m) => [m.san, m.adopt])) : {};
        const masterTopSans = master ? master.moves.slice(0, 3).map((m) => m.san) : [];
        const mk = (l) => { const s = snapBy[l.san] || {}; return { san: l.san, adopt: l.adopt, games: l.games, wdl: l.wdl, book: !!l.eco || !!s.book, eco: l.eco || s.eco, name: (l.eco ? l.name : s.name), kw: s.kw, evalCp: s.evalCp, isMain: s.isMain, masterAdopt: masterAdoptBy[l.san] ?? null, masterTop: masterTopSans.includes(l.san) }; };
        const all = active.moves.map(mk);
        const books = all.filter((m) => m.book);
        const nonbook = all.filter((m) => !m.book);
        // 비이론 수: 리체스 채택률 상위 3개 (엔진 상위 3개는 엔진 effect에서 보충, 최소 6개 목표)
        const out = [...books, ...nonbook.slice(0, 3)];
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
      // 비이론 수 6개 보장: 엔진 평가 상위 수로 보충 (리체스 상위 3 + 엔진 상위 3)
      let cur = moves;
      const curNonbook = () => cur.filter((m) => !m.book && !m.eco).length;
      if (curNonbook() < 6) {
        const brd = boardFromSans(sans);
        const snapBy = node ? Object.fromEntries(node.moves.map((m) => [m.san, m])) : {};
        const pvs = await engine.evaluateMulti(sansToFen(sans), 13, 10);
        if (!cancelled && pvs && pvs.length) {
          const have = new Set(cur.map((m) => m.san));
          const add = [];
          for (const pv of pvs) {
            const san = uciToSan(brd, pv.uci, ply % 2 === 0 ? "w" : "b");
            if (san && !have.has(san)) { const s = snapBy[san] || {}; add.push({ san, book: !!s.book || !!s.eco, eco: s.eco, name: s.name, evalCp: s.evalCp, adopt: null, games: null, engine: true }); have.add(san); }
            if (curNonbook() + add.filter((a) => !a.book && !a.eco).length >= 6) break;
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
  }, [key, liveOn, engine.status, moves.length, isMaster]);

  const fallbackEval = useMemo(() => {
    const whites = moves.map((m) => whiteEval(m)).filter((v) => v != null);
    if (!whites.length) return null;
    return ply % 2 === 0 ? Math.max(...whites) : Math.min(...whites);
  }, [moves, ply]);

  const board = useMemo(() => boardFromSans(sans), [key]);
  const tiled = useMemo(() => {
    const seen = new Set();
    const uniq = moves.filter((m) => { if (seen.has(m.san)) return false; seen.add(m.san); return true; });
    const t = assignTiers(uniq, ply, board, key).map((m) => isMainline(key, m.san) ? { ...m, isMain: true } : m);
    const absEval = (m) => { const e = m.live ? (m.live.mate != null ? 10000 : m.live.cp) : (m.mate != null ? 10000 : m.evalCp); return e == null ? -1 : Math.abs(e); };
    const books = t.filter((m) => m.book);
    const nonbooks = t.filter((m) => !m.book).sort((a, b) => absEval(b) - absEval(a));
    return [...books, ...nonbooks];
  }, [moves, ply, board, key, contentVer]);
  return { moves: tiled, posGames, engineNote, posEval: posEval != null ? posEval : fallbackEval, node };
}

/* ============================================================ 집중 학습 모드 ============================================================ */
function AnimatedMove({ sans, san, size = 140, extraArrows = [], loopMs = 2000 }) {
  const cell = Math.floor(size / 8);
  const before = useMemo(() => boardFromSans(sans), [sans.join(" ")]);
  const color = sans.length % 2 === 0 ? "w" : "b";
  const geo = useMemo(() => sanSrc(before, san, color), [before, san, color]);
  const [slid, setSlid] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => { setSlid(false); const t = setTimeout(() => setSlid(true), 60); return () => clearTimeout(t); }, [tick, san, sans.join(" ")]);
  useEffect(() => { if (!loopMs) return; const id = setInterval(() => setTick((t) => t + 1), loopMs); return () => clearInterval(id); }, [loopMs, san, sans.join(" ")]);
  if (!geo || !geo.from) return <Board board={boardFromSans([...sans, san])} flip={false} size={size} showEval={false} showCoords={false} interactive={false} />;
  const fr = geo.from, to = geo.to; const mp = before[fr[0]][fr[1]];
  const dx = (to[1] - fr[1]) * cell, dy = (to[0] - fr[0]) * cell;
  const px = (r, c) => [c * cell + cell / 2, r * cell + cell / 2];
  return (
    <div>
      <div style={{ width: cell * 8 + 12, padding: 6, borderRadius: 9, background: "linear-gradient(160deg,#3A2516,#241509)", border: "1px solid #000" }}>
        <div style={{ position: "relative", borderRadius: 3, overflow: "hidden", border: "2px solid " + T.brass }}>
          {before.map((row, r) => (
            <div key={r} style={{ display: "flex" }}>
              {row.map((p, c) => { const light = (r + c) % 2 === 0; const hideFrom = r === fr[0] && c === fr[1]; const isTo = r === to[0] && c === to[1];
                return <div key={c} style={{ width: cell, height: cell, display: "flex", alignItems: "center", justifyContent: "center", background: light ? T.boardLight : T.boardDark, boxShadow: (hideFrom || isTo) ? "inset 0 0 0 2px rgba(62,124,196,.6)" : "none" }}>{p && !hideFrom && <span style={{ fontSize: cell * 0.72, lineHeight: 1, opacity: isTo && slid ? 0 : 1, transform: isTo && slid ? "scale(.55)" : "scale(1)", transition: isTo ? "opacity .4s ease .18s, transform .4s ease .18s" : "none", color: p.c === "w" ? T.ivoryHi : "#0E0907" }}>{PIECE[p.t]}</span>}</div>; })}
            </div>
          ))}
          {mp && <span style={{ position: "absolute", top: fr[0] * cell, left: fr[1] * cell, width: cell, height: cell, display: "flex", alignItems: "center", justifyContent: "center", fontSize: cell * 0.72, lineHeight: 1, color: mp.c === "w" ? T.ivoryHi : "#0E0907", transform: slid ? "translate(" + dx + "px," + dy + "px)" : "translate(0,0)", transition: "transform .6s cubic-bezier(.4,1.3,.5,1)", filter: "drop-shadow(0 2px 3px rgba(0,0,0,.5))" }}>{PIECE[mp.t]}</span>}
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
  const explainLong = !!explain && explain.length > 90;
  const [mistakes, setMistakes] = useState([]);
  useEffect(() => {
    setMistakes([]);
    if (!engine || engine.status !== "ready" || !stats || !stats.lines || !stats.lines.length) return;
    let cancelled = false;
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
          if (isUser && drop >= 100) { found.push({ seq: full.slice(base.length, i + 1), kind: drop >= 250 ? "blunder" : "inaccuracy", count: ln.count }); break; }
          prev = after;
        }
      }
      if (!cancelled) { found.sort((a, b) => b.count - a.count); setMistakes(found.slice(0, 5)); }
    })();
    return () => { cancelled = true; };
  }, [sans.join(" "), san, engine.status, chesscom && chesscom.status, stats && stats.total]);
  useEffect(() => {
    if (!isPunishable || !onSavePuzzle) return;
    const id = sans.join(" ") + "|" + san;
    if (curated) { onSavePuzzle({ id, name: curated.opening + "에서 " + moveNumber(ply) + san + " 응징하기", opening: curated.opening, setupSans: [...sans], mistakeSan: san, solution: curated.line, steps: curated.steps }); return; }
    if (engine && engine.status === "ready") {
      let cancelled = false;
      genPunishLine(engine, [...sans, san], 3).then((line) => { if (!cancelled && line.length >= 2) { const op = title || "오프닝"; onSavePuzzle({ id, name: op + "에서 " + moveNumber(ply) + san + " 응징하기", opening: op, setupSans: [...sans], mistakeSan: san, solution: line, steps: [], auto: true }); } });
      return () => { cancelled = true; };
    }
  }, [sans.join(" "), san, engine && engine.status]);
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
                      <div style={{ fontWeight: 800, color: T.mistake, fontSize: 11.5, marginBottom: 2 }}>오프닝 실수 {engine && engine.status === "ready" ? "" : "(엔진 준비 중…)"}</div>
                      {mistakes.length === 0 ? <div style={{ fontSize: 11.5, color: T.inkSoft }}>{engine && engine.status === "ready" ? "15수 이내에서 두드러진 실수가 발견되지 않았습니다." : "엔진이 준비되면 분석합니다."}</div>
                        : mistakes.map((mt, idx) => {
                          const seqStr = [san, ...mt.seq]; // 표기: 집중 학습 수부터
                          return (
                            <button key={idx} onClick={() => { const pre = [...sans, san, ...mt.seq.slice(0, -1)]; onJump && onJump(pre, mt.seq[mt.seq.length - 1]); }} className="press text-left" style={{ display: "block", width: "100%", fontFamily: "ui-monospace,monospace", fontSize: 12, color: T.ink, background: "none", border: "none", cursor: "pointer", padding: "2px 0", lineHeight: 1.6 }}>
                              {seqStr.map((mv, i) => {
                                const isMistake = i === seqStr.length - 1;
                                const num = moveNumber(ply + i);
                                return <span key={i} style={isMistake ? { fontWeight: 900, textDecoration: "underline", color: mt.kind === "blunder" ? T.blunder : T.inaccuracy } : {}}>{num}{mv} </span>;
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
  const [sel, setSel] = useState(null);
  const [drag, setDrag] = useState(null);
  const [lastMascot, setLastMascot] = useState(EXPLAIN[""]);
  const [focus, setFocus] = useState(null);
  const [lastQ, setLastQ] = useState(null);
  const key = sans.join(" ");
  const board = useMemo(() => boardFromSans(sans), [key]);
  const color = sans.length % 2 === 0 ? "w" : "b";
  const ply = sans.length;
  const ep = useMemo(() => epTarget(sans), [key]);
  const [mode, setMode] = useState("normal");
  const { moves, posGames, engineNote, posEval } = useMergedMoves(sans, engine, liveOn, extra[key], contentVer, mode);
  useEffect(() => { onFocusActive && onFocusActive(!!focus); }, [focus]);
  // 각 단계의 실수/블런더 중 임의 1개를 골라 응징 퍼즐 자동 생성
  const autoRef = useRef(new Set());
  useEffect(() => {
    if (!liveOn || engine.status !== "ready" || autoRef.current.has(key)) return;
    const bad = moves.filter((m) => m.kind === "mistake" || m.kind === "blunder");
    if (!bad.length) return;
    autoRef.current.add(key);
    const pick = bad[Math.floor(Math.random() * bad.length)];
    let cancelled = false;
    genPunishLine(engine, [...sans, pick.san], 3).then((line) => {
      if (cancelled || line.length < 2) return;
      const op = pick.name || (snapNode([...sans, pick.san]) || {}).opening?.name || "오프닝";
      onSavePuzzle({ id: key + "|" + pick.san, name: op + "에서 " + moveNumber(ply) + pick.san + " 응징하기", opening: op, setupSans: [...sans], mistakeSan: pick.san, solution: line, steps: [], auto: true });
    });
    return () => { cancelled = true; };
  }, [key, moves, engine.status, liveOn]);

  const arrows = useMemo(() => moves.filter((m) => m.book).map((m) => { const info = sanSrc(board, m.san, color); return info && info.from ? { from: info.from, to: info.to, adopt: m.adopt } : null; }).filter(Boolean), [moves, board, color]);
  const legalTargets = useMemo(() => sel ? legalDests(board, sel[0], sel[1], color, ep) : [], [sel, board, color, ep]);

  const go = useCallback((san, isExtra) => {
    if (isExtra) setExtra((prev) => { const cur = prev[key] || []; if (cur.includes(san)) return prev; return { ...prev, [key]: [...cur, san] }; });
    const mm = moves.find((x) => x.san === san); const src = sanSrc(board, san, color);
    setLastQ(src && src.to ? { to: src.to, kind: mm ? (mm.kind || null) : null } : null);
    const next = [...sans, san]; setSans(next); setFuture([]); setSel(null); setDrag(null);
    setLastMascot(mascotFor(sans, san));
  }, [sans, key, moves, board, color]);

  const tryMove = useCallback((from, to) => {
    if (from[0] === to[0] && from[1] === to[1]) return false;
    if (!legalDests(board, from[0], from[1], color, ep).some(([r, c]) => r === to[0] && c === to[1])) return false;
    const san = buildSan(board, from[0], from[1], to[0], to[1], color, ep);
    if (!san) return false;
    const known = moves.some((mm) => mm.san === san);
    go(san, !known);                                  // 제안에 없으면 사용자 수 블록 생성
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
  const fwd = () => { if (!future.length) return; const h = future[0]; setSans([...sans, h]); setFuture(future.slice(1)); setSel(null); };
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
          <Board board={board} flip={flip} arrows={arrows} legalTargets={legalTargets} selected={sel} onSquareClick={!focus ? onSquareClick : undefined} onPieceDrag={!focus ? onPieceDrag : undefined} onDrop={!focus ? onDrop : undefined} onMove={!focus ? tryMove : undefined} evalCp={posEval} interactive={!focus} lastQ={lastQ} />
          <div className="flex items-center justify-between mt-3">
            <NavBtn onClick={() => setFlip((v) => !v)} active={flip}><ArrowUpDown size={17} /></NavBtn>
            <div className="flex items-center gap-2">
              <NavBtn onClick={reset} disabled={!sans.length}><ChevronsLeft size={17} /></NavBtn>
              <NavBtn onClick={back} disabled={!sans.length}><ChevronLeft size={17} /></NavBtn>
              <NavBtn onClick={fwd} disabled={!future.length}><ChevronRight size={17} /></NavBtn>
            </div>
          </div>
        </div>
        <p style={{ fontSize: 11, color: T.inkSoft, marginTop: 10, lineHeight: 1.5 }}>기물을 끌거나 눌러 어떤 수든 둘 수 있어요. 제안에 없는 수를 두면 평가해서 블록을 만들어 줍니다. 화살표는 이론 수만, 두께는 채택률 비례.</p>
        <div style={{ marginTop: 12 }}><MascotBubble text={lastMascot} ply={ply} /></div>
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
              {explainFor(sans) && <p style={{ color: T.inkSoft, fontSize: 12, marginTop: 6, lineHeight: 1.5 }}>{explainFor(sans)}</p>}
            </div>
            {moves.length === 0 ? (
              <div style={{ background: T.paper, borderRadius: 12, padding: 16, border: "1px dashed #C9B58C", textAlign: "center" }}>
                <Crown size={22} style={{ color: T.brass, margin: "0 auto" }} />
                <p style={{ fontSize: 13, color: T.inkSoft, marginTop: 8 }}>제안된 수가 없어요. 보드에서 직접 두면 그 수가 평가되어 블록으로 추가됩니다.</p>
              </div>
            ) : moves.map((m) => <MoveTile key={m.san} m={m} ply={ply} posGames={posGames} onClick={() => go(m.san, false)} onFocus={() => enterFocus(m)} />)}
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
function DexMoveCard({ path, m, child, isUnlocked, hasChildren, wdl, onOpen }) {
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
      <button onClick={onOpen} disabled={!hasChildren} className="press" style={{ marginTop: 10, width: "100%", padding: "8px 0", borderRadius: 9, border: "none", cursor: hasChildren ? "pointer" : "default", background: hasChildren ? "linear-gradient(180deg,#3A2516,#241509)" : "rgba(0,0,0,.12)", color: hasChildren ? T.brassHi : (isUnlocked ? "#A8906A" : "#5E4E38"), fontWeight: 700, fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
        {hasChildren ? <>다음 수 살펴보기 <ChevronRight size={14} /></> : "마지막 수록 수"}
      </button>
    </div>
  );
}
function CollectionTab({ unlocked, liveOn, contentVer }) {
  const [path, setPath] = useState([]);
  const [lc, setLc] = useState(null);
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
      {opening && <div className="flex items-center gap-3" style={{ background: "linear-gradient(135deg,#3A2516,#241509)", border: "1px solid " + T.brass, borderRadius: 14, padding: "12px 16px", marginBottom: 14 }}>
        <span style={{ fontSize: 30, color: T.brassHi, filter: "drop-shadow(0 2px 2px rgba(0,0,0,.5))" }}>{PIECE.N}</span>
        <div><div style={{ fontSize: 16, fontWeight: 800, color: T.ivoryHi }}>{opening.name}</div><div style={{ fontSize: 12, color: T.brassHi, fontFamily: "ui-monospace,monospace" }}>{opening.eco}</div></div>
        {lc && lc.wdl && <div style={{ marginLeft: "auto", width: 150 }}><WinBar wdl={lc.wdl} /></div>}
      </div>}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {baseMoves.map((m) => {
          const childSans = [...path, m.san]; const child = snapNode(childSans);
          const hasChildren = (child && child.moves && child.moves.length > 0) || addsFor(childSans.join(" ")).length > 0;
          const isUnlocked = unlocked.has(childSans.join(" "));
          return <DexMoveCard key={m.san} path={path} m={m} child={child} isUnlocked={isUnlocked} hasChildren={hasChildren} wdl={wdlFor(m.san)} onOpen={() => hasChildren && setPath(childSans)} />;
        })}
      </div>
    </div>
  );
}

/* ============================================================ 퍼즐 탭 ============================================================ */
function PuzzleSolver({ puzzle, onClose, onSolved }) {
  const setup = [...puzzle.setupSans, puzzle.mistakeSan];
  const [started, setStarted] = useState(false);
  const [idx, setIdx] = useState(0);
  const [sel, setSel] = useState(null);
  const [msg, setMsg] = useState("");
  const cur = [...setup, ...puzzle.solution.slice(0, idx)];
  const board = useMemo(() => boardFromSans(cur), [idx, started]);
  const color = cur.length % 2 === 0 ? "w" : "b";
  const ep = epTarget(cur);
  const done = idx >= puzzle.solution.length;
  const userToMove = !done && idx % 2 === 0;
  useEffect(() => { if (done && onSolved) onSolved(puzzle.id); }, [done]);
  useEffect(() => { if (started && !done && idx % 2 === 1) { const t = setTimeout(() => setIdx((i) => i + 1), 600); return () => clearTimeout(t); } }, [idx, done, started]);
  const tryMove = (from, to) => {
    if (!userToMove) return;
    const san = buildSan(board, from[0], from[1], to[0], to[1], color, ep);
    if (san === puzzle.solution[idx]) { setMsg(""); setIdx((i) => i + 1); }
    else setMsg("✗ 잘못된 수예요. 다시 시도해 보세요.");
  };
  const onSquareClick = (sq) => { const p = board[sq[0]][sq[1]]; if (sel) { if (legalDests(board, sel[0], sel[1], color, ep).some(([r, c]) => r === sq[0] && c === sq[1])) { tryMove(sel, sq); setSel(null); return; } if (p && p.c === color) { setSel(sq); return; } setSel(null); } else if (p && p.c === color) setSel(sq); };
  const restart = () => { setStarted(false); setIdx(0); setSel(null); setMsg(""); };
  return (
    <div style={{ background: T.paper, border: "1px solid #DCCBA8", borderRadius: 14, padding: 16, maxWidth: 460, margin: "0 auto" }}>
      <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: T.ink }}>{puzzle.name}</div>
        <button onClick={onClose} className="press" style={{ padding: "5px 10px", borderRadius: 8, background: T.ebony2, color: T.ivory, border: "1px solid #000", fontSize: 12, cursor: "pointer" }}>목록</button>
      </div>
      {!started ? (
        <div>
          <AnimatedMove sans={puzzle.setupSans} san={puzzle.mistakeSan} size={380} />
          <p style={{ fontSize: 13, color: T.ink, textAlign: "center", margin: "12px 0", lineHeight: 1.5 }}>상대가 <b>{moveNumber(puzzle.setupSans.length)}{puzzle.mistakeSan}</b> 를 두었습니다. 이 실수를 응징하는 수순을 직접 두어 보세요.</p>
          <div className="flex justify-center"><button onClick={() => setStarted(true)} className="press" style={{ padding: "9px 20px", borderRadius: 10, background: T.brass, color: "#2A1A0E", fontWeight: 800, border: "none", cursor: "pointer", fontSize: 14 }}>풀기 시작 ›</button></div>
        </div>
      ) : (
        <div>
          <Board board={board} flip={color === "b"} size={380} selected={sel} onSquareClick={onSquareClick} onPieceDrag={(sq) => { const p = board[sq[0]][sq[1]]; if (userToMove && p && p.c === color) setSel(sq); }} onDrop={(sq) => { if (sel) onSquareClick(sq); }} onMove={(from, to) => { if (userToMove) { tryMove(from, to); setSel(null); } }} legalTargets={sel ? legalDests(board, sel[0], sel[1], color, ep) : []} showEval={false} interactive={userToMove} />
          <p style={{ fontSize: 13, color: done ? T.best : T.ink, fontWeight: 700, marginTop: 12, textAlign: "center" }}>{done ? "✓ 완성! 응징 수순을 모두 찾았어요." : userToMove ? "당신 차례 — 응징하는 최선의 수를 두세요." : "상대 응수 중…"}</p>
          {msg && !done && <p style={{ fontSize: 12.5, color: T.blunder, textAlign: "center", fontWeight: 700, marginTop: 4 }}>{msg}</p>}
          <div className="flex justify-center" style={{ marginTop: 10 }}><button onClick={restart} className="press" style={{ padding: "6px 14px", borderRadius: 9, background: T.ebony2, color: T.ivory, border: "1px solid #000", fontWeight: 700, cursor: "pointer", fontSize: 12 }}>{done ? "다시 풀기" : "처음부터"}</button></div>
        </div>
      )}
    </div>
  );
}
function PuzzleCard({ p, isSolved, onClick }) {
  return (
    <button onClick={onClick} className="press text-left" style={{ borderRadius: 14, padding: 14, background: isSolved ? "linear-gradient(180deg,#E7F0DC,#D2E2BC)" : "linear-gradient(180deg," + T.ivoryHi + ",#E2D2B2)", boxShadow: "0 4px 0 " + (isSolved ? "#9DB97E" : "#B59A6E"), border: "1px solid " + (isSolved ? "#A9C589" : "#CDB98E"), cursor: "pointer", position: "relative" }}>
      <div className="flex items-center justify-between"><div style={{ fontSize: 11, color: isSolved ? T.best : T.brass, fontWeight: 800 }}>{p.opening}</div>{isSolved && <span style={{ display: "inline-flex", alignItems: "center", gap: 3, color: T.best, fontSize: 11, fontWeight: 800 }}><Check size={14} /> 해결됨</span>}</div>
      <div style={{ fontSize: 14, fontWeight: 800, color: T.ink, marginTop: 4 }}>{p.name}</div>
      <div style={{ fontSize: 11, color: T.inkSoft, marginTop: 6 }}>응징 {Math.ceil(p.solution.length / 2)}수 · {isSolved ? "다시 풀기" : "풀어보기"} ›</div>
    </button>
  );
}
function PuzzleTab({ puzzles, solved, onSolved }) {
  const [active, setActive] = useState(null);
  if (active) return <PuzzleSolver puzzle={active} onClose={() => setActive(null)} onSolved={onSolved} />;
  const open = puzzles.filter((p) => !solved.has(p.id));
  const cleared = puzzles.filter((p) => solved.has(p.id));
  return (
    <div>
      <h2 style={{ fontSize: 18, fontWeight: 800, color: T.ivoryHi }}>퍼즐 · 실수 응징</h2>
      <p style={{ fontSize: 13, color: T.inkSoft, margin: "6px 0 14px" }}>학습 탭에서 실수·블런더 수에 들어가면 응징 수순이 퍼즐로 자동 저장됩니다. ({cleared.length}/{puzzles.length} 해결)</p>
      {puzzles.length === 0 ? <div style={{ background: T.paper, border: "1px dashed #C9B58C", borderRadius: 12, padding: 20, textAlign: "center", color: T.inkSoft, fontSize: 13 }}>아직 저장된 퍼즐이 없어요.</div>
        : <div>
            {open.length > 0 && <div style={{ marginBottom: 16 }}><div style={{ fontSize: 12.5, fontWeight: 800, color: T.brassHi, marginBottom: 8 }}>미해결 ({open.length})</div><div className="grid sm:grid-cols-2 gap-3">{open.map((p) => <PuzzleCard key={p.id} p={p} isSolved={false} onClick={() => setActive(p)} />)}</div></div>}
            {cleared.length > 0 && <div><div style={{ fontSize: 12.5, fontWeight: 800, color: T.best, marginBottom: 8 }}>해결된 퍼즐 ({cleared.length})</div><div className="grid sm:grid-cols-2 gap-3">{cleared.map((p) => <PuzzleCard key={p.id} p={p} isSolved={true} onClick={() => setActive(p)} />)}</div></div>}
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
function SettingsTab({ profile, setProfile, engineStatus, liveOn, setLiveOn, chesscomStatus, user, isDev, isCodev, devOn, setDevOn, canAdd, canEdit, bumpContent, contentVer, openAuth }) {
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
      <h2 style={{ fontSize: 18, fontWeight: 800, color: T.ivoryHi }}>설정</h2>

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
        <div className="flex items-center justify-between" style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: T.ink }}>{mode === "login" ? "로그인" : "회원가입"}</div>
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
    if (raw) { try { const d = JSON.parse(raw); setUnlocked(new Set(d.unlocked || [])); setProfile(d.profile || { nickname: "", chesscom: "" }); setPuzzles(d.puzzles || []); setSolved(new Set(d.solved || [])); if (typeof d.liveOn === "boolean") setLiveOn(d.liveOn); if (d.user && d.userHash) { setUser(d.user); setUserHash(d.userHash); try { const r = await acctLogin(d.user, d.userHash); if (r && r.ok && r.data) { const pr = r.data.progress || {}; if (pr.unlocked) setUnlocked(new Set(pr.unlocked)); if (pr.puzzles) setPuzzles(pr.puzzles); if (pr.solved) setSolved(new Set(pr.solved)); if (r.data.chesscom) setProfile((p) => ({ ...p, chesscom: r.data.chesscom })); } } catch { } } } catch { } }
    setLoaded(true);
  })(); }, []);
  useEffect(() => { if (loaded) store.set("chess_state_v5", JSON.stringify({ unlocked: [...unlocked], profile, puzzles, solved: [...solved], liveOn, user, userHash })); }, [unlocked, profile, puzzles, solved, liveOn, loaded, user, userHash]);
  useEffect(() => { if (loaded && user && userHash) acctSave(user, userHash, { progress: { unlocked: [...unlocked], puzzles, solved: [...solved] }, chesscom: profile.chesscom || "" }); }, [unlocked, puzzles, solved, user, userHash, loaded, profile.chesscom]);

  const onAuth = useCallback((id, data, hash) => { setUser(id); setUserHash(hash || null); const pr = (data && data.progress) || {}; if (pr.unlocked) setUnlocked(new Set(pr.unlocked)); if (pr.puzzles) setPuzzles(pr.puzzles); if (pr.solved) setSolved(new Set(pr.solved)); if (data && data.chesscom) setProfile((p) => ({ ...p, chesscom: data.chesscom })); setAuthOpen(false); }, []);
  const logout = useCallback(() => { setUser(null); setUserHash(null); setDevOn(false); setConfirmLogout(false); }, []);
  const unlockOpening = useCallback((keyStr) => { let isNew = false; setUnlocked((p) => { if (p.has(keyStr)) return p; isNew = true; const n = new Set(p); const parts = keyStr.split(" ").filter(Boolean); for (let i = 1; i <= parts.length; i++) n.add(parts.slice(0, i).join(" ")); return n; }); if (isNew) setNewUnlocks((n) => n + 1); return isNew; }, []);
  const onLearned = useCallback((name) => { setToast({ name }); setTimeout(() => setToast(null), 2600); }, []);
  const onSavePuzzle = useCallback((pz) => setPuzzles((prev) => prev.some((x) => x.id === pz.id) ? prev : [...prev, pz]), []);
  const onSolved = useCallback((id) => setSolved((p) => { if (p.has(id)) return p; const n = new Set(p); n.add(id); return n; }), []);
  const switchTab = (k) => { if (k === "dex") setNewUnlocks(0); setTab(k); };

  return (
    <div style={{ minHeight: "100vh", background: "radial-gradient(130% 120% at 50% -10%, #3A2516 0%, #1B0F07 60%)", fontFamily: "system-ui, -apple-system, 'Noto Sans KR', sans-serif" }}>
      <style>{"button{transition:transform .08s ease, box-shadow .08s ease} button:not(:disabled):active{transform:scale(.94)} @keyframes lockpop{0%{transform:scale(.6);opacity:0}50%{transform:scale(1.1)}100%{transform:scale(1);opacity:1}}"}</style>
      <header className="flex items-center justify-between" style={{ padding: "16px 20px", borderBottom: "1px solid #000", background: "linear-gradient(180deg,#3A2516,#2A1810)" }}>
        <div className="flex items-center gap-3">
          <span style={{ fontSize: 26, color: T.ivoryHi, filter: "drop-shadow(0 2px 2px rgba(0,0,0,.5))" }}>{PIECE.N}</span>
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
            <span style={{ fontSize: 22 }}>🔓</span>
            <div><div style={{ fontWeight: 800, fontSize: 13, color: T.brassHi }}>새로운 오프닝 잠금 해제!</div><div style={{ fontSize: 12 }}>{toast.name}</div></div>
          </div>
        </div>
      )}

      <main style={{ maxWidth: 1080, margin: "0 auto", padding: "22px 18px 110px" }}>
        {tab === "learn" && <LearnTab engine={engine} liveOn={liveOn} onFocusActive={setFocusActive} unlockOpening={unlockOpening} onLearned={onLearned} chesscom={chesscom} onSavePuzzle={onSavePuzzle} contentVer={contentVer} canEdit={canEdit} canAdd={canAdd} bumpContent={bumpContent} sans={learnSans} setSans={setLearnSans} future={learnFuture} setFuture={setLearnFuture} extra={learnExtra} setExtra={setLearnExtra} />}
        {tab === "dex" && <CollectionTab unlocked={unlocked} liveOn={liveOn} contentVer={contentVer} />}
        {tab === "puzzle" && <PuzzleTab puzzles={puzzles} solved={solved} onSolved={onSolved} />}
        {tab === "set" && <SettingsTab profile={profile} setProfile={setProfile} engineStatus={engine.status} liveOn={liveOn} setLiveOn={setLiveOn} chesscomStatus={chesscom.status} user={user} isDev={isDev} isCodev={isCodev} devOn={devOn} setDevOn={setDevOn} canAdd={canAdd} canEdit={canEdit} bumpContent={bumpContent} contentVer={contentVer} openAuth={openAuth} />}
      </main>

      <nav style={{ position: "fixed", left: 0, right: 0, bottom: 0, background: "linear-gradient(180deg,#2E1B10,#160C06)", borderTop: "1px solid #000", height: 66, paddingBottom: "env(safe-area-inset-bottom)" }}>
        {(
          <div className="flex" style={{ maxWidth: 480, margin: "0 auto", height: "100%", gap: 6, padding: "0 14px" }}>
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
