'use strict';

const DISPATCH_FIELDS = Object.freeze([
  'activationId', 'cycleId', 'occurredAt', 'opportunityId', 'payloadRef', 'source', 'sourceRef'
]);
const FORBIDDEN_AUTHORITY_KEYS = Object.freeze(new Set([
  'provider', 'model', 'route', 'routeid', 'hostactiveroute', 'fallback', 'message',
  'assistantmessage', 'tool', 'mcp', 'permission', 'actionpermission', 'persona', 'prompt'
]));

function normalizedKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function assertNoAuthorityLeak(value, seen = new Set()) {
  if (!value || typeof value !== 'object') return;
  if (seen.has(value)) throw new TypeError('Wake payload must not be circular');
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_AUTHORITY_KEYS.has(normalizedKey(key))) throw new TypeError(`Wake authority field is forbidden: ${key}`);
    assertNoAuthorityLeak(child, seen);
  }
  seen.delete(value);
}

function requiredText(value, label) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new TypeError(`${label} is required`);
  return text;
}

function createWakeDispatchRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype) {
    throw new TypeError('Wake dispatch request must be a plain object');
  }
  for (const key of Object.keys(input)) {
    if (!DISPATCH_FIELDS.includes(key)) throw new TypeError(`Unknown Wake dispatch field: ${key}`);
  }
  assertNoAuthorityLeak(input);
  const occurredAt = Number(input.occurredAt);
  if (!Number.isSafeInteger(occurredAt) || occurredAt < 1) throw new TypeError('occurredAt must be UTC epoch milliseconds');
  const source = requiredText(input.source, 'source');
  const request = {
    opportunityId: requiredText(input.opportunityId, 'opportunityId'),
    activationId: requiredText(input.activationId, 'activationId'),
    source,
    occurredAt
  };
  if (source === 'spontaneous') request.cycleId = requiredText(input.cycleId, 'cycleId');
  else if (input.cycleId !== undefined && input.cycleId !== null) request.cycleId = requiredText(input.cycleId, 'cycleId');
  if (input.sourceRef !== undefined) request.sourceRef = requiredText(input.sourceRef, 'sourceRef');
  if (input.payloadRef !== undefined) request.payloadRef = requiredText(input.payloadRef, 'payloadRef');
  return Object.freeze(request);
}

function buildDynamicWakeupContribution(requestInput) {
  const request = createWakeDispatchRequest(requestInput);
  return Object.freeze({
    wakeup: Object.freeze({
      activationId: request.activationId,
      source: request.source,
      occurredAt: request.occurredAt,
      ...(request.sourceRef ? { sourceRef: request.sourceRef } : {}),
      ...(request.payloadRef ? { payloadRef: request.payloadRef } : {})
    })
  });
}

module.exports = { DISPATCH_FIELDS, assertNoAuthorityLeak, buildDynamicWakeupContribution, createWakeDispatchRequest };
