import { describe, expect, it } from 'vitest';
import { bufferToVec, cosine, vecToBuffer } from '@/lib/vec';

describe('cosine', () => {
  it('computes the dot product for equal-dimension vectors', () => {
    expect(cosine(new Float32Array([1, 0]), new Float32Array([0, 1]))).toBe(0);
    expect(cosine(new Float32Array([3, 4]), new Float32Array([3, 4]))).toBe(25);
    // L2-normalized vector against itself is 1
    const v = new Float32Array([0.6, 0.8]);
    expect(cosine(v, v)).toBeCloseTo(1, 5);
  });

  it('throws on dimension mismatch instead of truncating to a prefix', () => {
    expect(() => cosine(new Float32Array(384), new Float32Array(768))).toThrow(/dimension mismatch/);
    expect(() => cosine(new Float32Array(2), new Float32Array(1))).toThrow(/dimension mismatch/);
  });
});

describe('bufferToVec', () => {
  it('throws a clear error when the buffer is not 4-byte aligned in length', () => {
    expect(() => bufferToVec(Buffer.alloc(6))).toThrow(/multiple of 4/);
    expect(() => bufferToVec(Buffer.alloc(1))).toThrow(/multiple of 4/);
  });

  it('accepts an empty buffer', () => {
    expect(bufferToVec(Buffer.alloc(0))).toHaveLength(0);
  });

  it('round-trips through vecToBuffer', () => {
    const v = new Float32Array([1.5, -2.25, 3.125]);
    expect(Array.from(bufferToVec(vecToBuffer(v)))).toEqual(Array.from(v));
  });
});
