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

export const dhakaAreas = [
  { code: 'banani', name: 'Banani' }, { code: 'mohakhali', name: 'Mohakhali' },
  { code: 'gulshan-1', name: 'Gulshan 1' }, { code: 'dhanmondi', name: 'Dhanmondi' },
  { code: 'mirpur', name: 'Mirpur' }, { code: 'uttara', name: 'Uttara' },
  { code: 'farmgate', name: 'Farmgate' }, { code: 'bashundhara', name: 'Bashundhara' },
] as const;

export async function seedRideDomain(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const area of dhakaAreas) {
      await client.query(
        `INSERT INTO areas (id, code, name) VALUES ($1, $2, $3)
         ON CONFLICT (code) DO NOTHING`, [randomUUID(), area.code, area.name],
      );
      const existing = await client.query<{ name: string }>('SELECT name FROM areas WHERE code = $1', [area.code]);
      if (existing.rows[0]?.name !== area.name) throw new Error('Existing demo area conflicts with seed');
    }
    for (const [destination, zoneCharge] of [['mohakhali', 8000], ['gulshan-1', 12000]] as const) {
      await client.query(
        `INSERT INTO route_fares (id, origin_area_id, destination_area_id, pricing_version,
           base_per_seat_poysha, zone_charge_poysha)
         SELECT $1, origin.id, destination.id, 1, 5000, $4
         FROM areas origin CROSS JOIN areas destination
         WHERE origin.code = $2 AND destination.code = $3
         ON CONFLICT (origin_area_id, destination_area_id, pricing_version) DO NOTHING`,
        [randomUUID(), 'banani', destination, zoneCharge],
      );
      const tariff = await client.query<{ base_per_seat_poysha: number; zone_charge_poysha: number }>(
        `SELECT base_per_seat_poysha, zone_charge_poysha FROM route_fares
         WHERE origin_area_id = (SELECT id FROM areas WHERE code = $1)
           AND destination_area_id = (SELECT id FROM areas WHERE code = $2) AND pricing_version = 1`,
        ['banani', destination],
      );
      if (tariff.rows[0]?.base_per_seat_poysha !== 5000 || tariff.rows[0]?.zone_charge_poysha !== zoneCharge) {
        throw new Error('Existing demo tariff conflicts with approved fare');
      }
    }
    const driver = await client.query<{ id: string; role: string }>(
      'SELECT id, role FROM users WHERE normalized_email = $1', [demoAccounts[0].email],
    );
    if (driver.rows[0]?.role !== 'DRIVER') throw new Error('Seed Jashim before Bullet');
    await client.query(
      `INSERT INTO vehicles (id, driver_user_id, name, capacity_seats)
       VALUES ($1, $2, 'Bullet', 3) ON CONFLICT (driver_user_id) DO NOTHING`,
      [randomUUID(), driver.rows[0].id],
    );
    const vehicle = await client.query<{ name: string; capacity_seats: number }>(
      'SELECT name, capacity_seats FROM vehicles WHERE driver_user_id = $1', [driver.rows[0].id],
    );
    if (vehicle.rows[0]?.name !== 'Bullet' || vehicle.rows[0]?.capacity_seats !== 3) {
      throw new Error('Existing demo vehicle conflicts with Bullet');
    }
    await client.query('COMMIT');
    process.stdout.write(`${JSON.stringify({ event: 'ride_domain_ready', areas: dhakaAreas.length })}\n`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

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
    .then(() => seedRideDomain())
    .catch((error: unknown) => {
      process.stderr.write(`${JSON.stringify({ event: 'seed_failed', message: error instanceof Error ? error.message : 'unknown' })}\n`);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
