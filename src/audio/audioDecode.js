export const WAV_MAX_CHANNELS = 8;
export const WAV_MIN_SAMPLE_RATE = 3000;
export const WAV_MAX_SAMPLE_RATE = 384000;
export const WAV_MAX_FRAMES = 48000 * 60 * 60;                             


export function normalizeSoundId(id) {
	const s = String(id == null ? "" : id).trim();
	if (!s) return "";
	if (/^\d+$/.test(s)) return "rbxassetid://" + s;
	return s;
}


const B64_LOOKUP = (() => {
	const t = new Int8Array(256).fill(-1);
	const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
	for (let i = 0; i < abc.length; i++) t[abc.charCodeAt(i)] = i;
	return t;
})();


export function decodeBase64(str) {
	const s = String(str == null ? "" : str);
	const out = new Uint8Array(((s.length >> 2) + 1) * 3);
	let acc = 0;
	let bits = 0;
	let n = 0;
	let done = false;
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i);
		if (c === 9 || c === 10 || c === 13 || c === 32) continue;              
		if (c === 61) {
			done = true;                                 
			continue;
		}
		if (done) return null;                                       
		const v = c < 256 ? B64_LOOKUP[c] : -1;
		if (v < 0) return null;
		acc = (acc << 6) | v;
		bits += 6;
		if (bits >= 8) {
			bits -= 8;
			out[n++] = (acc >> bits) & 0xff;
		}
	}
	return out.subarray(0, n);
}


export function parseDataUri(uri) {
	const s = String(uri == null ? "" : uri);
	const comma = s.indexOf(",");
	if (!s.startsWith("data:") || comma < 0) return null;
	const meta = s.slice(5, comma);
	if (!/(^|;)base64$/i.test(meta)) return null;
	const bytes = decodeBase64(s.slice(comma + 1));
	if (!bytes) return null;
	const mime = (meta.split(";")[0] || "").toLowerCase();
	return { mime, bytes };
}


function tag4(bytes, off) {
	return String.fromCharCode(bytes[off], bytes[off + 1], bytes[off + 2], bytes[off + 3]);
}


export function parseWav(bytes) {
	try {
		return parseWavInner(bytes);
	} catch {
		return null;
	}
}

function parseWavInner(bytes) {
	if (!(bytes instanceof Uint8Array) || bytes.length < 44) return null;
	if (tag4(bytes, 0) !== "RIFF" || tag4(bytes, 8) !== "WAVE") return null;
	const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let fmt = null;
	let dataOff = -1;
	let dataLen = 0;
	let off = 12;

	while (off + 8 <= bytes.length) {
		const id = tag4(bytes, off);
		let size = dv.getUint32(off + 4, true);
		const body = off + 8;

		if (body + size > bytes.length) size = bytes.length - body;
		if (id === "fmt " && size >= 16 && !fmt) {
			let format = dv.getUint16(body, true);
			const channels = dv.getUint16(body + 2, true);
			const sampleRate = dv.getUint32(body + 4, true);
			const bitsPerSample = dv.getUint16(body + 14, true);

			if (format === 0xfffe && size >= 26) format = dv.getUint16(body + 24, true);
			fmt = { format, channels, sampleRate, bitsPerSample };
		} else if (id === "data" && dataOff < 0) {
			dataOff = body;
			dataLen = size;
		}
		off = body + size + (size & 1);
	}
	if (!fmt || dataOff < 0 || dataLen <= 0) return null;
	const { format, channels, sampleRate, bitsPerSample } = fmt;
	const pcmInt =
		format === 1 &&
		(bitsPerSample === 8 || bitsPerSample === 16 || bitsPerSample === 24 || bitsPerSample === 32);
	const pcmFloat = format === 3 && bitsPerSample === 32;
	if (!pcmInt && !pcmFloat) return null;
	if (channels < 1 || channels > WAV_MAX_CHANNELS) return null;
	if (sampleRate < WAV_MIN_SAMPLE_RATE || sampleRate > WAV_MAX_SAMPLE_RATE) return null;
	const bytesPerSample = bitsPerSample >> 3;
	const frameBytes = bytesPerSample * channels;
	let frames = Math.floor(dataLen / frameBytes);
	if (frames < 1) return null;
	if (frames > WAV_MAX_FRAMES) frames = WAV_MAX_FRAMES;                     
	const chans = [];
	for (let c = 0; c < channels; c++) chans.push(new Float32Array(frames));
	for (let i = 0; i < frames; i++) {
		const base = dataOff + i * frameBytes;
		for (let c = 0; c < channels; c++) {
			const o = base + c * bytesPerSample;
			let v = 0;
			if (pcmFloat) {
				v = dv.getFloat32(o, true);
				if (!Number.isFinite(v)) v = 0;                                       
			} else if (bitsPerSample === 8) {
				v = (bytes[o] - 128) / 128;                            
			} else if (bitsPerSample === 16) {
				v = dv.getInt16(o, true) / 32768;
			} else if (bitsPerSample === 24) {
				let u = bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16);
				if (u & 0x800000) u |= 0xff000000;                              
				v = u / 8388608;
			} else {
				v = dv.getInt32(o, true) / 2147483648;
			}
			chans[c][i] = v < -1 ? -1 : v > 1 ? 1 : v;
		}
	}
	return { sampleRate, channels: chans, frames, duration: frames / sampleRate };
}
