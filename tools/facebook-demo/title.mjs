// A day post's first line, the title Orca Network's staff give it: "Thursday, November 12th
// - ORCAS (Port Susan)", "Tuesday, November 10th - GROUP TWO ORCAS (Possession Sound)",
// "Sunday, November 8 - Baleen whale post for today ~". It gives every report in the post
// its date, and the kind of animal when a report names none. A post whose first line is
// not a dated title (an announcement) is not a day post.

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const TITLE = new RegExp(String.raw`\b(?:mon|tues|wednes|thurs|fri|satur|sun)day,?\s+(${MONTHS.join('|')})\s+(\d{1,2})(?:st|nd|rd|th)?\b\s*[-–—~:]*\s*(.*)$`, 'i');

/**
 * The date and subject of a day post from its first line, or null if it is not a day post.
 * `sentAt` (epoch seconds) supplies the year, which titles leave out.
 * @returns {{date: string, kind: string|null, group: string|null, region: string|null} | null}
 */
export function parseTitle(line, sentAt) {
  const m = TITLE.exec(line ?? '');
  if (!m) return null;
  const month = MONTHS.indexOf(m[1].toLowerCase());
  const sent = new Date(sentAt * 1000);
  // A title from late December sent in early January belongs to the year before.
  const year = sent.getUTCFullYear() - (month === 11 && sent.getUTCMonth() === 0 ? 1 : 0);
  const day = Number(m[2]);
  // "November 32nd" is a typo, not a date: such a post has no title we can read.
  if (new Date(Date.UTC(year, month, day)).getUTCDate() !== day) return null;
  const date = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const rest = m[3];
  const kind = /baleen/i.test(rest) ? 'baleen whales'
    : /southern resident|srkw/i.test(rest) ? 'Southern Resident orcas'
    : /bigg'?s|transient/i.test(rest) ? "Bigg's orcas"
    : /humpback/i.test(rest) ? 'humpbacks'
    : /gr[ae]y whale/i.test(rest) ? 'gray whales'
    : /\borcas?\b/i.test(rest) ? 'orcas'
    : null;
  const group = /\bgroup\s+(\w+)/i.exec(rest)?.[1] ?? null;
  const region = /\(([^)]+)\)/.exec(rest)?.[1] ?? null;
  return { date, kind, group, region };
}
