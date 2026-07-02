// Deterministic tag chip coloring. Hash on tag.id (rename-safe, spatial-memory
// preserved) with FNV-1a 32-bit -> curated 10-pair tinted-neutral palette.
// Every pair clears WCAG AA 4.5:1 contrast (see tagChipStyle.test.ts).

export interface TagChipStyle {
  background: string;
  color: string;
}

// Curated palette: soft tinted backgrounds paired with deep desaturated
// foregrounds. Backgrounds sit near L*95 in the tinted-neutral register;
// foregrounds near L*30. Hex-baked so we sidestep WebKit OKLCH quirks in
// Tauri. Chosen to read acceptably on both light and dark app surfaces.
const PALETTE: readonly TagChipStyle[] = [
  { background: '#eceff4', color: '#2e3440' }, // slate
  { background: '#efe6d9', color: '#5c4326' }, // sand
  { background: '#e2ebe1', color: '#2f4a3a' }, // sage
  { background: '#e2e8f0', color: '#243b5e' }, // steel
  { background: '#ede2e8', color: '#5a2f44' }, // rose
  { background: '#dfe7e6', color: '#264a49' }, // teal
  { background: '#ebe3ea', color: '#432f52' }, // mauve
  { background: '#e9e6d7', color: '#4a4222' }, // olive
  { background: '#e1e8ea', color: '#2f434b' }, // mist
  { background: '#ece0db', color: '#5b3421' }, // terracotta
] as const;

// FNV-1a 32-bit over UTF-8 bytes of `tagId`. Zero-dep, deterministic, and
// distributes short ASCII (UUIDs, ULIDs) evenly across the palette.
function fnv1a(str: string): number {
  let hash = 0x811c9dc5;
  const bytes = new TextEncoder().encode(str);
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i]!;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export function tagChipStyle(tagId: string): TagChipStyle {
  const idx = fnv1a(tagId) % PALETTE.length;
  return PALETTE[idx]!;
}

// Exported for tests only.
export const __palette = PALETTE;
