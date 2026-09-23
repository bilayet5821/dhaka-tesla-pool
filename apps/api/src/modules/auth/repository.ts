import type { Pool } from 'pg';

export type Role = 'PASSENGER' | 'DRIVER';

export type UserRecord = {
  id: string;
  name: string;
  normalized_email: string;
  password_hash: string;
  role: Role;
};

export type SafeUser = Omit<UserRecord, 'password_hash'>;

export type NewUser = UserRecord;
export type NewSession = { id: string; userId: string; tokenHash: string; expiresAt: Date };

export interface AuthRepository {
  findUserByEmail(normalizedEmail: string): Promise<UserRecord | null>;
  createUser(user: NewUser): Promise<void>;
  createSession(session: NewSession): Promise<void>;
  findActiveUserBySession(tokenHash: string, now: Date): Promise<SafeUser | null>;
  revokeSession(tokenHash: string): Promise<void>;
}

export class PostgresAuthRepository implements AuthRepository {
  constructor(private readonly db: Pick<Pool, 'query'>) {}

  async findUserByEmail(normalizedEmail: string): Promise<UserRecord | null> {
    const result = await this.db.query<UserRecord>(
      'SELECT id, name, normalized_email, password_hash, role FROM users WHERE normalized_email = $1',
      [normalizedEmail],
    );
    return result.rows[0] ?? null;
  }

  async createUser(user: NewUser): Promise<void> {
    await this.db.query(
      'INSERT INTO users (id, name, normalized_email, password_hash, role) VALUES ($1, $2, $3, $4, $5)',
      [user.id, user.name, user.normalized_email, user.password_hash, user.role],
    );
  }

  async createSession(session: NewSession): Promise<void> {
    await this.db.query(
      'INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)',
      [session.id, session.userId, session.tokenHash, session.expiresAt],
    );
  }

  async findActiveUserBySession(tokenHash: string, now: Date): Promise<SafeUser | null> {
    const result = await this.db.query<SafeUser>(
      `SELECT u.id, u.name, u.normalized_email, u.role
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > $2`,
      [tokenHash, now],
    );
    return result.rows[0] ?? null;
  }

  async revokeSession(tokenHash: string): Promise<void> {
    await this.db.query('UPDATE sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL', [tokenHash]);
  }
}
