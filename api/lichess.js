// Vercel 서버리스 함수: 브라우저 대신 Lichess Opening Explorer를 호출한다.
// Lichess가 Explorer API에 로그인(OAuth 토큰)을 요구하게 되면서, 토큰을 브라우저에
// 그대로 노출할 수 없어 이 프록시를 거친다 — 토큰은 Vercel 환경변수(LICHESS_TOKEN)로만 존재.
export default async function handler(req, res) {
  const { master, pgn, ...params } = req.query;
  const token = process.env.LICHESS_TOKEN;
  const headers = { "User-Agent": "openchess-explorer-proxy/1.0" };
  if (token) headers.Authorization = "Bearer " + token;

  // 마스터 대국 하나의 전체 기보(PGN)를 조회하는 경로 — 집중학습에서 대국을 클릭했을 때 사용.
  // lila-openingexplorer는 "/masters/pgn/{id}"(현재 경로)와 "/master/pgn/{id}"(구버전 호환 경로)를
  // 둘 다 같은 핸들러로 서비스한다. 현재 경로를 우선 시도하고, 실패하면 구버전 경로로 한 번 더 시도한다.
  if (pgn) {
    const id = encodeURIComponent(pgn);
    try {
      let upstream = await fetch("https://explorer.lichess.org/masters/pgn/" + id, { headers });
      if (!upstream.ok) upstream = await fetch("https://explorer.lichess.org/master/pgn/" + id, { headers });
      const body = await upstream.text();
      res.status(upstream.status);
      res.setHeader("content-type", upstream.headers.get("content-type") || "application/x-chess-pgn");
      res.send(body);
    } catch (e) {
      res.status(502).json({ error: String(e) });
    }
    return;
  }

  const base = master === "1"
    ? "https://explorer.lichess.org/masters"
    : "https://explorer.lichess.org/lichess";
  const url = base + "?" + new URLSearchParams(params).toString();
  try {
    const upstream = await fetch(url, { headers });
    const body = await upstream.text();
    res.status(upstream.status);
    res.setHeader("content-type", upstream.headers.get("content-type") || "application/json");
    res.send(body);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
}
