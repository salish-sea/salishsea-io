import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from "./app.ts";

describe('GET /temporal-features', () => {
  it('responds with 200 and valid geojson for a valid date', async () => {
    const response = await request(app)
      .get('/api/temporal-features')
      .query({ d: '2025-07-05' });
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/application\/geo\+json/);
    expect(response.body).toHaveProperty('type', 'FeatureCollection');
    expect(Array.isArray(response.body.features)).toBe(true);
  });
});
