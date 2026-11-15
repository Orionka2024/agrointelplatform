/** Local durable SQLite store with optional Vercel KV REST synchronization.
 * Serverless requires an explicitly mounted persistent DATA_DIR or Vercel KV credentials.
 * Original JSON inputs are read once as unverified legacy evidence and never rewritten.
 * SQLite transactions serialize writes; audit revisions and forecast records are retained.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { isVerified } from '../shared/observations.js';
import { DEFAULT_ASSUMPTIONS } from '../shared/marketModel.js';

let db;

export function isDurable() {
  if (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL) return true;
  if (process.env.DATA_DIR && process.env.DATA_DIR !== '/tmp') return true;
  if (process.env.AGRO_PERSISTENT_VOLUME === 'true') return true;
  if (!process.env.VERCEL) return true;
  return false;
}

export function getBackendType() {
  if (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL) return 'vercel_kv';
  if (process.env.DATA_DIR && process.env.DATA_DIR !== '/tmp') return 'persistent_volume';
  if (process.env.AGRO_PERSISTENT_VOLUME === 'true') return 'persistent_volume';
  if (!process.env.VERCEL) return 'local_sqlite';
  return 'ephemeral_tmp';
}

async function remoteKvGet(name) {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  try {
    const res = await fetch(`${url}/get/agro_${encodeURIComponent(name)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json?.result ? JSON.parse(json.result) : null;
  } catch (err) {
    console.warn(`[store] Remote KV get failed for ${name}:`, err.message);
    return null;
  }
}

async function remoteKvSet(name, value) {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return false;
  try {
    const res = await fetch(`${url}/set/agro_${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(typeof value === 'string' ? value : JSON.stringify(value)),
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch (err) {
    console.warn(`[store] Remote KV set failed for ${name}:`, err.message);
    return false;
  }
}

function database() {
  if (db) return db;
  const dir = process.env.DATA_DIR || (process.env.VERCEL ? '/tmp' : path.join(process.cwd(), 'data'));
  const seedDir = path.join(process.cwd(), 'data');
  fs.mkdirSync(dir, { recursive: true });
  db = new DatabaseSync(path.join(dir, 'agro.sqlite'));
  db.exec('PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS documents (name TEXT PRIMARY KEY, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS revisions (id INTEGER PRIMARY KEY, name TEXT NOT NULL, body TEXT NOT NULL, saved_at TEXT NOT NULL);');
  for (const name of ['observations','indicators','forecasts','assumptions','macro_cache','annual','refresh_status','refresh_lock']) {
    if (db.prepare('SELECT name FROM documents WHERE name=?').get(name)) continue;
    let value = name === 'assumptions' ? DEFAULT_ASSUMPTIONS : ['macro_cache','refresh_status','refresh_lock'].includes(name) ? null : [];
    const seed = path.join(seedDir, `${name}.json`);
    const fallbackSeed = path.join(dir, `${name}.json`);
    const actualSeed = fs.existsSync(seed) ? seed : (fs.existsSync(fallbackSeed) ? fallbackSeed : null);
    if (actualSeed && !['assumptions','macro_cache','refresh_status','refresh_lock'].includes(name)) value = JSON.parse(fs.readFileSync(actualSeed, 'utf8'));
    db.prepare('INSERT OR IGNORE INTO documents VALUES (?,?)').run(name, JSON.stringify(value));
  }
  return db;
}

function read(name) {
  const row = database().prepare('SELECT body FROM documents WHERE name=?').get(name);
  return row ? JSON.parse(row.body) : null;
}

function write(name, value) {
  const d = database(), body = JSON.stringify(value);
  d.prepare('INSERT INTO revisions(name,body,saved_at) VALUES (?,?,?)').run(name, body, new Date().toISOString());
  d.prepare('INSERT OR REPLACE INTO documents (name, body) VALUES (?, ?)').run(name, body);
  if (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL) {
    remoteKvSet(name, body).catch(() => {});
  }
  return value;
}

function change(name, fn) {
  const d = database(); d.exec('BEGIN IMMEDIATE');
  try { const value = write(name, fn(read(name))); d.exec('COMMIT'); return value; }
  catch(e) { d.exec('ROLLBACK'); throw e; }
}

function append(name, rows) {
  let added = 0;
  const out = change(name, current => {
    const list = Array.isArray(current) ? current : [];
    const ids = new Set(list.map(o => o.id));
    for (const row of rows) {
      if (!ids.has(row.id)) { list.push(row); ids.add(row.id); added++; }
      else {
        const index = list.findIndex(o => o.id === row.id);
        if (!isVerified(list[index]) && isVerified(row)) {
          // Attestation may be upgraded; historical values remain immutable.
          list[index] = { ...list[index], verification: row.verification }; added++;
        }
      }
    }
    return list;
  });
  return { added, total: out.length };
}

export const store = {
  getObservations: () => read('observations') || [],
  saveObservations: list => change('observations', () => list),
  appendObservations: rows => append('observations', rows),
  getIndicators: () => read('indicators') || [],
  saveIndicators: list => change('indicators', () => list),
  appendIndicators: rows => append('indicators', rows),
  getAnnual: () => read('annual') || [],
  appendAnnual: rows => append('annual', rows),
  getForecasts: () => read('forecasts') || [],
  saveForecast(fc) {
    change('forecasts', rows => {
      const list = Array.isArray(rows) ? rows : [];
      const old = list.find(r => r.id === fc.id);
      if (old && JSON.stringify(old) !== JSON.stringify(fc)) throw new Error('Forecast ID collision: immutable history');
      return old ? list : [...list, fc];
    });
    return fc;
  },
  getAssumptions: () => read('assumptions'),
  saveAssumptions: a => change('assumptions', () => a),
  updateAssumptions(patch) {
    return change('assumptions', cur => {
      const out = { ...cur, ...patch, version: 2 };
      for (const key of ['bridge','storage','scenarios','sensitivities','manualPrices','balance','planning']) {
        out[key] = { ...(cur?.[key] || {}), ...(patch[key] || {}) };
      }
      return out;
    });
  },
  getMacroCache: () => read('macro_cache'),
  saveMacroCache: c => change('macro_cache', () => c),
  getRefreshStatus: () => read('refresh_status'),
  saveRefreshStatus: s => write('refresh_status', s),
  getRefreshLock: () => read('refresh_lock'),
  acquireRefreshLock(ttlMs = 10 * 60 * 1000) {
    const d = database();
    d.exec('BEGIN IMMEDIATE');
    try {
      const current = read('refresh_lock');
      const now = Date.now();
      if (current && current.status === 'running' && (now - (current.startedAtMs || 0)) < ttlMs) {
        d.exec('COMMIT');
        return { acquired: false, lock: current };
      }
      const newLock = {
        status: 'running',
        startedAt: new Date().toISOString(),
        startedAtMs: now,
        runId: `run-${now}`,
      };
      write('refresh_lock', newLock);
      d.exec('COMMIT');
      return { acquired: true, lock: newLock };
    } catch (err) {
      d.exec('ROLLBACK');
      throw err;
    }
  },
  releaseRefreshLock() {
    try {
      write('refresh_lock', { status: 'idle', releasedAt: new Date().toISOString() });
    } catch (err) {
      console.warn('[store] Failed to release refresh lock:', err.message);
    }
  },
  isDurable,
  getBackendType,
  async syncFromDurable() {
    if (!process.env.KV_REST_API_URL && !process.env.UPSTASH_REDIS_REST_URL) return false;
    let synced = 0;
    for (const name of ['observations','indicators','forecasts','assumptions','macro_cache','annual','refresh_status']) {
      const remote = await remoteKvGet(name);
      if (remote !== null) {
        database().prepare('INSERT OR REPLACE INTO documents (name, body) VALUES (?, ?)').run(name, JSON.stringify(remote));
        synced++;
      }
    }
    return synced > 0;
  },
  async persistToDurable(name, value) {
    write(name, value);
    if (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL) {
      return await remoteKvSet(name, value);
    }
    return true;
  },
  clearData() {
    for (const k of ['observations','indicators','forecasts','annual','refresh_status']) {
      change(k, () => []);
    }
  },
};
