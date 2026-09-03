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

/** Cosine similarity for L2-normalized vectors (= dot product). */
export function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`cosine: dimension mismatch ${a.length} vs ${b.length} (embedding model changed?)`);
  }
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}
