'use strict';

function normalizeSourceId(value) {
  const sourceId = typeof value === 'string' ? value.trim() : '';
  if (!sourceId || sourceId.length > 120) throw new TypeError('Wake sourceId is invalid');
  if (sourceId === 'spontaneous') throw new TypeError('spontaneous source is owned by the activation kernel');
  return sourceId;
}

function createWakeSourceRegistry(options = {}) {
  const submitExternalOpportunity = options.submitExternalOpportunity;
  const cancelExternalOpportunity = options.cancelExternalOpportunity;
  if (typeof submitExternalOpportunity !== 'function') throw new TypeError('Wake source registry submit port is required');
  if (cancelExternalOpportunity !== undefined && typeof cancelExternalOpportunity !== 'function') {
    throw new TypeError('Wake source registry cancel port must be a function');
  }
  const sources = new Map();

  function register(sourceIdInput, adapter, config = {}) {
    const sourceId = normalizeSourceId(sourceIdInput);
    if (!adapter || typeof adapter !== 'object') throw new TypeError('Wake source adapter is required');
    if (sources.has(sourceId)) throw new Error('wake_source_already_registered');
    const entry = { adapter, enabled: config.enabled !== false };
    sources.set(sourceId, entry);
    return Object.freeze({ sourceId, enabled: entry.enabled });
  }

  async function emit(sourceIdInput, facts = {}) {
    const sourceId = normalizeSourceId(sourceIdInput);
    const entry = sources.get(sourceId);
    if (!entry) throw new Error('wake_source_not_registered');
    if (!entry.enabled) return { noOp: true, reason: 'wake_source_disabled', retryable: true };
    return submitExternalOpportunity({ ...facts, source: sourceId });
  }

  async function cancel(sourceIdInput, sourceRef, reason = 'source_cancelled') {
    const sourceId = normalizeSourceId(sourceIdInput);
    if (!sources.has(sourceId)) throw new Error('wake_source_not_registered');
    if (typeof cancelExternalOpportunity !== 'function') throw new Error('wake_source_cancel_unavailable');
    if (!['source_cancelled', 'source_expired'].includes(reason)) throw new TypeError('Wake source cancel reason is invalid');
    return cancelExternalOpportunity({ source: sourceId, sourceRef, reason });
  }

  return Object.freeze({
    cancel,
    emit,
    expire(sourceId, sourceRef) { return cancel(sourceId, sourceRef, 'source_expired'); },
    get(sourceId) {
      const entry = sources.get(normalizeSourceId(sourceId));
      return entry ? entry.adapter : null;
    },
    isEnabled(sourceId) {
      const entry = sources.get(normalizeSourceId(sourceId));
      return !!entry && entry.enabled;
    },
    list: () => [...sources.entries()].map(([sourceId, entry]) => ({ sourceId, enabled: entry.enabled })),
    register,
    setEnabled(sourceIdInput, enabled) {
      const sourceId = normalizeSourceId(sourceIdInput);
      const entry = sources.get(sourceId);
      if (!entry) throw new Error('wake_source_not_registered');
      entry.enabled = enabled === true;
      return Object.freeze({ sourceId, enabled: entry.enabled });
    },
    unregister(sourceId) { return sources.delete(normalizeSourceId(sourceId)); }
  });
}

module.exports = { createWakeSourceRegistry, normalizeSourceId };
