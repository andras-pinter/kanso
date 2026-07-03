import { describe, expect, it } from 'vitest';
import { __palette, tagChipStyle } from '../tagChipStyle';

// WCAG relative luminance + contrast ratio, sRGB.
function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

// Approximate chroma proxy in sRGB space: distance from the achromatic
// axis, normalized. Cheap way to assert "tinted-neutral": backgrounds
// must be close to neutral, foregrounds a bit further but still muted.
function chromaProxy(hex: string): number {
  const [r, g, b] = rgb(hex);
  const mean = (r + g + b) / 3;
  const dev = Math.sqrt(((r - mean) ** 2 + (g - mean) ** 2 + (b - mean) ** 2) / 3);
  return dev / 255;
}

describe('tagChipStyle', () => {
  it('is deterministic across calls', () => {
    for (const id of ['a', 'tag-42', 'f1b3d9c0-ffff-4000-8000-000000000000']) {
      expect(tagChipStyle(id)).toEqual(tagChipStyle(id));
    }
  });

  it('hashes on id, not name (rename-safe)', () => {
    // Same id -> same style regardless of external context.
    const idA = 'tag-uuid-1';
    const idB = 'tag-uuid-2';
    expect(tagChipStyle(idA)).toEqual(tagChipStyle(idA));
    // Different ids should usually diverge; assert they can differ on a
    // handful of well-chosen inputs so the palette isn't degenerate.
    const distinct = new Set(
      Array.from({ length: 30 }, (_, i) => JSON.stringify(tagChipStyle(`t-${i}`))),
    );
    expect(distinct.size).toBeGreaterThan(1);
    // Rename-safe means the function depends only on the id argument -
    // there is no external state that could vary. Trivially demonstrated
    // by the deterministic assertion above, but keep the id/name split
    // explicit for future readers.
    expect(tagChipStyle(idA)).not.toEqual(tagChipStyle(idB));
  });

  it('covers every palette entry across many ids', () => {
    const hit = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const style = tagChipStyle(`id-${i}`);
      const idx = __palette.findIndex(
        (p) => p.background === style.background && p.color === style.color,
      );
      expect(idx).toBeGreaterThanOrEqual(0);
      hit.add(idx);
      if (hit.size === __palette.length) break;
    }
    expect(hit.size).toBe(__palette.length);
  });

  it('every palette pair clears WCAG AA (>= 4.5:1)', () => {
    for (const pair of __palette) {
      const ratio = contrast(pair.background, pair.color);
      expect(
        ratio,
        `pair bg=${pair.background} fg=${pair.color} contrast=${ratio.toFixed(2)}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('palette has at least 16 pairs (broadened from the original 10)', () => {
    expect(__palette.length).toBeGreaterThanOrEqual(16);
  });

  it('every palette entry is a unique bg/fg pair', () => {
    const keys = __palette.map((p) => `${p.background}|${p.color}`);
    expect(new Set(keys).size).toBe(__palette.length);
    // Backgrounds alone must also be distinct so two adjacent hash
    // buckets never render the same chip color.
    const bgs = __palette.map((p) => p.background);
    expect(new Set(bgs).size).toBe(__palette.length);
  });

  it('backgrounds stay in the tinted-neutral register (chroma proxy <= 0.08)', () => {
    // DESIGN.md hard constraint: chips must not compete with the accent
    // color for attention. Anything saturated breaks that.
    for (const pair of __palette) {
      const c = chromaProxy(pair.background);
      expect(c, `bg=${pair.background} chroma=${c.toFixed(3)}`).toBeLessThanOrEqual(0.08);
    }
  });

  it('foregrounds stay muted (chroma proxy <= 0.15)', () => {
    // Foregrounds carry more chroma than backgrounds but must still read
    // as tinted-dark. The threshold is intentionally loose — the real
    // constraint is authored in OKLCH (C ≤ 0.08); this sRGB proxy just
    // catches accidental fully-saturated entries.
    for (const pair of __palette) {
      const c = chromaProxy(pair.color);
      expect(c, `fg=${pair.color} chroma=${c.toFixed(3)}`).toBeLessThanOrEqual(0.15);
    }
  });

  it('spans a broad hue range across backgrounds (not clustered)', () => {
    // The palette used to cluster in a narrow tinted-neutral band. After
    // the broadening pass, the maximum pairwise Euclidean RGB distance
    // between backgrounds must be meaningfully larger than a monochrome
    // set would produce.
    let maxDist = 0;
    for (let i = 0; i < __palette.length; i++) {
      for (let j = i + 1; j < __palette.length; j++) {
        const a = rgb(__palette[i]!.background);
        const b = rgb(__palette[j]!.background);
        const d = Math.sqrt(
          (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2,
        );
        if (d > maxDist) maxDist = d;
      }
    }
    expect(maxDist).toBeGreaterThanOrEqual(40);
  });
});
