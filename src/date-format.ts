/**
 * A date in words, from one formatter per format.
 *
 * `date.toLocaleString('en-US', options)` builds a new Intl.DateTimeFormat on every
 * call, and building one is native ICU work whose memory the garbage collector does
 * not see. The prerendered profile pages (decision 057) format tens of thousands of
 * dates — every presence-table cell has a title — and doing it that way grew the
 * haul-out render past a gigabyte and took the Fly machine down. Six formats cover
 * every profile page; each is built once here.
 */

import { Intl as TemporalIntl, type Temporal } from 'temporal-polyfill';

const formats = new Map<string, InstanceType<typeof TemporalIntl.DateTimeFormat>>();

/** What `date.toLocaleString('en-US', options)` writes. */
export function formatDate(date: Temporal.PlainDate, options: Intl.DateTimeFormatOptions): string {
  const key = JSON.stringify(options);
  let format = formats.get(key);
  if (!format) formats.set(key, format = new TemporalIntl.DateTimeFormat('en-US', options));
  return format.format(date);
}
