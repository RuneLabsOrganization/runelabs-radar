import { describe, expect, it } from 'vitest';
import { bufferToVec, cosine, vecToBuffer } from '@/lib/vec';

describe('cosine', () => {
  it('computes the dot product for equal-dimension unit vectors', () => {
    expect(cosine(new Float32Array([1, 0]), new Float32Array([0, 1]))).toBe(0);
    // L2-normalized vector against itself is 1
    const v = new Float32Array([0.6, 0.8]);
    expect(cosine(v, v)).toBeCloseTo(1, 5);
  });

  it('renormalizes drifted vectors before the dot product (E1)', () => {
    // JUSTIFICATION for the changed constant: cosine() used to be a raw dot
    // product ([3,4]·[3,4] = 25) that ASSUMED unit-norm inputs; a denormalized
    // embedding silently inflated every threshold comparison. It now repairs
    // drift >±0.05 first, so the same pair scores a true cosine of 1.
    expect(cosine(new Float32Array([3, 4]), new Float32Array([3, 4]))).toBeCloseTo(1, 5);
    // a uniformly scaled twin gives the SAME similarity as the normalized one —
    // the merge decision is identical either way
    const v = new Float32Array([0.6, 0.8]);
    const w = new Float32Array([0.8, -0.6]);
    const scaled = new Float32Array([1.3 * 0.6, 1.3 * 0.8]);
    expect(cosine(scaled, w)).toBeCloseTo(cosine(v, w), 5);
    expect(cosine(scaled, v)).toBeCloseTo(1, 5);
  });

  it('leaves small float drift (within tolerance) and unrepairable vectors alone', () => {
    const barelyOff = new Float32Array([0.6, 0.8]);
    barelyOff[0] *= 1.01; // norm ≈ 1.005 — inside ±0.05, returned as-is
    expect(cosine(barelyOff, barelyOff)).toBeCloseTo(1.01 ** 2 * 0.36 + 0.64, 3);
    // NaN stays NaN (comparisons fail) instead of being "repaired" into garbage
    const nan = new Float32Array([NaN, 0]);
    expect(cosine(nan, new Float32Array([1, 0]))).toBeNaN();
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
