'use strict';
// wake-veil 的沙盒兼容层：补齐 crypto/Buffer/process
// 纯 JS 实现，不依赖任何 node 内置模块（沙盒里全是空壳）

// ===== 简易 SHA-256（纯 JS）=====
const K256 = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];

function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }
function shr(x, n) { return x >>> n; }

function sha256Bytes(data) {
  // data: Uint8Array
  const len = data.length;
  const bitLenHi = Math.floor(len / 0x20000000); // len*8 / 2^32
  const bitLenLo = (len << 3) >>> 0;
  const paddedLen = (((len + 8) >> 6) + 1) << 6;
  const padded = new Uint8Array(paddedLen);
  padded.set(data);
  padded[len] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(paddedLen - 8, bitLenHi >>> 0);
  dv.setUint32(paddedLen - 4, bitLenLo >>> 0);

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

  const w = new Uint32Array(64);
  for (let i = 0; i < paddedLen; i += 64) {
    for (let j = 0; j < 16; j++) {
      w[j] = dv.getUint32(i + j * 4);
    }
    for (let j = 16; j < 64; j++) {
      const s0 = rotr(w[j - 15], 7) ^ rotr(w[j - 15], 18) ^ shr(w[j - 15], 3);
      const s1 = rotr(w[j - 2], 17) ^ rotr(w[j - 2], 19) ^ shr(w[j - 2], 10);
      w[j] = (w[j - 16] + s0 + w[j - 7] + s1) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let j = 0; j < 64; j++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K256[j] + w[j]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }

  const out = new Uint8Array(32);
  const odv = new DataView(out.buffer);
  odv.setUint32(0, h0 >>> 0); odv.setUint32(4, h1 >>> 0);
  odv.setUint32(8, h2 >>> 0); odv.setUint32(12, h3 >>> 0);
  odv.setUint32(16, h4 >>> 0); odv.setUint32(20, h5 >>> 0);
  odv.setUint32(24, h6 >>> 0); odv.setUint32(28, h7 >>> 0);
  return new ShimBuffer(out); // 必须返回 ShimBuffer，否则 Buffer.isBuffer 判定失败
}

// ===== 简易 Buffer（够用就行：alloc/from/concat/isBuffer + 读写方法）=====
class ShimBuffer extends Uint8Array {
  static alloc(size) { return new ShimBuffer(size); }
  static from(data, encoding) {
    if (typeof data === 'string') {
      const enc = encoding || 'utf8';
      if (enc === 'hex') {
        const clean = data.replace(/\s+/g, '');
        const out = new ShimBuffer(clean.length / 2);
        for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
        return out;
      }
      // utf8 / latin1
      let str = data;
      const bytes = [];
      for (let i = 0; i < str.length; i++) {
        let code = str.charCodeAt(i);
        if (code < 0x80) bytes.push(code);
        else if (code < 0x800) {
          bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
        } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length) {
          const code2 = str.charCodeAt(i + 1);
          if (code2 >= 0xdc00 && code2 <= 0xdfff) {
            code = 0x10000 + ((code - 0xd800) << 10) + (code2 - 0xdc00);
            i++;
            bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
          } else bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
        } else if (code < 0x10000) {
          bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
        } else {
          bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
        }
      }
      return new ShimBuffer(bytes);
    }
    if (Array.isArray(data)) return new ShimBuffer(data);
    if (data instanceof Uint8Array) {
      const out = new ShimBuffer(data.length);
      out.set(data);
      return out;
    }
    return new ShimBuffer(0);
  }
  static concat(list) {
    let total = 0;
    for (const b of list) total += b.length;
    const out = new ShimBuffer(total);
    let off = 0;
    for (const b of list) { out.set(b, off); off += b.length; }
    return out;
  }
  static isBuffer(v) { return v instanceof ShimBuffer; }
  static byteLength(str, encoding) {
    const enc = encoding || 'utf8';
    if (enc === 'utf8' || enc === 'utf-8') {
      let bytes = 0;
      for (let i = 0; i < str.length; i++) {
        const code = str.charCodeAt(i);
        if (code < 0x80) bytes += 1;
        else if (code < 0x800) bytes += 2;
        else if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length) {
          const code2 = str.charCodeAt(i + 1);
          if (code2 >= 0xdc00 && code2 <= 0xdfff) { bytes += 4; i++; }
          else bytes += 3;
        } else bytes += 3;
      }
      return bytes;
    }
    if (enc === 'hex') return str.replace(/\s+/g, '').length / 2;
    if (enc === 'latin1' || enc === 'binary') return str.length;
    return str.length; // 兜底
  }
  toString(encoding) {
    if (encoding === 'hex') {
      let s = '';
      for (let i = 0; i < this.length; i++) {
        const b = this[i];
        s += (b < 16 ? '0' : '') + b.toString(16);
      }
      return s;
    }
    // utf8 decode
    let out = '';
    for (let i = 0; i < this.length;) {
      const b0 = this[i];
      if (b0 < 0x80) { out += String.fromCharCode(b0); i++; }
      else if ((b0 & 0xe0) === 0xc0 && i + 1 < this.length) {
        out += String.fromCharCode(((b0 & 0x1f) << 6) | (this[i + 1] & 0x3f)); i += 2;
      }
      else if ((b0 & 0xf0) === 0xe0 && i + 2 < this.length) {
        out += String.fromCharCode(((b0 & 0x0f) << 12) | ((this[i + 1] & 0x3f) << 6) | (this[i + 2] & 0x3f)); i += 3;
      }
      else if ((b0 & 0xf8) === 0xf0 && i + 3 < this.length) {
        let cp = ((b0 & 0x07) << 18) | ((this[i + 1] & 0x3f) << 12) | ((this[i + 2] & 0x3f) << 6) | (this[i + 3] & 0x3f);
        cp -= 0x10000;
        out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff)); i += 4;
      } else { out += String.fromCharCode(b0); i++; }
    }
    return out;
  }
  writeBigUInt64BE(value) {
    const dv = new DataView(this.buffer, this.byteOffset, this.byteLength);
    dv.setBigUint64(0, value, false);
    return 8;
  }
  readBigUInt64BE(offset) {
    const dv = new DataView(this.buffer, this.byteOffset, this.byteLength);
    return dv.getBigUint64(offset || 0, false);
  }
  writeUInt8(v, off) { this[off] = v; return 1; }
  writeUInt16BE(v, off) {
    const dv = new DataView(this.buffer, this.byteOffset, this.byteLength);
    dv.setUint16(off || 0, v, false); return 2;
  }
  writeUInt32BE(v, off) {
    const dv = new DataView(this.buffer, this.byteOffset, this.byteLength);
    dv.setUint32(off || 0, v, false); return 4;
  }
  readUInt8(off) { return this[off]; }
  readUInt16BE(off) {
    const dv = new DataView(this.buffer, this.byteOffset, this.byteLength);
    return dv.getUint16(off || 0, false);
  }
  readUInt32BE(off) {
    const dv = new DataView(this.buffer, this.byteOffset, this.byteLength);
    return dv.getUint32(off || 0, false);
  }
  slice(start, end) {
    const s = start || 0, e = end === undefined ? this.length : end;
    const out = new ShimBuffer(Math.max(0, e - s));
    for (let i = s; i < e && i < this.length; i++) out[i - s] = this[i];
    return out;
  }
  subarray(start, end) { return this.slice(start, end); }
  copy(target, targetStart) {
    const ts = targetStart || 0;
    for (let i = 0; i < this.length && ts + i < target.length; i++) target[ts + i] = this[i];
    return Math.min(this.length, target.length - ts);
  }
  indexOf(byte) {
    for (let i = 0; i < this.length; i++) if (this[i] === byte) return i;
    return -1;
  }
}

