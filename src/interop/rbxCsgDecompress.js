const MAXBITS = 15;
const MAXLCODES = 286;
const MAXDCODES = 30;
const FIXLCODES = 288;

const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CLC_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];


function bitsReader(src) {
  return { src, pos: 0, buf: 0, cnt: 0 };
}

function bits(st, need) {
  let val = st.buf;
  while (st.cnt < need) {
    if (st.pos >= st.src.length) throw new Error("deflate truncado (fim no meio dos bits)");
    val |= st.src[st.pos++] << st.cnt;
    st.cnt += 8;
  }
  st.buf = val >>> need;
  st.cnt -= need;
  return val & ((1 << need) - 1);
}


function makeOut(maxOut) {
  return { buf: new Uint8Array(Math.min(maxOut, 1 << 16)), len: 0, maxOut };
}

function ensureOut(o, need) {
  if (need <= o.buf.length) return;
  if (need > o.maxOut) throw new Error("saída descomprimida excede o teto (" + o.maxOut + " bytes)");
  let cap = o.buf.length || 1;
  while (cap < need) cap = Math.min(o.maxOut, cap * 2);
  const nx = new Uint8Array(cap);
  nx.set(o.buf.subarray(0, o.len));
  o.buf = nx;
}


function construct(lengths, n) {
  const counts = new Int32Array(MAXBITS + 1);
  for (let s = 0; s < n; s++) counts[lengths[s]] += 1;
  if (counts[0] === n) return { counts, symbols: new Int32Array(0) };
  let left = 1;
  for (let len = 1; len <= MAXBITS; len++) {
    left <<= 1;
    left -= counts[len];
    if (left < 0) throw new Error("tabela Huffman sobre-assinada");
  }
  const offs = new Int32Array(MAXBITS + 2);
  for (let len = 1; len <= MAXBITS; len++) offs[len + 1] = offs[len] + counts[len];
  const symbols = new Int32Array(n);
  for (let s = 0; s < n; s++) {
    if (lengths[s] !== 0) symbols[offs[lengths[s]]++] = s;
  }
  return { counts, symbols };
}


function decodeSym(st, huff) {
  let code = 0;
  let first = 0;
  let index = 0;
  for (let len = 1; len <= MAXBITS; len++) {
    code |= bits(st, 1);
    const count = huff.counts[len];
    if (code - first < count) return huff.symbols[index + (code - first)];
    index += count;
    first = (first + count) << 1;
    code <<= 1;
  }
  throw new Error("código Huffman inválido");
}


function codesBlock(st, out, lencode, distcode) {
  for (;;) {
    let symbol = decodeSym(st, lencode);
    if (symbol < 256) {
      ensureOut(out, out.len + 1);
      out.buf[out.len++] = symbol;
      continue;
    }
    if (symbol === 256) return;
    symbol -= 257;
    if (symbol >= 29) throw new Error("símbolo de comprimento inválido no deflate");
    const len = LEN_BASE[symbol] + bits(st, LEN_EXTRA[symbol]);
    const dsym = decodeSym(st, distcode);
    if (dsym >= 30) throw new Error("símbolo de distância inválido no deflate");
    const dist = DIST_BASE[dsym] + bits(st, DIST_EXTRA[dsym]);
    if (dist > out.len) throw new Error("distância deflate além do histórico");
    ensureOut(out, out.len + len);
    let from = out.len - dist;
    for (let i = 0; i < len; i++) out.buf[out.len++] = out.buf[from++];
  }
}

function storedBlock(st, out) {
  st.buf = 0;
  st.cnt = 0;                           
  if (st.pos + 4 > st.src.length) throw new Error("bloco stored truncado (LEN/NLEN)");
  const len = st.src[st.pos] | (st.src[st.pos + 1] << 8);
  const nlen = st.src[st.pos + 2] | (st.src[st.pos + 3] << 8);
  if ((len ^ 0xffff) !== nlen) throw new Error("bloco stored com NLEN inconsistente");
  st.pos += 4;
  if (st.pos + len > st.src.length) throw new Error("bloco stored truncado (dados)");
  ensureOut(out, out.len + len);
  out.buf.set(st.src.subarray(st.pos, st.pos + len), out.len);
  out.len += len;
  st.pos += len;
}

let FIXED = null;
function fixedTrees() {
  if (FIXED) return FIXED;
  const lenl = new Uint8Array(FIXLCODES);
  let s = 0;
  for (; s < 144; s++) lenl[s] = 8;
  for (; s < 256; s++) lenl[s] = 9;
  for (; s < 280; s++) lenl[s] = 7;
  for (; s < FIXLCODES; s++) lenl[s] = 8;
  const distl = new Uint8Array(MAXDCODES).fill(5);
  FIXED = { len: construct(lenl, FIXLCODES), dist: construct(distl, MAXDCODES) };
  return FIXED;
}

function dynamicTrees(st) {
  const nlen = bits(st, 5) + 257;
  const ndist = bits(st, 5) + 1;
  const ncode = bits(st, 4) + 4;
  if (nlen > MAXLCODES || ndist > MAXDCODES) throw new Error("contagens dinâmicas fora do range");
  const clen = new Uint8Array(19);
  for (let i = 0; i < ncode; i++) clen[CLC_ORDER[i]] = bits(st, 3);
  const clTree = construct(clen, 19);
  const lengths = new Uint8Array(nlen + ndist);
  let index = 0;
  while (index < nlen + ndist) {
    const symbol = decodeSym(st, clTree);
    if (symbol < 16) {
      lengths[index++] = symbol;
      continue;
    }
    let len = 0;
    let rep;
    if (symbol === 16) {
      if (index === 0) throw new Error("repetição sem comprimento anterior");
      len = lengths[index - 1];
      rep = 3 + bits(st, 2);
    } else if (symbol === 17) {
      rep = 3 + bits(st, 3);
    } else {
      rep = 11 + bits(st, 7);
    }
    if (index + rep > nlen + ndist) throw new Error("repetição estoura as contagens");
    while (rep-- > 0) lengths[index++] = len;
  }
  if (lengths[256] === 0) throw new Error("sem código de fim de bloco");
  return {
    lencode: construct(lengths.subarray(0, nlen), nlen),
    distcode: construct(lengths.subarray(nlen, nlen + ndist), ndist),
  };
}


