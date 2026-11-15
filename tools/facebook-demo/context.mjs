// Which animals a report means when it names none: "They have turned west at Camano Head"
// means the T137s that the post (or the comment it answers) named. Orca Network's staff
// update the day's post as they learn who the animals are ("EDIT W/ IDs - T137s"), so the
// post's text as it stands is the best guess, as long as everything it names is of one kind.
// The page shows these apart from what a report's own text names.

/** What a row's own text names: present codes and pods, as the page writes them. */
export function ownNames(row) {
  const reading = JSON.parse(row.reading ?? '{}');
  return [
    ...(reading.claims ?? []).filter((c) => c.presence !== 'absent').map((c) => ({ kind: kindOf(c.code), label: c.code + (c.certainty !== 'certain' ? '?' : '') })),
    ...(reading.pods ?? []).map((p) => ({ kind: 'JKL', label: `${p} pod` })),
  ];
}

/**
 * What a code's letters say it is: the same letters are one kind. J, K and L are one kind
 * (the pods travel together), and the three prefixes of the BC humpback catalogue are one.
 * This compares letters; it makes no claim about what they stand for.
 */
export function kindOf(code) {
  const letters = /^[A-Z]+/.exec(code)?.[0] ?? code;
  if (/^[JKL]$/.test(letters)) return 'JKL';
  if (/^BC[XYZ]$/.test(letters)) return 'BC';
  return letters;
}

/** Whether a row says anything a sighting says: a time, a heading, a behaviour or a place. */
function saysSighting(row) {
  const reading = JSON.parse(row.reading ?? '{}');
  return !!(row.clock || reading.direction || reading.behaviour?.length || JSON.parse(row.places ?? '[]').length);
}

/**
 * For one post's rows, the animals each row means but doesn't name, by row key:
 * { labels, from: 'post' | 'comment' }. Only rows that say something a sighting says get
 * one: "Thank you" means no animals. `standing` is the set of standing texts to skip.
 */
export function contextFor(rows, standing = new Set()) {
  const live = rows.filter((r) => !standing.has(r.text));
  const postNames = live.filter((r) => r.kind === 'line' && !r.gone).flatMap(ownNames);
  const kinds = new Set(postNames.map((n) => n.kind));
  const fromPost = kinds.size === 1 ? [...new Set(postNames.map((n) => n.label))] : [];
  const byComment = new Map(live.filter((r) => r.comment_id).map((r) => [r.comment_id, r]));

  const out = new Map();
  for (const r of live) {
    if (ownNames(r).length || !saysSighting(r)) continue;
    const parent = r.kind === 'reply' ? byComment.get(r.reply_to) : null;
    const parentNames = parent ? [...new Set(ownNames(parent).map((n) => n.label))] : [];
    if (parentNames.length) out.set(r.key, { labels: parentNames, from: 'comment' });
    else if (fromPost.length) out.set(r.key, { labels: fromPost, from: 'post' });
  }
  return out;
}
