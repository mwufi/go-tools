// "Did you mean": keywords a typo away from what was typed. Pure: no Convex imports.

/** Edit distance counting a swap of two neighbours as one edit (optimal string alignment). */
export function editDistance(a: string, b: string, max = Infinity): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      rowMin = Math.min(rowMin, d[i][j]);
    }
    if (rowMin > max) return max + 1;
  }
  return d[a.length][b.length];
}

/** How many typos we forgive for a word this long. Short words are too easy to confuse. */
const allowed = (len: number) => (len <= 3 ? 0 : len <= 5 ? 1 : 2);

/**
 * Keywords close to `typed` (already normalized), best first. Exact matches are
 * not suggestions, so they're left out.
 */
export function didYouMean(typed: string, keywords: Iterable<string>, limit = 3): string[] {
  const t = typed.trim().toLowerCase().replace(/^go\//, "").replace(/\s+/g, " ");
  const max = allowed(t.length);
  if (!max) return [];
  const scored: [string, number][] = [];
  const seen = new Set<string>();
  for (const k of keywords) {
    if (k === t || seen.has(k)) continue;
    seen.add(k);
    const dist = editDistance(t, k, max);
    if (dist <= max && dist <= allowed(k.length)) scored.push([k, dist]);
  }
  scored.sort((a, b) => a[1] - b[1] || a[0].length - b[0].length || a[0].localeCompare(b[0]));
  return scored.slice(0, limit).map(([k]) => k);
}
