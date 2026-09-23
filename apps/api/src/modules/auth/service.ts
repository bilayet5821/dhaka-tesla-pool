import { randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import type { AuthRepository, Role, SafeUser, UserRecord } from './repository.js';
import { hashSessionToken, newSessionToken, passwordOptions, SESSION_LIFETIME_MS } from './security.js';

export class AuthFailure extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
  }
}

export type PublicUser = { id: string; name: string; email: string; role: Role };
export function publicUser(user: SafeUser): PublicUser {
  return { id: user.id, name: user.name, email: user.normalized_email, role: user.role };
}

export class AuthService {
  constructor(private readonly repository: AuthRepository, private readonly now: () => Date = () => new Date()) {}

  private async issueSession(user: SafeUser): Promise<{ user: PublicUser; token: string }> {
    const token = newSessionToken();
    await this.repository.createSession({
      id: randomUUID(), userId: user.id, tokenHash: hashSessionToken(token),
      expiresAt: new Date(this.now().getTime() + SESSION_LIFETIME_MS),
    });
    return { user: publicUser(user), token };
  }

  async register(input: { name: string; email: string; password: string }): Promise<{ user: PublicUser; token: string }> {
    const normalizedEmail = input.email.trim().toLowerCase();
    const passwordHash = await argon2.hash(input.password, passwordOptions);
    const user: UserRecord = {
      id: randomUUID(), name: input.name.trim(), normalized_email: normalizedEmail,
      password_hash: passwordHash, role: 'PASSENGER',
    };
    try {
      await this.repository.createUser(user);
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
        throw new AuthFailure(409, 'EMAIL_IN_USE', 'An account with this email already exists');
      }
      throw error;
    }
    return this.issueSession(user);
  }

  async login(input: { email: string; password: string }): Promise<{ user: PublicUser; token: string }> {
    const user = await this.repository.findUserByEmail(input.email.trim().toLowerCase());
    if (!user || !(await argon2.verify(user.password_hash, input.password))) {
      throw new AuthFailure(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    }
    return this.issueSession(user);
  }

  async currentUser(rawToken: string | undefined): Promise<SafeUser | null> {
    if (!rawToken || !/^[A-Za-z0-9_-]{43}$/.test(rawToken)) return null;
    return this.repository.findActiveUserBySession(hashSessionToken(rawToken), this.now());
  }

  async logout(rawToken: string): Promise<void> {
    await this.repository.revokeSession(hashSessionToken(rawToken));
  }
}
