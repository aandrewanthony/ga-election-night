// Proxy for the Georgia Secretary of State's public results API (it sends no CORS headers).
// Only the two read-only paths the app uses are allowed.
const SOS = 'https://results.sos.ga.gov/results/public/api/';
const ALLOWED = /^(jurisdictions\/Georgia|elections\/[A-Za-z0-9-]{2,60}\/[A-Za-z0-9]{4,60}\/data)$/;

export default async (req) => {
  const path = new URL(req.url).searchParams.get('path') ?? '';
  if (!ALLOWED.test(path)) return new Response('Not allowed', { status: 400 });
  const res = await fetch(SOS + path, { headers: { Accept: 'application/json', 'User-Agent': 'GA-Election-Night/1.0' } });
  return new Response(res.body, {
    status: res.status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=20' },
  });
};
