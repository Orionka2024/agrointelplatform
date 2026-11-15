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
let initPromise = null;
let kvSyncSucceeded = false;
let kvSyncError = null;
const docRevs = new Map();

export class DurableSyncError extends Error {
  constructor(message, statusCode = 503, code = 'DURABLE_SYNC_FAILED') {
    super(message);
    this.name = 'DurableSyncError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function isKvConfigured() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return Boolean(url && token);
}

export function isDurable() {
  if (isKvConfigured()) return true;
  if (process.env.DATA_DIR && process.env.DATA_DIR !== '/tmp') return true;
  if (process.env.AGRO_PERSISTENT_VOLUME === 'true') return true;
  if (!process.env.VERCEL) return true;
  return false;
}

export function getBackendType() {
  if (isKvConfigured()) return 'vercel_kv';
  if (process.env.DATA_DIR && process.env.DATA_DIR !== '/tmp') return 'persistent_volume';
  if (process.env.AGRO_PERSISTENT_VOLUME === 'true') return 'persistent_volume';
  if (!process.env.VERCEL) return 'local_sqlite';
  return 'ephemeral_tmp';
}

function unwrapKvPayload(raw) {
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Number.isInteger(parsed.__agro_rev) && 'data' in parsed) {
    return { rev: parsed.__agro_rev, data: parsed.data };
  }
  return { rev: 1, data: parsed };
}

