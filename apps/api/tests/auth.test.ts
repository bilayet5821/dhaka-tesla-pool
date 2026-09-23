import { describe, expect, it, vi } from 'vitest';
import argon2 from 'argon2';
import cookieParser from 'cookie-parser';
import express from 'express';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { AuthService } from '../src/modules/auth/service.js';
import { requireRole, requireSession } from '../src/modules/auth/middleware.js';
import type { AuthRepository, NewSession, NewUser, SafeUser, UserRecord } from '../src/modules/auth/repository.js';
import { passwordOptions, SESSION_COOKIE } from '../src/modules/auth/security.js';
import { AuthThrottle } from '../src/modules/auth/throttle.js';

const origin = 'http://localhost:3000';
const db = { query: async () => ({ rows: [{ installed: 'schema_migrations' }] }) } as never;

class MemoryAuthRepository implements AuthRepository {
  users = new Map<string, UserRecord>();
  sessions = new Map<string, NewSession & { revokedAt?: Date }>();

  async findUserByEmail(email: string): Promise<UserRecord | null> {
    return this.users.get(email) ?? null;
  }
  async createUserWithSession(user: NewUser, session: NewSession): Promise<void> {
    if (this.users.has(user.normalized_email)) throw Object.assign(new Error('unique'), { code: '23505' });
    this.users.set(user.normalized_email, user);
    this.sessions.set(session.tokenHash, session);
  }
  async createSession(session: NewSession): Promise<void> {
    this.sessions.set(session.tokenHash, session);
  }
  async findActiveUserBySession(tokenHash: string, now: Date): Promise<SafeUser | null> {
    const session = this.sessions.get(tokenHash);
    const user = session && !session.revokedAt && session.expiresAt > now
      ? [...this.users.values()].find((candidate) => candidate.id === session.userId) : undefined;
    if (!user) return null;
    return { id: user.id, name: user.name, normalized_email: user.normalized_email, role: user.role };
  }
  async revokeSession(tokenHash: string): Promise<void> {
    const session = this.sessions.get(tokenHash);
    if (session) session.revokedAt = new Date();
  }
}

function fixture(secureCookies = false) {
  const repository = new MemoryAuthRepository();
  let now = new Date('2026-09-23T12:00:00Z');
  const app = createApp(db, {
    authRepository: repository, allowedOrigins: [origin], secureCookies,
    now: () => now, throttle: new AuthThrottle(() => now.getTime()),
  });
  return { app, repository, setNow: (value: Date) => { now = value; }, now: () => now };
}

const nusrat = { name: 'Nusrat', email: 'Nusrat@Example.Com', password: 'correct-horse-river-2026' };

async function register(app: ReturnType<typeof createApp>, body = nusrat) {
  return request(app).post('/api/v1/auth/register').set('Origin', origin).send(body);
}

function cookieFrom(response: { headers: Record<string, unknown> }): string {
  const setCookie = response.headers['set-cookie'] as string[];
  return setCookie[0].split(';')[0];
}

describe('passenger registration and sessions', () => {
  it('registers only a passenger, hashes password and token, and exposes no hashes', async () => {
    const { app, repository } = fixture();
    const response = await register(app);
    expect(response.status).toBe(201);
    expect(response.body.data.user).toMatchObject({ name: 'Nusrat', email: 'nusrat@example.com', role: 'PASSENGER' });
    const cookie = cookieFrom(response);
    expect(cookie).toMatch(new RegExp(`^${SESSION_COOKIE}=[A-Za-z0-9_-]{43}$`));
    expect((response.headers['set-cookie'] as string[])[0]).toMatch(/HttpOnly.*SameSite=Lax/);
    const user = repository.users.get('nusrat@example.com')!;
    expect(user.password_hash).toMatch(/^\$argon2id\$/);
    expect(await argon2.verify(user.password_hash, nusrat.password)).toBe(true);
    expect([...repository.sessions.keys()][0]).toMatch(/^[0-9a-f]{64}$/);
    expect([...repository.sessions.keys()][0]).not.toBe(cookie.split('=')[1]);
    expect(JSON.stringify(response.body)).not.toMatch(/password|hash|token|session/i);
    const me = await request(app).get('/api/v1/auth/me').set('Cookie', cookie);
    expect(me.status).toBe(200);
    expect(me.body.data.user.email).toBe('nusrat@example.com');
    expect(JSON.stringify(me.body)).not.toMatch(/password|hash|token|session/i);
  });

  it('sets Secure cookies when production cookie mode is enabled', async () => {
    const { app } = fixture(true);
    const response = await register(app);
    expect((response.headers['set-cookie'] as string[])[0]).toContain('Secure');
  });

  it('never logs the password or raw session cookie', async () => {
    const { app } = fixture();
    const logged: string[] = [];
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      logged.push(String(chunk));
      return true;
    });
    let response;
    try {
      response = await register(app);
    } finally {
      spy.mockRestore();
    }
    const cookie = cookieFrom(response);
    const text = logged.join('');
    expect(text).toContain('http_request');
    expect(text).not.toContain(nusrat.password);
    expect(text).not.toContain(cookie.split('=')[1]);
    expect(text).not.toContain('nusrat@example.com');
  });

  it('refuses a client-provided driver role and duplicate email', async () => {
    const { app } = fixture();
    const roleAttempt = await register(app, { ...nusrat, role: 'DRIVER' } as never);
    expect(roleAttempt.status).toBe(400);
    expect((await register(app)).status).toBe(201);
    const duplicate = await register(app, { ...nusrat, email: 'nusrat@example.com' });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('EMAIL_IN_USE');
  });

  it('rejects an expired session and revokes a logged-out session', async () => {
    const { app, repository, setNow, now } = fixture();
    const registration = await register(app);
    const firstCookie = cookieFrom(registration);
    const logout = await request(app).post('/api/v1/auth/logout').set('Origin', origin)
      .set('Cookie', firstCookie).send({});
    expect(logout.status).toBe(200);
    expect((await request(app).get('/api/v1/auth/me').set('Cookie', firstCookie)).status).toBe(401);
    expect([...repository.sessions.values()][0].revokedAt).toBeDefined();

    const login = await request(app).post('/api/v1/auth/login').set('Origin', origin)
      .send({ email: nusrat.email, password: nusrat.password });
    expect(login.status).toBe(200);
    const secondCookie = cookieFrom(login);
    expect((await request(app).get('/api/v1/auth/me').set('Cookie', secondCookie)).status).toBe(200);
    setNow(new Date(now().getTime() + 7 * 24 * 60 * 60 * 1000));
    expect((await request(app).get('/api/v1/auth/me').set('Cookie', secondCookie)).status).toBe(401);
  });
});