export function inflateRaw(src, maxOut) {
  if (!(Number.isFinite(maxOut) && maxOut > 0)) throw new Error("inflateRaw: maxOut inválido");          
  const st = bitsReader(src);
  const out = makeOut(maxOut);
  let last = 0;
  do {
    last = bits(st, 1);
    const type = bits(st, 2);
    if (type === 0) storedBlock(st, out);
    else if (type === 1) {
      const f = fixedTrees();
      codesBlock(st, out, f.len, f.dist);
    } else if (type === 2) {
      const d = dynamicTrees(st);
      codesBlock(st, out, d.lencode, d.distcode);
    } else {
      throw new Error("tipo de bloco deflate inválido (3)");
    }
  } while (!last);
  return out.buf.slice(0, out.len);
}

function adler32(u8) {
  let a = 1;
  let b = 0;
  for (let i = 0; i < u8.length; i++) {
    a = (a + u8[i]) % 65521;
    b = (b + a) % 65521;
  }
  return (((b << 16) >>> 0) | a) >>> 0;
}

let CRC_TABLE = null;
function crc32(u8) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}


export function zlibInflate(src, maxOut) {
  if (src.length < 6) throw new Error("zlib: curto demais");
  const cmf = src[0];
  const flg = src[1];
  if ((cmf & 0x0f) !== 8) throw new Error("zlib: método de compressão != deflate");
  if (((cmf << 8) + flg) % 31 !== 0) throw new Error("zlib: FCHECK inválido");
  if (flg & 0x20) throw new Error("zlib: FDICT não suportado");
  const out = inflateRaw(src.subarray(2, src.length - 4), maxOut);
  const p = src.length - 4;
  const want = ((src[p] << 24) | (src[p + 1] << 16) | (src[p + 2] << 8) | src[p + 3]) >>> 0;
  if (adler32(out) !== want) throw new Error("zlib: adler32 não confere");
  return out;
}


export function gunzip(src, maxOut) {
  if (src.length < 18) throw new Error("gzip: curto demais");
  if (src[0] !== 0x1f || src[1] !== 0x8b) throw new Error("gzip: magic inválido");
  if (src[2] !== 8) throw new Error("gzip: método de compressão != deflate");
  const flg = src[3];
  let off = 10;
  if (flg & 0x04) {
    if (off + 2 > src.length) throw new Error("gzip: FEXTRA truncado");
    const xlen = src[off] | (src[off + 1] << 8);
    off += 2 + xlen;
  }
  if (flg & 0x08) {
    while (off < src.length && src[off] !== 0) off++;
    off++;
  }
  if (flg & 0x10) {
    while (off < src.length && src[off] !== 0) off++;
    off++;
  }
  if (flg & 0x02) off += 2;
  if (off >= src.length - 8) throw new Error("gzip: cabeçalho consome o arquivo");
  const out = inflateRaw(src.subarray(off, src.length - 8), maxOut);
  const p = src.length - 8;
  const crc = (src[p] | (src[p + 1] << 8) | (src[p + 2] << 16) | (src[p + 3] << 24)) >>> 0;
  const isize = (src[p + 4] | (src[p + 5] << 8) | (src[p + 6] << 16) | (src[p + 7] << 24)) >>> 0;
  if ((out.length >>> 0) !== isize) throw new Error("gzip: ISIZE não confere");
  if (crc32(out) !== crc) throw new Error("gzip: crc32 não confere");
  return out;
}


export function lz4BlockDecompressUnknown(src, maxOut) {
  if (!(Number.isFinite(maxOut) && maxOut >= 0)) throw new Error("lz4: maxOut inválido");          
  const n = src.length;
  const out = makeOut(Math.max(1, maxOut));
  out.maxOut = maxOut;
  let s = 0;
  while (s < n) {
    const token = src[s++];
    let lit = token >>> 4;
    if (lit === 15) {
      let b = 255;
      while (b === 255) {
        if (s >= n) throw new Error("LZ4: truncado (comprimento de literais)");
        b = src[s++];
        lit += b;
      }
    }
    if (s + lit > n) throw new Error("LZ4: literais fora dos limites");
    ensureOut(out, out.len + lit);
    out.buf.set(src.subarray(s, s + lit), out.len);
    out.len += lit;
    s += lit;
    if (s === n) break;                             
    if (s + 2 > n) throw new Error("LZ4: truncado (offset)");
    const offv = src[s] | (src[s + 1] << 8);
    s += 2;
    if (offv === 0 || offv > out.len) throw new Error("LZ4: offset inválido");
    let ml = token & 0x0f;
    if (ml === 15) {
      let b = 255;
      while (b === 255) {
        if (s >= n) throw new Error("LZ4: truncado (comprimento de match)");
        b = src[s++];
        ml += b;
      }
    }
    ml += 4;
    ensureOut(out, out.len + ml);
    let from = out.len - offv;
    for (let i = 0; i < ml; i++) out.buf[out.len++] = out.buf[from++];
  }
  return out.buf.slice(0, out.len);
}




export function lz4FrameDecompress(src, maxOut) {
  if (src.length < 11) throw new Error("LZ4: frame curto demais");
  if (!(src[0] === 0x04 && src[1] === 0x22 && src[2] === 0x4d && src[3] === 0x18)) {
    throw new Error("LZ4: magic de frame inválido");
  }
  const flg = src[4];
  if ((flg >>> 6) !== 1) throw new Error("LZ4: versão de frame não suportada");
  const hasBChecksum = (flg & 0x10) !== 0;
  const hasCSize = (flg & 0x08) !== 0;
  const hasDictId = (flg & 0x01) !== 0;
  let off = 6;            
  if (hasCSize) {
    const lo = (src[off] | (src[off + 1] << 8) | (src[off + 2] << 16) | (src[off + 3] << 24)) >>> 0;
    const hi = (src[off + 4] | (src[off + 5] << 8) | (src[off + 6] << 16) | (src[off + 7] << 24)) >>> 0;
    if (hi !== 0 || lo > maxOut) throw new Error("LZ4: contentSize acima do teto");
    off += 8;
  }
  if (hasDictId) off += 4;
  off += 1;                                                   
  const out = makeOut(maxOut);
  for (;;) {
    if (off + 4 > src.length) throw new Error("LZ4: frame truncado (blockSize)");
    const raw = (src[off] | (src[off + 1] << 8) | (src[off + 2] << 16) | (src[off + 3] << 24)) >>> 0;
    off += 4;
    if (raw === 0) break;           
    const uncompressed = (raw & 0x80000000) !== 0;
    const bsize = raw & 0x7fffffff;
    if (bsize > 8 * 1024 * 1024) throw new Error("LZ4: bloco maior que o teto de bloco");
    if (off + bsize > src.length) throw new Error("LZ4: bloco fora dos limites");
    const block = src.subarray(off, off + bsize);
    off += bsize;
    if (uncompressed) {
      ensureOut(out, out.len + bsize);
      out.buf.set(block, out.len);
      out.len += bsize;
    } else {
      const dec = lz4BlockDecompressUnknown(block, maxOut - out.len);
      ensureOut(out, out.len + dec.length);
      out.buf.set(dec, out.len);
      out.len += dec.length;
    }
    if (hasBChecksum) off += 4;                                             
  }
  return out.buf.slice(0, out.len);
}


