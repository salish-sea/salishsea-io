// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import './error-toast.ts';
import ErrorToast, { DISMISS_AFTER_MS } from './error-toast.ts';

const mount = async () => {
  const toast = document.createElement('error-toast') as ErrorToast;
  document.body.append(toast);
  await toast.updateComplete;
  return toast;
};
const text = (toast: ErrorToast) => toast.shadowRoot?.querySelector('p')?.textContent ?? null;

describe('error-toast', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it('renders nothing until something fails', async () => {
    const toast = await mount();
    expect(toast.shadowRoot?.querySelector('.toast')).toBeNull();
  });

  it('shows a message and clears itself once the action is stale', async () => {
    const toast = await mount();
    toast.show('Something broke');
    await toast.updateComplete;
    expect(text(toast)).toBe('Something broke');

    vi.advanceTimersByTime(DISMISS_AFTER_MS - 1);
    await toast.updateComplete;
    expect(text(toast)).toBe('Something broke');

    vi.advanceTimersByTime(1);
    await toast.updateComplete;
    expect(toast.shadowRoot?.querySelector('.toast')).toBeNull();
  });

  it('keeps a persistent message up, because the condition is still true', async () => {
    const toast = await mount();
    toast.show('Sightings did not load', {persist: true});
    await toast.updateComplete;

    vi.advanceTimersByTime(DISMISS_AFTER_MS * 10);
    await toast.updateComplete;
    expect(text(toast)).toBe('Sightings did not load');
  });

  it('replaces rather than stacks, and the newest failure restarts the clock', async () => {
    const toast = await mount();
    toast.show('First');
    vi.advanceTimersByTime(DISMISS_AFTER_MS - 100);
    toast.show('Second');
    await toast.updateComplete;

    expect(toast.shadowRoot?.querySelectorAll('.toast')).toHaveLength(1);
    expect(text(toast)).toBe('Second');

    // Had the first timer survived, this would have cleared the second message.
    vi.advanceTimersByTime(200);
    await toast.updateComplete;
    expect(text(toast)).toBe('Second');
  });

  it('dismisses on click, including a persistent one', async () => {
    const toast = await mount();
    toast.show('Sightings did not load', {persist: true});
    await toast.updateComplete;

    toast.shadowRoot?.querySelector('button')?.click();
    await toast.updateComplete;
    expect(toast.shadowRoot?.querySelector('.toast')).toBeNull();
  });

  it('announces itself to assistive tech', async () => {
    const toast = await mount();
    toast.show('Something broke');
    await toast.updateComplete;
    const region = toast.shadowRoot!.querySelector('.toast')!;
    expect(region.getAttribute('role')).toBe('status');
    expect(region.getAttribute('aria-live')).toBe('polite');
  });
});
