/**
 * Durable storage for local development and serverless deployment.
 *
 * Persistence Strategy:
 * - When running locally: persists to `./data/*.json` with atomic file writes (write to temp file then rename).
 * - When running on Vercel / serverless: uses writable /tmp directory or falls back to in-memory state.
 * - Browser localStorage is strictly non-authoritative (only for local UI preferences).
 */
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_ASSUMPTIONS } from '../shared/marketModel.js';

const DATA_DIR = process.env.DATA_DIR || (
  process.env.VERCEL ? path.join('/tmp', 'agro-data') : path.join(process.cwd(), 'data')
);

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function getFilePath(filename) {
  ensureDir();
  return path.join(DATA_DIR, filename);
}

function readJSON(filename, fallback) {
  try {
    const p = getFilePath(filename);
    if (!fs.existsSync(p)) return fallback;
    const raw = fs.readFileSync(p, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`[store] Failed to read ${filename}:`, err.message);
    return fallback;
  }
}

function writeJSON(filename, data) {
  try {
    ensureDir();
    const target = path.join(DATA_DIR, filename);
    const temp = `${target}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(temp, target);
    return true;
  } catch (err) {
    console.error(`[store] Failed to write ${filename}:`, err.message);
    return false;
  }
}

// In-memory cache to guarantee fast access and serverless persistence within warm container
let memObservations = null;
let memIndicators = null;
let memForecasts = null;
let memAssumptions = null;
let memMacroCache = null;

export const store = {
  getObservations() {
    if (!memObservations) {
      memObservations = readJSON('observations.json', []);
    }
    return memObservations;
  },

  saveObservations(list) {
    memObservations = list;
    return writeJSON('observations.json', list);
  },

  appendObservations(newObs) {
    const current = this.getObservations();
    const existingIds = new Set(current.map(o => o.id));
    const toAdd = newObs.filter(o => !existingIds.has(o.id));
    const merged = [...current, ...toAdd];
    this.saveObservations(merged);
    return { added: toAdd.length, total: merged.length };
  },

  getIndicators() {
    if (!memIndicators) {
      memIndicators = readJSON('indicators.json', []);
    }
    return memIndicators;
  },

  saveIndicators(list) {
    memIndicators = list;
    return writeJSON('indicators.json', list);
  },

  appendIndicators(newInd) {
    const current = this.getIndicators();
    const existingIds = new Set(current.map(o => o.id));
    const toAdd = newInd.filter(o => !existingIds.has(o.id));
    const merged = [...current, ...toAdd];
    this.saveIndicators(merged);
    return { added: toAdd.length, total: merged.length };
  },

  getForecasts() {
    if (!memForecasts) {
      memForecasts = readJSON('forecasts.json', []);
    }
    return memForecasts;
  },

  saveForecast(fc) {
    const current = this.getForecasts();
    // Keep immutable history, replace existing if same ID
    const idx = current.findIndex(f => f.id === fc.id);
    if (idx >= 0) {
      current[idx] = fc;
    } else {
      current.push(fc);
    }
    memForecasts = current;
    writeJSON('forecasts.json', current);
    return fc;
  },

  getAssumptions() {
    if (!memAssumptions) {
      memAssumptions = readJSON('assumptions.json', DEFAULT_ASSUMPTIONS);
    }
    return memAssumptions;
  },

  saveAssumptions(assumptions) {
    memAssumptions = assumptions;
    return writeJSON('assumptions.json', assumptions);
  },

  updateAssumptions(patch) {
    const cur = this.getAssumptions();
    const updated = {
      ...cur,
      ...patch,
      bridge: { ...(cur.bridge || {}), ...(patch.bridge || {}) },
      storage: { ...(cur.storage || {}), ...(patch.storage || {}) },
      scenarios: { ...(cur.scenarios || {}), ...(patch.scenarios || {}) },
      sensitivities: { ...(cur.sensitivities || {}), ...(patch.sensitivities || {}) },
      manualPrices: { ...(cur.manualPrices || {}), ...(patch.manualPrices || {}) },
      balance: { ...(cur.balance || {}), ...(patch.balance || {}) },
    };
    this.saveAssumptions(updated);
    return updated;
  },

  getMacroCache() {
    if (!memMacroCache) {
      memMacroCache = readJSON('macro_cache.json', null);
    }
    return memMacroCache;
  },

  saveMacroCache(cache) {
    memMacroCache = cache;
    return writeJSON('macro_cache.json', cache);
  },

  clearData() {
    memObservations = [];
    memIndicators = [];
    memForecasts = [];
    writeJSON('observations.json', []);
    writeJSON('indicators.json', []);
    writeJSON('forecasts.json', []);
  }
};
