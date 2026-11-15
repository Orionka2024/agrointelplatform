# Backup and Restore Guide (`P1-0c` / `F-08`)

## Architecture Overview

User-generated data (`users`, `auth_sessions`, `magic_links`, `user_observations`, `user_assumptions`, `farm_profiles`, `issued_forecasts`, and `audit_revisions`) is stored in normalized relational tables managed by numbered migrations in [`server/migrations.js`](../server/migrations.js).

Bundled public history files (`data/official-history.json`, `data/official-drivers.json`, `data/official-forecast.json`, `data/official-hashes.json`) remain read-only files verified by SHA-256 on startup.

### Supported Storage Backends
1. **Managed Postgres (`DATABASE_URL`)** or **Managed Turso / libSQL (`TURSO_DATABASE_URL`)** for serverless production deployments.
2. **Mounted Persistent Volume (`AGRO_PERSISTENT_VOLUME=true` + `DATA_DIR`)** for single-node / container deployments.
3. **Ephemeral SQLite (`fs.mkdtempSync` via `DATA_DIR`)** for isolated automated test suites (`npm test`).

---

## One-Time Import from Legacy SQLite

When upgrading from an existing database that used the legacy `documents(name, body)` table:
- Migration `001_initial_relational_schema` creates the relational tables (`users`, `auth_sessions`, `magic_links`, `user_observations`, `user_assumptions`, `farm_profiles`, `issued_forecasts`, `audit_revisions`).
- Migration `002_legacy_documents_one_time_import` automatically imports all rows from `documents` into the relational tables inside a transaction, records a `legacy_sqlite_import` entry in `audit_revisions`, and records version `2` in `schema_migrations`.
- Subsequent startups or explicit calls to `store.importFromLegacySqlite()` check `schema_migrations` (`version = 2`) and return `{ alreadyImported: true }` without duplicating data.

---

## Exporting a Backup Snapshot

### Programmatic / CLI Backup
Run the following command to export a complete JSON snapshot of all relational tables and audit revisions:

```bash
node -e '
  import("./server/store.js").then(async ({ store }) => {
    await store.ensureInitialized({ forWrite: false });
    const snapshot = store.exportBackupSnapshot();
    process.stdout.write(JSON.stringify(snapshot, null, 2) + "\n");
  });
' > backup-$(date +%Y%m%d-%H%M%S).json
```

### SQLite File-Level Hot Backup
If running on a mounted SQLite volume (`DATA_DIR/agro.sqlite`):

```bash
sqlite3 "$DATA_DIR/agro.sqlite" ".backup 'agro-backup-$(date +%Y%m%d).sqlite'"
```

---

## Restoring from a Backup Snapshot

To restore a JSON backup snapshot into a target database (and record a `restore_backup` revision in `audit_revisions`):

```bash
node -e '
  import fs from "node:fs";
  import { store } from "./server/store.js";
  await store.ensureInitialized({ forWrite: true });
  const snapshot = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  store.restoreBackupSnapshot(snapshot);
  console.log("Backup restored successfully:", snapshot.exportedAt);
' backup-YYYYMMDD-HHMMSS.json
```
