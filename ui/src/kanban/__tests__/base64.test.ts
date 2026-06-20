import { describe, expect, it } from 'vitest';
import { base64ToBytes, bytesToBase64 } from '../base64';

describe('base64 helpers', () => {
  it('roundtrips a full byte range', () => {
    const bytes = new Uint8Array(256);
    for (let i = 0; i < 256; i += 1) bytes[i] = i;
    const b64 = bytesToBase64(bytes);
    const back = base64ToBytes(b64);
    expect(back.length).toBe(bytes.length);
    expect(Array.from(back)).toEqual(Array.from(bytes));
  });

  it('handles empty input', () => {
    expect(bytesToBase64(new Uint8Array())).toBe('');
    expect(base64ToBytes('').length).toBe(0);
  });

  it('matches canonical base64 (RFC 4648 STANDARD)', () => {
    const bytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    expect(bytesToBase64(bytes)).toBe('3q2+7w==');
  });

  it('handles large buffers above the chunk size', () => {
    const size = 0x8000 * 3 + 17;
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i += 1) bytes[i] = (i * 31) & 0xff;
    const back = base64ToBytes(bytesToBase64(bytes));
    expect(back.length).toBe(size);
    // spot-check a few positions to avoid O(N) comparison cost
    expect(back[0]).toBe(bytes[0]);
    expect(back[size - 1]).toBe(bytes[size - 1]);
    expect(back[size >> 1]).toBe(bytes[size >> 1]);
  });
});
