// Client/web-safe vector helpers — no ONNX/transformers imports here.

export function vecToBuffer(v: Float32Array): Buffer {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
}

export function bufferToVec(buf: Buffer): Float32Array {
  if (buf.byteLength % 4 !== 0) {
    throw new Error(`bufferToVec: byte length ${buf.byteLength} is not a multiple of 4 (corrupt embedding?)`);
  }
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

/**
 * How far an embedding's L2 norm may drift from 1 before cosine() repairs it.
 * MiniLM fp32 output lands within ~1e-6; ±0.05 absorbs float noise without
 * masking real denormalization.
 */
export const NORM_TOLERANCE = 0.05;

let normRepairLogged = false;

/**
 * Returns v unchanged when its norm is within NORM_TOLERANCE of 1; otherwise a
 * renormalized copy (v itself is never mutated — callers keep their pooled
 * vectors). Zero/NaN norms can't be repaired and pass through as-is: a NaN
 * vector must STAY NaN so comparisons fail and writers can refuse to persist
 * it. Logs once per process — a repair means the embedding pipeline regressed.
 */
function asUnit(v: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
  const norm = Math.sqrt(sum);
  if (!Number.isFinite(norm) || norm === 0 || Math.abs(norm - 1) <= NORM_TOLERANCE) return v;
  if (!normRepairLogged) {
    normRepairLogged = true;
    console.warn(`[vec] denormalized embedding (norm ${norm.toFixed(4)}) repaired — further repairs logged only at debug level`);
  }
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / norm;
  return out;
}

/**
 * Cosine similarity. Embeddings are supposed to be L2-normalized at write time
 * (MiniLM normalize:true), so the dot product suffices — but nothing enforced
 * that, and a denormalized vector silently inflated/deflated every threshold
 * comparison it touched (the 0.87 merge bar). Drifted inputs are renormalized
 * defensively (see asUnit), so this is a true cosine for any finite input.
 */
export function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`cosine: dimension mismatch ${a.length} vs ${b.length} (embedding model changed?)`);
  }
  const ua = asUnit(a);
  const ub = asUnit(b);
  let dot = 0;
  for (let i = 0; i < ua.length; i++) dot += ua[i] * ub[i];
  return dot;
}
