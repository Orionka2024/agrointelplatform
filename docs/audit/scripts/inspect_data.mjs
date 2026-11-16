// Audit helper (read-only): data integrity checks for official-history / official-drivers / official-forecast.
// Usage: node docs/audit/scripts/inspect_data.mjs
import fs from 'node:fs';
import { createHash } from 'node:crypto';

const root = new URL('../../../', import.meta.url);
const j = (p) => JSON.parse(fs.readFileSync(new URL(p, root), 'utf8'));
const h = j('data/official-history.json');
const d = j('data/official-drivers.json');
const f = j('data/official-forecast.json');
const mi = (p) => Number(p.slice(0, 4)) * 12 + Number(p.slice(5, 7)) - 1;

function seriesReport(name, rows, key = 'period') {
  const ps = rows.map((r) => r[key]);
  const dup = ps.filter((p, i) => ps.indexOf(p) !== i);
  const sorted = [...rows].sort((a, b) => a[key].localeCompare(b[key]));
  const gaps = [];
  if (key === 'period') {
    for (let i = 1; i < sorted.length; i++) {
      const g = mi(sorted[i].period) - mi(sorted[i - 1].period);
      if (g !== 1) gaps.push(`${sorted[i - 1].period}->${sorted[i].period}`);
    }
  }
  const vals = rows.map((r) => r.value).filter(Number.isFinite);
  const bad = rows.filter((r) => !Number.isFinite(r.value) || r.value <= 0).length;
  const lag = rows.filter((r) => r.availableDate).map((r) => {
    const end = key === 'period' ? new Date(Date.UTC(+r.period.slice(0, 4), +r.period.slice(5, 7), 0)) : new Date(r[key]);
    return Math.round((Date.parse(r.availableDate) - end) / 864e5);
  });
  return {
    name, n: rows.length, first: sorted[0]?.[key], last: sorted.at(-1)?.[key], duplicates: dup.length, gaps: gaps.slice(0, 10), nGaps: gaps.length,
    nonPositiveOrNaN: bad, min: Math.min(...vals), max: Math.max(...vals),
    publicationLagDays: lag.length ? { min: Math.min(...lag), max: Math.max(...lag) } : null,
  };
}

const out = {};
out.sources = h.sources.map((s) => {
  const p = new URL(s.file, root);
  const exists = fs.existsSync(p);
  const sha = exists ? createHash('sha256').update(fs.readFileSync(p)).digest('hex') : null;
  return { id: s.id, file: s.file, exists, shaMatches: exists ? sha === s.sha256 : null, url: s.url };
});
out.producerMonthly = seriesReport('producer.monthly (RF, RUB/kg)', h.producer.monthly);
out.producerAnnual = { n: h.producer.annual.length };
out.regional = (() => {
  const r = h.producer.regional || [];
  const regions = [...new Set(r.map((x) => (x.region || '').trim()))];
  return { n: r.length, regions: regions.length, hasVolgograd: regions.some((x) => /Волгоград/i.test(x)), sample: regions.slice(0, 12) };
})();
out.retailWeekly = seriesReport('retail.weekly', h.retail.weekly, 'date');
for (const k of ['usdRub', 'kztRub', 'keyRate']) out[k] = seriesReport(k, d[k] || []);
out.weatherVolgograd = seriesReport('weather.volgograd', d.weather?.volgograd || []);
out.weatherZhambyl = seriesReport('weather.zhambyl', d.weather?.zhambyl || []);
out.driverSources = Object.fromEntries(Object.entries(d.sources || {}).map(([k, s]) => {
  const p = s.file ? new URL(s.file, root) : null;
  const ok = p && fs.existsSync(p) ? createHash('sha256').update(fs.readFileSync(p)).digest('hex') === s.sha256 : null;
  return [k, { file: s.file, shaMatches: ok, url: s.url }];
}));
out.forecast = {
  id: f.id, issueDate: f.issueDate, modelVersion: f.modelVersion, status: f.status, inputCutoff: f.inputCutoff, n: f.n,
  rows: f.rows.map((r) => ({
    h: r.h, lead: r.lead, target: r.targetMonth, selected: r.validation.selected, point: +r.point?.toFixed(2), cb: +r.catboostPoint?.toFixed(2),
    q80: r.validation.q80 && +r.validation.q80.toFixed(2), q95: r.validation.q95, calN: r.validation.calibrationN,
    finalN: r.validation.final.n, finalMAE: +r.validation.final.mae?.toFixed(2), naiveMAE: +r.validation.naiveFinal.mae?.toFixed(2),
    cov80: r.validation.finalCoverage80,
    finalAll: Object.fromEntries(r.validation.finalAll.map((x) => [x.id, x.mae == null ? null : +x.mae.toFixed(2)])),
  })),
};
console.log(JSON.stringify(out, null, 1));