async function remoteKvGetMeta(name, { strict = false } = {}) {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return { found: false, rev: 0, data: null };
  try {
    const res = await fetch(`${url}/get/agro_${encodeURIComponent(name)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) {
      if (strict) {
        throw new DurableSyncError(`Remote KV get HTTP ${res.status} for ${name}`, 503);
      }
      return { found: false, rev: 0, data: null };
    }
    const json = await res.json();
    if (json?.result === null || json?.result === undefined) {
      return { found: false, rev: 0, data: null };
    }
    const unwrapped = unwrapKvPayload(json.result);
    return { found: true, rev: unwrapped.rev, data: unwrapped.data };
  } catch (err) {
    if (strict) {
      if (err instanceof DurableSyncError) throw err;
      throw new DurableSyncError(`Remote KV get failed for ${name}: ${err.message}`, 503);
    }
    console.warn(`[store] Remote KV get failed for ${name}:`, err.message);
    return { found: false, rev: 0, data: null };
  }
}

async function remoteKvSet(name, value, { rev = null } = {}) {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return false;
  try {
    const parsedVal = typeof value === 'string' ? JSON.parse(value) : value;
    const envelope = rev !== null ? { __agro_rev: rev, data: parsedVal } : parsedVal;
    const res = await fetch(`${url}/set/agro_${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(JSON.stringify(envelope)),
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
  db.exec('PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS documents (name TEXT PRIMARY KEY, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS revisions (id INTEGER PRIMARY KEY, name TEXT NOT NULL, body TEXT NOT NULL, saved_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS doc_meta (name TEXT PRIMARY KEY, rev INTEGER NOT NULL DEFAULT 0);');
  for (const name of ['observations','indicators','forecasts','assumptions','macro_cache','annual','refresh_status','refresh_lock','official_forecast']) {
    if (db.prepare('SELECT name FROM documents WHERE name=?').get(name)) continue;
    let value = name === 'assumptions' ? DEFAULT_ASSUMPTIONS : ['macro_cache','refresh_status','refresh_lock','official_forecast'].includes(name) ? null : [];
    const seed = path.join(seedDir, `${name}.json`);
    const fallbackSeed = path.join(dir, `${name}.json`);
    const actualSeed = fs.existsSync(seed) ? seed : (fs.existsSync(fallbackSeed) ? fallbackSeed : null);
    if (actualSeed && !['assumptions','macro_cache','refresh_status','refresh_lock','official_forecast'].includes(name)) value = JSON.parse(fs.readFileSync(actualSeed, 'utf8'));
    db.prepare('INSERT OR IGNORE INTO documents VALUES (?,?)').run(name, JSON.stringify(value));
    db.prepare('INSERT OR IGNORE INTO doc_meta VALUES (?,0)').run(name);
  }
  return db;
}

function getLocalRev(name) {
  if (docRevs.has(name)) return docRevs.get(name);
  const row = database().prepare('SELECT rev FROM doc_meta WHERE name=?').get(name);
  const rev = row ? Number(row.rev) || 0 : 0;
  docRevs.set(name, rev);
  return rev;
}

function setLocalRev(name, rev) {
  docRevs.set(name, rev);
  database().prepare('INSERT OR REPLACE INTO doc_meta (name, rev) VALUES (?, ?)').run(name, rev);
}

function read(name) {
  const row = database().prepare('SELECT body FROM documents WHERE name=?').get(name);
  return row ? JSON.parse(row.body) : null;
}

function write(name, value) {
  if (isKvConfigured() && !kvSyncSucceeded && name !== 'refresh_lock') {
    throw new DurableSyncError(
      `Durable KV sync has not succeeded on this instance (${kvSyncError?.message || 'uninitialized'}); refusing to write "${name}" and overwrite KV with seed data`,
      503
    );
  }
  const d = database(), body = JSON.stringify(value);
  const nextRev = getLocalRev(name) + 1;
  d.prepare('INSERT INTO revisions(name,body,saved_at) VALUES (?,?,?)').run(name, body, new Date().toISOString());
  d.prepare('INSERT OR REPLACE INTO documents (name, body) VALUES (?, ?)').run(name, body);
  setLocalRev(name, nextRev);
  if (isKvConfigured()) {
    remoteKvSet(name, value, { rev: nextRev }).catch(() => {});
  }
  return value;
}

function change(name, fn) {
  if (isKvConfigured() && !kvSyncSucceeded && name !== 'refresh_lock') {
    throw new DurableSyncError(
      `Durable KV sync has not succeeded on this instance (${kvSyncError?.message || 'uninitialized'}); refusing to modify "${name}" and overwrite KV with seed data`,
      503
    );
  }
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

async function performSyncFromDurable({ strict = false } = {}) {
  if (!isKvConfigured()) {
    kvSyncSucceeded = true;
    kvSyncError = null;
    return false;
  }
  let synced = 0;
  for (const name of ['observations','indicators','forecasts','assumptions','macro_cache','annual','refresh_status','official_forecast']) {
    const remote = await remoteKvGetMeta(name, { strict });
    if (remote.found && remote.data !== null) {
      const localRev = getLocalRev(name);
      if (remote.rev >= localRev) {
        database().prepare('INSERT OR REPLACE INTO documents (name, body) VALUES (?, ?)').run(name, JSON.stringify(remote.data));
        setLocalRev(name, remote.rev);
        synced++;
      }
    }
  }
  kvSyncSucceeded = true;
  kvSyncError = null;
  return synced > 0;
}

export const store = {
  async ensureInitialized({ forWrite = false } = {}) {
    if (!isKvConfigured()) {
      database();
      kvSyncSucceeded = true;
      return true;
    }
    if (kvSyncSucceeded) return true;
    if (!initPromise) {
      initPromise = performSyncFromDurable({ strict: true }).catch(err => {
        kvSyncSucceeded = false;
        kvSyncError = err;
        initPromise = null;
        throw err;
      });
    }
    try {
      await initPromise;
      return true;
    } catch (err) {
      if (forWrite) throw err;
      console.warn('[store] ensureInitialized read-only sync warning:', err.message);
      return false;
    }
  },
  resetForTests() {
    if (db) {
      try { db.close(); } catch { /* ignore */ }
    }
    db = null;
    initPromise = null;
    kvSyncSucceeded = false;
    kvSyncError = null;
    docRevs.clear();
  },
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
  getOfficialForecast: () => read('official_forecast'),
  saveOfficialForecast: fc => write('official_forecast', fc),
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
      const body = JSON.stringify(newLock);
      d.prepare('INSERT INTO revisions(name,body,saved_at) VALUES (?,?,?)').run('refresh_lock', body, new Date().toISOString());
      d.prepare('INSERT OR REPLACE INTO documents (name, body) VALUES (?, ?)').run('refresh_lock', body);
      d.exec('COMMIT');
      return { acquired: true, lock: newLock };
    } catch (err) {
      d.exec('ROLLBACK');
      throw err;
    }
  },
  releaseRefreshLock() {
    try {
      const d = database();
      const body = JSON.stringify({ status: 'idle', releasedAt: new Date().toISOString() });
      d.prepare('INSERT OR REPLACE INTO documents (name, body) VALUES (?, ?)').run('refresh_lock', body);
    } catch (err) {
      console.warn('[store] Failed to release refresh lock:', err.message);
    }
  },
  isDurable,
  getBackendType,
  async syncFromDurable(opts = {}) {
    return await performSyncFromDurable(opts);
  },
  async persistToDurable(name, value) {
    if (isKvConfigured()) {
      const remote = await remoteKvGetMeta(name, { strict: true });
      const localRev = getLocalRev(name);
      if (remote.found && remote.rev > localRev) {
        throw new DurableSyncError(
          `Revision conflict for "${name}": local revision (${localRev}) is older than remote KV revision (${remote.rev}); refusing stale overwrite`,
          409,
          'REVISION_CONFLICT'
        );
      }
    }
    write(name, value);
    if (isKvConfigured()) {
      const rev = getLocalRev(name);
      return await remoteKvSet(name, value, { rev });
    }
    return true;
  },
  clearData() {
    for (const k of ['observations','indicators','forecasts','annual','refresh_status']) {
      change(k, () => []);
    }
  },
};

