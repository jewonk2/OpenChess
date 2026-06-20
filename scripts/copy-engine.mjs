#!/usr/bin/env node
/** npm 'stockfish' 의 단일 스레드 WASM 빌드를 public/engine 으로 복사 (Web Worker 동일 출처 로딩용). */
import { mkdirSync, copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const base = dirname(require.resolve("stockfish/package.json")) + "/src";
const out = "public/engine"; mkdirSync(out, { recursive: true });
for (const f of ["stockfish-nnue-16-single.js", "stockfish-nnue-16-single.wasm", "nn-5af11540bbfe.nnue"]) {
  const src = join(base, f);
  if (existsSync(src)) { copyFileSync(src, join(out, f)); console.log("copied", f); }
  else console.warn("missing", f, "(빌드명이 다를 수 있음 — node_modules/stockfish/src 확인)");
}
