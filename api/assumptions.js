/**
 * Vercel Serverless Function & Local Dev Handler: /api/assumptions
 * Manages user assumptions (cost bridge, storage parameters, scenarios, sensitivities, balance, manual prices).
 */
import { store } from '../server/store.js';
import { DEFAULT_ASSUMPTIONS } from '../shared/marketModel.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    const current = store.getAssumptions();
    return res.status(200).json(current);
  }

  if (req.method === 'DELETE') {
    // Reset to defaults
    store.saveAssumptions(DEFAULT_ASSUMPTIONS);
    return res.status(200).json({ success: true, assumptions: DEFAULT_ASSUMPTIONS });
  }

  if (req.method === 'POST' || req.method === 'PUT') {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { body = {}; }
    }

    try {
      const updated = store.updateAssumptions(body);
      return res.status(200).json({ success: true, assumptions: updated });
    } catch (err) {
      console.error('[api/assumptions] Update error:', err);
      return res.status(500).json({ error: 'ASSUMPTIONS_UPDATE_FAILED', message: err.message });
    }
  }

  return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
}
