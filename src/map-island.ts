/**
 * The one script a prerendered profile page loads (decision 057): it defines
 * <individual-map>, which upgrades inside the page's declarative shadow root and
 * loads its dots from its `src`. Nothing else on the page needs the browser, so
 * nothing else is imported here — no Sentry, no Supabase client.
 */

import './individual-map.ts';
