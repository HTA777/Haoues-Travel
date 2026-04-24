export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ success: false, error: 'Method not allowed' });
    return;
  }

  try {
    const GOOGLE_SHEETS_URL = process.env.GOOGLE_SHEETS_URL;
    if (!GOOGLE_SHEETS_URL) {
      throw new Error('Server configuration error: Webhook URL is missing.');
    }

    const { id, newStatus } = req.body;
    if (!id || !newStatus) {
       return res.status(400).json({ success: false, error: 'Missing parameters' });
    }

    const payload = {
      action: 'updateStatus',
      id: id,
      newStatus: newStatus
    };

    const response = await fetch(GOOGLE_SHEETS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    res.status(200).json(data);
  } catch (error) {
    console.error('Update Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}
