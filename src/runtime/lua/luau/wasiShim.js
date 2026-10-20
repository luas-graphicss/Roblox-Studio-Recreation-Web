const ERRNO_SUCCESS = 0;
const ERRNO_BADF = 8;
const ERRNO_NOSYS = 52;

export function createWasiShim(getMemory, options = {}) {
  const onStdout = options.onStdout || (() => {});


  const decoders = { 1: new TextDecoder("utf-8"), 2: new TextDecoder("utf-8") };


  const lineBufs = { 1: "", 2: "" };

  function view() {
    return new DataView(getMemory().buffer);
  }
  function bytes() {
    return new Uint8Array(getMemory().buffer);
  }

  function fdWrite(fd, iovsPtr, iovsLen, nwrittenPtr) {
    const dv = view();
    const mem = bytes();
    let written = 0;
    let total = 0;
    const spans = [];
    for (let i = 0; i < iovsLen; i++) {
      const base = dv.getUint32(iovsPtr + i * 8, true);
      const len = dv.getUint32(iovsPtr + i * 8 + 4, true);
      if (len > 0) {
        spans.push([base, len]);
        total += len;
        written += len;
      }
    }
    dv.setUint32(nwrittenPtr, written, true);
    if ((fd === 1 || fd === 2) && total > 0) {

      const all = new Uint8Array(total);
      let off = 0;
      for (const [base, len] of spans) {
        all.set(mem.subarray(base, base + len), off);
        off += len;
      }
      let buf = lineBufs[fd] + decoders[fd].decode(all, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        onStdout(buf.slice(0, nl), fd);
        buf = buf.slice(nl + 1);
      }
      lineBufs[fd] = buf;
    }
    return ERRNO_SUCCESS;
  }

  const t0 = Date.now();
  function nowNs() {
    const ms =
      typeof performance !== "undefined" && performance.now
        ? performance.now()
        : Date.now() - t0;
    return BigInt(Math.round(ms * 1e6));
  }

  return {
    fd_write: fdWrite,
    fd_read: () => ERRNO_BADF,
    fd_close: () => ERRNO_SUCCESS,
    fd_seek: () => ERRNO_BADF,
    fd_fdstat_get: (fd, ptr) => {
      if (fd > 2) return ERRNO_BADF;
      const dv = view();
      dv.setUint8(ptr, 2);
      dv.setUint8(ptr + 1, 0);
      dv.setUint16(ptr + 2, 0, true);
      dv.setBigUint64(ptr + 8, 0n, true);
      dv.setBigUint64(ptr + 16, 0n, true);
      return ERRNO_SUCCESS;
    },
    fd_fdstat_set_flags: () => ERRNO_BADF,
    fd_prestat_get: () => ERRNO_BADF,
    fd_prestat_dir_name: () => ERRNO_BADF,
    path_open: () => ERRNO_NOSYS,
    path_filestat_get: () => ERRNO_NOSYS,
    fd_filestat_get: () => ERRNO_BADF,
    environ_sizes_get: (countPtr, sizePtr) => {
      const dv = view();
      dv.setUint32(countPtr, 0, true);
      dv.setUint32(sizePtr, 0, true);
      return ERRNO_SUCCESS;
    },
    environ_get: () => ERRNO_SUCCESS,
    args_sizes_get: (countPtr, sizePtr) => {
      const dv = view();
      dv.setUint32(countPtr, 0, true);
      dv.setUint32(sizePtr, 0, true);
      return ERRNO_SUCCESS;
    },
    args_get: () => ERRNO_SUCCESS,
    clock_time_get: (id, precision, outPtr) => {
      const dv = view();
      if (id === 0) {
        dv.setBigUint64(outPtr, BigInt(Date.now()) * 1000000n, true);
      } else {
        dv.setBigUint64(outPtr, nowNs(), true);
      }
      return ERRNO_SUCCESS;
    },
    clock_res_get: (id, outPtr) => {
      view().setBigUint64(outPtr, 1000n, true);
      return ERRNO_SUCCESS;
    },


    random_get: (bufPtr, len) => {
      const ERRNO_IO_ERROR = 29;            
      const MAX_RANDOM_CHUNK_BYTES = 65536;                                       
      if (typeof crypto === "undefined" || typeof crypto.getRandomValues !== "function") {
        return ERRNO_IO_ERROR;
      }
      const mem = bytes().subarray(bufPtr, bufPtr + len);
      for (let offset = 0; offset < len; offset += MAX_RANDOM_CHUNK_BYTES) {
        crypto.getRandomValues(mem.subarray(offset, Math.min(offset + MAX_RANDOM_CHUNK_BYTES, len)));
      }
      return ERRNO_SUCCESS;
    },
    sched_yield: () => ERRNO_SUCCESS,
    poll_oneoff: () => ERRNO_NOSYS,
    proc_exit: (code) => {
      throw new Error("Luau VM: proc_exit(" + code + ")");
    },
  };
}