function zBitsReader(src) {
  return { src, pos: 0, buf: 0, cnt: 0 };
}
function zBits(r, n) {
  while (r.cnt < n) {
    if (r.pos >= r.src.length) throw new Error("zstd: truncado (bits)");
    r.buf |= r.src[r.pos++] << r.cnt;
    r.cnt += 8;
  }
  const v = r.buf & ((1 << n) - 1);
  r.buf >>>= n;
  r.cnt -= n;
  return v;
}


function fseBuildTable(freqs, maxSym, log2Size) {
  const tableSize = 1 << log2Size;

  const tbl = new Int32Array(tableSize);
  let pos = 0;
  const step = (tableSize >> 1) + (tableSize >> 3) + 3;
  const mask = tableSize - 1;
  for (let s = 0; s <= maxSym; s++) {
    const f = freqs[s];
    if (f <= 0) continue;
    for (let i = 0; i < f; i++) {
      tbl[pos] = s;
      pos = (pos + step) & mask;
      while (pos >= tableSize - (tableSize >> 3)) pos = (pos + step) & mask;
    }
  }

  const next = new Int32Array(maxSym + 1);
  for (let s = 0; s <= maxSym; s++) next[s] = freqs[s] > 0 ? freqs[s] : 0;
  const dt = new Array(tableSize);
  for (let i = 0; i < tableSize; i++) {
    const s = tbl[i];
    const n = next[s]++;
    let nb = log2Size;
    let threshold = 1 << nb;
    while (n >= threshold) { threshold <<= 1; nb--; }
    dt[i] = { sym: s, nbBits: nb, nextState: (n << nb) - tableSize };
  }
  return dt;
}


function fseReadNormalizedCounters(src, off, maxSym, log2Size) {
  let pos = off;
  const freqs = new Int32Array(maxSym + 2);
  let remaining = 1 << log2Size;
  let threshold = 1 << log2Size;
  const nbBits = log2Size + 1;
  let sym = 0;
  let bitPos = 0;
  let bitBuf = 0;

  function peek(n) {
    while (bitPos < n) {
      if (pos >= src.length) throw new Error("zstd: FSE header truncado");
      bitBuf |= src[pos++] << bitPos;
      bitPos += 8;
    }
    const v = bitBuf & ((1 << n) - 1);
    bitBuf >>>= n;
    bitPos -= n;
    return v;
  }

  while (remaining > 1 && sym <= maxSym) {
    let nb = nbBits;
    if (threshold <= 1) nb = 1;
    let val = peek(nb);
    while ((1 << nb) > threshold * 2) { nb--; val &= (1 << nb) - 1; }
    if (val < threshold) {

    } else {

      val = peek(1) ? val - threshold : val;
    }
    const count = val - 1;                              
    if (count === -1) {
      freqs[sym] = -1;                              
      remaining--;
    } else {
      freqs[sym] = count;
      remaining -= count;
    }
    threshold = 1;
    while (remaining < threshold) { threshold >>= 1; nb--; }
    sym++;
  }
  return { freqs, bytesRead: pos - off };
}


const ZSTD_LITLEN_FREQS_DEFAULT = [4,3,2,2,2,2,2,2,2,2,2,2,2,1,1,1,2,2,2,2,2,2,2,2,2,3,2,4,2,3,2,2];
const ZSTD_MATCHLEN_FREQS_DEFAULT = [1,4,3,2,2,2,2,2,2,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,"-1","-1","-1","-1","-1","-1"].map(v => v === "-1" ? -1 : +v);
const ZSTD_OFFSET_FREQS_DEFAULT = [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1];

const LITLEN_LOG = 6;
const MATCHLEN_LOG = 6;
const OFFSET_LOG = 5;

let _dtLL = null, _dtML = null, _dtOF = null;
function getDefaultTables() {
  if (_dtLL) return { ll: _dtLL, ml: _dtML, of: _dtOF };
  const llFreqs = new Int32Array(36);
  const mlFreqs = new Int32Array(53);
  const ofFreqs = new Int32Array(29);
  const llDef = [4,3,2,2,2,2,2,2,2,2,2,2,2,1,1,1,2,2,2,2,2,2,2,2,2,3,2,4,2,3,2,2];
  const mlDef = [1,4,3,2,2,2,2,2,2,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1];
  const ofDef = [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1];
  for (let i = 0; i < llDef.length; i++) llFreqs[i] = llDef[i];
  for (let i = 0; i < mlDef.length; i++) mlFreqs[i] = mlDef[i];
  for (let i = 0; i < ofDef.length; i++) ofFreqs[i] = ofDef[i];
  _dtLL = fseBuildTable(llFreqs, 35, LITLEN_LOG);
  _dtML = fseBuildTable(mlFreqs, 52, MATCHLEN_LOG);
  _dtOF = fseBuildTable(ofFreqs, 28, OFFSET_LOG);
  return { ll: _dtLL, ml: _dtML, of: _dtOF };
}


