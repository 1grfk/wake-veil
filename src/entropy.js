'use strict';

require('./env');
const { crypto } = require('./shim');

const ENTROPY_ALGORITHM_VERSION = 'wake.entropy.sha256-boxmuller.v1';
const INTEGRATOR_VERSION = 'wake.seeded-path.fixed-step.v1';

function assertSeed(seed) {
  if (typeof seed !== 'string' || !/^[0-9a-f]{64}$/.test(seed)) {
    throw new TypeError('driftSeed must be 64 lowercase hex characters');
  }
  return seed;
}

function encodeEntropyPayload(seed, domain, stepIndex, lane) {
  assertSeed(seed);
  if (domain !== 'tone' && domain !== 'drift') throw new TypeError('Unsupported entropy domain');
  if (!Number.isSafeInteger(stepIndex) || stepIndex < 0) throw new TypeError('stepIndex must be a non-negative safe integer');
  if (lane !== 0 && lane !== 1) throw new TypeError('lane must be 0 or 1');
  const step = Buffer.alloc(8);
  step.writeBigUInt64BE(BigInt(stepIndex));
  return Buffer.concat([
    Buffer.from(ENTROPY_ALGORITHM_VERSION, 'utf8'),
    Buffer.from([0]),
    Buffer.from(seed, 'hex'),
    Buffer.from([0]),
    Buffer.from(domain, 'utf8'),
    Buffer.from([0]),
    step,
    Buffer.from([lane])
  ]);
}

function entropyDigest(seed, domain, stepIndex, lane) {
  return crypto.createHash('sha256').update(encodeEntropyPayload(seed, domain, stepIndex, lane)).digest();
}

function uniformFromDigest(digest) {
  if (!(digest instanceof Uint8Array) || digest.length < 8) throw new TypeError('digest must contain at least 8 bytes');
  const n64 = digest.readBigUInt64BE(0);
  const n53 = n64 >> 11n;
  const value = (Number(n53) + 0.5) / 9007199254740992;
  // The exact rational for the maximum n53 is 1 - 2^-54, which binary64 can
  // tie-round to 1. Preserve strict (0,1) with the immediate predecessor of 1.
  return Math.min(1 - Number.EPSILON / 2, Math.max(Number.MIN_VALUE, value));
}

function normalFromSeed(seed, domain, stepIndex) {
  const u1 = uniformFromDigest(entropyDigest(seed, domain, stepIndex, 0));
  const u2 = uniformFromDigest(entropyDigest(seed, domain, stepIndex, 1));
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function thresholdUniformFromBytes(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 8) throw new TypeError('threshold entropy must contain at least 8 bytes');
  return uniformFromDigest(bytes);
}

function createEntropyRecord(options = {}) {
  const randomBytes = typeof options.randomBytes === 'function' ? options.randomBytes : crypto.randomBytes;
  const nowMs = Number(options.nowMs);
  if (!Number.isSafeInteger(nowMs) || nowMs < 1) throw new TypeError('nowMs must be UTC epoch milliseconds');
  const cycleId = String(options.cycleId || '').trim();
  if (!cycleId) throw new TypeError('cycleId is required');
  const thresholdBytes = randomBytes(8);
  const seedBytes = randomBytes(32);
  if (!(thresholdBytes instanceof Uint8Array) || thresholdBytes.length !== 8) throw new TypeError('randomBytes(8) returned invalid data');
  if (!(seedBytes instanceof Uint8Array) || seedBytes.length !== 32) throw new TypeError('randomBytes(32) returned invalid data');
  return Object.freeze({
    cycleId,
    thresholdSample: -Math.log(thresholdUniformFromBytes(thresholdBytes)) * 1.4,
    driftSeed: seedBytes.toString('hex'),
    policyVersion: options.policyVersion,
    integratorVersion: INTEGRATOR_VERSION,
    entropyAlgorithmVersion: ENTROPY_ALGORITHM_VERSION,
    cycleGridAnchorAtMs: nowMs,
    createdAtMs: nowMs
  });
}

module.exports = {
  ENTROPY_ALGORITHM_VERSION,
  INTEGRATOR_VERSION,
  createEntropyRecord,
  encodeEntropyPayload,
  entropyDigest,
  normalFromSeed,
  thresholdUniformFromBytes,
  uniformFromDigest
};
