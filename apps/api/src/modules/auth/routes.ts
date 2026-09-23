import { Router } from 'express';
import type { RequestHandler } from 'express';
import { z } from 'zod';
import type { AuthRepository } from './repository.js';
import { AuthService, AuthFailure } from './service.js';
import { cookieOptions, SESSION_COOKIE } from './security.js';
import { AuthThrottle } from './throttle.js';

const credentials = z.strictObject({
  email: z.email().max(254),
  password: z.string().min(12).max(128),
});
const registration = credentials.extend({ name: z.string().trim().min(2).max(80) });

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
    throttle.clearLogin(ip, email);
    response.cookie(SESSION_COOKIE, result.token, cookieOptions(config.secureCookies));
    response.json({ data: { user: result.user } });
  }) as RequestHandler);

  return router;
}
