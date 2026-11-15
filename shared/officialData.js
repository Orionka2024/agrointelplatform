import history from '../data/official-history.json' with { type: 'json' };
import forecast from '../data/official-forecast.json' with { type: 'json' };
import drivers from '../data/official-drivers.json' with { type: 'json' };
import expectedHashes from '../data/official-hashes.json' with { type: 'json' };
import regionalHistory from '../data/regional-history.json' with { type: 'json' };
import importsHs070310 from '../data/imports-hs070310.json' with { type: 'json' };

// Pure-JS FIPS 180-4 SHA-256 (works identically in Node >= 24 and browser bundles without Node polyfills)
const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export function sha256Hex(input) {
  const bytes =
    typeof input === 'string'
      ? new TextEncoder().encode(input)
      : input instanceof Uint8Array
        ? input
        : new Uint8Array(input || []);
  const len = bytes.length;
  const bitLenHi = Math.floor((len * 8) / 0x100000000);
  const bitLenLo = (len * 8) >>> 0;
  const padLen = ((len + 9 + 63) & ~63);
  const padded = new Uint8Array(padLen);
  padded.set(bytes);
  padded[len] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padLen - 8, bitLenHi, false);
  view.setUint32(padLen - 4, bitLenLo, false);

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Uint32Array(64);

  for (let i = 0; i < padLen; i += 64) {
    for (let t = 0; t < 16; t++) {
      w[t] = view.getUint32(i + t * 4, false);
    }
    for (let t = 16; t < 64; t++) {
      const x = w[t - 15];
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const y = w[t - 2];
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let t = 0; t < 64; t++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[t] + w[t]) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7].map((v) => v.toString(16).padStart(8, '0')).join('');
}

export function verifyOfficialDataHashes({
  rawFiles = null,
  parsedFiles = null,
  expected = expectedHashes,
  throwOnMismatch = false,
} = {}) {
  const defaultParsed = {
    'official-history.json': history,
    'official-drivers.json': drivers,
    'regional-history.json': regionalHistory,
    'imports-hs070310.json': importsHs070310,
  };
  const targets = parsedFiles || defaultParsed;
  const expMap = expected?.files || {};
  const mismatches = [];
  const verifiedFiles = {};

  for (const [name, exp] of Object.entries(expMap)) {
    if (rawFiles && Object.prototype.hasOwnProperty.call(rawFiles, name) && rawFiles[name] !== undefined) {
      const actualRawSha = sha256Hex(rawFiles[name]);
      verifiedFiles[name] = { actualSha256: actualRawSha, expectedSha256: exp.sha256 };
      if (actualRawSha !== exp.sha256) {
        mismatches.push({
          file: name,
          mode: 'raw_bytes',
          expected: exp.sha256,
          actual: actualRawSha,
        });
        continue;
      }
      // Also verify that raw bytes parse and match canonicalSha256
      try {
        const text =
          typeof rawFiles[name] === 'string'
            ? rawFiles[name]
            : new TextDecoder('utf-8', { fatal: true }).decode(rawFiles[name]);
        const parsed = JSON.parse(text);
        const actualCanonical = sha256Hex(JSON.stringify(parsed));
        if (exp.canonicalSha256 && actualCanonical !== exp.canonicalSha256) {
          mismatches.push({
            file: name,
            mode: 'canonical_json',
            expected: exp.canonicalSha256,
            actual: actualCanonical,
          });
        }
      } catch (err) {
        mismatches.push({
          file: name,
          mode: 'json_parse',
          expected: exp.sha256,
          actual: `INVALID_JSON: ${err.message}`,
        });
      }
    } else if (targets[name]) {
      const actualCanonical = sha256Hex(JSON.stringify(targets[name]));
      verifiedFiles[name] = { actualCanonicalSha256: actualCanonical, expectedCanonicalSha256: exp.canonicalSha256 };
      if (exp.canonicalSha256 && actualCanonical !== exp.canonicalSha256) {
        mismatches.push({
          file: name,
          mode: 'canonical_json',
          expected: exp.canonicalSha256,
          actual: actualCanonical,
        });
      }
    } else {
      mismatches.push({
        file: name,
        mode: 'missing_file',
        expected: exp.sha256,
        actual: null,
      });
    }
  }

  // Also check that every source entry inside official-history.json has a valid 64-char SHA-256
  const histObj = targets['official-history.json'] || history;
  for (const src of histObj?.sources || []) {
    if (!src?.sha256 || !/^[a-f0-9]{64}$/i.test(src.sha256)) {
      mismatches.push({
        file: `official-history.json#sources[${src?.id || 'unknown'}]`,
        mode: 'source_sha256',
        expected: '64-hex sha256',
        actual: src?.sha256 || null,
      });
    }
  }

  if (mismatches.length > 0) {
    const msg = `DATA_HASH_MISMATCH: Нарушена целостность официальных данных (${mismatches.map((m) => m.file).join(', ')}). Выдача прогноза заблокирована.`;
    if (throwOnMismatch) {
      const err = new Error(msg);
      err.code = 'DATA_HASH_MISMATCH';
      err.mismatches = mismatches;
      throw err;
    }
    return {
      ok: false,
      code: 'DATA_HASH_MISMATCH',
      message: msg,
      mismatches,
      files: verifiedFiles,
    };
  }

  return {
    ok: true,
    code: 'OK',
    message: 'Целостность официальных данных (SHA-256) подтверждена.',
    mismatches: [],
    files: verifiedFiles,
  };
}

