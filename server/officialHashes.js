import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256Hex } from '../shared/officialData.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_DATA_DIR = path.resolve(__dirname, '..', 'data');

export const OFFICIAL_TRACKED_FILES = ['official-history.json', 'official-drivers.json'];

/**
 * Atomically writes a JSON object (or string/buffer) to targetPath using a sibling .tmp file and renameSync.
 */
export function writeJsonAtomically(targetPath, data) {
  const resolved = typeof targetPath === 'string' ? targetPath : fileURLToPath(targetPath);
  const dir = path.dirname(resolved);
  fs.mkdirSync(dir, { recursive: true });
  const text = typeof data === 'string' ? data : `${JSON.stringify(data, null, 2)}\n`;
  const tmpPath = `${resolved}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmpPath, text, 'utf8');
  fs.renameSync(tmpPath, resolved);
  return resolved;
}

/**
 * Computes and atomically writes official-hashes.json for the given dataDir.
 */
export function regenerateOfficialHashesAtomically(
  dataDir = DEFAULT_DATA_DIR,
  trackedFiles = OFFICIAL_TRACKED_FILES
) {
  const resolvedDir = typeof dataDir === 'string' ? dataDir : fileURLToPath(dataDir);
  const files = {};

  for (const name of trackedFiles) {
    const filePath = path.join(resolvedDir, name);
    if (!fs.existsSync(filePath)) continue;
    const buf = fs.readFileSync(filePath);
    const parsed = JSON.parse(buf.toString('utf8'));
    files[name] = {
      sha256: sha256Hex(buf),
      canonicalSha256: sha256Hex(JSON.stringify(parsed)),
      bytes: buf.length,
    };
  }

  const manifest = {
    version: 1,
    files,
  };

  const hashesPath = path.join(resolvedDir, 'official-hashes.json');
  writeJsonAtomically(hashesPath, manifest);
  return manifest;
}

/**
 * Loads official-history.json, official-drivers.json, official-forecast.json, and official-hashes.json
 * from a runtime dataDir if present, falling back to bundled defaults.
 */
export function readRuntimeOfficialFiles(dataDir = process.env.DATA_DIR || DEFAULT_DATA_DIR) {
  const resolvedDir = typeof dataDir === 'string' ? dataDir : fileURLToPath(dataDir);
  const rawFiles = {};
  const parsedFiles = {};
  let expected = null;
  let forecastObj = null;

  for (const name of OFFICIAL_TRACKED_FILES) {
    const p = path.join(resolvedDir, name);
    if (fs.existsSync(p)) {
      const buf = fs.readFileSync(p);
      rawFiles[name] = buf;
      try {
        parsedFiles[name] = JSON.parse(buf.toString('utf8'));
      } catch {
        // leave unparsed so verifyOfficialDataHashes flags json_parse mismatch
      }
    }
  }

  const hashesPath = path.join(resolvedDir, 'official-hashes.json');
  if (fs.existsSync(hashesPath)) {
    try {
      expected = JSON.parse(fs.readFileSync(hashesPath, 'utf8'));
    } catch {
      expected = null;
    }
  }

  const fcPath = path.join(resolvedDir, 'official-forecast.json');
  if (fs.existsSync(fcPath)) {
    try {
      forecastObj = JSON.parse(fs.readFileSync(fcPath, 'utf8'));
    } catch {
      forecastObj = null;
    }
  }

  return {
    hasCustomFiles: Object.keys(rawFiles).length > 0,
    rawFiles,
    parsedFiles,
    expected,
    forecastObj,
  };
}