const LL_BASE  = [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,18,20,22,24,28,32,40,48,64,128,256,512,1024,2048,4096,8192,16384,32768,65536];
const LL_EXTRA = [0,0,0,0,0,0,0,0,0,0,0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 3, 3, 4, 6,  7,  8,  9,  10,  11,  12,  13,   14,   15,   16];
const ML_BASE  = [3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,37,39,41,43,47,51,59,67,83,99,131,163,227,291,419,547,803,1059,1571,2083];
const ML_EXTRA = [0,0,0,0,0,0,0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 3, 3, 4, 4, 5,   5,   6,   7,   8,   9,  10,  11,  12,  13,  14];
const OF_EXTRA = [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30];


function zstdDecodeCompressedBlock(src, off, blockSize, maxOut, history, outBuf, outLen, seqRepOffsets) {
  const end = off + blockSize;

  if (off >= end) throw new Error("zstd: bloco comprimido vazio");
  const lhByte0 = src[off];
  const litType = lhByte0 & 3;
  let literals;
  let litOff;
  if (litType === 0) {

    const sizeFormat = (lhByte0 >> 2) & 3;
    let litSize, headerBytes;
    if (sizeFormat === 0 || sizeFormat === 2) { litSize = lhByte0 >> 3; headerBytes = 1; }
    else if (sizeFormat === 1) { litSize = (lhByte0 >> 4) | (src[off + 1] << 4); headerBytes = 2; }
    else { litSize = (lhByte0 >> 4) | (src[off + 1] << 4) | (src[off + 2] << 12); headerBytes = 3; }
    litOff = off + headerBytes;
    literals = src.subarray(litOff, litOff + litSize);
    litOff += litSize;
  } else if (litType === 1) {

    const sizeFormat = (lhByte0 >> 2) & 3;
    let litSize, headerBytes;
    if (sizeFormat === 0 || sizeFormat === 2) { litSize = lhByte0 >> 3; headerBytes = 1; }
    else if (sizeFormat === 1) { litSize = (lhByte0 >> 4) | (src[off + 1] << 4); headerBytes = 2; }
    else { litSize = (lhByte0 >> 4) | (src[off + 1] << 4) | (src[off + 2] << 12); headerBytes = 3; }
    const byte = src[off + headerBytes];
    literals = new Uint8Array(litSize).fill(byte);
    litOff = off + headerBytes + 1;
  } else if (litType === 2 || litType === 3) {

    const sizeFormat = (lhByte0 >> 2) & 3;
    let litSize, regSize, headerBytes;
    if (sizeFormat === 0) {
      if (off + 3 > end) throw new Error("zstd: lits header truncado");
      const h = lhByte0 | (src[off+1] << 8) | (src[off+2] << 16);
      const compSize = (h >> 4) & 0x3ff;
      litSize = (h >> 14) & 0x3ff;
      regSize = litSize; headerBytes = 3;
      litOff = off + headerBytes;

      literals = zstdDecodeHuffLiterals(src, litOff, compSize, litSize, 1);
      litOff += compSize;
    } else {
      if (off + 5 > end) throw new Error("zstd: lits header truncado (4)");
      const h = lhByte0 | (src[off+1]<<8) | (src[off+2]<<16) | (src[off+3]<<24);
      const s1 = (h >> 4) & 0x3ff;
      const s2 = (h >> 14) & 0x3ff;
      litSize = (h >> 24) & 0xff | (src[off+4] << 8 & 0xff00);

      headerBytes = 5;
      litOff = off + headerBytes;

      const { huff, bytesRead: hbr } = zstdReadHuffTable(src, litOff);
      litOff += hbr;
      const totalCompSize = s1 + s2 + ((h >> 4) & 0x3ff);               

      const streamEnd = off + blockSize -            0;
      literals = zstdHuffDecode4Streams(src, litOff, s1, s2, h, src[off+4], litSize, huff);
      litOff = off + headerBytes + (end - off - headerBytes);                               


      const { huff: huff2, bytesRead: hbr2 } = zstdReadHuffTable(src, off + headerBytes);
      const seqStart = zstdFindSeqSection(src, off + headerBytes + hbr2, end);
      litOff = seqStart;                                   
      literals = zstdHuffDecode1Stream(src, off + headerBytes + hbr2, seqStart - (off + headerBytes + hbr2), litSize, huff2);
    }
  } else {
    throw new Error("zstd: tipo de literais desconhecido: " + litType);
  }


  let seqPos = litOff;
  if (seqPos >= end) {

    return { literals, sequences: [] };
  }
  const seqCount0 = src[seqPos++];
  let numSeqs;
  if (seqCount0 === 0) { numSeqs = 0; }
  else if (seqCount0 < 128) { numSeqs = seqCount0; }
  else if (seqCount0 < 255) { numSeqs = ((seqCount0 - 128) << 8) | src[seqPos++]; }
  else { numSeqs = src[seqPos++] + (src[seqPos++] << 8) + 0x7f00; }

  if (numSeqs === 0) return { literals, sequences: [] };

  const compMode = src[seqPos++];
  const llMode = (compMode >> 6) & 3;
  const ofMode = (compMode >> 4) & 3;
  const mlMode = (compMode >> 2) & 3;

  const defTbl = getDefaultTables();

  let dtLL, dtOF, dtML;
  let newLL = null, newOF = null, newML = null;

  function readFseTable(mode, def, maxSym, log2Size, key) {
    if (mode === 0) return def;
    if (mode === 1) {
      const sym = src[seqPos++];
      const single = []; for (let i = 0; i <= maxSym; i++) single[i] = 0; single[sym] = 1 << log2Size;
      return fseBuildTable(single, maxSym, log2Size);
    }
    if (mode === 2) {

      const al = (src[seqPos] & 0x0f) + 5;
      const freqs = new Int32Array(maxSym + 2);
      let remaining = 1 << al;
      let byteOff = seqPos;
      let bitBuf = 0, bitPos = 0;
      function peekF(n) {
        while (bitPos < n) { bitBuf |= src[byteOff++] << bitPos; bitPos += 8; }
        const v = bitBuf & ((1 << n) - 1); bitBuf >>>= n; bitPos -= n; return v;
      }
      peekF(4);                           
      let s2 = 0;
      while (remaining > 1 && s2 <= maxSym) {
        let nb = Math.ceil(Math.log2(remaining + 2));
        let val = peekF(nb);

        const threshold = (1 << nb) - remaining - 1;
        if (val < threshold) {

          bitBuf = (val >> (nb - 1)) | (bitBuf << 1); bitPos++;
          val = val & ((1 << (nb-1)) - 1);
          nb--;
        }
        const prob = val - 1;
        if (prob === -1) { freqs[s2] = -1; remaining--; }
        else { freqs[s2] = prob; remaining -= prob; }
        s2++;

        while (freqs[s2 - 1] === 0) {
          const skip = peekF(2);
          for (let k = 0; k < skip && s2 <= maxSym; k++, s2++) freqs[s2] = 0;
          if (skip !== 3) break;
        }
      }
      seqPos = byteOff;
      return fseBuildTable(freqs, maxSym, al);
    }
    return def;                  
  }

  dtLL = readFseTable(llMode, defTbl.ll, 35, LITLEN_LOG, "ll");
  if (llMode === 2) newLL = dtLL;
  dtOF = readFseTable(ofMode, defTbl.of, 28, OFFSET_LOG, "of");
  if (ofMode === 2) newOF = dtOF;
  dtML = readFseTable(mlMode, defTbl.ml, 52, MATCHLEN_LOG, "ml");
  if (mlMode === 2) newML = dtML;
  if (newLL) seqRepOffsets.dtLL = newLL;
  if (newOF) seqRepOffsets.dtOF = newOF;
  if (newML) seqRepOffsets.dtML = newML;


  const seqData = src.subarray(seqPos, end);
  const seqs = zstdDecodeSequences(seqData, numSeqs, dtLL, dtOF, dtML);
  return { literals, sequences: seqs };
}