export const officialDataIntegrity = verifyOfficialDataHashes();
const safeForecast = officialDataIntegrity.ok ? forecast : null;

let runtimeOverlay = null;

export function setRuntimeOfficialOverlay(overlay = null) {
  runtimeOverlay = overlay;
}

export function getRuntimeOfficialOverlay() {
  return runtimeOverlay;
}

export function endOfMonthIso(periodOrDate) {
  const s = String(periodOrDate || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const d = new Date(Date.UTC(year, month, 0));
  return d.toISOString().slice(0, 10);
}

export function computeForecastFreshness(fc = safeForecast, { today = null, maxAgeDays = 90, historyObj = history } = {}) {
  const inputCutoff =
    fc?.inputCutoff || fc?.dataCutoff || historyObj?.producer?.monthly?.at(-1)?.period || '2026-09';
  const cutoffEndDate = endOfMonthIso(inputCutoff) || '2026-09-30';
  const modelVersion = fc?.modelVersion || forecast?.modelVersion || 'rosstat-catboost-3.0.0';
  const lastBacktestDate = fc?.lastBacktestDate || inputCutoff;
  const generatedAt = fc?.issueDate || fc?.generatedAt || forecast?.issueDate || '2026-10-30';
  const todayIso = (today ? String(today) : new Date().toISOString()).slice(0, 10);

  const [cY, cM, cD] = cutoffEndDate.split('-').map(Number);
  const [tY, tM, tD] = todayIso.split('-').map(Number);
  const cutoffUtc = Date.UTC(cY, cM - 1, cD);
  const todayUtc = Date.UTC(tY, tM - 1, tD);
  const ageDays = Number.isFinite(cutoffUtc) && Number.isFinite(todayUtc)
    ? Math.round((todayUtc - cutoffUtc) / 86400000)
    : 0;
  const isStale = ageDays > maxAgeDays;
  const stampText = `Данные Росстата по: ${inputCutoff} · Модель: ${modelVersion} · Бэктест: ${lastBacktestDate} · Сформировано: ${generatedAt}`;
  const staleWarning = isStale
    ? `Внимание: прогноз основан на данных Росстата старше 3 месяцев (${ageDays} дн. с ${cutoffEndDate}, порог > ${maxAgeDays} дней). Обновите официальную статистику перед принятием решений.`
    : null;

  return {
    inputCutoff,
    cutoffEndDate,
    modelVersion,
    lastBacktestDate,
    generatedAt,
    today: todayIso,
    ageDays,
    maxAgeDays,
    isStale,
    stampText,
    staleWarning,
  };
}

export {
  history as officialHistory,
  safeForecast as officialForecast,
  drivers as officialDrivers,
  expectedHashes as officialHashes,
};

export function officialSnapshot(today, options = {}) {
  const effectiveOptions =
    options.rawFiles || options.parsedFiles || options.expected
      ? options
      : runtimeOverlay
        ? runtimeOverlay
        : {};

  const integrity =
    effectiveOptions.rawFiles || effectiveOptions.parsedFiles || effectiveOptions.expected
      ? verifyOfficialDataHashes(effectiveOptions)
      : officialDataIntegrity;

  if (!integrity.ok) {
    return {
      status: 'error',
      error: 'DATA_HASH_MISMATCH',
      errorMessage: integrity.message,
      integrity,
      freshness: null,
      collectedAt: null,
      producer: null,
      producerSouth: null,
      retail: null,
      producerCount: 0,
      retailCount: 0,
      annualCount: 0,
      drivers: null,
      forecast: null,
      limitations: [],
      sources: [],
    };
  }

  const activeHistory = effectiveOptions.parsedFiles?.['official-history.json'] || history;
  const activeDrivers = effectiveOptions.parsedFiles?.['official-drivers.json'] || drivers;
  const activeForecast = options.forecast || effectiveOptions.forecast || forecast;

  const producer = activeHistory.producer.monthly.filter((r) => r.availableDate <= today && r.period <= today.slice(0, 7));
  const producerSouth = (activeHistory.producer.regional || []).filter(
    (r) =>
      r.region &&
      r.region.trim() === 'Южный федеральный округ' &&
      r.availableDate <= today &&
      r.period <= today.slice(0, 7)
  );
  const retail = activeHistory.retail.weekly.filter((r) => r.availableDate <= today && r.date <= today);
  const usdRub = (activeDrivers.usdRub || []).filter((r) => r.availableDate <= today);
  const kztRub = (activeDrivers.kztRub || []).filter((r) => r.availableDate <= today);
  const keyRate = (activeDrivers.keyRate || []).filter((r) => r.availableDate <= today);
  const vlgWeather = (activeDrivers.weather?.volgograd || []).filter((r) => r.availableDate <= today);
  const zhmWeather = (activeDrivers.weather?.zhambyl || []).filter((r) => r.availableDate <= today);
  const freshness = computeForecastFreshness(activeForecast, { today, historyObj: activeHistory });

  return {
    status: 'ok',
    error: null,
    integrity,
    freshness,
    collectedAt: activeHistory.collectedAt,
    producer: producer.at(-1) ?? null,
    producerSouth: producerSouth.at(-1) ?? null,
    retail: retail.at(-1) ?? null,
    producerCount: producer.length,
    retailCount: retail.length,
    annualCount: activeHistory.producer.annual.length,
    drivers: {
      collectedAt: activeDrivers.collectedAt,
      count: Math.min(usdRub.length, keyRate.length),
      usdRub: usdRub.at(-1) ?? null,
      kztRub: kztRub.at(-1) ?? null,
      keyRate: keyRate.at(-1) ?? null,
      weather: {
        volgograd: vlgWeather.at(-1) ?? null,
        zhambyl: zhmWeather.at(-1) ?? null,
      },
      sources: activeDrivers.sources,
      note: activeDrivers.note,
    },
    forecast:
      activeForecast && activeForecast.issueDate <= today
        ? {
            id: activeForecast.id,
            issueDate: activeForecast.issueDate,
            inputCutoff: activeForecast.inputCutoff,
            status: activeForecast.status,
            modelVersion: activeForecast.modelVersion,
            target: activeForecast.target,
            freshness,
            rows: activeForecast.rows.map((r) => ({
              targetMonth: r.targetMonth,
              point: r.point,
              catboostPoint: r.catboostPoint,
              mae: r.validation.final.mae,
              catboostMae: r.catboostHoldoutMae,
              naiveMae: r.validation.naiveFinal.mae,
              selected: r.validation.selected,
              n: r.validation.final.n,
            })),
          }
        : null,
    limitations: activeHistory.limitations,
    sources: activeHistory.sources,
  };
}

export { regionalHistory, importsHs070310 };



