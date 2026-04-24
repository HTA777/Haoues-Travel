const GOOGLE_APP_SCRIPT_URL = process.env.GOOGLE_SHEETS_URL || "https://script.google.com/macros/s/AKfycbzRm_l67zSJOepDVZxqmXa1Dfbt9BtRDnYAK_LD51bK6z46P-o7DnKI72g1JETKfVCB/exec";
const ADMIN_KEY = process.env.ADMIN_KEY || "admin2025H";
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",").map(s => s.trim()).filter(Boolean);

// Simple in-memory rate limiting (stateless per Vercel instance)
const rateLimit = new Map();
const LIMIT_WINDOW = 60000; // 1 minute
const MAX_UPLOADS = 10;

export default async function handler(req, res) {
  if (!GOOGLE_APP_SCRIPT_URL || !ADMIN_KEY) {
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

  if (entry.count > MAX_UPLOADS) {
    return res.status(429).json({ success: false, error: "تم تجاوز حد الرفع المسموح به. يرجى الانتظار دقيقة واحدة." });
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
  res.setHeader('Access-Control-Allow-Methods', 'OPTIONS,POST');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-Requested-With, Accept, Content-Type'
  );

  // Handle OPTIONS request
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  try {
    const payload = req.body || {};
    
    if (typeof payload !== 'object') {
      return res.status(400).json({ success: false, error: "بيانات الصورة غير صالحة." });
    }

    // 3. Security Hardening: Inject ADMIN_KEY (resilient check)
    const providedPass = (payload.pass || payload.key || "").trim();
    if (providedPass === ADMIN_KEY) {
      payload.key = ADMIN_KEY;
      delete payload.pass;
    } else {
      return res.status(401).json({ success: false, error: "كلمة المرور غير صحيحة أو انتهت الجلسة. يرجى تسجيل الدخول مجدداً لرفع الصور." });
    }

    // Check payload size
    const bodySize = JSON.stringify(payload).length;
    console.log(`Payload size: ${bodySize} bytes`);
    
    if (bodySize > 4.4 * 1024 * 1024) {
      return res.status(413).json({ 
        success: false, 
        error: "حجم الصورة كبير جداً بالنسبة للخادم (الحد الأقصى 4.5 ميجابايت). يرجى تقليل حجم الصورة قليلاً أو استخدام صورة أخرى." 
      });
    }

    const response = await fetch(GOOGLE_APP_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
    });

    const contentType = response.headers.get("content-type");
    const responseText = await response.text();

    if (contentType && contentType.includes("text/html")) {
      let errorHint = "خطأ غير معروف في جوجل";
      if (responseText.includes("google-signin") || responseText.includes("ServiceLogin")) {
        errorHint = "جوجل يطلب تسجيل الدخول. الرابط لا يزال 'خاصاً'. يرجى إعادة النشر واختيار 'Anyone'.";
      } else {
        const match = responseText.match(/<title>(.*?)<\/title>/i);
        const title = match ? match[1] : "";
        errorHint = `جوجل أرجع خطأ: ${title || responseText.substring(0, 150)}`;
      }
      
      return res.status(500).json({ 
        success: false, 
        error: errorHint 
      });
    }

    try {
      const data = JSON.parse(responseText);
      res.status(200).json(data);
    } catch (e) {
      res.status(500).json({ success: false, error: `فشل تحليل الرد: ${responseText.substring(0, 100)}...` });
    }
    
  } catch (error) {
    console.error('Upload Proxy Error:', error);
    res.status(500).json({ success: false, error: `Proxy Error: ${error.message}` });
  }
}
