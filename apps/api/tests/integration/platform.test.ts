import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { closeDatabase, hasDatabase } from '../helpers/db';
import { app } from '../helpers/api';

describe.skipIf(!hasDatabase)('platform endpoints', () => {
  afterAll(async () => {
    await closeDatabase();
  });

  it('reports liveness without touching dependencies', async () => {
    const res = await request(app()).get('/healthz').expect(200);
    expect(res.body.status).toBe('ok');
  });

  it('reports readiness with a per-dependency breakdown', async () => {
    const res = await request(app()).get('/readyz').expect(200);
    expect(res.body.status).toBe('ready');
    expect(res.body.checks.database).toBe('ok');
  });

  it('serves the OpenAPI document', async () => {
    const res = await request(app()).get('/openapi.json').expect(200);
    expect(res.body.openapi).toBe('3.1.0');
    expect(res.body.info.title).toBe('OutreachOS API');
  });

  it('serves Swagger UI at /docs', async () => {
    const res = await request(app()).get('/docs/').expect(200);
    expect(res.text).toContain('swagger');
  });

  it('returns a structured 404 for an unknown route', async () => {
    const res = await request(app()).get('/api/v1/nope').expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.requestId).toBeTypeOf('string');
  });

  it('echoes a correlation id on every response', async () => {
    const res = await request(app()).get('/healthz').expect(200);
    expect(res.headers['x-request-id']).toMatch(/^req_[0-9a-f]{24}$/);

    const supplied = await request(app())
      .get('/healthz')
      .set({ 'x-request-id': 'trace-abc-123' })
      .expect(200);
    expect(supplied.headers['x-request-id']).toBe('trace-abc-123');
  });

  it('rejects an oversized JSON body', async () => {
    const res = await request(app())
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ email: 'a@b.com', password: 'x'.repeat(2 * 1024 * 1024) }));
    expect(res.status).toBe(413);
  });

  it('does not advertise the server framework', async () => {
    const res = await request(app()).get('/healthz').expect(200);
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
