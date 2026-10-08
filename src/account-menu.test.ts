// @vitest-environment jsdom
import { ContextProvider } from '@lit/context';
import { afterEach, describe, expect, it } from 'vitest';
import './account-menu.ts';
import type { AccountMenu } from './account-menu.ts';
import { contributorContext, userContext } from './identity.ts';
import type { Contributor, Occurrence } from './types.ts';

/** The menu inside a provider of who is signed in, as `<salish-sea>` provides it. */
async function mount(signedIn: Partial<Contributor> | null, lastOwnOccurrence: Partial<Occurrence> | null = null) {
  const host = document.createElement('div');
  new ContextProvider(host, { context: userContext, initialValue: signedIn ? { id: 'u1' } : undefined });
  new ContextProvider(host, { context: contributorContext, initialValue: (signedIn ?? undefined) as Contributor | undefined });
  document.body.append(host);
  const menu = document.createElement('account-menu') as AccountMenu;
  menu.lastOwnOccurrence = lastOwnOccurrence as Occurrence | null;
  host.append(menu);
  await menu.updateComplete;
  return menu;
}

const $ = (menu: AccountMenu, selector: string) => menu.shadowRoot!.querySelector<HTMLElement>(selector);
const rows = (menu: AccountMenu) => [...menu.shadowRoot!.querySelectorAll('.row')].map(r => r.textContent!.replace(/\s+/g, ' ').trim());

async function open(menu: AccountMenu) {
  $(menu, '.account')!.click();
  await menu.updateComplete;
}

/** The next event of this type the menu raises. */
const next = (menu: AccountMenu, type: string) => new Promise<Event>(resolve => menu.addEventListener(type, resolve, { once: true }));

describe('account-menu (GH #644)', () => {
  afterEach(() => document.body.replaceChildren());

  it('signed out: an outline person, and a menu that offers to sign in, raising log-in', async () => {
    const menu = await mount(null);
    expect($(menu, '.account img')).toBeNull();
    expect($(menu, '.account')!.getAttribute('aria-label')).toBe('Account');
    expect($(menu, '.menu')).toBeNull();
    await open(menu);
    expect(rows(menu)).toEqual(['Sign in with Google']);
    const raised = next(menu, 'log-in');
    $(menu, '.row')!.click();
    expect((await raised).bubbles).toBe(true);
    await menu.updateComplete;
    expect($(menu, '.menu')).toBeNull();
  });

  it('signed in: your picture, your name, your last sighting, and sign out, raising log-out', async () => {
    const last = { id: 'native:1', observed_at: '2026-10-06T20:00:00+00:00' };
    const menu = await mount({ name: 'Peter', picture: 'https://example.org/p.jpg', editor: true }, last);
    expect($(menu, '.account img.avatar')!.getAttribute('src')).toBe('https://example.org/p.jpg');
    expect($(menu, '.account')!.getAttribute('aria-label')).toBe('Account: Peter');
    await open(menu);
    expect($(menu, '.identity')!.textContent!.replace(/\s+/g, ' ').trim()).toBe('Peter Editor');
    expect(rows(menu)).toEqual(['Your last sighting · Oct 6, 2026', 'Sign out']);
    const focused = next(menu, 'focus-occurrence');
    ($(menu, '.row') as HTMLButtonElement).click();
    expect((await focused as CustomEvent).detail).toBe(last);
    await open(menu);
    const out = next(menu, 'log-out');
    (menu.shadowRoot!.querySelectorAll('.row')[1] as HTMLButtonElement).click();
    await out;
  });

  it('a picture that will not load gives way to the outline person', async () => {
    const menu = await mount({ name: 'Peter', picture: 'https://example.org/gone.jpg', editor: false });
    $(menu, '.account img')!.dispatchEvent(new Event('error'));
    await menu.updateComplete;
    expect($(menu, '.account img')).toBeNull();
    expect($(menu, '.account svg')).not.toBeNull();
  });

  it('a new picture is tried even after another failed', async () => {
    const menu = await mount({ name: 'Peter', picture: 'https://example.org/gone.jpg', editor: false });
    $(menu, '.account img')!.dispatchEvent(new Event('error'));
    await menu.updateComplete;
    (menu as unknown as { contributor: Partial<Contributor> }).contributor = { name: 'Peter', picture: 'https://example.org/new.jpg' };
    await menu.updateComplete;
    expect($(menu, '.account img')!.getAttribute('src')).toBe('https://example.org/new.jpg');
  });

  it('a click elsewhere, or Escape, closes the menu', async () => {
    const menu = await mount(null);
    await open(menu);
    document.body.click();
    await menu.updateComplete;
    expect($(menu, '.menu')).toBeNull();
    await open(menu);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await menu.updateComplete;
    expect($(menu, '.menu')).toBeNull();
  });
});