describe('login and authorization boundaries', () => {
  it('uses the same generic failure for unknown users and wrong passwords, then throttles', async () => {
    const { app } = fixture();
    await register(app);
    const wrong = await request(app).post('/api/v1/auth/login').set('Origin', origin)
      .send({ email: nusrat.email, password: 'this-is-not-the-right-pass' });
    const unknown = await request(app).post('/api/v1/auth/login').set('Origin', origin)
      .send({ email: 'nobody@example.com', password: 'this-is-not-the-right-pass' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
    const shortPassword = await request(app).post('/api/v1/auth/login').set('Origin', origin)
      .send({ email: nusrat.email, password: 'wrong' });
    expect(shortPassword.status).toBe(401);
    for (let attempt = 0; attempt < 3; attempt++) {
      await request(app).post('/api/v1/auth/login').set('Origin', origin)
        .send({ email: nusrat.email, password: 'this-is-not-the-right-pass' });
    }
    const blocked = await request(app).post('/api/v1/auth/login').set('Origin', origin)
      .send({ email: nusrat.email, password: nusrat.password });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
  });

  it('allows seeded-driver credentials and enforces passenger versus driver role', async () => {
    const { app, repository, now } = fixture();
    const passengerCookie = cookieFrom(await register(app));
    repository.users.set('jashim@demo.dhakatesla.local', {
      id: 'f089c01d-16fe-41fa-8de6-3254bce47205', name: 'Jashim',
      normalized_email: 'jashim@demo.dhakatesla.local', role: 'DRIVER',
      password_hash: await argon2.hash('bullet-demo-password-2026', passwordOptions),
    });
    const login = await request(app).post('/api/v1/auth/login').set('Origin', origin)
      .send({ email: 'jashim@demo.dhakatesla.local', password: 'bullet-demo-password-2026' });
    expect(login.status).toBe(200);
    expect(login.body.data.user.role).toBe('DRIVER');
    const driverCookie = cookieFrom(login);
    const guard = express();
    guard.use(cookieParser());
    const service = new AuthService(repository, now);
    guard.get('/driver-only', requireSession(service), requireRole('DRIVER'), (_req, res) => res.json({ ok: true }));
    guard.get('/passenger-only', requireSession(service), requireRole('PASSENGER'), (_req, res) => res.json({ ok: true }));
    expect((await request(guard).get('/driver-only').set('Cookie', passengerCookie)).status).toBe(403);
    expect((await request(guard).get('/driver-only').set('Cookie', driverCookie)).status).toBe(200);
    expect((await request(guard).get('/passenger-only').set('Cookie', driverCookie)).status).toBe(403);
    expect((await request(guard).get('/driver-only')).status).toBe(401);
  });

  it('requires an allowed origin and JSON content type for cookie-changing actions', async () => {
    const { app } = fixture();
    const forbidden = await request(app).post('/api/v1/auth/register').set('Origin', 'https://evil.example').send(nusrat);
    expect(forbidden.status).toBe(403);
    const noOrigin = await request(app).post('/api/v1/auth/register').send(nusrat);
    expect(noOrigin.status).toBe(403);
    const wrongType = await request(app).post('/api/v1/auth/register').set('Origin', origin)
      .set('Content-Type', 'text/plain').send('hello');
    expect(wrongType.status).toBe(415);
    expect((await request(app).get('/api/v1/auth/me')).status).toBe(401);
  });
});
