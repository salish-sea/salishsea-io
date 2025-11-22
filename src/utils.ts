export function compactMap<T, U>(collection: T[], fun: (t: T) => U | null | undefined): U[] {
  const us: U[] = [];
  for (const t of collection) {
    const u = fun(t);
    if (u !== null && typeof u !== 'undefined')
      us.push(u);
  }
  return us;
}
