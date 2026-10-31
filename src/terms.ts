/**
 * The terms of use a contributor agrees to (decision 086, #739): sightings submitted to
 * SalishSea.io are published under CC BY 4.0. The page is /terms.html. A change to the
 * terms that affects what contributors grant moves the version, and each contributor is
 * asked again; the build publishes a contributor's sightings beyond the site only once
 * they have agreed to some version.
 */
export const TERMS_VERSION = 1;
export const TERMS_PATH = '/terms.html';

/** Whether a contributor who agreed to `agreed` (null: never) has agreed to the current terms. */
export const agreedToCurrent = (agreed: number | null | undefined) => (agreed ?? 0) >= TERMS_VERSION;
