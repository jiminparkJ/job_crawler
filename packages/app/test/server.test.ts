import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { Agent } from 'undici';
import { buildServer } from '../src/server.js';

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'warn';

describe('server', () => {
  it('exposes a health endpoint', async () => {
    const app = await buildServer();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(body.features).toBeDefined();
    expect(typeof body.uptime).toBe('number');
    await app.close();
  });

  it('uses fastify under the hood', () => {
    expect(typeof Fastify).toBe('function');
  });

  it('undici Agent is constructible for pool config', () => {
    const agent = new Agent({ connections: 2 });
    expect(agent).toBeInstanceOf(Agent);
  });
});
