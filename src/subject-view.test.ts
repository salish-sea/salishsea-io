// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { occurrenceFromHref, SubjectView } from './subject-view.ts';

describe('a link to a day and a sighting on the map', () => {
  const base = 'https://salishsea.io/individuals/0000101/J035';

  it('is read as that day and sighting', () => {
    expect(occurrenceFromHref('/?d=2026-10-25&o=maplify%3A262674', base)).toEqual({date: '2026-10-25', occurrenceId: 'maplify:262674'});
  });

  it('needs both the day and the sighting, on our own map page', () => {
    for (const href of ['/?d=2026-10-25', '/?o=maplify:1', '/?d=yesterday&o=maplify:1', '/whales?d=2026-10-25&o=maplify:1',
                        'https://example.org/?d=2026-10-25&o=maplify:1'])
      expect(occurrenceFromHref(href, base), href).toBeNull();
  });
});

describe("the sidebar's subject view", () => {
  afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });

  // The view as it stands after its data failed to load, with links of every kind put in
  // its shadow root: what it does with a click doesn't depend on what it drew.
  const mounted = async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', {status: 404})));
    const view = document.createElement('subject-view') as SubjectView;
    view.subject = {kind: 'individuals', id: '0000101'};
    document.body.append(view);
    await view.updateComplete;
    await new Promise(r => setTimeout(r, 0));
    await view.updateComplete;
    const events: string[] = [];
    for (const type of ['open-subject', 'go-to-occurrence', 'close-subject'])
      document.body.addEventListener(type, e => events.push(`${type} ${JSON.stringify((e as CustomEvent).detail ?? null)}`));
    const link = (href: string, cls = '') => {
      const a = document.createElement('a');
      a.href = href;
      if (cls) a.className = cls;
      view.shadowRoot!.append(a);
      return a;
    };
    return {view, events, link};
  };

  it('opens another animal or matriline here, and moves the map for Last reported', async () => {
    const {events, link} = await mounted();
    link('/matrilines/0002163/T065As').click();
    link('/?d=2026-10-25&o=maplify%3A262674').click();
    expect(events).toEqual([
      'open-subject {"kind":"matrilines","id":"0002163"}',
      'go-to-occurrence {"date":"2026-10-25","occurrenceId":"maplify:262674"}',
    ]);
  });

  it('leaves alone a link it cannot show, one to the full page, and one opened in a new tab', async () => {
    const {events, link} = await mounted();
    link('/pods/0000020/J-pod').click();
    link('/individuals/0000101/J035', 'full-page').click();
    link('/individuals/0000101/J035', 'full-page-link').click();
    link('/individuals/0000102/J036').dispatchEvent(new MouseEvent('click', {bubbles: true, composed: true, metaKey: true}));
    expect(events).toEqual([]);
  });

  it("says when the subject couldn't be loaded, and its page link leaves the map", async () => {
    const {view} = await mounted();
    const link = view.shadowRoot!.querySelector<HTMLAnchorElement>('a.full-page-link');
    expect(view.shadowRoot!.textContent).toMatch(/Couldn't load this animal/);
    expect(link?.getAttribute('href')).toBe('/individuals/0000101');
  });

  it('asks to close from its Back button', async () => {
    const {view, events} = await mounted();
    view.shadowRoot!.querySelector<HTMLButtonElement>('nav.back button')!.click();
    expect(events).toEqual(['close-subject null']);
  });
});
