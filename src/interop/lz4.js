const MAX_OUTPUT = 200 * 1024 * 1024;

export function lz4Decompress(src, expectedLength) {
  const n = src.length >>> 0;
  const outLen = expectedLength >>> 0;
  if (outLen > MAX_OUTPUT) throw new Error("Bloco LZ4 excede o limite de saída.");
  const out = new Uint8Array(outLen);
  let s = 0;
  let d = 0;
  while (s < n) {
    const token = src[s++];
    let lit = token >>> 4;
    if (lit === 15) {
      let b = 255;
      while (b === 255) {
        if (s >= n) throw new Error("LZ4 truncado (literais).");
        b = src[s++];
        lit += b;
      }
    }
    if (s + lit > n || d + lit > outLen) throw new Error("LZ4 inválido (literais fora dos limites).");
    out.set(src.subarray(s, s + lit), d);
    s += lit;
    d += lit;
    if (s >= n) break;
    if (s + 2 > n) throw new Error("LZ4 truncado (offset).");
    const off = src[s] | (src[s + 1] << 8);
    s += 2;
    if (off === 0 || off > d) throw new Error("LZ4 inválido (offset).");
    let ml = (token & 15) + 4;
    if ((token & 15) === 15) {
      let b = 255;
      while (b === 255) {
        if (s >= n) throw new Error("LZ4 truncado (match).");
        b = src[s++];
        ml += b;
      }
    }
    if (d + ml > outLen) throw new Error("LZ4 inválido (match fora dos limites).");
    let m = d - off;
    for (let i = 0; i < ml; i++) out[d++] = out[m++];
  }
  if (d !== outLen) throw new Error("LZ4 inválido (tamanho final não confere).");
  return out;
}

export function lz4Compress(src) {
  const n = src.length >>> 0;
  if (n > MAX_OUTPUT) throw new Error("Bloco LZ4 excede o limite de entrada.");
  if (n === 0) return new Uint8Array([0]);
  const out = new Uint8Array(n + Math.ceil(n / 255) + 16);
  const HASH_BITS = 14;
  const table = new Int32Array(1 << HASH_BITS).fill(-1);
  const mflimit = n - 12;
  const matchlimit = n - 5;
  let s = 0;
  let d = 0;
  let anchor = 0;
  const readU32 = (i) => (src[i] | (src[i + 1] << 8) | (src[i + 2] << 16) | (src[i + 3] << 24)) >>> 0;
  const hash = (v) => Math.imul(v, 2654435761) >>> (32 - HASH_BITS);
  const writeLen = (base) => {
    let rest = base;
    while (rest >= 255) {
      out[d++] = 255;
      rest -= 255;
    }
    out[d++] = rest;
  };
  while (s < mflimit) {
    const seq = readU32(s);
    const h = hash(seq);
    const ref = table[h];
    table[h] = s;
    if (ref < 0 || s - ref > 0xffff || readU32(ref) !== seq) {
      s++;
      continue;
    }
    let ml = 4;
    while (s + ml < matchlimit && src[ref + ml] === src[s + ml]) ml++;
    const lit = s - anchor;
    const mrest = ml - 4;
    const tokenPos = d++;
    out[tokenPos] = ((lit < 15 ? lit : 15) << 4) | (mrest < 15 ? mrest : 15);
    if (lit >= 15) writeLen(lit - 15);
    out.set(src.subarray(anchor, s), d);
    d += lit;
    const off = s - ref;
    out[d++] = off & 0xff;
    out[d++] = (off >> 8) & 0xff;
    if (mrest >= 15) writeLen(mrest - 15);
    s += ml;
    anchor = s;
  }
  const lastLit = n - anchor;
  const tokenPos = d++;
  out[tokenPos] = (lastLit < 15 ? lastLit : 15) << 4;
  if (lastLit >= 15) writeLen(lastLit - 15);
  out.set(src.subarray(anchor, n), d);
  d += lastLit;
  return out.subarray(0, d);
}
