import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import argon2 from 'argon2';
import { pool } from './pool.js';
import { passwordOptions } from '../modules/auth/security.js';

export const demoAccounts = [
  { name: 'Jashim', email: 'jashim@demo.dhakatesla.local', role: 'DRIVER' },
  { name: 'Nusrat', email: 'nusrat@demo.dhakatesla.local', role: 'PASSENGER' },
  { name: 'Rafiq', email: 'rafiq@demo.dhakatesla.local', role: 'PASSENGER' },
  { name: 'Shirin', email: 'shirin@demo.dhakatesla.local', role: 'PASSENGER' },
] as const;

export async function seedDemoAccounts(password: string): Promise<void> {
  if (password.length < 12 || password.length > 128) {
    throw new Error('AUTH_DEMO_PASSWORD must have 12 to 128 characters');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const account of demoAccounts) {
      const passwordHash = await argon2.hash(password, passwordOptions);
      const result = await client.query<{ role: string }>(
        `INSERT INTO users (id, name, normalized_email, password_hash, role)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (normalized_email) DO NOTHING
         RETURNING role`,
        [randomUUID(), account.name, account.email, passwordHash, account.role],
      );
      if (!result.rows[0]) {
        const existing = await client.query<{ role: string }>('SELECT role FROM users WHERE normalized_email = $1', [account.email]);
        if (existing.rows[0]?.role !== account.role) throw new Error('Existing demo account has an unexpected role');
      }
    }
    await client.query('COMMIT');
    process.stdout.write(`${JSON.stringify({ event: 'demo_accounts_ready', count: demoAccounts.length })}\n`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  seedDemoAccounts(process.env.AUTH_DEMO_PASSWORD ?? '')
    .catch((error: unknown) => {
      process.stderr.write(`${JSON.stringify({ event: 'seed_failed', message: error instanceof Error ? error.message : 'unknown' })}\n`);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
