import { createHash, randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import type { CookieOptions } from 'express';

export const SESSION_COOKIE = 'dtp_session';
export const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

export const passwordOptions = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function cookieOptions(secure: boolean): CookieOptions {
  return { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: SESSION_LIFETIME_MS };
}

export function clearCookieOptions(secure: boolean): CookieOptions {
  return { httpOnly: true, sameSite: 'lax', secure, path: '/' };
}
