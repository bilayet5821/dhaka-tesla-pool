import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './pool.js';

const migrationsDirectory = fileURLToPath(new URL('../../migrations/', import.meta.url));

export async function migrate(): Promise<void> {
  const entries = (await readdir(migrationsDirectory)).filter((name) => /^\d+_[a-z0-9_]+\.sql$/.test(name)).sort();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(7419001)');
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      sha256 text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const applied = await client.query<{ name: string; sha256: string }>('SELECT name, sha256 FROM schema_migrations');
    const byName = new Map(applied.rows.map((row) => [row.name, row.sha256]));
    for (const name of entries) {
      const sql = await readFile(join(migrationsDirectory, name), 'utf8');
      const digest = createHash('sha256').update(sql).digest('hex');
      if (byName.has(name)) {
        if (byName.get(name) !== digest) throw new Error(`Applied migration has changed: ${name}`);
        continue;
      }
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name, sha256) VALUES ($1, $2)', [name, digest]);
      process.stdout.write(`${JSON.stringify({ event: 'migration_applied', name })}\n`);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  migrate()
    .catch((error: unknown) => {
      process.stderr.write(`${JSON.stringify({ event: 'migration_failed', message: error instanceof Error ? error.message : 'unknown' })}\n`);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
