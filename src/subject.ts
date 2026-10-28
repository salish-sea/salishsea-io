/**
 * A subject the map page's sidebar can show in place of the day's list: an animal or a
 * matriline, for now (salish-7ds1.1, epic salish-fwyt). Every subject also has a page of
 * its own; the sidebar's view is the same content, read from the data the read-path build
 * writes beside the page.
 */

/** The kinds of subject the sidebar shows. Others still open their own page. */
export const SUBJECT_KINDS = ['individuals', 'matrilines'] as const;
export type SubjectKind = typeof SUBJECT_KINDS[number];

export interface Subject {
  kind: SubjectKind;
  /** The seven digits of the subject's register identifier, as in its page's address. */
  id: string;
}

/** The URL parameter that names the subject the sidebar shows. */
export const SUBJECT_PARAM = 's';

const isKind = (s: string): s is SubjectKind => (SUBJECT_KINDS as readonly string[]).includes(s);

/** `individuals/0000101` → the subject; anything else → null, so a stale link still shows the map. */
export function parseSubject(value: string | null): Subject | null {
  const match = value?.match(/^([a-z]+)\/(\d{7})$/);
  return match && isKind(match[1]!) ? {kind: match[1], id: match[2]!} : null;
}

export function subjectParam({kind, id}: Subject): string {
  return `${kind}/${id}`;
}

/**
 * A URL's address with the subject's slash left as a slash: `s=individuals/0010082`, not
 * the `s=individuals%2F0010082` that URLSearchParams writes. A slash needs no escaping in
 * a query, and a link people read or paste should look like the page's own address.
 */
export function readableSubject(url: URL): string {
  return url.toString().replace(new RegExp(`([?&]${SUBJECT_PARAM}=[a-z]+)%2F(\\d{7})(?=&|#|$)`), '$1/$2');
}

export function sameSubject(a: Subject | null, b: Subject | null): boolean {
  return a === b || (!!a && !!b && a.kind === b.kind && a.id === b.id);
}

/**
 * The subject a link on our own site goes to, when the sidebar can show it: a page
 * address keyed by a register identifier (decision 034), such as
 * `/individuals/0000101/J035`. A designation-shaped legacy address, another kind of
 * page, or another site is not one.
 */
export function subjectFromHref(href: string, base = window.location.origin): Subject | null {
  let url: URL;
  try {
    url = new URL(href, base);
  } catch {
    return null;
  }
  if (url.origin !== new URL(base).origin) return null;
  const match = url.pathname.match(/^\/([a-z]+)\/(\d{7})(?:\/[^/]*)?\/?$/);
  return match && isKind(match[1]!) ? {kind: match[1], id: match[2]!} : null;
}

/**
 * The anchor a click landed on, if the page may handle the click itself: a plain click
 * with the first button and no modifier key, not already handled, on a link that isn't
 * meant for a new tab. Otherwise null, and the click opens the link as any click does.
 * The sighting cards and the subject view both use it, so they can't disagree.
 */
export function interceptableAnchor(event: MouseEvent): HTMLAnchorElement | null {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  const anchor = event.composedPath().find((n): n is HTMLAnchorElement => n instanceof HTMLAnchorElement);
  return anchor && anchor.target !== '_blank' && !anchor.hasAttribute('download') ? anchor : null;
}

/**
 * A click on a link to an animal or a matriline, a chip or one in a report's text, opens
 * it in the map page's sidebar rather than leaving the map (salish-7ds1.1). With a
 * modifier key, or a button other than the first, it opens the page as any link does.
 * The sighting cards and a segment's card both listen with it (salish-fwyt.5).
 */
export function openAnimalLinkInSidebar(event: MouseEvent): void {
  const anchor = interceptableAnchor(event);
  const subject = anchor ? subjectFromHref(anchor.getAttribute('href') ?? '') : null;
  if (!subject) return;
  event.preventDefault();
  // From the link, so the page knows where focus goes when the subject closes.
  anchor!.dispatchEvent(new CustomEvent<Subject>('open-subject', {bubbles: true, composed: true, detail: subject}));
}

/** Where a "Last reported" link points: a day on the map, and the sighting to select. */
export interface OccurrenceTarget {
  date: string;
  occurrenceId: string;
}

/** A link on the map page to a day and a sighting, as `mapUrl` writes them: `/?d=2026-10-24&o=maplify%3A1`. */
export function occurrenceFromHref(href: string, base = window.location.origin): OccurrenceTarget | null {
  let url: URL;
  try {
    url = new URL(href, base);
  } catch {
    return null;
  }
  if (url.origin !== new URL(base).origin || url.pathname !== '/') return null;
  const date = url.searchParams.get('d');
  const occurrenceId = url.searchParams.get('o');
  return date && /^\d{4}-\d{2}-\d{2}$/.test(date) && occurrenceId ? {date, occurrenceId} : null;
}

/** Where the build writes a subject's page data and its sighting links, under the read-path files. */
export function subjectDataPath({kind, id}: Subject): string {
  return `profiles/${kind}/${id}.json`;
}

export function subjectLinksPath({kind, id}: Subject): string {
  return `profiles/${kind}/${id}.links.json`;
}

/**
 * A page's data as JSON. The pages' data holds `Map`s (a profile's groups by id), which
 * JSON has no form for, so a map is written as `{"$map": [[key, value], …]}` and read
 * back as a `Map`. The build writes with {@link encodeSubjectData}; the sidebar reads
 * with {@link decodeSubjectData}.
 */
export function encodeSubjectData(data: unknown): string {
  return JSON.stringify(data, (_key, value) => value instanceof Map ? {$map: [...value]} : value);
}

export function decodeSubjectData<T>(json: string): T {
  return JSON.parse(json, (_key, value) =>
    value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 1 && Array.isArray(value.$map)
      ? new Map(value.$map)
      : value) as T;
}
