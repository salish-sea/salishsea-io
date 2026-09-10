/**
 * What to tell someone whose browser declined to say where they are.
 *
 * Two controls ask for a location — the map's `user-location-control` and the
 * report form's "My location" button — and both fail in exactly the same three
 * ways, so they say the same three things. The distinction that matters to the
 * person is whether the browser refused (they can change that), the device
 * couldn't get a fix (they can move), or it simply took too long (they can try
 * again); an undifferentiated "location failed" leaves all three looking like a
 * broken button.
 *
 * `action` completes "Couldn't …" — a verb phrase naming what the click was
 * going to do, e.g. `'show your location'`.
 */
/**
 * Whether a geolocation failure is ours to count.
 *
 * PERMISSION_DENIED is a choice the visitor is entitled to make: the browser
 * asked, they said no, and the toast tells them so. That is the feature
 * working, and a Sentry issue about it is one nobody can act on (it was
 * SALISHSEA-IO-3H, bd salish-ogb). POSITION_UNAVAILABLE and TIMEOUT are the
 * device failing — not defects either, but a device with no fix, or the 5s
 * timeout the report form chose, can point at something real, so they stay
 * counted. Decision 031 records the exception.
 */
export function geolocationErrorIsReportable(error: {code: number}): boolean {
  return error.code !== 1;
}

export function geolocationMessage(error: {code: number}, action: string): string {
  // Spelled out rather than read off the `GeolocationPositionError` global:
  // jsdom doesn't implement the Geolocation API, so the global isn't there to
  // read from under test even though the type is.
  switch (error.code) {
    case 1: // PERMISSION_DENIED
      return `Couldn't ${action} — your browser is blocking location access for this site.`;
    case 2: // POSITION_UNAVAILABLE
      return `Couldn't ${action} — your device couldn't work out where you are.`;
    case 3: // TIMEOUT
      return `Couldn't ${action} — finding you took too long. Please try again.`;
    default:
      return `Couldn't ${action} — your location is unavailable.`;
  }
}
