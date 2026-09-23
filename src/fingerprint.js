/*
 * Small, synchronous, browser-compatible SHA-256 and canonical serializer.
 *
 * JSON.stringify is not a sufficient identity format here: object insertion
 * order is observable, NaN becomes null, and a rounded number can replay a
 * different trajectory.  The serializer below sorts object keys, preserves
 * JavaScript's shortest round-tripping number spelling (including -0), and
 * rejects every non-finite number before it can reach an artifact.
 */

function utf8Bytes(text) {
  const bytes = [];
  for (let index = 0; index < text.length; index += 1) {
    let codePoint = text.charCodeAt(index);
    if (codePoint >= 0xd800 && codePoint <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        codePoint = 0x10000 + ((codePoint - 0xd800) << 10) + (next - 0xdc00);
        index += 1;
      } else {
        codePoint = 0xfffd;
      }
    } else if (codePoint >= 0xdc00 && codePoint <= 0xdfff) {
      codePoint = 0xfffd;
    }
    if (codePoint <= 0x7f) bytes.push(codePoint);
    else if (codePoint <= 0x7ff) bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    else if (codePoint <= 0xffff) bytes.push(0xe0 | (codePoint >> 12), 0x80 | ((codePoint >> 6) & 0x3f), 0x80 | (codePoint & 0x3f));
    else bytes.push(0xf0 | (codePoint >> 18), 0x80 | ((codePoint >> 12) & 0x3f), 0x80 | ((codePoint >> 6) & 0x3f), 0x80 | (codePoint & 0x3f));
  }
  return Uint8Array.from(bytes);
}

function encodeCanonical(value, seen) {
  if (value === null) return "null";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("canonical payload contains a non-finite number");
    return Object.is(value, -0) ? "-0" : String(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
    throw new TypeError("canonical payload contains an unsupported value");
  }
  if (seen.has(value)) throw new TypeError("canonical payload contains a cycle");
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    throw new TypeError("canonical payload requires plain objects");
  }
  if (Object.getOwnPropertySymbols(value).length) throw new TypeError("canonical payload contains symbol keys");
  seen.add(value);
  let encoded;
  if (Array.isArray(value)) {
    encoded = `[${Array.from(value, (item) => encodeCanonical(item, seen)).join(",")}]`;
  } else {
    const keys = Object.keys(value).sort();
    encoded = `{${keys.map((key) => `${JSON.stringify(key)}:${encodeCanonical(value[key], seen)}`).join(",")}}`;
  }
  seen.delete(value);
  return encoded;
}

export function canonicalSerialize(value) {
  return encodeCanonical(value, new Set());
}

// Bounded replay diagnostics: report the first unequal leaf, never whole arrays.
export function firstDifference(left, right, path = "root") {
  if (Object.is(left, right)) return null;
  if (left && right && typeof left === "object" && typeof right === "object") {
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])];
    for (const key of keys) {
      const child = Array.isArray(left) ? `${path}[${key}]` : `${path}.${key}`;
      if (!Object.hasOwn(left, key) || !Object.hasOwn(right, key)) return `${child}: missing key`;
      const difference = firstDifference(left[key], right[key], child);
      if (difference) return difference;
    }
    return null;
  }
  const describe = (value) => {
    if (typeof value !== "number") return String(value).slice(0, 100);
    const bytes = new DataView(new ArrayBuffer(8));
    bytes.setFloat64(0, value);
    return `${Object.is(value, -0) ? "-0" : value} (0x${bytes.getBigUint64(0).toString(16).padStart(16, "0")})`;
  };
  return `${path}: ${describe(left)} != ${describe(right)}`;
}

const ROUND_CONSTANTS = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

const INITIAL_HASH = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
];

const rotateRight = (value, amount) => (value >>> amount) | (value << (32 - amount));

export function sha256Hex(input) {
  const bytes = utf8Bytes(String(input));
  const blockLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(blockLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const bitLength = bytes.length * 8;
  // The message length is a 64-bit big-endian integer.
  const highBits = Math.floor(bitLength / 0x100000000);
  padded[blockLength - 8] = highBits >>> 24;
  padded[blockLength - 7] = (highBits >>> 16) & 0xff;
  padded[blockLength - 6] = (highBits >>> 8) & 0xff;
  padded[blockLength - 5] = highBits & 0xff;
  padded[blockLength - 4] = Math.floor(bitLength / 0x1000000) & 0xff;
  padded[blockLength - 3] = Math.floor(bitLength / 0x10000) & 0xff;
  padded[blockLength - 2] = Math.floor(bitLength / 0x100) & 0xff;
  padded[blockLength - 1] = bitLength & 0xff;

  const hash = [...INITIAL_HASH];
  const schedule = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const start = offset + index * 4;
      schedule[index] = ((padded[start] << 24) | (padded[start + 1] << 16) | (padded[start + 2] << 8) | padded[start + 3]) >>> 0;
    }
    for (let index = 16; index < 64; index += 1) {
      const value = schedule[index - 15];
      const smallSigma0 = rotateRight(value, 7) ^ rotateRight(value, 18) ^ (value >>> 3);
      const previous = schedule[index - 2];
      const smallSigma1 = rotateRight(previous, 17) ^ rotateRight(previous, 19) ^ (previous >>> 10);
      schedule[index] = (schedule[index - 16] + smallSigma0 + schedule[index - 7] + smallSigma1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const bigSigma1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choose = (e & f) ^ (~e & g);
      const first = (h + bigSigma1 + choose + ROUND_CONSTANTS[index] + schedule[index]) >>> 0;
      const bigSigma0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const second = (bigSigma0 + majority) >>> 0;
      h = g; g = f; f = e; e = (d + first) >>> 0;
      d = c; c = b; b = a; a = (first + second) >>> 0;
    }
    hash[0] = (hash[0] + a) >>> 0;
    hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0;
    hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0;
    hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0;
    hash[7] = (hash[7] + h) >>> 0;
  }
  return hash.map((value) => value.toString(16).padStart(8, "0")).join("");
}

export function fingerprintValue(value) {
  return `sha256-${sha256Hex(canonicalSerialize(value))}`;
}
