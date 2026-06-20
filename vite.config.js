import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// 단일 스레드 Stockfish 는 COOP/COEP 가 필요 없습니다.
// base: Vercel/Netlify/Cloudflare(루트 도메인)는 "/", GitHub Pages 하위경로는 VITE_BASE 로 주입.
export default defineConfig({
  base: process.env.VITE_BASE || "/",
  plugins: [react()],
});
