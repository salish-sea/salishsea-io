// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@sentry/browser', () => ({captureException: () => {}}));
// The calendar's circles come from the read path; none are needed here.
vi.mock('./read-path.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./read-path.ts')>()),
  fetchCalendarCounts: async () => new Map(),
}));

/** A matchMedia that answers the layout query as `portrait` says, and nothing else. */
function stubLayout(portrait: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(max-aspect-ratio: 1)' && portrait, media: query,
    addEventListener: () => {}, removeEventListener: () => {},
  }));
}

async function panel() {
  await import('./obs-panel.ts');
  const el = document.createElement('obs-panel') as unknown as HTMLElement & {date: string, updateComplete: Promise<boolean>};
  el.date = '2026-09-29';
  document.body.append(el);
  await el.updateComplete;
  const root = el.shadowRoot!;
  const calendar = () => root.querySelector<HTMLElement>('date-calendar')!;
  const readout = () => root.querySelector<HTMLButtonElement>('.selected-date')!;
  return {el, root, calendar, readout};
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

// salish-dvd: on a phone held upright the map takes half the screen, and the month grid
// put the day's sightings a whole screen down. There it folds behind the date.
describe('the month grid, when the panel sits under the map', () => {
  it('is folded away, and the date opens it', async () => {
    stubLayout(true);
    const {el, calendar, readout} = await panel();
    expect(calendar().hidden).toBe(true);
    expect(readout().getAttribute('aria-expanded')).toBe('false');
    readout().click();
    await el.updateComplete;
    expect(calendar().hidden).toBe(false);
    expect(readout().getAttribute('aria-expanded')).toBe('true');
  });

  it('folds away again once a day is picked from it, and gives focus back to the date', async () => {
    stubLayout(true);
    const {el, root, calendar, readout} = await panel();
    readout().click();
    await el.updateComplete;
    calendar().dispatchEvent(new CustomEvent('date-selected', {bubbles: true, composed: true, detail: '2026-09-27'}));
    await el.updateComplete;
    expect(calendar().hidden).toBe(true);
    expect(root.activeElement).toBe(readout());
  });

  it('offers a typed date under the open grid, for a day far from this month', async () => {
    stubLayout(true);
    const {el, root, readout} = await panel();
    expect(root.querySelector('.type-date')).toBeNull();
    readout().click();
    await el.updateComplete;
    root.querySelector<HTMLButtonElement>('.type-date')!.click();
    await el.updateComplete;
    expect(root.querySelector('input[type=date]')).not.toBeNull();
  });
});

describe('the month grid, beside the map', () => {
  it('always shows, and the date opens a typed date instead', async () => {
    stubLayout(false);
    const {el, root, calendar, readout} = await panel();
    expect(calendar().hidden).toBe(false);
    expect(readout().hasAttribute('aria-expanded')).toBe(false);
    readout().click();
    await el.updateComplete;
    expect(calendar().hidden).toBe(false);
    expect(root.querySelector('input[type=date]')).not.toBeNull();
  });
});
