// @vitest-environment jsdom
/**
 * The photo list's three silent failures (bd salish-8q9, salish-jo5, salish-16b).
 *
 * Each of these was invisible from the outside: no exception, no message, just
 * a Save button that would not enable or a photo that would not go away. They
 * are grouped here because one change fixes all three — referring to a photo by
 * a stable id rather than by its index or its object.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const uploads = vi.hoisted(() => ({
  /** Resolve or reject each file's upload by name; default is instant success. */
  behaviour: new Map<string, () => Promise<string>>(),
  /** Milliseconds readExif takes per file — the window the race needs. */
  exifDelayMs: 0,
  /** Every file uploadPhoto was actually asked to send. */
  attempted: [] as string[],
}));

vi.mock('./supabase.ts', () => ({
  supabase: () => ({rpc: async () => ({data: null, error: null})}),
}));

vi.mock('@sentry/browser', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@sentry/browser')>()),
  captureException: vi.fn(),
}));

vi.mock('./photo-attachment.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./photo-attachment.ts')>();
  return {
    ...actual,
    photoThumbnail: async (file: File) => `thumb:${file.name}`,
    readExif: async () => {
      // A real macrotask, not a microtask: this is the gap during which an
      // already-finished upload for an EARLIER file lands, which is exactly
      // when the old index-based code corrupted the list.
      await new Promise((r) => setTimeout(r, uploads.exifDelayMs));
      return {};
    },
    uploadPhoto: async (file: File) => {
      uploads.attempted.push(file.name);
      const behaviour = uploads.behaviour.get(file.name);
      return behaviour ? behaviour() : `https://cdn.example/${file.name}`;
    },
  };
});

const { captureException } = await import('@sentry/browser');
const { default: VectorSource } = await import('ol/source/Vector.js');
await import('./sighting-form.ts');
/**
 * The surface these tests drive. `appendPhotos` and `removePhoto` are the
 * component's own public pair; `photos` is its private state, read here because
 * it is the thing all three bugs were about — every one of them left the list
 * in a state the screen could not distinguish from a correct one. Hence the
 * cast through `unknown`, which is the honest way to say "reaching in".
 */
type Form = HTMLElement & {
  sightingId: string;
  photos: readonly {id: string; state: string; url?: string}[];
  appendPhotos(files: File[]): Promise<void>;
  removePhoto(photo: {id: string}): void;
};

const jpeg = (name: string) => new File([new Uint8Array([1, 2, 3])], name, {type: 'image/jpeg'});
const settle = () => new Promise((r) => setTimeout(r, 20));

let el: Form;
beforeEach(async () => {
  uploads.behaviour.clear();
  uploads.exifDelayMs = 0;
  uploads.attempted = [];
  vi.mocked(captureException).mockClear();
  el = document.createElement('sighting-form') as unknown as Form;
  el.sightingId = 'sighting-under-test';
  // firstUpdated puts the observer/subject/bearing features into the map's
  // drawing source, normally supplied by <obs-map> through context. Nothing
  // here touches the map, but the component will not reach first render
  // without one.
  (el as unknown as {drawingSource: unknown}).drawingSource = new VectorSource();
  document.body.appendChild(el);
  await (el as unknown as {updateComplete: Promise<unknown>}).updateComplete;
});

afterEach(() => {
  document.body.querySelectorAll('sighting-form').forEach((node) => node.remove());
});