function zstdFindSeqSection(src, from, end) { return end; }

function zstdReadHuffTable(src, off) {
  const header = src[off];
  let pos = off + 1;
  let weights;
  if (header < 128) {

    const compSize = header;

    weights = [];
    pos += compSize;
    return { huff: null, bytesRead: pos - off };
  } else {

    const numSyms = header - 127;
    weights = [];
    for (let i = 0; i < (numSyms + 1) >> 1; i++) {
      const b = src[pos++];
      weights.push(b >> 4);
      weights.push(b & 0x0f);
    }
    weights = weights.slice(0, numSyms);
  }
  const huff = zstdBuildHuffFromWeights(weights);
  return { huff, bytesRead: pos - off };
}

function zstdBuildHuffFromWeights(weights) {
  const maxBits = Math.max(0, ...weights);
  const counts = new Int32Array(maxBits + 2);
  for (const w of weights) if (w > 0) counts[w]++;

  let total = 0;
  for (let b = 1; b <= maxBits; b++) total += counts[b] << (maxBits - b);

  const lastSym = (1 << maxBits) - total;

  const rank = new Int32Array(maxBits + 2);
  let r = 0;
  for (let b = maxBits; b >= 1; b--) { r += counts[b]; rank[b] = r; }

  const table = new Array(1 << maxBits).fill(-1);
  let code = 0;
  for (let s = 0; s < weights.length; s++) {
    const w = weights[s];
    if (w === 0) continue;
    const bits = maxBits - w + 1;
    const numCodes = 1 << (w - 1);
    for (let i = 0; i < numCodes; i++) {

      const idx = code + i;

      const fill = 1 << (maxBits - bits);
      const base2 = reverseBits(idx, bits) << (maxBits - bits);
      for (let j = 0; j < fill; j++) table[base2 | j] = s;

    }
    code += numCodes;
  }

  const tbl = [];
  let allocated = 0;
  for (let s = 0; s < weights.length; s++) {
    const w = weights[s];
    if (w === 0) continue;
    const nb = maxBits - w + 1;
    const start = allocated << (maxBits - (nb > 0 ? nb : 1));
    allocated++;
    tbl.push({ sym: s, bits: nb > 0 ? nb : maxBits, base: start });
  }
  return { tbl, maxBits };
}

function reverseBits(v, n) {
  let r = 0;
  for (let i = 0; i < n; i++) { r = (r << 1) | (v & 1); v >>= 1; }
  return r;
}

function zstdHuffDecode1Stream(src, off, compSize, litSize, huff) {
  if (!huff || !huff.tbl || huff.tbl.length === 0) return new Uint8Array(litSize);
  const out = new Uint8Array(litSize);
  const end = off + compSize;


  if (compSize === 0) return out;
  let bytePos = end - 1;
  let initByte = src[bytePos--];
  let bitBuf = initByte;
  let bitPos = 7 - Math.clz32(initByte);                        
  if (initByte === 0) bitPos = -1;
  let o = 0;
  const { tbl, maxBits } = huff;
  while (o < litSize && bytePos >= off) {

    while (bitPos < maxBits && bytePos >= off) {
      bitBuf = (bitBuf << 8) | src[bytePos--];
      bitPos += 8;
    }

    const peek = (bitBuf >> (bitPos - maxBits)) & ((1 << maxBits) - 1);
    let found = false;
    for (const e of tbl) {
      if ((peek >> (maxBits - e.bits)) === (e.base)) {
        out[o++] = e.sym;
        bitPos -= e.bits;
        found = true;
        break;
      }
    }
    if (!found) break;           
  }
  return out;
}

function zstdHuffDecode4Streams(src, off, s1, s2, h, b4, litSize, huff) {
  return new Uint8Array(litSize);
}

