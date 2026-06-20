// Browser-side base64 helpers for the BlockSuite Yjs snapshot.
// Kept tiny + dependency-free; the Tauri webview ships atob/btoa.

export function bytesToBase64(bytes: Uint8Array): string {
  // String.fromCharCode chokes on > ~64k args; chunk to stay safe.
  const CHUNK = 0x8000;
  let bin = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, i + CHUNK);
    bin += String.fromCharCode(...slice);
  }
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}
