import { describe, it, expect } from 'vitest';
import { fetchSpecies, ingestSpecies, upsertSpecies } from './species.js';
import { db } from '../database.js';

// Helper to count species in the DB
function countSpecies() {
  const row = db.prepare<[], number>('SELECT COUNT(*) as count FROM happywhale_species').get();
  return typeof row === 'object' && row !== null && 'count' in row ? Number((row as any).count) : 0;
}

describe('happywhale species integration', () => {
  it('fetches, ingests, and upserts species from file', async () => {
    const speciesList = await fetchSpecies('test/happywhale-encounter-config.json');
    expect(speciesList).toBeTruthy();
    expect(Array.isArray(speciesList)).toBe(true);
    if (!speciesList) return;
    const rows = speciesList.map(ingestSpecies);
    upsertSpecies(rows);
    // Check that at least one species is in the DB
    const count = countSpecies();
    expect(count).toBeGreaterThan(0);
    upsertSpecies(rows);
    expect(count).toEqual(countSpecies());
  });
});
