import { describe, it, expect } from 'vitest';
import { geolocationMessage } from './geolocation-message.ts';

describe('geolocationMessage', () => {
  it('names the browser when permission was denied, because that is what the user can change', () => {
    expect(geolocationMessage({code: 1}, 'show your location'))
      .toBe("Couldn't show your location — your browser is blocking location access for this site.");
  });

  it('distinguishes no fix from a refusal', () => {
    expect(geolocationMessage({code: 2}, 'place your marker'))
      .toBe("Couldn't place your marker — your device couldn't work out where you are.");
  });

  it('invites a retry on timeout, the one failure that often clears itself', () => {
    expect(geolocationMessage({code: 3}, 'show your location'))
      .toBe("Couldn't show your location — finding you took too long. Please try again.");
  });

  it('falls back rather than dropping the message for an unknown code', () => {
    expect(geolocationMessage({code: 99}, 'show your location'))
      .toBe("Couldn't show your location — your location is unavailable.");
  });
});
