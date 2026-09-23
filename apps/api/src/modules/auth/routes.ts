import { Router } from 'express';
import type { RequestHandler } from 'express';
import { z } from 'zod';
import type { AuthRepository } from './repository.js';
import { AuthService, AuthFailure } from './service.js';
import { clearCookieOptions, cookieOptions, SESSION_COOKIE } from './security.js';
import { AuthThrottle } from './throttle.js';
import { requireSession } from './middleware.js';
import type { SafeUser } from './repository.js';
import { publicUser } from './service.js';

const email = z.string().trim().email().max(254);
const credentials = z.strictObject({ email, password: z.string().min(1).max(128) });
const registration = z.strictObject({
  name: z.string().trim().min(2).max(80), email, password: z.string().min(12).max(128),
});

export type AuthConfig = {
  secureCookies: boolean;
  now?: () => Date;
  throttle?: AuthThrottle;
};

export function authRoutes(repository: AuthRepository, config: AuthConfig): Router {
  const router = Router();
  const service = new AuthService(repository, config.now);
  const throttle = config.throttle ?? new AuthThrottle();

  router.post('/register', (async (request, response) => {
    if (!throttle.allowRegister(request.ip ?? 'unknown')) throw new AuthFailure(429, 'RATE_LIMITED', 'Please try again later');
    const input = registration.parse(request.body);
    const result = await service.register(input);
    response.cookie(SESSION_COOKIE, result.token, cookieOptions(config.secureCookies));
    response.status(201).json({ data: { user: result.user } });
  }) as RequestHandler);

  router.post('/login', (async (request, response) => {
    const input = credentials.parse(request.body);
    const email = input.email.trim().toLowerCase();
    const ip = request.ip ?? 'unknown';
    if (!throttle.allowLogin(ip, email)) throw new AuthFailure(429, 'RATE_LIMITED', 'Please try again later');
    const result = await service.login(input);
    const previousToken = request.cookies?.[SESSION_COOKIE] as string | undefined;
    if (previousToken) await service.logout(previousToken);
    throttle.clearLogin(ip, email);
    response.cookie(SESSION_COOKIE, result.token, cookieOptions(config.secureCookies));
    response.json({ data: { user: result.user } });
  }) as RequestHandler);

  router.post('/logout', requireSession(service), (async (request, response) => {
    await service.logout(request.cookies[SESSION_COOKIE] as string);
    response.clearCookie(SESSION_COOKIE, clearCookieOptions(config.secureCookies));
    response.json({ data: { signedOut: true } });
  }) as RequestHandler);

  router.get('/me', requireSession(service), (_request, response) => {
    response.json({ data: { user: publicUser(response.locals.authUser as SafeUser) } });
  });

  return router;
}
