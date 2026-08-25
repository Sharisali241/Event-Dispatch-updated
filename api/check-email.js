// POST /api/check-email  ->  { registered: true | false }
//
// Lets the login screen tell someone "this email is not registered" instead of the
// silent success Supabase returns for every address.
//
// This has to run server-side. The lookup needs the service_role key, which bypasses
// RLS and grants full database access — it must never reach index.html.
//
// SECURITY NOTE: this endpoint deliberately reveals whether an address has an account,
// which is exactly what Supabase's /auth/v1/recover refuses to do (it always returns
// 200 so nobody can enumerate users). That is the tradeoff the feature asks for. The
// rate limit below keeps it from being a convenient bulk-enumeration tool, but anyone
// determined can still probe addresses one at a time. Remove this endpoint if the user
// list ever becomes sensitive.
//
// Required environment variables (Vercel -> Settings -> Environment Variables):
//   SUPABASE_URL                e.g. https://xxxx.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY   Project Settings -> API -> service_role (SECRET)

const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 8;

// Best-effort throttle. Serverless instances are recycled and requests can land on
// different ones, so this slows scanning rather than preventing it outright.
const hits = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const rec = hits.get(ip);
  if (!rec || now - rec.start > WINDOW_MS) {
    hits.set(ip, { start: now, count: 1 });
    if (hits.size > 5000) hits.clear(); // crude bound on memory
    return false;
  }
  rec.count += 1;
  return rec.count > MAX_PER_WINDOW;
}

function clientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd) return fwd.split(",")[0].trim();
  return (req.socket && req.socket.remoteAddress) || "unknown";
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const env = process.env;
  const missing = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"].filter(function (k) { return !env[k]; });
  if (missing.length) {
    console.error("check-email: missing env vars:", missing.join(", "));
    return res.status(500).json({ error: "Email check is not configured (missing " + missing.join(", ") + ")" });
  }

  if (rateLimited(clientIp(req))) {
    return res.status(429).json({ error: "Too many checks. Please wait a minute." });
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (e) { body = null; }
  }
  const email = body && typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "A valid email is required" });
  }

  try {
    const key = env.SUPABASE_SERVICE_ROLE_KEY;
    const url = env.SUPABASE_URL.replace(/\/+$/, "")
      + "/auth/v1/admin/users?per_page=50&filter=" + encodeURIComponent(email);
    const r = await fetch(url, { headers: { apikey: key, Authorization: "Bearer " + key } });
    if (!r.ok) {
      console.error("check-email: admin lookup failed:", r.status, await r.text());
      return res.status(502).json({ error: "Could not verify email" });
    }
    const data = await r.json();
    const users = Array.isArray(data) ? data : (data.users || []);
    // `filter` is a substring match, so "gmail.com" would match several accounts.
    // Only an exact address counts as registered.
    const registered = users.some(function (u) {
      return u && typeof u.email === "string" && u.email.trim().toLowerCase() === email;
    });
    return res.status(200).json({ registered: registered });
  } catch (e) {
    console.error("check-email: lookup threw:", e);
    return res.status(502).json({ error: "Could not verify email" });
  }
};
