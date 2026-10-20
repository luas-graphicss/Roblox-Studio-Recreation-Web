export function halfToFloat(h) {
  const s = h & 0x8000 ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const m = h & 0x3ff;
  if (e === 0) return s * m * Math.pow(2, -24);             
  if (e === 31) return m ? NaN : s * Infinity;
  return s * (1 + m / 1024) * Math.pow(2, e - 15);
}

export function floatToHalf(f) {
  if (!Number.isFinite(f)) return f > 0 ? 0x7c00 : f < 0 ? 0xfc00 : 0x7e00;
  const s = f < 0 || (f === 0 && 1 / f < 0) ? 0x8000 : 0;
  const v = Math.abs(f);
  if (v >= 65504) return s | 0x7bff;                               
  if (v < Math.pow(2, -24)) return s;                       
  let e = Math.floor(Math.log2(v));
  let m = v / Math.pow(2, e);
  if (m < 1) { m *= 2; e -= 1; }
  if (m >= 2) { m /= 2; e += 1; }
  if (e < -14) {
    const sub = Math.round(v * Math.pow(2, 24));
    return s | (sub > 0x3ff ? 0x3ff : sub);
  }
  const mm = Math.round((m - 1) * 1024);
  if (mm === 1024) {
    if (e + 1 > 15) return s | 0x7bff;
    return s | ((e + 16) << 10);
  }
  return s | ((e + 15) << 10) | mm;
}


export function parseHdr(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let pos = 0;
  function readLine() {
    let s = "";
    while (pos < u8.length) {
      const c = u8[pos];
      pos += 1;
      if (c === 10) break;
      if (c !== 13) s += String.fromCharCode(c);
      if (s.length > 512) throw new Error("hdr: cabecalho invalido (linha longa demais)");
    }
    return s;
  }
  const magic = readLine();
  if (magic.indexOf("#?") !== 0) throw new Error("hdr: assinatura #? ausente (nao e um arquivo Radiance)");
  let exposure = 1;
  let fmtOk = true;                                           
  for (;;) {
    if (pos >= u8.length) throw new Error("hdr: cabecalho truncado");
    const line = readLine();
    if (line === "") break;
    if (line.indexOf("FORMAT=") === 0) {
      fmtOk = line === "FORMAT=32-bit_rle_rgbe";
    } else if (line.indexOf("EXPOSURE=") === 0) {
      const v = parseFloat(line.slice(9));
      if (Number.isFinite(v) && v > 0) exposure *= v;                                   
    }
  }
  if (!fmtOk) throw new Error("hdr: FORMAT nao suportado (esperado 32-bit_rle_rgbe)");
  const res = readLine();
  const m = /^-Y (\d+) \+X (\d+)$/.exec(res.trim());
  if (!m) throw new Error('hdr: resolucao nao suportada: "' + res + '" (esperado "-Y H +X W")');
  const height = parseInt(m[1], 10);
  const width = parseInt(m[2], 10);
  if (!(width > 0 && height > 0) || width * height > 67108864) throw new Error("hdr: dimensoes invalidas");
  const out = new Float32Array(width * height * 3);
  const row = new Uint8Array(width * 4);                                 
  const inv = 1 / exposure;
  let o = 0;
  for (let y = 0; y < height; y++) {
    if (pos + 4 > u8.length) throw new Error("hdr: dados truncados (linha " + y + ")");
    const newRle = width >= 8 && width <= 32767 && u8[pos] === 2 && u8[pos + 1] === 2 && ((u8[pos + 2] << 8) | u8[pos + 3]) === width;
    if (newRle) {
      pos += 4;
      for (let ch = 0; ch < 4; ch++) {
        let x = 0;
        while (x < width) {
          if (pos >= u8.length) throw new Error("hdr: RLE truncado");
          let n = u8[pos];
          pos += 1;
          if (n > 128) {
            n -= 128;                                      
            if (x + n > width || pos >= u8.length) throw new Error("hdr: run RLE estoura a linha");
            const v = u8[pos];
            pos += 1;
            for (let i = 0; i < n; i++) row[(x + i) * 4 + ch] = v;
          } else {
            if (n === 0 || x + n > width || pos + n > u8.length) throw new Error("hdr: bloco RLE invalido");
            for (let i = 0; i < n; i++) row[(x + i) * 4 + ch] = u8[pos + i];
            pos += n;
          }
          x += n;
        }
      }
    } else {


      let x = 0;
      let shift = 0;
      while (x < width) {
        if (pos + 4 > u8.length) throw new Error("hdr: dados truncados (pixel plano)");
        const r = u8[pos];
        const g = u8[pos + 1];
        const b = u8[pos + 2];
        const e = u8[pos + 3];
        pos += 4;
        if (r === 1 && g === 1 && b === 1) {
          if (x === 0 && y === 0) throw new Error("hdr: old-RLE sem pixel anterior");
          const px = (x > 0 ? x - 1 : width - 1) * 4;                     
          let n = e << shift;
          while (n > 0 && x < width) {
            row[x * 4] = row[px];
            row[x * 4 + 1] = row[px + 1];
            row[x * 4 + 2] = row[px + 2];
            row[x * 4 + 3] = row[px + 3];
            x += 1;
            n -= 1;
          }
          shift += 8;
        } else {
          row[x * 4] = r;
          row[x * 4 + 1] = g;
          row[x * 4 + 2] = b;
          row[x * 4 + 3] = e;
          x += 1;
          shift = 0;
        }
      }
    }

    for (let x = 0; x < width; x++) {
      const e = row[x * 4 + 3];
      const f = e === 0 ? 0 : Math.pow(2, e - 136) * inv;
      out[o] = row[x * 4] * f;
      out[o + 1] = row[x * 4 + 1] * f;
      out[o + 2] = row[x * 4 + 2] * f;
      o += 3;
    }
  }
  return { width: width, height: height, data: out };
}


