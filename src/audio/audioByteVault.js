export const BYTE_VAULT_LIMITS = Object.freeze({
	dbName: "rsw-audio-byte-vault",
	storeName: "bytes",
	maxEntryBytes: 20 * 1024 * 1024,                                              
	maxEntries: 96,
	maxTotalBytes: 64 * 1024 * 1024,
	opTimeoutMs: 1500,
});

export function createByteVault(opts = {}) {
	const limits = Object.freeze({ ...BYTE_VAULT_LIMITS, ...(opts.limits || {}) });
	const now = typeof opts.now === "function" ? opts.now : () => Date.now();
	const idb =
		opts.indexedDBImpl !== undefined
			? opts.indexedDBImpl
			: typeof indexedDB !== "undefined"
				? indexedDB
				: null;
	const counters = {
		hits: 0,
		misses: 0,
		puts: 0,
		rejectedPuts: 0,
		evictions: 0,
		failures: 0,
		touchFailures: 0,
	};
	let disabled = false;
	let reason = null;
	let dbPromise = null;

	function off(why) {
		if (!disabled) {
			disabled = true;
			reason = why;
		}
		return null;
	}

	function validId(id) {
		if (typeof id !== "string" && typeof id !== "number") return false;
		return /^\d+$/.test(String(id));
	}

	function toBytes(v) {
		if (v instanceof Uint8Array) return v;
		if (typeof ArrayBuffer !== "undefined" && v instanceof ArrayBuffer) return new Uint8Array(v);
		return null;
	}


	function within(promise, fallback) {
		return new Promise((resolve) => {
			let done = false;
			const timer = setTimeout(() => {
				if (done) return;
				done = true;
				off("timeout");
				resolve(fallback);
			}, limits.opTimeoutMs);
			promise.then(
				(v) => {
					if (done) return;
					done = true;
					clearTimeout(timer);
					resolve(v);
				},
				() => {
					if (done) return;
					done = true;
					clearTimeout(timer);
					counters.failures++;
					resolve(fallback);
				},
			);
		});
	}


	function req(r) {
		return new Promise((resolve) => {
			if (!r) {
				resolve(undefined);
				return;
			}
			r.onsuccess = () => resolve(r.result);
			r.onerror = () => {
				counters.failures++;
				resolve(undefined);
			};
		});
	}

	function openDb() {
		if (disabled) return Promise.resolve(null);
		if (!idb) {
			off("unavailable");
			return Promise.resolve(null);
		}
		if (!dbPromise) {
			dbPromise = within(
				new Promise((resolve) => {
					let r = null;
					try {
						r = idb.open(limits.dbName, 1);
					} catch {
						resolve(null);
						return;
					}
					if (!r) {
						resolve(null);
						return;
					}
					r.onupgradeneeded = () => {
						try {
							const db = r.result;
							if (!db.objectStoreNames.contains(limits.storeName)) {
								db.createObjectStore(limits.storeName, { keyPath: "id" });
							}
						} catch {}
					};
					r.onsuccess = () => resolve(r.result || null);
					r.onerror = () => resolve(null);
					r.onblocked = () => resolve(null);
				}),
				null,
			).then((db) => (db ? db : off("open-failed")));
		}
		return dbPromise;
	}

	function storeIn(db, mode) {
		try {
			return db.transaction(limits.storeName, mode).objectStore(limits.storeName);
		} catch {
			counters.failures++;
			return null;
		}
	}

	async function prune(db) {
		let all;
		try {
			const st = storeIn(db, "readonly");
			if (!st) return;
			all = await within(req(st.getAll()), undefined);
		} catch {
			all = undefined;
		}
		if (!Array.isArray(all)) return;
		let total = 0;
		for (const r of all) total += r && Number.isFinite(r.size) ? r.size : 0;
		if (all.length <= limits.maxEntries && total <= limits.maxTotalBytes) return;
		const sorted = all
			.filter((r) => r && r.id != null)
			.sort((a, b) => (a.lastUsed || 0) - (b.lastUsed || 0));
		const w = storeIn(db, "readwrite");
		if (!w) return;
		let count = sorted.length;
		for (const r of sorted) {
			if (count <= limits.maxEntries && total <= limits.maxTotalBytes) break;
			try {
				w.delete(r.id);
			} catch {
				counters.failures++;
				break;
			}
			total -= Number.isFinite(r.size) ? r.size : 0;
			count--;
			counters.evictions++;
		}
	}


	async function get(id) {
		if (disabled) return null;
		if (!validId(id)) {
			counters.misses++;
			return null;
		}
		const db = await openDb();
		if (!db || disabled) return null;
		let rec;
		try {
			const st = storeIn(db, "readonly");
			if (!st) return null;
			rec = await within(req(st.get(String(id))), undefined);
		} catch {
			rec = undefined;
		}
		const bytes = rec ? toBytes(rec.bytes) : null;
		if (!bytes || bytes.length === 0) {
			counters.misses++;
			return null;
		}
		counters.hits++;
		if (!disabled) {

			try {
				const w = storeIn(db, "readwrite");
				if (w) {
					const r2 = w.put({ ...rec, bytes, lastUsed: now() });
					if (r2) r2.onerror = () => counters.touchFailures++;
				}
			} catch {
				counters.touchFailures++;
			}
		}
		return { bytes, container: typeof rec.container === "string" ? rec.container : "" };
	}


	async function put(id, bytesIn, container) {
		if (disabled) return false;
		const bytes = toBytes(bytesIn);
		if (!validId(id) || !bytes || bytes.length === 0 || bytes.length > limits.maxEntryBytes) {
			counters.rejectedPuts++;
			return false;
		}
		const db = await openDb();
		if (!db || disabled) return false;
		let okPut = false;
		try {
			const st = storeIn(db, "readwrite");
			if (!st) return false;

			const copy = bytes.slice();
			const r = await within(
				req(
					st.put({
						id: String(id),
						bytes: copy,
						container: typeof container === "string" ? container : "",
						size: copy.length,
						addedAt: now(),
						lastUsed: now(),
					}),
				),
				undefined,
			);
			okPut = r !== undefined;
		} catch {
			counters.failures++;
			okPut = false;
		}
		if (!okPut) return false;
		counters.puts++;
		await prune(db);
		return true;
	}


	async function clear() {
		if (!disabled && idb) {
			const db = await openDb();
			if (db) {
				try {
					const st = storeIn(db, "readwrite");
					if (st) await within(req(st.clear()), undefined);
				} catch {
					counters.failures++;
				}
			}
		}
		return stats();
	}

	function stats() {
		return { disabled, reason, ...counters };
	}

	return { get, put, clear, stats };
}
