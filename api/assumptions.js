import { allowRequest } from '../server/access.js';
/**
 * Vercel Serverless Function & Local Dev Handler: /api/assumptions
 * Manages user assumptions (cost bridge, storage parameters, scenarios, sensitivities, balance, manual prices).
 */
import { store } from '../server/store.js';
import { DEFAULT_ASSUMPTIONS } from '../shared/marketModel.js';

export default async function handler(req, res) {
  if (!allowRequest(req, res, {costly: false})) return;

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

    if (!body || Array.isArray(body) || typeof body !== 'object' || JSON.stringify(body).length > 100000) return res.status(400).json({message:'Invalid assumptions object'});
    const allowed = ['bridge','storage','scenarios','sensitivities','manualPrices','balance','planning'];
    if (Object.keys(body).some(k => !allowed.includes(k)) || Object.values(body).some(v => !v || typeof v !== 'object' || Array.isArray(v))) return res.status(400).json({message:'Invalid assumptions fields'});
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
