export default async function handler(req, res) {
  // CORS configuration
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { password } = req.body || {};
  const ADMIN_KEY = process.env.ADMIN_KEY || "admin2025H";
  if (!ADMIN_KEY) {
    return res.status(500).json({
      success: false,
      error: "الخدمة غير مهيأة على الخادم (ADMIN_KEY غير معرّف)."
    });
  }

  if (password && password === ADMIN_KEY) {
    return res.status(200).json({ 
      success: true, 
      token: Buffer.from(ADMIN_KEY).toString('base64') // Simple encoding for UI identification
    });
  } else {
    return res.status(401).json({ 
      success: false, 
      error: "كلمة المرور غير صحيحة. يرجى المحاولة مرة أخرى." 
    });
  }
}
