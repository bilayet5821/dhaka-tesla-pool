import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

// Only run against an explicitly configured disposable PostgreSQL database.
const integrationDb = process.env.TEST_DATABASE_URL;
const enabled = Boolean(integrationDb && integrationDb === process.env.DATABASE_URL);

describe.skipIf(!enabled)('auth against PostgreSQL', () => {
  let database: typeof import('../src/db/pool.js').pool;

  beforeAll(async () => {
    const poolModule = await import('../src/db/pool.js');
    database = poolModule.pool;
    const { migrate } = await import('../src/db/migrate.js');
    await migrate();
    await migrate(); // A second invocation must not reapply the auth migration.
  });

  afterAll(async () => {
    if (database) await database.end();
  });

  it('seeds named driver and passengers idempotently with hashed passwords', async () => {
    const { seedDemoAccounts, demoAccounts } = await import('../src/db/seed.js');
    const password = randomBytes(24).toString('base64url');
    await seedDemoAccounts(password);
    await seedDemoAccounts(password);
    const { rows } = await database.query<{
      name: string; normalized_email: string; role: string; password_hash: string;
    }>('SELECT name, normalized_email, role, password_hash FROM users WHERE normalized_email LIKE $1',
      ['%@demo.dhakatesla.local']);
    expect(rows).toHaveLength(4);
    for (const account of demoAccounts) {
      const row = rows.find((item) => item.normalized_email === account.email);
      expect(row).toMatchObject({ name: account.name, role: account.role });
      expect(row?.password_hash).toMatch(/^\$argon2id\$/);
    }
    const { createApp } = await import('../src/app.js');
    const login = await request(createApp(database, { allowedOrigins: ['http://localhost:3000'] }))
      .post('/api/v1/auth/login').set('Origin', 'http://localhost:3000')
      .send({ email: demoAccounts[0].email, password });
    expect(login.status).toBe(200);
    expect(login.body.data.user.role).toBe('DRIVER');
  });

  it('writes user and session, then revokes the hashed session on logout', async () => {
    const { createApp } = await import('../src/app.js');
    const app = createApp(database, { allowedOrigins: ['http://localhost:3000'] });
    const email = `db-${randomUUID()}@example.com`;
    const password = randomBytes(24).toString('base64url');
    const created = await request(app).post('/api/v1/auth/register').set('Origin', 'http://localhost:3000')
      .send({ name: 'DB Auth Test', email, password });
    expect(created.status).toBe(201);
    const cookie = (created.headers['set-cookie'] as string[])[0].split(';')[0];
    const rawToken = cookie.split('=')[1];
    const result = await database.query<{
      role: string; password_hash: string; token_hash: string; revoked_at: Date | null;
    }>(`SELECT u.role, u.password_hash, s.token_hash, s.revoked_at
       FROM users u JOIN sessions s ON s.user_id = u.id WHERE u.normalized_email = $1`, [email]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].role).toBe('PASSENGER');
    expect(result.rows[0].password_hash).toMatch(/^\$argon2id\$/);
    expect(result.rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.rows[0].token_hash).not.toBe(rawToken);
    expect((await request(app).get('/api/v1/auth/me').set('Cookie', cookie)).status).toBe(200);
    const logout = await request(app).post('/api/v1/auth/logout').set('Origin', 'http://localhost:3000')
      .set('Cookie', cookie).send({});
    expect(logout.status).toBe(200);
    const after = await database.query<{ revoked_at: Date | null }>(
      'SELECT revoked_at FROM sessions WHERE token_hash = $1', [result.rows[0].token_hash]);
    expect(after.rows[0].revoked_at).not.toBeNull();
    expect((await request(app).get('/api/v1/auth/me').set('Cookie', cookie)).status).toBe(401);
  });
});
