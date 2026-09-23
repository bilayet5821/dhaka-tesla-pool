import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';

describe('health endpoint foundation', () => {
  it('reports process liveness without querying the database', async () => {
    const query = vi.fn();
    const response = await request(createApp({ query } as never)).get('/api/v1/health/live');
    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('live');
    expect(query).not.toHaveBeenCalled();
  });

  it('reports migration readiness when the database is prepared', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ installed: 'schema_migrations' }] });
    const response = await request(createApp({ query } as never)).get('/api/v1/health/ready');
    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('ready');
  });

  it('reports unavailable database without leaking connection details', async () => {
    const query = vi.fn().mockRejectedValue(new Error('secret connection string'));
    const response = await request(createApp({ query } as never)).get('/api/v1/health/ready');
    expect(response.status).toBe(503);
    expect(response.text).not.toContain('secret connection string');
  });
});
