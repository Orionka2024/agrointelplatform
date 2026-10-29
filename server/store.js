/** Local durable SQLite store. Serverless requires an explicitly mounted persistent DATA_DIR.
 * Original JSON inputs are read once as unverified legacy evidence and never rewritten.
 * SQLite transactions serialize writes; audit revisions and forecast records are retained.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { isVerified } from '../shared/observations.js';
import { DEFAULT_ASSUMPTIONS } from '../shared/marketModel.js';
let db;
function database() {
  if (db) return db;
  const dir = process.env.DATA_DIR || (process.env.VERCEL ? '/tmp' : path.join(process.cwd(), 'data'));
  const seedDir = path.join(process.cwd(), 'data');
  fs.mkdirSync(dir, { recursive: true });
  db = new DatabaseSync(path.join(dir, 'agro.sqlite'));
  db.exec('PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS documents (name TEXT PRIMARY KEY, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS revisions (id INTEGER PRIMARY KEY, name TEXT NOT NULL, body TEXT NOT NULL, saved_at TEXT NOT NULL);');
  for (const name of ['observations','indicators','forecasts','assumptions','macro_cache','annual']) {
    if (db.prepare('SELECT name FROM documents WHERE name=?').get(name)) continue;
    let value = name === 'assumptions' ? DEFAULT_ASSUMPTIONS : name === 'macro_cache' ? null : [];
    const seed = path.join(seedDir, `${name}.json`);
    const fallbackSeed = path.join(dir, `${name}.json`);
    const actualSeed = fs.existsSync(seed) ? seed : (fs.existsSync(fallbackSeed) ? fallbackSeed : null);
    if (actualSeed && !['assumptions','macro_cache'].includes(name)) value = JSON.parse(fs.readFileSync(actualSeed, 'utf8'));
    db.prepare('INSERT OR IGNORE INTO documents VALUES (?,?)').run(name,JSON.stringify(value));
  }
  return db;
}
function read(name) { return JSON.parse(database().prepare('SELECT body FROM documents WHERE name=?').get(name).body); }
function write(name,value) {
  const d = database(), body = JSON.stringify(value);
  d.prepare('INSERT INTO revisions(name,body,saved_at) VALUES (?,?,?)').run(name,body,new Date().toISOString());
  d.prepare('UPDATE documents SET body=? WHERE name=?').run(body,name);
  return value;
}
function change(name, fn) {
  const d = database(); d.exec('BEGIN IMMEDIATE');
  try { const value = write(name,fn(read(name))); d.exec('COMMIT'); return value; }
  catch(e) { d.exec('ROLLBACK'); throw e; }
}
function append(name,rows) {
  let added=0;
  const out=change(name,current=>{
    const ids=new Set(current.map(o=>o.id));
    for(const row of rows) {
      if(!ids.has(row.id)) {current.push(row);ids.add(row.id);added++;}
      else {
        const index=current.findIndex(o=>o.id===row.id);
        if(!isVerified(current[index]) && isVerified(row)) {
          // Attestation may be upgraded; historical values remain immutable.
          current[index]={...current[index],verification:row.verification}; added++;
        }
      }
    }
    return current;
  }); return {added,total:out.length};
}
export const store = {
  getObservations:()=>read('observations'), saveObservations:list=>change('observations',()=>list), appendObservations:rows=>append('observations',rows),
  getIndicators:()=>read('indicators'), saveIndicators:list=>change('indicators',()=>list), appendIndicators:rows=>append('indicators',rows),
  getAnnual:()=>read('annual'), appendAnnual:rows=>append('annual',rows),
  getForecasts:()=>read('forecasts'),
  saveForecast(fc) {
    change('forecasts',rows=>{
      const old=rows.find(r=>r.id===fc.id);
      if(old && JSON.stringify(old)!==JSON.stringify(fc)) throw new Error('Forecast ID collision: immutable history');
      return old ? rows : [...rows,fc];
    }); return fc;
  },
  getAssumptions:()=>read('assumptions'), saveAssumptions:a=>change('assumptions',()=>a),
  updateAssumptions(patch) {
    return change('assumptions',cur=>{
      const out={...cur,...patch,version:2};
      for(const key of ['bridge','storage','scenarios','sensitivities','manualPrices','balance','planning']) out[key]={...(cur[key]||{}),...(patch[key]||{})};
      return out;
    });
  },
  getMacroCache:()=>read('macro_cache'), saveMacroCache:c=>change('macro_cache',()=>c),
  clearData() { for(const k of ['observations','indicators','forecasts','annual']) change(k,()=>[]); },
};
