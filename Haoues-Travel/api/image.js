/**
 * Image proxy — serves Google Drive images through Vercel's CDN.
 *
 * Public Drive endpoints (thumbnail?id=, uc?export=view&id=) are aggressively
 * throttled by Google when hit from anonymous visitors, so the site used to
 * show broken images once traffic grew. This handler:
 *
 *   1. Extracts the file ID from ?id= (or a full Drive URL).
 *   2. Tries several public Drive endpoints server-side and streams the first
 *      one that returns real image bytes back to the browser.
 *   3. Falls back to the Apps Script `?action=imageBlob&id=` endpoint, which
 *      runs as the deployment owner and can read files even when Drive's
 *      public URLs are refused or throttled.
 *   4. Sets a long Cache-Control so Vercel's CDN caches the image globally —
 *      after the first hit from any region, subsequent visitors get it from
 *      the CDN and Drive is not touched again.
 */

const APPS_SCRIPT_URL = process.env.GOOGLE_SHEETS_URL ||
  "https://script.google.com/macros/s/AKfycbxxKLSEicEESR53XBoXsW2lwqrfq87D_006Eq2KnZJFCm2j_ZCxPrDo6y3px7PdV8a8qA/exec";

const PUBLIC_ENDPOINTS = [
  (id, sz) => `https://lh3.googleusercontent.com/d/${id}=s${sz}`,
  (id, sz) => `https://drive.google.com/thumbnail?id=${id}&sz=w${sz}`,
  (id)     => `https://drive.google.com/uc?export=view&id=${id}`,
];

function extractFileId(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (/^[A-Za-z0-9_-]{20,}$/.test(s)) return s;
  let m = s.match(/\/d\/([A-Za-z0-9_-]{20,})/);
  if (m) return m[1];
  m = s.match(/[?&]id=([A-Za-z0-9_-]{20,})/);
  if (m) return m[1];
  return null;
}

async function tryPublicEndpoint(urlBuilder, id, sz) {
  const url = urlBuilder(id, sz);
  try {
    const upstream = await fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; AbuIlyasUmrah/1.0)" },
    });
    if (!upstream.ok) return { ok: false, reason: `status ${upstream.status}` };
    const ctype = upstream.headers.get("content-type") || "";
    // Drive sometimes answers the throttled/sign-in HTML stub with 200.
    if (!ctype.startsWith("image/")) {
      return { ok: false, reason: `non-image content-type ${ctype}` };
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    return { ok: true, buf, ctype };
  } catch (err) {
    return { ok: false, reason: err && err.message ? err.message : String(err) };
  }
}

async function tryAppsScriptBlob(id) {
  try {
    const url = `${APPS_SCRIPT_URL}?action=imageBlob&id=${encodeURIComponent(id)}`;
    const upstream = await fetch(url, { redirect: "follow" });
    if (!upstream.ok) return { ok: false, reason: `apps-script status ${upstream.status}` };
    const json = await upstream.json();
    if (!json || !json.success || !json.base64) {
      return { ok: false, reason: `apps-script ${json && json.error ? json.error : "unknown"}` };
    }
    const buf = Buffer.from(json.base64, "base64");
    return { ok: true, buf, ctype: json.contentType || "image/jpeg" };
  } catch (err) {
    return { ok: false, reason: err && err.message ? err.message : String(err) };
  }
}

/* Error paths must never inherit the immutable cache header we set for
   successful images — a transient Drive 502 must not be cached for a year. */
function sendError(res, status, payload) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.status(status).json(payload);
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "GET") {
    sendError(res, 405, { success: false, error: "Method not allowed" });
    return;
  }

  const id = extractFileId(req.query.id || req.query.url);
  if (!id) {
    sendError(res, 400, { success: false, error: "Missing or invalid file id." });
    return;
  }

  const raw = parseInt(req.query.sz || req.query.w || "1600", 10);
  const sz = Number.isFinite(raw) && raw > 0 ? Math.min(raw, 2400) : 1600;

  const failures = [];

  // Try each public endpoint in order.
  for (const build of PUBLIC_ENDPOINTS) {
    const r = await tryPublicEndpoint(build, id, sz);
    if (r.ok) return sendImage(res, r.buf, r.ctype);
    failures.push(r.reason);
  }

  // Last resort: fetch the bytes through Apps Script (runs as the owner).
  const r = await tryAppsScriptBlob(id);
  if (r.ok) return sendImage(res, r.buf, r.ctype);
  failures.push(r.reason);

  sendError(res, 502, {
    success: false,
    error: "Failed to fetch image from any source.",
    details: failures,
  });
}

function sendImage(res, buf, ctype) {
  res.setHeader("Content-Type", ctype);
  res.setHeader("Content-Length", String(buf.length));
  // One year on Vercel's edge + browsers. Images are content-addressed by
  // file ID so a new upload gets a new URL — safe to treat as immutable.
  res.setHeader(
    "Cache-Control",
    "public, max-age=31536000, s-maxage=31536000, immutable"
  );
  res.status(200).send(buf);
}