export function encodeHdrFlat(width, height, rgb) {
  const head = "#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y " + height + " +X " + width + "\n";
  const out = new Uint8Array(head.length + width * height * 4);
  for (let i = 0; i < head.length; i++) out[i] = head.charCodeAt(i);
  let p = head.length;
  for (let i = 0; i < width * height; i++) {
    const r = Math.max(0, rgb[i * 3]);
    const g = Math.max(0, rgb[i * 3 + 1]);
    const b = Math.max(0, rgb[i * 3 + 2]);
    const m = Math.max(r, g, b);
    if (m <= 1e-32) {
      out[p] = 0; out[p + 1] = 0; out[p + 2] = 0; out[p + 3] = 0;
      p += 4;
      continue;
    }
    let e = Math.ceil(Math.log2(m));
    if (Math.pow(2, e) < m) e += 1;                                       
    const s = Math.pow(2, 8 - e);
    let rb = Math.floor(r * s);
    let gb = Math.floor(g * s);
    let bb = Math.floor(b * s);
    if (rb > 255) rb = 255;
    if (gb > 255) gb = 255;
    if (bb > 255) bb = 255;
    out[p] = rb; out[p + 1] = gb; out[p + 2] = bb; out[p + 3] = e + 128;
    p += 4;
  }
  return out;
}


export function exrZipPostprocess(u8) {
  const n = u8.length;
  for (let i = 1; i < n; i++) u8[i] = (u8[i - 1] + u8[i] - 128) & 0xff;
  const out = new Uint8Array(n);
  const half = Math.floor((n + 1) / 2);
  let a = 0;
  let b = half;
  let o = 0;
  while (o < n) {
    out[o] = u8[a];
    a += 1;
    o += 1;
    if (o < n) {
      out[o] = u8[b];
      b += 1;
      o += 1;
    }
  }
  return out;
}


export function exrZipPreprocess(u8) {
  const n = u8.length;
  const tmp = new Uint8Array(n);
  const half = Math.floor((n + 1) / 2);
  let a = 0;
  let b = half;
  let o = 0;
  while (o < n) {
    tmp[a] = u8[o];
    a += 1;
    o += 1;
    if (o < n) {
      tmp[b] = u8[o];
      b += 1;
      o += 1;
    }
  }
  const out = new Uint8Array(n);
  if (n > 0) out[0] = tmp[0];
  for (let i = 1; i < n; i++) out[i] = (tmp[i] - tmp[i - 1] + 128) & 0xff;
  return out;
}