function zstdDecodeSequences(src, numSeqs, dtLL, dtOF, dtML) {
  const n = src.length;
  if (n === 0) return [];

  let bytePos = n - 1;
  let initByte = src[bytePos];
  if (initByte === 0) return [];                      
  let bitBuf = 0;
  let bitPos = 0;

  function refill() {
    while (bitPos <= 24 && bytePos >= 0) {
      bitBuf |= src[bytePos--] << bitPos;
      bitPos += 8;
    }
  }
  function peekBits(n2) {
    refill();
    if (n2 === 0) return 0;
    return bitBuf & ((1 << n2) - 1);
  }
  function consumeBits(n2) {
    bitBuf >>>= n2;
    bitPos -= n2;
  }


  bytePos = n - 1;
  bitBuf = 0; bitPos = 0;
  refill();
  const hi = 31 - Math.clz32(src[n - 1]);
  consumeBits(hi + 1);


  function initState(dt) {
    const al = Math.round(Math.log2(dt.length));
    const state = peekBits(al); consumeBits(al);
    return state;
  }
  function nextState(dt, state) {
    const e = dt[state];
    const nb = e.nbBits;
    const add = peekBits(nb); consumeBits(nb);
    return e.nextState + add;
  }
  function readExtra(baseArr, extraArr, sym) {
    const eb = extraArr[sym] || 0;
    const extra = peekBits(eb); consumeBits(eb);
    return (baseArr[sym] || 0) + extra;
  }

  let stLL = initState(dtLL);
  let stOF = initState(dtOF);
  let stML = initState(dtML);

  const seqs = [];
  for (let i = 0; i < numSeqs; i++) {
    const ofSym = dtOF[stOF].sym;
    const mlSym = dtML[stML].sym;
    const llSym = dtLL[stLL].sym;

    const ofCode = ofSym;
    const offset = ofCode > 0 ? ((1 << ofCode) + peekBits(ofCode)) : (consumeBits(0), 0 + peekBits(0));
    consumeBits(OF_EXTRA[ofCode] || ofCode);
    const ml = readExtra(ML_BASE, ML_EXTRA, mlSym);
    const ll = readExtra(LL_BASE, LL_EXTRA, llSym);

    stOF = nextState(dtOF, stOF);
    stML = nextState(dtML, stML);
    stLL = nextState(dtLL, stLL);

    seqs.push({ ll, offset: ofCode > 0 ? ((1 << ofCode) | (offset >> 0)) : 1, ml });
  }
  return seqs;
}


