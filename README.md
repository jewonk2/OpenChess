# 오프닝 연구소 (OpenChess)

React + Vite 기반 체스 오프닝 트레이너. 실시간 Stockfish(단일 스레드 WASM) · Lichess Explorer · ECO 스냅샷(최대 10수)으로 동작하는 정적 SPA.

## 로컬 실행

```powershell
npm install      # postinstall 이 Stockfish 엔진을 public/engine 으로 복사
npm run dev      # http://localhost:5173
npm run build    # 정적 빌드 → dist/
npm run preview  # 빌드 결과 미리보기
```

Node 18 이상 필요. 단일 스레드 엔진이라 COOP/COEP 헤더가 필요 없어 어떤 정적 호스트에도 그대로 올라갑니다.

## 배포

빌드하면 `dist/` 정적 파일만 남으므로 아래 어디든 가능합니다.

### A. Vercel (권장 · 루트 도메인 · 설정 0)
1. 이 폴더를 GitHub 저장소로 푸시
2. vercel.com → New Project → 저장소 선택
3. Framework: Vite 자동 감지 / Build: `npm run build` / Output: `dist`
4. Deploy. 이후 main 에 푸시할 때마다 자동 재배포

### B. GitHub Pages (저장소에 포함된 워크플로 사용)
1. GitHub 저장소로 푸시 (.github/workflows/deploy.yml 포함됨)
2. 저장소 Settings → Pages → Source: GitHub Actions
3. main 에 푸시하면 자동 빌드/배포. 주소: https://<사용자명>.github.io/<저장소이름>/
4. 워크플로가 하위 경로에 맞춰 VITE_BASE 를 주입하므로 엔진/에셋 경로가 깨지지 않습니다.

### C. Netlify / Cloudflare Pages
Build command `npm run build`, Publish directory `dist`. 나머지는 Vercel 과 동일.

## 데이터 갱신 (선택)

```bash
npm run refresh   # Lichess Explorer + Stockfish 로 openings.json 재생성
```

## 구조

- `src/App.jsx` — 앱 전체 (단일 파일)
- `src/data/openings.json` — ECO 오프닝 트리 스냅샷 (최대 10수)
- `scripts/copy-engine.mjs` — 엔진 파일을 public/engine 으로 복사 (postinstall)
- `scripts/refresh-data.mjs` — 라이브 데이터로 스냅샷 재생성

## 참고

- 계정·개발자 콘텐츠 저장은 현재 브라우저 localStorage 기반입니다. 다기기 동기화가 필요하면 App.jsx 의 accountStore / saveContent / loadContent 를 백엔드 API(Supabase, Firebase 등)로 교체하세요.
- Lichess Explorer · chess.com API 는 브라우저에서 직접 호출하며 CORS 를 허용합니다.

## 백엔드(Supabase) 연동 — 다기기 로그인 + 공유 개발자 콘텐츠

미설정 시 브라우저 localStorage로 동작합니다(기기별 저장, 공유 안 됨). 아래를 설정하면 계정·진도가 다기기에서 동기화되고, 개발자/공동개발자 콘텐츠가 모든 방문자에게 공유됩니다.

1. supabase.com 에서 프로젝트 생성
2. 대시보드 → SQL Editor → `supabase-setup.sql` 내용을 붙여넣고 RUN
3. Project Settings → API 에서 **Project URL** 과 **anon public key** 복사
4. 로컬: `.env.example` 를 `.env` 로 복사해 두 값을 채움 → `npm run dev`
5. 배포:
   - Vercel: Project → Settings → Environment Variables 에 `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` 추가 후 재배포
   - GitHub Pages: 저장소 Settings → Secrets and variables → Actions 에 같은 이름의 Secret 2개 추가(워크플로가 빌드시 주입)

설계: 비밀번호는 SHA-256으로 해시 후 전송, `accounts` 테이블은 RLS로 직접 접근을 막고 `app_signup`/`app_login`/`app_save` RPC(SECURITY DEFINER)로만 접근하여 해시가 외부로 노출되지 않습니다. 진도 저장은 비밀번호 해시가 일치해야만 가능합니다. 공유 콘텐츠(`app_content`)는 모든 방문자가 읽고, 편집 UI는 개발자/공동개발자에게만 노출됩니다.

보안 주의(취미 프로젝트 기준): `app_content` 는 anon 키로 쓰기가 가능하므로(편집 UI 게이팅은 클라이언트), 민감 서비스라면 콘텐츠 쓰기도 RPC+자격 검증으로 막고, 인증은 Supabase Auth(이메일/OAuth)로 전환하는 것을 권장합니다. 현재 해시는 솔트 없는 SHA-256입니다.
