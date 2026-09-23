import { createApp } from './app.js';
import { pool } from './db/pool.js';

const port = Number(process.env.API_PORT ?? 3001);
const server = createApp(pool).listen(port, '0.0.0.0', () => {
  process.stdout.write(`${JSON.stringify({ event: 'api_started', port })}\n`);
});

function shutdown() {
  server.close(() => void pool.end());
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