export async function parseExrAsync(bytes, inflate) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8.length < 12) throw new Error("exr: arquivo pequeno demais");
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (dv.getUint32(0, true) !== 20000630) throw new Error("exr: assinatura invalida");
  const version = dv.getUint32(4, true);
  if ((version & 0xff) !== 2) throw new Error("exr: versao " + (version & 0xff) + " nao suportada");
  if (version & 0x200) throw new Error("exr: tiled nao suportado (exporte scanline)");
  if (version & 0x800) throw new Error("exr: deep data nao suportado");
  if (version & 0x1000) throw new Error("exr: multipart nao suportado");
  let pos = 8;
  function readString(maxLen) {
    let s = "";
    while (pos < u8.length) {
      const c = u8[pos];
      pos += 1;
      if (c === 0) return s;
      s += String.fromCharCode(c);
      if (s.length > maxLen) throw new Error("exr: string longa demais no cabecalho");
    }
    return s;
  }
  let channels = null;
  let compression = -1;
  let dataWindow = null;
  let lineOrder = 0;
  for (;;) {
    const name = readString(255);
    if (name === "") break;
    const type = readString(255);
    if (pos + 4 > u8.length) throw new Error("exr: cabecalho truncado");
    const size = dv.getInt32(pos, true);
    pos += 4;
    const base = pos;
    if (size < 0 || base + size > u8.length) throw new Error("exr: atributo truncado (" + name + ")");
    if (name === "channels" && type === "chlist") {
      channels = [];
      while (pos < base + size) {
        const cn = readString(255);
        if (cn === "") break;
        const pixelType = dv.getInt32(pos, true);
        pos += 4;
        pos += 4;                               
        const sx = dv.getInt32(pos, true);
        pos += 4;
        const sy = dv.getInt32(pos, true);
        pos += 4;
        channels.push({ name: cn, pixelType: pixelType, sx: sx, sy: sy });
      }
    } else if (name === "compression" && type === "compression") {
      compression = u8[pos];
    } else if (name === "dataWindow" && type === "box2i") {
      dataWindow = {
        xMin: dv.getInt32(pos, true),
        yMin: dv.getInt32(pos + 4, true),
        xMax: dv.getInt32(pos + 8, true),
        yMax: dv.getInt32(pos + 12, true),
      };
    } else if (name === "lineOrder" && type === "lineOrder") {
      lineOrder = u8[pos];
    }
    pos = base + size;
  }
  if (!channels || !dataWindow || compression < 0) throw new Error("exr: cabecalho incompleto");
  if (compression !== 0 && compression !== 2 && compression !== 3) {
    throw new Error("exr: compressao " + compression + " nao suportada (aceito NONE/ZIPS/ZIP; PIZ/PXR24/B44/DWA fora) — converta para .hdr ou re-exporte com ZIP");
  }
  if (lineOrder !== 0) throw new Error("exr: lineOrder decrescente/random nao suportado");
  const width = dataWindow.xMax - dataWindow.xMin + 1;
  const height = dataWindow.yMax - dataWindow.yMin + 1;
  if (!(width > 0 && height > 0) || width * height > 67108864) throw new Error("exr: dimensoes invalidas");
  const byName = {};
  for (let i = 0; i < channels.length; i++) {
    const ch = channels[i];
    if (ch.sx !== 1 || ch.sy !== 1) throw new Error("exr: subsampling de canal nao suportado");
    if (ch.pixelType !== 1 && ch.pixelType !== 2) throw new Error("exr: canal " + ch.name + " nao e HALF nem FLOAT");
    byName[ch.name] = ch;
  }
  if (!byName.R || !byName.G || !byName.B) throw new Error("exr: canais R/G/B ausentes");
  const linesPerBlock = compression === 3 ? 16 : 1;
  const numBlocks = Math.ceil(height / linesPerBlock);
  pos += numBlocks * 8;                                                   
  let lineBytes = 0;
  for (let i = 0; i < channels.length; i++) lineBytes += width * (channels[i].pixelType === 1 ? 2 : 4);
  const out = new Float32Array(width * height * 3);
  for (let bI = 0; bI < numBlocks; bI++) {
    if (pos + 8 > u8.length) throw new Error("exr: bloco truncado");
    const yAbs = dv.getInt32(pos, true);
    pos += 4;
    const dataSize = dv.getInt32(pos, true);
    pos += 4;
    if (dataSize < 0 || pos + dataSize > u8.length) throw new Error("exr: dados do bloco truncados");
    const y0 = yAbs - dataWindow.yMin;
    const lines = Math.min(linesPerBlock, height - bI * linesPerBlock);
    const rawSize = lineBytes * lines;
    let raw = u8.subarray(pos, pos + dataSize);
    pos += dataSize;
    if (compression !== 0 && dataSize < rawSize) {
      if (typeof inflate !== "function") throw new Error("exr: bloco ZIP sem inflate disponivel");
      const inflated = await inflate(raw);
      if (!inflated || inflated.length !== rawSize) throw new Error("exr: tamanho inesperado apos inflate");
      raw = exrZipPostprocess(inflated instanceof Uint8Array ? inflated : new Uint8Array(inflated));
    } else if (dataSize !== rawSize) {
      throw new Error("exr: bloco com tamanho inesperado");
    }
    const rdv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    for (let ln = 0; ln < lines; ln++) {
      const y = y0 + ln;
      if (y < 0 || y >= height) throw new Error("exr: linha fora da janela de dados");
      let cOff = ln * lineBytes;
      for (let ci = 0; ci < channels.length; ci++) {
        const ch = channels[ci];
        const bytesPer = ch.pixelType === 1 ? 2 : 4;
        const target = ch.name === "R" ? 0 : ch.name === "G" ? 1 : ch.name === "B" ? 2 : -1;
        if (target >= 0) {
          const rowBase = y * width * 3 + target;
          for (let x = 0; x < width; x++) {
            const v = ch.pixelType === 1 ? halfToFloat(rdv.getUint16(cOff + x * 2, true)) : rdv.getFloat32(cOff + x * 4, true);
            out[rowBase + x * 3] = v;
          }
        }
        cOff += width * bytesPer;
      }
    }
  }
  return { width: width, height: height, data: out };
}


