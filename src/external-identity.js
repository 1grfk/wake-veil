'use strict';

require('./env');
const { crypto } = require('./shim');

function requiredIdentityText(value, label) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new TypeError(`${label} is required`);
  return text;
}

function lengthPrefixed(value) {
  const text = String(value);
  return `${Buffer.byteLength(text, 'utf8')}:${text}`;
}

function canonicalExternalIdentity(sourceInput, sourceRefInput) {
  const source = requiredIdentityText(sourceInput, 'source');
  const sourceRef = requiredIdentityText(sourceRefInput, 'sourceRef');
  const canonical = `wake-external-identity-v1|${lengthPrefixed(source)}|${lengthPrefixed(sourceRef)}`;
  const digest = crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
  return Object.freeze({
    canonicalVersion: 'wake.external.identity.v1',
    digest,
    dedupeKey: `wake:external:v1:${digest}`,
    activationId: `wa_ext_${digest.slice(0, 24)}`,
    opportunityId: `wk_${digest.slice(0, 24)}`
  });
}

module.exports = { canonicalExternalIdentity, lengthPrefixed };
