import type { RequestHandler } from 'express';
import type { Role, SafeUser } from './repository.js';
import { SESSION_COOKIE } from './security.js';
import type { AuthService } from './service.js';

export function requireSession(service: AuthService): RequestHandler {
  return async (request, response, next) => {
    try {
      const rawToken = request.cookies?.[SESSION_COOKIE] as string | undefined;
      const user = await service.currentUser(rawToken);
      if (!user) {
        response.locals.errorCode = 'AUTH_REQUIRED';
        response.status(401).json({ error: { code: 'AUTH_REQUIRED', message: 'Sign in required' } });
        return;
      }
      response.locals.authUser = user;
      response.locals.actorId = user.id;
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireRole(role: Role): RequestHandler {
  return (_request, response, next) => {
    const user = response.locals.authUser as SafeUser | undefined;
    if (!user) {
      response.locals.errorCode = 'AUTH_REQUIRED';
      response.status(401).json({ error: { code: 'AUTH_REQUIRED', message: 'Sign in required' } });
      return;
    }
    if (user.role !== role) {
      response.locals.errorCode = 'FORBIDDEN';
      response.status(403).json({ error: { code: 'FORBIDDEN', message: 'Insufficient role' } });
      return;
    }
    next();
  };
}