describe('adding photos (salish-8q9)', () => {
  test('an upload that lands while a later photo is still being read still settles', async () => {
    // The exact shape of the bug: the first file's upload finishes immediately,
    // while the second file is still in readExif. The old code held an index
    // into a local array copy it had not assigned yet, so this landed past the
    // end of `this.photos` and was then overwritten and lost.
    uploads.exifDelayMs = 10;

    await el.appendPhotos([jpeg('first.jpg'), jpeg('second.jpg')]);
    await settle();

    expect(el.photos.map((p) => p.state)).toEqual(['uploaded', 'uploaded']);
    expect(el.photos.map((p) => p.url)).toEqual([
      'https://cdn.example/first.jpg',
      'https://cdn.example/second.jpg',
    ]);
  });

  test('nothing is left uploading, so Save is reachable', async () => {
    uploads.exifDelayMs = 10;
    await el.appendPhotos([jpeg('a.jpg'), jpeg('b.jpg'), jpeg('c.jpg')]);
    await settle();

    // enableSubmit refuses while any photo is 'uploading' or 'failed'; a photo
    // stranded in 'uploading' made the whole sighting unsaveable.
    expect(el.photos.filter((p) => p.state === 'uploading' || p.state === 'failed')).toEqual([]);
  });

  test('a photo removed while its EXIF is being read is not uploaded at all', async () => {
    // Publishing the photo before its upload starts is what fixes the race, and
    // it also makes the photo removable earlier than it used to be. Nothing
    // downstream may act on a photo the person has since discarded: its EXIF
    // would move their observer marker, and the upload would spend their data.
    uploads.exifDelayMs = 20;
    const adding = el.appendPhotos([jpeg('changed-my-mind.jpg')]);
    await new Promise((r) => setTimeout(r, 5));   // mid-readExif
    el.removePhoto(el.photos[0]!);
    await adding;
    await settle();

    expect(uploads.attempted).toEqual([]);
    expect(el.photos.map((p) => p.state)).toEqual(['removed']);
  });

  test('a photo removed mid-upload stays removed', async () => {
    let release!: (url: string) => void;
    uploads.behaviour.set('slow.jpg', () => new Promise<string>((r) => { release = r; }));

    const adding = el.appendPhotos([jpeg('slow.jpg')]);
    await adding;
    el.removePhoto(el.photos[0]!);
    release('https://cdn.example/slow.jpg');
    await settle();

    expect(el.photos.map((p) => p.state)).toEqual(['removed']);
  });
});

describe('removing photos (salish-jo5)', () => {
  test('a stale photo reference removes nothing, rather than the last photo', async () => {
    await el.appendPhotos([jpeg('keep-me.jpg'), jpeg('and-me.jpg')]);
    await settle();

    // What a rendered <photo-attachment> is holding after the list has been
    // rebuilt beneath it. indexOf gives -1, and toSpliced(-1, …) replaces the
    // LAST element — so this used to delete 'and-me.jpg'.
    el.removePhoto({id: 'an-id-no-longer-in-the-list'});

    expect(el.photos.map((p) => p.state)).toEqual(['uploaded', 'uploaded']);
  });

  test('removing marks the photo asked for, not its neighbour', async () => {
    await el.appendPhotos([jpeg('one.jpg'), jpeg('two.jpg'), jpeg('three.jpg')]);
    await settle();
    const middle = el.photos[1]!;

    el.removePhoto(middle);

    expect(el.photos.find((p) => p.id === middle.id)!.state).toBe('removed');
    expect(el.photos.filter((p) => p.state === 'removed')).toHaveLength(1);
  });
});

describe('a failed upload (salish-16b)', () => {
  test('tells the person and tells Sentry', async () => {
    const reported: string[] = [];
    el.addEventListener('report-error', (e) => reported.push((e as CustomEvent<{message: string}>).detail.message));
    uploads.behaviour.set('doomed.jpg', () => Promise.reject(new Error('network is down')));

    await el.appendPhotos([jpeg('doomed.jpg')]);
    await settle();

    expect(el.photos.map((p) => p.state)).toEqual(['failed']);
    expect(reported).toEqual(["Couldn't upload doomed.jpg. Remove it and try again."]);
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  test('stays quiet about a photo the person already removed', async () => {
    let fail!: (e: Error) => void;
    uploads.behaviour.set('abandoned.jpg', () => new Promise<string>((_, reject) => { fail = reject; }));
    const reported: string[] = [];
    el.addEventListener('report-error', (e) => reported.push((e as CustomEvent<{message: string}>).detail.message));

    await el.appendPhotos([jpeg('abandoned.jpg')]);
    el.removePhoto(el.photos[0]!);
    fail(new Error('network is down'));
    await settle();

    expect(reported).toEqual([]);
    expect(captureException).not.toHaveBeenCalled();
  });
});