export function downsampleEquirect(data, width, height, maxWidth) {
  const maxW = Math.max(16, maxWidth | 0);
  if (width <= maxW) return { width: width, height: height, data: data };
  const factor = Math.ceil(width / maxW);
  const ow = Math.max(1, Math.floor(width / factor));
  const oh = Math.max(1, Math.floor(height / factor));
  const out = new Float32Array(ow * oh * 3);
  const inv = 1 / (factor * factor);
  for (let y = 0; y < oh; y++) {
    for (let x = 0; x < ow; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let dy = 0; dy < factor; dy++) {
        const sy = Math.min(height - 1, y * factor + dy);
        for (let dx = 0; dx < factor; dx++) {
          const sx = Math.min(width - 1, x * factor + dx);
          const so = (sy * width + sx) * 3;
          r += data[so];
          g += data[so + 1];
          b += data[so + 2];
        }
      }
      const oo = (y * ow + x) * 3;
      out[oo] = r * inv;
      out[oo + 1] = g * inv;
      out[oo + 2] = b * inv;
    }
  }
  return { width: ow, height: oh, data: out };
}


export function rgbToRgbaHalf(data, intensity) {
  let k = Number(intensity);
  if (!Number.isFinite(k)) k = 1;
  if (k < 0) k = 0;
  if (k > 8) k = 8;
  const n = (data.length / 3) | 0;
  const out = new Uint16Array(n * 4);
  const one = floatToHalf(1);
  for (let i = 0; i < n; i++) {
    out[i * 4] = floatToHalf(data[i * 3] * k);
    out[i * 4 + 1] = floatToHalf(data[i * 3 + 1] * k);
    out[i * 4 + 2] = floatToHalf(data[i * 3 + 2] * k);
    out[i * 4 + 3] = one;
  }
  return out;
}


export function hdriMaxSizeForTier(weakGpu) {
  return weakGpu ? 1024 : 2048;
}


export function hdriIntensityClamp(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 1;
  if (n < 0) return 0;
  if (n > 8) return 8;
  return n;
}

export function hdriKindForExt(ext) {
  const e = String(ext || "").toLowerCase();
  if (e === "hdr") return "hdr";
  if (e === "exr") return "exr";
  return "";
}


export function hdriSignature(assetId, intensity, maxSize) {
  return String(assetId || "") + "|" + hdriIntensityClamp(intensity) + "|" + (maxSize | 0);
}


export function hdriLumStats(data) {
  const n = (data.length / 3) | 0;
  if (!n) return { avg: 0, max: 0 };
  let max = 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const l = 0.2126 * data[i * 3] + 0.7152 * data[i * 3 + 1] + 0.0722 * data[i * 3 + 2];
    sum += l;
    if (l > max) max = l;
  }
  return { avg: sum / n, max: max };
}
