// @vitest-environment jsdom
/**
 * The terms of use in the sighting form (#739): a box to tick before a contributor's
 * first sighting, a line once they have agreed, and nothing while editing.
 */
import { ContextProvider } from '@lit/context';
import { afterEach, describe, expect, test, vi } from 'vitest';

vi.mock('./read-path.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./read-path.ts')>()),
  fetchStaticAnimalNames: async () => new Map(),
}));

const { contributorContext } = await import('./identity.ts');
const { TERMS_VERSION } = await import('./terms.ts');
const { sightingBody } = await import('./write-api.ts');
await import('./sighting-form.ts');

type Form = HTMLElement & {isNew: boolean, sightingId: string, updateComplete: Promise<boolean>};

const someone = (terms_version: number | null) =>
  ({id: 7, name: 'Someone', picture: null, editor: false, orcid: null, terms_version});

async function mount(terms_version: number | null, isNew = true) {
  const host = document.createElement('div');
  document.body.append(host);
  new ContextProvider(host, {context: contributorContext, initialValue: someone(terms_version)});
  const form = document.createElement('sighting-form') as Form;
  form.sightingId = '01977c2a-b313-77a9-8433-ffccbd56bf57';
  form.isNew = isNew;
  host.append(form);
  await form.updateComplete;
  return form.shadowRoot!;
}

afterEach(() => { document.body.innerHTML = ''; });

describe('the terms of use in the sighting form', () => {
  test('a contributor who hasn\'t agreed ticks a required box naming the license and linking the terms', async () => {
    const root = await mount(null);
    const box = root.querySelector<HTMLInputElement>('.terms input[type=checkbox]');
    expect(box?.required).toBe(true);
    expect(root.querySelector('.terms')!.textContent).toMatch(/I agree to the terms of use: my sightings are published under CC BY 4\.0/);
    expect(root.querySelector('.terms a[href="/terms.html"]')).not.toBeNull();
  });

  test('one who has agreed sees a line, and no box', async () => {
    const root = await mount(TERMS_VERSION);
    expect(root.querySelector('.terms input')).toBeNull();
    expect(root.querySelector('p.terms')!.textContent).toMatch(/Published under CC BY 4\.0, as the terms of use say/);
  });

  test('editing a sighting asks nothing of one who hasn\'t agreed', async () => {
    const root = await mount(null, false);
    expect(root.querySelector('.terms')).toBeNull();
  });
});

describe('the save request', () => {
  const sighting = {id: 'x', body: '', count: null, direction: null, entity_id: 'SSA:0000900',
    location: {lon: -123, lat: 48.5}, observed_at: '2026-10-30T17:00:00Z', observed_from: null,
    photos: [], url: '', accuracy: null};
  test('carries the agreement when the contributor gives it with this save, and not otherwise', () => {
    expect(sightingBody({...sighting, agree_terms: TERMS_VERSION})).toMatchObject({agree_terms: TERMS_VERSION});
    expect(sightingBody(sighting)).not.toHaveProperty('agree_terms');
  });
});