export function zstdDecompress(src, maxOut) {
  if (src.length < 4) throw new Error("zstd: curto demais");

  if (!(src[0] === 0x28 && src[1] === 0xb5 && src[2] === 0x2f && src[3] === 0xfd))
    throw new Error("zstd: magic inválido");

  let pos = 4;

  const fhd = src[pos++];
  const fcsFlag = (fhd >> 6) & 3;
  const singleSeg = (fhd >> 5) & 1;
  const hasChecksum = (fhd >> 2) & 1;
  const didFlag = fhd & 3;

  if (didFlag !== 0) throw new Error("zstd: dicionário não suportado");

  let windowSize = 0;
  if (!singleSeg) {
    const wd = src[pos++];
    const mantissa = wd & 7;
    const exponent = wd >> 3;
    windowSize = (1 << (10 + exponent)) * (1 + mantissa / 8);
  }

  let frameContentSize = -1;
  if (fcsFlag === 0) {
    if (singleSeg) frameContentSize = src[pos++];
  } else if (fcsFlag === 1) {
    frameContentSize = (src[pos] | (src[pos+1] << 8)) + 256; pos += 2;
  } else if (fcsFlag === 2) {
    frameContentSize = src[pos] | (src[pos+1]<<8) | (src[pos+2]<<16) | (src[pos+3]<<24); pos += 4;
  } else {

    const lo = src[pos] | (src[pos+1]<<8) | (src[pos+2]<<16) | (src[pos+3]<<24);
    const hi = src[pos+4] | (src[pos+5]<<8) | (src[pos+6]<<16) | (src[pos+7]<<24);
    frameContentSize = hi === 0 ? lo : maxOut;
    pos += 8;
  }

  const allocSize = frameContentSize > 0 ? Math.min(frameContentSize, maxOut) : Math.min(maxOut, 4 * 1024 * 1024);
  let outBuf = new Uint8Array(Math.max(allocSize, 1024));
  let outLen = 0;
  const repOffsets = [1, 4, 8];
  const seqState = {};

  function ensureOut(need) {
    if (need <= outBuf.length) return;
    if (need > maxOut) throw new Error("zstd: saída excede teto (" + maxOut + " bytes)");
    let cap = outBuf.length;
    while (cap < need) cap = Math.min(maxOut, cap * 2);
    const nb = new Uint8Array(cap);
    nb.set(outBuf.subarray(0, outLen));
    outBuf = nb;
  }


  for (;;) {
    if (pos + 3 > src.length) throw new Error("zstd: bloco truncado (header)");
    const bh0 = src[pos]; const bh1 = src[pos+1]; const bh2 = src[pos+2]; pos += 3;
    const lastBlock = bh0 & 1;
    const blockType = (bh0 >> 1) & 3;
    const blockSize = (bh0 >> 3) | (bh1 << 5) | (bh2 << 13);

    if (blockType === 0) {

      if (pos + blockSize > src.length) throw new Error("zstd: Raw block truncado");
      ensureOut(outLen + blockSize);
      outBuf.set(src.subarray(pos, pos + blockSize), outLen);
      outLen += blockSize;
      pos += blockSize;
    } else if (blockType === 1) {

      ensureOut(outLen + blockSize);
      outBuf.fill(src[pos++], outLen, outLen + blockSize);
      outLen += blockSize;
    } else if (blockType === 2) {

      const blockEnd = pos + blockSize;
      if (blockEnd > src.length) throw new Error("zstd: Compressed block truncado");


      const litByte0 = src[pos];
      const litType = litByte0 & 3;
      let lits, afterLits;

      if (litType === 0) {

        const sf = (litByte0 >> 2) & 3;
        let lsz, lh;
        if (sf < 2) { lsz = litByte0 >> 3; lh = 1; }
        else if (sf === 2) { lsz = (litByte0 >> 4) | (src[pos+1] << 4); lh = 2; }
        else { lsz = (litByte0 >> 4) | (src[pos+1] << 4) | (src[pos+2] << 12); lh = 3; }
        lits = src.subarray(pos + lh, pos + lh + lsz);
        afterLits = pos + lh + lsz;
      } else if (litType === 1) {

        const sf = (litByte0 >> 2) & 3;
        let lsz, lh;
        if (sf < 2) { lsz = litByte0 >> 3; lh = 1; }
        else if (sf === 2) { lsz = (litByte0 >> 4) | (src[pos+1] << 4); lh = 2; }
        else { lsz = (litByte0 >> 4) | (src[pos+1] << 4) | (src[pos+2] << 12); lh = 3; }
        lits = new Uint8Array(lsz).fill(src[pos + lh]);
        afterLits = pos + lh + 1;
      } else {


        const sf = (litByte0 >> 2) & 3;
        let rsize, csize, lsz, lh;
        if (sf === 0) {

          const b1 = src[pos+1], b2 = src[pos+2];
          rsize = ((litByte0 >> 4) & 0xf) | ((b1 & 0x3f) << 4);
          csize = ((b1 >> 6) & 0x3) | (b2 << 2);
          lh = 3;
        } else if (sf === 1) {
          const b1 = src[pos+1], b2 = src[pos+2], b3 = src[pos+3];
          rsize = ((litByte0 >> 4) & 0xf) | (b1 << 4) | ((b2 & 3) << 12);
          csize = ((b2 >> 2) & 0x3f) | (b3 << 6);
          lh = 4;
        } else {

          const b1 = src[pos+1], b2 = src[pos+2], b3 = src[pos+3];
          rsize = ((litByte0 >> 4) & 0xf) | (b1 << 4) | ((b2 & 3) << 12);
          csize = ((b2 >> 2) & 0x3f) | (b3 << 6);                        
          lh = 4;
        }
        const huffStart = pos + lh;
        const huffByte0 = src[huffStart];
        let huffHeaderSize, huffWeights;
        if (huffByte0 < 128) {

          huffHeaderSize = 1 + huffByte0;
          huffWeights = [];
          for (let i = 1; i <= huffByte0; i++) {
            huffWeights.push(src[huffStart + i] >> 4);
            huffWeights.push(src[huffStart + i] & 0xf);
          }
        } else {

          const numSyms = huffByte0 - 127;
          huffHeaderSize = 1 + ((numSyms + 1) >> 1);
          huffWeights = [];
          for (let i = 1; i < huffHeaderSize; i++) {
            huffWeights.push(src[huffStart + i] >> 4);
            huffWeights.push(src[huffStart + i] & 0xf);
          }
          huffWeights = huffWeights.slice(0, numSyms);
        }
        const streamStart = huffStart + huffHeaderSize;
        const streamSize = csize - huffHeaderSize;

        lits = zstdHuffDecode1StreamSimple(src, streamStart, streamSize, rsize, huffWeights);
        afterLits = pos + lh + csize;
      }


      let seqPos2 = afterLits;
      const seqCnt0 = seqPos2 < blockEnd ? src[seqPos2++] : 0;
      let numSeqs;
      if (seqCnt0 === 0) numSeqs = 0;
      else if (seqCnt0 < 128) numSeqs = seqCnt0;
      else if (seqCnt0 < 255) numSeqs = ((seqCnt0 - 128) << 8) | src[seqPos2++];
      else { numSeqs = src[seqPos2++] + (src[seqPos2++] << 8) + 0x7f00; }


      let litPos = 0;
      if (numSeqs === 0) {
        ensureOut(outLen + lits.length);
        outBuf.set(lits, outLen);
        outLen += lits.length;
      } else {

        const compMode = seqPos2 < blockEnd ? src[seqPos2++] : 0;
        const llMode = (compMode >> 6) & 3;
        const ofMode = (compMode >> 4) & 3;
        const mlMode = (compMode >> 2) & 3;
        const defTbl = getDefaultTables();

        let dtLL = seqState.dtLL || defTbl.ll;
        let dtOF = seqState.dtOF || defTbl.of;
        let dtML = seqState.dtML || defTbl.ml;

        function maybeReadFseTable(mode, def, maxSym, logSize) {
          if (mode === 0) return def;
          if (mode === 1) {
            const sym = src[seqPos2++];
            const f2 = new Int32Array(maxSym + 1); f2[sym] = 1 << logSize;
            return fseBuildTable(f2, maxSym, logSize);
          }
          if (mode === 2) {
            const al = (src[seqPos2] & 0x0f) + 5;
            const freqs = new Int32Array(maxSym + 2);
            let remaining = 1 << al;
            let bb = 0, bp = 0, bp2 = seqPos2;
            function pf(n3) {
              while (bp < n3) { bb |= src[bp2++] << bp; bp += 8; }
              const v = bb & ((1 << n3) - 1); bb >>>= n3; bp -= n3; return v;
            }
            pf(4);                   
            let sym2 = 0;
            while (remaining > 1 && sym2 <= maxSym) {
              let nb = 32 - Math.clz32(remaining + 1);
              let val2 = pf(nb);
              const thresh = (1 << nb) - remaining - 1;
              if (val2 >= thresh) {

                const extra = pf(1);
                if (extra) val2 |= 1 << (nb - 1);                     
                else val2 = val2 & ((1 << (nb - 1)) - 1);
              }
              const prob = val2 - 1;
              if (prob < 0) { freqs[sym2] = -1; remaining--; }
              else { freqs[sym2] = prob; remaining -= prob; }
              sym2++;
              if (remaining === 0) break;
              while (sym2 <= maxSym && freqs[sym2 - 1] === 0) {
                const skip = pf(2);
                for (let k = 0; k < skip && sym2 <= maxSym; k++, sym2++) freqs[sym2] = 0;
                if (skip < 3) break;
              }
            }
            seqPos2 = bp2;
            return fseBuildTable(freqs, maxSym, al);
          }
          return def;                  
        }

        const newLL = maybeReadFseTable(llMode, dtLL, 35, LITLEN_LOG);
        if (llMode === 2) seqState.dtLL = newLL; dtLL = newLL;
        const newOF = maybeReadFseTable(ofMode, dtOF, 28, OFFSET_LOG);
        if (ofMode === 2) seqState.dtOF = newOF; dtOF = newOF;
        const newML = maybeReadFseTable(mlMode, dtML, 52, MATCHLEN_LOG);
        if (mlMode === 2) seqState.dtML = newML; dtML = newML;


        const seqBuf = src.subarray(seqPos2, blockEnd);
        const sn = seqBuf.length;
        if (sn === 0 || seqBuf[sn - 1] === 0) {                             }
        else {
          let sBytePos = sn - 1;
          let sBitBuf = 0, sBitPos = 0;
          function sRefill() {
            while (sBitPos <= 24 && sBytePos >= 0) {
              sBitBuf |= seqBuf[sBytePos--] << sBitPos; sBitPos += 8;
            }
          }
          function sPeek(n3) { sRefill(); return sBitPos >= n3 ? sBitBuf & ((1 << n3) - 1) : 0; }
          function sConsume(n3) { sBitBuf >>>= n3; sBitPos -= n3; }


          const hi = 31 - Math.clz32(seqBuf[sn - 1]); sRefill(); sConsume(hi + 1);

          function initSt(dt) {
            const al = Math.round(Math.log2(Math.max(1, dt.length)));
            const s = sPeek(al); sConsume(al); return s;
          }
          function nextSt(dt, state) {
            const e = dt[state] || { nbBits: 0, nextState: 0 };
            const add = sPeek(e.nbBits); sConsume(e.nbBits);
            return (e.nextState + add) & (dt.length - 1);
          }
          function readEx(baseArr, extraArr, sym) {
            const eb = extraArr[sym] || 0;
            const ex = sPeek(eb); sConsume(eb);
            return (baseArr[sym] || 0) + ex;
          }

          let stLL = initSt(dtLL), stOF = initSt(dtOF), stML = initSt(dtML);

          for (let si = 0; si < numSeqs; si++) {
            const ofSym = (dtOF[stOF] || { sym: 0 }).sym;
            const mlSym = (dtML[stML] || { sym: 0 }).sym;
            const llSym = (dtLL[stLL] || { sym: 0 }).sym;

            let offset;
            if (ofSym === 0) { offset = repOffsets[0]; }
            else if (ofSym <= 30) {
              offset = (1 << ofSym) | sPeek(ofSym); sConsume(ofSym);
            } else { offset = 1; }


            if (ofSym === 0) { offset = repOffsets[0]; }
            else if (offset <= 3) {
              const idx = offset - 1;
              offset = repOffsets[idx];
              repOffsets[idx] = repOffsets[Math.max(0, idx - 1)];
              repOffsets[0] = offset;
            } else {
              repOffsets[2] = repOffsets[1]; repOffsets[1] = repOffsets[0]; repOffsets[0] = offset - 3;
              offset = offset - 3;
            }

            const ml = readEx(ML_BASE, ML_EXTRA, mlSym);
            const ll = readEx(LL_BASE, LL_EXTRA, llSym);

            stOF = nextSt(dtOF, stOF);
            stML = nextSt(dtML, stML);
            stLL = nextSt(dtLL, stLL);


            ensureOut(outLen + ll + ml);
            if (ll > 0 && litPos + ll <= lits.length) {
              outBuf.set(lits.subarray(litPos, litPos + ll), outLen);
              outLen += ll; litPos += ll;
            }

            if (offset > 0 && ml > 0) {
              const matchFrom = outLen - offset;
              if (matchFrom >= 0) {
                for (let m = 0; m < ml; m++) outBuf[outLen++] = outBuf[matchFrom + m];
              }
            }
          }
        }

        const remLits = lits.length - litPos;
        if (remLits > 0) {
          ensureOut(outLen + remLits);
          outBuf.set(lits.subarray(litPos), outLen);
          outLen += remLits;
        }
      }
      pos = blockEnd;
    } else {
      throw new Error("zstd: tipo de bloco reservado (3)");
    }

    if (outLen > maxOut) throw new Error("zstd: saída excede teto (" + maxOut + " bytes)");
    if (lastBlock) break;
  }


  return outBuf.slice(0, outLen);
}


