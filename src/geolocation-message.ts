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
