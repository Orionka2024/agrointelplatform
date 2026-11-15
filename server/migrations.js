/**
 * Numbered relational migrations and one-time legacy SQLite import.
 *
 * Compatible with SQLite / Turso (libSQL) / managed Postgres.
 */

export const MIGRATIONS = [
  {
    version: 1,
    name: '001_initial_relational_schema',
    sql: `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS auth_sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        email TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at_ms INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS magic_links (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        email TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at_ms INTEGER NOT NULL,
        used_at TEXT
      );

      CREATE TABLE IF NOT EXISTS user_observations (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        kind TEXT,
        market TEXT,
        observation_date TEXT,
        verification_status TEXT,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_user_obs_owner ON user_observations (owner_id, observation_date);

      CREATE TABLE IF NOT EXISTS user_assumptions (
        owner_id TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS farm_profiles (
        owner_id TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS issued_forecasts (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        basis TEXT,
        issue_date TEXT,
        input_cutoff TEXT,
        model_version TEXT,
        inputs_hash TEXT,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_issued_forecasts_owner ON issued_forecasts (owner_id, basis, issue_date);

      CREATE TABLE IF NOT EXISTS audit_revisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        action TEXT NOT NULL,
        before_json TEXT,
        after_json TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_audit_revisions_user ON audit_revisions (user_id, created_at);
    `,
  },
  {
    version: 2,
    name: '002_legacy_documents_one_time_import',
    sql: null, // Handled programmatically by runLegacyDocumentsImport() inside a transaction
  },
];

export function insertAuditRevision(
  db,
  { userId = null, entityType, entityId, action, before = null, after = null, createdAt = new Date().toISOString() }
) {
  db.prepare(
    `INSERT INTO audit_revisions (user_id, entity_type, entity_id, action, before_json, after_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    userId,
    String(entityType),
    String(entityId),
    String(action),
    before === null || before === undefined ? null : JSON.stringify(before),
    after === null || after === undefined ? null : JSON.stringify(after),
    createdAt
  );
}

/**
 * Runs one-time idempotent import from legacy `documents` table into normalized relational tables.
 */
export function runLegacyDocumentsImport(db, { nowIso = new Date().toISOString() } = {}) {
  const existingMig = db
    .prepare('SELECT version, applied_at FROM schema_migrations WHERE version = 2')
    .get();
  if (existingMig) {
    return { alreadyImported: true, appliedAt: existingMig.applied_at, importedCounts: null };
  }

  const readLegacyDoc = (name) => {
    try {
      const row = db.prepare('SELECT body FROM documents WHERE name = ?').get(name);
      return row ? JSON.parse(row.body) : null;
    } catch {
      return null;
    }
  };

  const importedCounts = {
    observations: 0,
    assumptions: 0,
    farmProfiles: 0,
    forecasts: 0,
    users: 0,
  };

  // 1. Legacy observations
  const legacyObs = readLegacyDoc('observations');
  if (Array.isArray(legacyObs)) {
    const upsertObs = db.prepare(`
      INSERT OR REPLACE INTO user_observations
        (id, owner_id, kind, market, observation_date, verification_status, payload_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const obs of legacyObs) {
      if (!obs || !obs.id) continue;
      const ownerId = obs.ownerId || 'public';
      upsertObs.run(
        String(obs.id),
        String(ownerId),
        obs.kind || null,
        obs.market || null,
        obs.observationDate || null,
        obs.verification?.status || 'unverified',
        JSON.stringify(obs),
        nowIso,
        nowIso
      );
      importedCounts.observations++;
    }
  }

  // 2. Legacy default assumptions + farmProfile
  const legacyAssump = readLegacyDoc('assumptions');
  if (legacyAssump && typeof legacyAssump === 'object') {
    db.prepare(
      'INSERT OR REPLACE INTO user_assumptions (owner_id, payload_json, updated_at) VALUES (?, ?, ?)'
    ).run('default', JSON.stringify(legacyAssump), nowIso);
    importedCounts.assumptions++;
    if (legacyAssump.farmProfile && typeof legacyAssump.farmProfile === 'object') {
      db.prepare(
        'INSERT OR REPLACE INTO farm_profiles (owner_id, payload_json, updated_at) VALUES (?, ?, ?)'
      ).run('default', JSON.stringify(legacyAssump.farmProfile), nowIso);
      importedCounts.farmProfiles++;
    }
  }

  // 3. Legacy per-user assumptions map
  const legacyUserMap = readLegacyDoc('user_assumptions_map');
  if (legacyUserMap && typeof legacyUserMap === 'object') {
    for (const [ownerId, val] of Object.entries(legacyUserMap)) {
      if (!val || typeof val !== 'object') continue;
      db.prepare(
        'INSERT OR REPLACE INTO user_assumptions (owner_id, payload_json, updated_at) VALUES (?, ?, ?)'
      ).run(ownerId, JSON.stringify(val), nowIso);
      importedCounts.assumptions++;
      if (val.farmProfile && typeof val.farmProfile === 'object') {
        db.prepare(
          'INSERT OR REPLACE INTO farm_profiles (owner_id, payload_json, updated_at) VALUES (?, ?, ?)'
        ).run(ownerId, JSON.stringify(val.farmProfile), nowIso);
        importedCounts.farmProfiles++;
      }
    }
  }

  // 4. Legacy forecasts
  const legacyForecasts = readLegacyDoc('forecasts');
  if (Array.isArray(legacyForecasts)) {
    const upsertFc = db.prepare(`
      INSERT OR REPLACE INTO issued_forecasts
        (id, owner_id, basis, issue_date, input_cutoff, model_version, inputs_hash, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const fc of legacyForecasts) {
      if (!fc || !fc.id) continue;
      const ownerId = fc.ownerId || 'public';
      upsertFc.run(
        String(fc.id),
        String(ownerId),
        fc.basis || null,
        fc.issueDate || null,
        fc.inputCutoff || null,
        fc.modelVersion || null,
        fc.provenance?.inputHash || null,
        JSON.stringify(fc),
        fc.issuedAt || nowIso
      );
      importedCounts.forecasts++;
    }
  }

  // 5. Legacy users
  const legacyUsers = readLegacyDoc('auth_users');
  if (Array.isArray(legacyUsers)) {
    const upsertUser = db.prepare(
      'INSERT OR REPLACE INTO users (id, email, created_at, updated_at) VALUES (?, ?, ?, ?)'
    );
    for (const u of legacyUsers) {
      if (!u?.id || !u?.email) continue;
      upsertUser.run(u.id, u.email, u.createdAt || nowIso, u.updatedAt || nowIso);
      importedCounts.users++;
    }
  }

  insertAuditRevision(db, {
    userId: 'system',
    entityType: 'database',
    entityId: '002_legacy_documents_one_time_import',
    action: 'legacy_sqlite_import',
    before: null,
    after: importedCounts,
    createdAt: nowIso,
  });

  db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
    2,
    '002_legacy_documents_one_time_import',
    nowIso
  );

  return { alreadyImported: false, appliedAt: nowIso, importedCounts };
}

export function applyMigrations(db) {
  const nowIso = new Date().toISOString();
  db.exec(MIGRATIONS[0].sql);

  const m1 = db.prepare('SELECT version FROM schema_migrations WHERE version = 1').get();
  if (!m1) {
    db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
      1,
      MIGRATIONS[0].name,
      nowIso
    );
  }

  runLegacyDocumentsImport(db, { nowIso });
}
