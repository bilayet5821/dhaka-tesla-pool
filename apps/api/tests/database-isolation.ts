import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';

/** Give one integration test file its own schema in the explicitly disposable test DB. */
export async function isolateDatabaseSuite(): Promise<() => Promise<void>> {
  const baseUrl = process.env.TEST_DATABASE_URL;
  if (!baseUrl || baseUrl !== process.env.DATABASE_URL) {
    throw new Error('Integration tests require TEST_DATABASE_URL to equal DATABASE_URL');
  }
  const schema = `suite_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({ connectionString: baseUrl });
  try {
    // schema is generated locally from a UUID, never supplied by a user.
    await admin.query(`CREATE SCHEMA "${schema}"`);
    const isolatedUrl = new URL(baseUrl);
    isolatedUrl.searchParams.set('options', `-c search_path=${schema}`);
    process.env.DATABASE_URL = isolatedUrl.toString();
    return async () => {
      process.env.DATABASE_URL = baseUrl;
      try {
        await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      } finally {
        await admin.end();
      }
    };
  } catch (error) {
    await admin.end();
    throw error;
  }
}
