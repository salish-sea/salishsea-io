// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const deleteResult = vi.hoisted(() => ({error: null as unknown}));
vi.mock('@sentry/browser', () => ({captureException: () => {}}));
// The write API's DELETE (decision 065): it throws on a failed delete.
vi.mock('./write-api.ts', () => ({
  deleteSighting: async () => { if (deleteResult.error) throw deleteResult.error; },
}));
// obs-summary's connectedCallback warms the catalog-code lookup; an empty result
// leaves designations as plain text, which these tests don't assert on.
vi.mock('./individual-links.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./individual-links.ts')>()),
  loadCatalogCodes: async () => new Map(),
}));

import { buildShareUrl, confirmationNote, stripResolvedProvenance, ObsSummary } from './obs-summary.ts';
import type { Occurrence } from './types.ts';

describe('buildShareUrl', () => {
  beforeEach(() => {
    // jsdom provides window.location but we need to stub it for tests
    Object.defineProperty(window, 'location', {
      value: {
        origin: 'https://example.com',
        pathname: '/app',
        search: '',
        href: 'https://example.com/app',
      },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    // Reset to defaults
    Object.defineProperty(window, 'location', {
      value: {
        origin: 'http://localhost:3000',
        pathname: '/',
        search: '',
        href: 'http://localhost:3000/',
      },
      writable: true,
      configurable: true,
    });
  });

  it('Test 1: builds a URL from origin + map root + ?o=id, whatever page hosts the summary', () => {
    const result = buildShareUrl('abc123');
    expect(result).toBe('https://example.com/?o=abc123');
  });

  it('Test 2: never includes other query params regardless of window.location.search', () => {
    // Set search to simulate existing query params
    Object.defineProperty(window, 'location', {
      value: {
        origin: 'https://example.com',
        pathname: '/app',
        search: '?d=2024-01-01&x=48.5&y=-123.2&z=10',
        href: 'https://example.com/app?d=2024-01-01&x=48.5&y=-123.2&z=10',
      },
      writable: true,
      configurable: true,
    });
    const result = buildShareUrl('xyz');
    expect(result).not.toContain('?d=');
    expect(result).not.toContain('?x=');
    expect(result).not.toContain('?y=');
    expect(result).not.toContain('?z=');
    expect(result).toBe('https://example.com/?o=xyz');
  });

  it('Test 3: UUID-style id round-trips cleanly', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    const result = buildShareUrl(uuid);
    expect(result).toBe(`https://example.com/?o=${uuid}`);
    // Verify no double-encoding occurs for standard UUID characters
    expect(result).toContain(uuid);
  });
});

describe('stripResolvedProvenance', () => {
  // Patterns mirror real maplify.sightings.comments resolved by
  // maplify.resolve_collection (leading bracket tag + trailing attribution).

  it('drops a row whose body is only the trailing attribution line', () => {
    const body = '\n\nSubmitted by a Whale Alert Alaska Trusted Observer Via Webmap';
    expect(stripResolvedProvenance(body, 'maplify')).toBe('');
  });

  it('strips the leading bracket tag but keeps the real sighting content', () => {
    const body = '[Orca Network] Biggs T65As northbound (Charvet Drucker)\n\nSubmitted by a Cascadia Trusted Observer Via Webmap';
    expect(stripResolvedProvenance(body, 'maplify')).toBe('Biggs T65As northbound (Charvet Drucker)');
  });

  it('handles "an" and other org names in the trailing line', () => {
    const body = 'Two orcas\n\nSubmitted by an MMC Trusted Observer Via App';
    expect(stripResolvedProvenance(body, 'maplify')).toBe('Two orcas');
  });

  it('is a no-op for non-Maplify sources (preserves HappyWhale markdown links)', () => {
    const body = '[CRC-1234](https://happywhale.com/individual/1234)\n\n📍 Salish Sea';
    expect(stripResolvedProvenance(body, 'happywhale')).toBe(body);
  });

  it('leaves Maplify content without resolver artifacts untouched', () => {
    const body = 'Gray whale southbound near Alki';
    expect(stripResolvedProvenance(body, 'maplify')).toBe(body);
  });
});

describe('deleting a sighting', () => {
  // The element is driven directly rather than rendered: the point under test is
  // what onDelete does with the result, and a full render would need a whole
  // Occurrence fixture to say nothing extra.
  const summaryFor = (id: string) => {
    const el = document.createElement('obs-summary') as ObsSummary;
    (el as unknown as {sighting: Partial<Occurrence>}).sighting = {id};
    return el;
  };
  const clickDelete = (el: ObsSummary) =>
    (el as unknown as {onDelete(e: Event): Promise<void>}).onDelete(new Event('click'));

  beforeEach(() => { deleteResult.error = null; });

  it('announces the deletion so the list can drop the row without waiting for the next build', async () => {
    const el = summaryFor('abc-123');
    const deleted: string[] = [];
    el.addEventListener('sighting-deleted', e => deleted.push((e as CustomEvent<string>).detail));

    await clickDelete(el);

    expect(deleted).toEqual(['abc-123']);
  });

  it('reports a failed delete and does not announce a deletion that did not happen', async () => {
    deleteResult.error = {message: 'permission denied for table observations'};
    const el = summaryFor('abc-123');
    const deleted: string[] = [];
    const reported: string[] = [];
    el.addEventListener('sighting-deleted', e => deleted.push((e as CustomEvent<string>).detail));
    el.addEventListener('report-error', e => reported.push((e as CustomEvent<{message: string}>).detail.message));

    await clickDelete(el);

    expect(reported).toEqual(["Couldn't delete that sighting. Please try again."]);
    // Announcing here would remove the row for a sighting that is still there.
    expect(deleted).toEqual([]);
  });
});

describe('an unconfirmed sighting', () => {
  const rendered = async (confirmation: Occurrence['confirmation'], disagreements: number | null = null,
                          vitality: Occurrence['vitality'] = null) => {
    const el = document.createElement('obs-summary') as ObsSummary;
    (el as unknown as {sighting: Partial<Occurrence>}).sighting = {
      id: 'inaturalist:1', body: null, confirmation, disagreements, vitality, count: null, observed_at: '2026-09-15T18:00:00+00:00',
      photos: [], provider_slug: 'inaturalist', provider: 'iNaturalist', collection: 'iNaturalist',
      observer: 'someone', source_url: null, organization_url: null, url: null, attribution: null,
      taxon: {scientific_name: 'Megaptera novaeangliae', vernacular_name: 'Humpback whale', species_id: 41566, entity_id: null},
    };
    document.body.append(el);
    await el.updateComplete;
    const root = el.shadowRoot!;
    el.remove();
    // what the dot is filled with, not only its class: an inline fill once overrode the class's
    const dot = root.querySelector<HTMLElement>('.focus-occurrence')!;
    return {word: [...root.querySelectorAll('.confirmation')].map(e => e.textContent).join(' · ') || null,
            outlined: dot.classList.contains('unconfirmed') && dot.style.backgroundColor === 'rgb(255, 255, 255)'};
  };

  it('says so beside its name, and its dot is outlined as on the map (decision 080)', async () => {
    expect(await rendered('unconfirmed')).toEqual({word: 'Unconfirmed', outlined: true});
    expect(await rendered('disputed')).toEqual({word: 'Disputed', outlined: true});
    expect(await rendered('confirmed')).toEqual({word: null, outlined: false});
  });

  it('a confirmed sighting someone was outvoted on says so quietly, with a solid dot', async () => {
    expect(await rendered('confirmed', 1)).toEqual({word: '1 identifier disagrees', outlined: false});
    expect(await rendered('confirmed', 2)).toEqual({word: '2 identifiers disagree', outlined: false});
    expect(await rendered('confirmed', 0)).toEqual({word: null, outlined: false});
  });

  it('a dead animal says so (salish-1y8); alive and undetermined say nothing', async () => {
    expect(await rendered('confirmed', null, 'dead')).toEqual({word: 'Dead', outlined: false});
    expect(await rendered('unconfirmed', null, 'dead')).toEqual({word: 'Unconfirmed · Dead', outlined: true});
    expect(await rendered('confirmed', null, 'alive')).toEqual({word: null, outlined: false});
    expect(await rendered('confirmed', null, 'undetermined')).toEqual({word: null, outlined: false});
  });
});

describe('confirmationNote', () => {
  it("explains each source's own rule, not person-to-person agreement where that isn't the rule (decision 080)", () => {
    expect(confirmationNote({confirmation: 'unconfirmed', provider_slug: 'inaturalist'})).toMatch(/observer/);
    expect(confirmationNote({confirmation: 'disputed', provider_slug: 'inaturalist'})).toMatch(/disagree/);
    expect(confirmationNote({confirmation: 'unconfirmed', provider_slug: 'maplify'})).toMatch(/marked this report trusted/);
    expect(confirmationNote({confirmation: 'unconfirmed', provider_slug: 'orcasound'})).toMatch(/possibly heard/);
  });
});

describe("a card's actions menu", () => {
  const mounted = async () => {
    const el = document.createElement('obs-summary') as ObsSummary;
    (el as unknown as {sighting: Partial<Occurrence>}).sighting = {
      id: 'inaturalist:1', body: null, confirmation: 'confirmed', disagreements: null, vitality: null, count: null,
      observed_at: '2026-09-15T18:00:00+00:00', photos: [], provider_slug: 'inaturalist', provider: 'iNaturalist',
      collection: 'iNaturalist', observer: 'someone', source_url: null, organization_url: null, url: null, attribution: null,
      identifiers: null,
      taxon: {scientific_name: 'Megaptera novaeangliae', vernacular_name: 'Humpback whale', species_id: 41566, entity_id: null},
    };
    document.body.append(el);
    await el.updateComplete;
    const root = el.shadowRoot!;
    const button = root.querySelector<HTMLButtonElement>('button.more')!;
    const items = () => [...root.querySelectorAll<HTMLButtonElement>('.menu [role="menuitem"]')];
    const settle = async () => { await el.updateComplete; await el.updateComplete; };
    return {el, root, button, items, settle};
  };
  afterEach(() => { document.body.replaceChildren(); });

  it('is closed until its button is pressed, and then offers what anyone may do', async () => {
    const {button, items, settle} = await mounted();
    expect(items()).toEqual([]);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    button.click();
    await settle();
    expect(button.getAttribute('aria-expanded')).toBe('true');
    // Signed out, and not one's own sighting: only the link to it.
    expect(items().map(i => i.textContent)).toEqual(['Copy link']);
    // Out of the Tab order, as a menu's items are: the arrows move between them, and
    // Tab leaves the menu rather than landing on an item about to be removed.
    expect(items().map(i => i.tabIndex)).toEqual([-1]);
  });

  it('closes on Escape and gives focus back to its button', async () => {
    const {root, button, items, settle} = await mounted();
    button.click();
    await settle();
    expect(root.activeElement).toBe(items()[0]);
    document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'}));
    await settle();
    expect(items()).toEqual([]);
    expect(root.activeElement).toBe(button);
  });

  it('closes on a click elsewhere on the page, but not on a click inside it', async () => {
    const {root, button, items, settle} = await mounted();
    button.click();
    await settle();
    root.querySelector<HTMLElement>('.menu')!.click();
    await settle();
    expect(items().length).toBe(1);
    document.body.click();
    await settle();
    expect(items()).toEqual([]);
  });

  it("closes when another card's menu opens", async () => {
    const first = await mounted();
    const second = await mounted();
    first.button.click();
    await first.settle();
    second.button.click();
    await first.settle();
    await second.settle();
    expect(first.items()).toEqual([]);
    expect(second.items().length).toBe(1);
  });

  it('stops listening to the page once closed', async () => {
    const {button, settle} = await mounted();
    const removed = vi.spyOn(document, 'removeEventListener');
    button.click();
    await settle();
    button.click();
    await settle();
    expect(removed.mock.calls.map(([type]) => type).sort()).toEqual(['click', 'keydown']);
    removed.mockRestore();
  });
});
