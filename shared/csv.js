/**
 * Minimal RFC-4180-style CSV parser (quotes, escaped quotes, CRLF, BOM) with
 * delimiter auto-detection (',' ';' or tab) and tolerant number parsing
 * (decimal comma, space / NBSP thousands separators).
 */

export function detectDelimiter(headerLine) {
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let inQ = false;
  for (const ch of headerLine) {
    if (ch === '"') inQ = !inQ;
    else if (!inQ && ch in counts) counts[ch]++;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][1] === 0
    ? ','
    : Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

export function parseCSV(text, { maxRows = 50000 } = {}) {
  if (typeof text !== 'string') return { header: [], rows: [], errors: ['CSV must be a string'] };
  const src = text.replace(/^\uFEFF/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const delim = detectDelimiter(firstLine);
  const records = [];
  let row = [];
  let field = '';
  let inQ = false;
  let line = 1;
  const lineOfRecord = [];
  let recordStartLine = 1;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQ) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else {
        if (ch === '\n') line++;
        field += ch;
      }
      continue;
    }
    if (ch === '"') { inQ = true; continue; }
    if (ch === delim) { row.push(field); field = ''; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') {
      row.push(field); field = '';
      if (row.some(c => c.trim() !== '')) { records.push(row); lineOfRecord.push(recordStartLine); }
      row = [];
      line++;
      recordStartLine = line;
      continue;
    }
    field += ch;
  }
  row.push(field);
  if (row.some(c => c.trim() !== '')) { records.push(row); lineOfRecord.push(recordStartLine); }

  const errors = [];
  if (inQ) errors.push('Unterminated quoted field');
  if (records.length === 0) return { header: [], rows: [], errors: [...errors, 'Empty CSV'] };
  const header = records[0].map(h => h.trim().toLowerCase());
  const body = records.slice(1);
  if (body.length > maxRows) errors.push(`Too many rows (${body.length} > ${maxRows})`);
  const rows = body.slice(0, maxRows).map((r, idx) => {
    const o = { __line: lineOfRecord[idx + 1] };
    header.forEach((h, j) => { o[h] = (r[j] ?? '').trim(); });
    return o;
  });
  return { header, rows, errors };
}

/** Returns a finite number or null. Accepts "31,5", "1 234,5", "1234.5". */
export function parseNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  let s = v.trim().replace(/[\s\u00A0]/g, '');
  if (s === '') return null;
  if (s.includes(',') && s.includes('.')) return null; // ambiguous thousands/decimal mix
  s = s.replace(',', '.');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
