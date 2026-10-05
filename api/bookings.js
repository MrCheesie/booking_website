/**
 * Vercel Serverless Function: Proxy API for NocoDB
 * Keeps API Tokens and Table URLs secure on the server side using Vercel Environment Variables.
 */

export default async function handler(req, res) {
  // Read from environment variables (configured in Vercel Dashboard)
  const API_BASE_URL = process.env.NOCODB_API_BASE_URL;
  const VIEW_ID = process.env.NOCODB_VIEW_ID;
  const API_TOKEN = process.env.NOCODB_API_TOKEN;

  if (!API_BASE_URL || !API_TOKEN) {
    return res.status(500).json({
      error: 'CONFIG_ERROR',
      message: 'Missing NocoDB Environment Variables in Vercel (NOCODB_API_BASE_URL, NOCODB_API_TOKEN).'
    });
  }

  // Set CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    if (req.method === 'GET') {
      const url = `${API_BASE_URL}?pageSize=100${VIEW_ID ? `&viewId=${VIEW_ID}` : ''}`;
      const nocodbRes = await fetch(url, {
        method: 'GET',
        headers: {
          'xc-token': API_TOKEN,
          'Content-Type': 'application/json'
        }
      });
      const data = await nocodbRes.json();
      return res.status(nocodbRes.status).json(data);
    }

    if (req.method === 'POST') {
      const nocodbRes = await fetch(API_BASE_URL, {
        method: 'POST',
        headers: {
          'xc-token': API_TOKEN,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(req.body)
      });
      const data = await nocodbRes.json();
      return res.status(nocodbRes.status).json(data);
    }

    return res.status(405).json({ error: 'METHOD_NOT_ALLOWED', message: `Method ${req.method} not allowed` });
  } catch (err) {
    return res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
}
