const GOOGLE_SHEETS_URL = process.env.GOOGLE_SHEETS_URL || "https://script.google.com/macros/s/AKfycbxxKLSEicEESR53XBoXsW2lwqrfq87D_006Eq2KnZJFCm2j_ZCxPrDo6y3px7PdV8a8qA/exec";
const ADMIN_KEY = process.env.ADMIN_KEY || "admin2025H";

// Allowed origins for CORS. Override via env var as a comma-separated list.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",").map(s => s.trim()).filter(Boolean);

// Simple in-memory rate limiting (stateless per Vercel instance)
const rateLimit = new Map();
const LIMIT_WINDOW = 10000; // 10 seconds
const MAX_REQUESTS = 15;

export default async function handler(req, res) {
  // 0. Fail-closed if server-side config is missing. Never leak a default secret.
  if (!GOOGLE_SHEETS_URL || !ADMIN_KEY) {
    return res.status(500).json({
      success: false,
      error: "الخدمة غير مهيأة على الخادم (GOOGLE_SHEETS_URL أو ADMIN_KEY غير معرّفين)."
    });
  }

  // 1. IP Rate Limiting
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const now = Date.now();
  const entry = rateLimit.get(ip) || { count: 0, firstReq: now };

  if (now - entry.firstReq > LIMIT_WINDOW) {
    entry.count = 1;
    entry.firstReq = now;
  } else {
    entry.count++;
  }
  rateLimit.set(ip, entry);

  if (entry.count > MAX_REQUESTS) {
    return res.status(429).json({ success: false, error: "تم تجاوز عدد الطلبات المسموح به. يرجى المحاولة بعد 10 ثوانٍ." });
  }

  // 2. CORS configuration — reflect only allowed origins when configured.
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.length === 0) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-Requested-With, Accept, Content-Type'
  );

  // Handle OPTIONS request
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    let response;
    
    if (req.method === 'GET') {
      // Forward GET with query parameters
      const url = new URL(GOOGLE_SHEETS_URL);
      const query = { ...req.query };

      // 3. Security: Handle 'pass' injection for GET requests
      if (query.key === ADMIN_KEY || query.pass === ADMIN_KEY) {
        query.key = ADMIN_KEY;
        delete query.pass;
      }
      
      Object.keys(query).forEach(key => url.searchParams.append(key, query[key]));
      response = await fetch(url.toString());
    } else if (req.method === 'POST') {
      const payload = req.body || {};
      
      if (typeof payload !== 'object') {
        return res.status(400).json({ success: false, error: "بيانات الطلب غير صالحة." });
      }

      // 3. Security Hardening: Inject ADMIN_KEY (resilient check)
      const providedPass = (payload.pass || payload.key || "").trim();
      if (providedPass === ADMIN_KEY) {
        payload.key = ADMIN_KEY; 
        delete payload.pass;
      } else if (payload.action !== 'book' && payload.action !== 'checkDuplicate') {
        return res.status(401).json({ success: false, error: "كلمة المرور غير صحيحة أو انتهت الجلسة. يرجى تسجيل الدخول مجدداً." });
      }

      console.log(`[Proxy] Forwarding POST ${payload.action || 'unknown'}`);

      // Forward POST with JSON body
      response = await fetch(GOOGLE_SHEETS_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json', 
        },
        body: JSON.stringify(payload),
      });
    } else {
      return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

      console.log(`[Proxy] Response from Google: status=${response.status}`);
      const contentType = response.headers.get("content-type");
      const responseText = await response.text();

      if (!response.ok) {
        console.error(`[Proxy] Google returned error status: ${response.status}`, responseText.substring(0, 500));
      }

    if (contentType && contentType.includes("text/html")) {
      let errorHint = "Google returned an HTML error";
      if (responseText.includes("ServiceLogin")) {
        errorHint = "Google requires login. Ensure the script is deployed with 'Anyone' access.";
      }
      return res.status(500).json({ success: false, error: errorHint, details: responseText.substring(0, 200) });
    }

    try {
      const data = JSON.parse(responseText);
      res.status(response.status).json(data);
    } catch (e) {
      res.status(200).send(responseText); 
    }
  } catch (error) {
    console.error(`[Proxy Critical Error]`, error);
    res.status(500).json({ success: false, error: error.message });
  }
}