function zstdHuffDecode1StreamSimple(src, off, compSize, litSize, weights) {
  const out = new Uint8Array(litSize);
  if (compSize <= 0 || litSize === 0 || weights.length === 0) return out;


  const numSyms = weights.length;
  const maxBits = Math.max(1, ...weights.filter(w => w > 0).map(w => w));


  let weightSum = 0;
  for (const w of weights) if (w > 0) weightSum += 1 << (w - 1);
  const fullTable = 1 << maxBits;
  const lastWeight = fullTable - weightSum > 0 ? Math.log2(fullTable - weightSum) + 1 : 0;


  const syms = [];
  for (let s = 0; s < numSyms; s++) { if (weights[s] > 0) syms.push({ s, w: weights[s] }); }
  if (lastWeight > 0) syms.push({ s: numSyms, w: lastWeight });
  syms.sort((a, b) => a.w - b.w || a.s - b.s);

  const codes = new Array(256).fill(null);
  let code = 0;
  for (const { s, w } of syms) {
    const nbits = maxBits - w + 1;
    codes[s] = { nbits, code };
    code += 1 << (w - 1);
  }


  const end = off + compSize;
  if (end > src.length) return out;
  let bytePos = end - 1;
  let bitBuf = 0, bitLen = 0;
  let o = 0;


  const initB = src[bytePos--];
  const hi = 7 - Math.clz32(initB & 0xff) + (Math.clz32(initB & 0xff) < 32 ? 0 : -7);
  let skipBits = (initB === 0) ? 8 : (7 - (31 - Math.clz32(initB)));
  bitBuf = initB;
  bitLen = 8 - skipBits - 1;
  bitBuf &= (1 << bitLen) - 1;

  while (o < litSize) {

    while (bitLen < maxBits && bytePos >= off) {
      bitBuf = (bitBuf << 8) | src[bytePos--];
      bitLen += 8;
    }
    if (bitLen < 1) break;

    const peekVal = bitLen >= maxBits ? (bitBuf >> (bitLen - maxBits)) & ((1 << maxBits) - 1) : (bitBuf << (maxBits - bitLen)) & ((1 << maxBits) - 1);

    let found = false;
    for (const [sIdx, entry] of codes.entries()) {
      if (!entry) continue;
      const { nbits, code: c } = entry;
      if (nbits > bitLen) continue;
      const shifted = peekVal >> (maxBits - nbits);
      if (shifted === c) {
        out[o++] = sIdx;
        bitLen -= nbits;
        bitBuf &= (1 << bitLen) - 1;
        found = true;
        break;
      }
    }
    if (!found) break;
  }
  return out;
}


export function tryDecompressCsgBody(u8, kind, maxOut) {
  try {
    if (!u8 || typeof u8.byteLength !== "number" || u8.byteLength === 0) return null;
    if (!(Number.isFinite(maxOut) && maxOut > 0)) return null;
    if (kind === "gzip") return gunzip(u8, maxOut);
    if (kind === "zlib/deflate") return zlibInflate(u8, maxOut);
    if (kind === "LZ4 frame") return lz4FrameDecompress(u8, maxOut);
    if (kind === "zstd") return zstdDecompress(u8, maxOut);
    return null;                          
  } catch (_) {
    return null;
  }
}