// ===== 随机数源 =====
function randomBytes(size) {
  const out = new ShimBuffer(size);
  // 用高精度时间 + 计数器混合，够非加密用途（wake 调度阈值用）
  let seed = Date.now() ^ (typeof performance !== 'undefined' ? Math.floor(performance.now() * 1000) : 0);
  for (let i = 0; i < size; i++) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    out[i] = seed & 0xff;
  }
  // 混入 Math.random 提升熵
  for (let i = 0; i < size; i++) {
    out[i] = (out[i] ^ (Math.floor(Math.random() * 256))) & 0xff;
  }
  return out;
}

function randomUUID() {
  const b = randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString('hex');
  return h.substr(0, 8) + '-' + h.substr(8, 4) + '-' + h.substr(12, 4) + '-' + h.substr(16, 4) + '-' + h.substr(20, 12);
}

// ===== Hash 类 =====
class ShimHash {
  constructor(algorithm) {
    this.algorithm = algorithm; // sha256
    this.parts = [];
  }
  update(data) {
    if (typeof data === 'string') this.parts.push(ShimBuffer.from(data, 'utf8'));
    else this.parts.push(ShimBuffer.from(data));
    return this;
  }
  digest(encoding) {
    const input = ShimBuffer.concat(this.parts);
    const digested = sha256Bytes(input);
    if (encoding === 'hex') return digested.toString('hex');
    return digested; // 返回 Uint8Array（Buffer 语义）
  }
}

// ===== crypto shim =====
const crypto = {
  createHash: (algo) => {
    if (algo !== 'sha256') throw new Error('shim only supports sha256');
    return new ShimHash(algo);
  },
  randomBytes,
  randomUUID,
  // 为了兼容原生 Buffer.toString 在 Uint8Array 上的缺失
};

// ===== AbortController / AbortSignal shim（QuickJS 沙盒缺失）=====
class ShimAbortSignal {
  constructor() {
    this.aborted = false;
    this.reason = undefined;
    this._listeners = new Set();
  }
  addEventListener(type, fn) {
    if (type === 'abort' && typeof fn === 'function') this._listeners.add(fn);
  }
  removeEventListener(type, fn) {
    if (type === 'abort') this._listeners.delete(fn);
  }
  dispatchEvent() { return true; }
}

class ShimAbortController {
  constructor() { this.signal = new ShimAbortSignal(); }
  abort(reason) {
    if (this.signal.aborted) return;
    this.signal.aborted = true;
    this.signal.reason = reason !== undefined ? reason : new Error('Aborted');
    const listeners = Array.from(this.signal._listeners);
    this.signal._listeners.clear();
    for (const fn of listeners) {
      try { fn({ type: 'abort', target: this.signal }); } catch (_) {}
    }
  }
}

// ===== process shim（够 file persistence 用）=====
const process = {
  pid: 1,
  env: {},
  platform: 'android',
  nextTick: (fn, ...args) => setTimeout(() => fn(...args), 0)
};

module.exports = { crypto, process, ShimBuffer, ShimAbortController, ShimAbortSignal };