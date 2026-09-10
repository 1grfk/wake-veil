'use strict';

const { assertNoAuthorityLeak, createWakeDispatchRequest } = require('./contracts');

const ADAPTER_OPTION_FIELDS = Object.freeze(new Set(['runtime']));
const DISPATCH_HOOK_FIELDS = Object.freeze(new Set(['onProviderDispatched', 'signal']));
const RESULT_FIELDS = Object.freeze(new Set([
  'agentRunOccurredAtMs', 'agentRunRef', 'inferenceAttemptRef', 'opportunityId',
  'outcome', 'reason', 'resultRef', 'retryable', 'status'
]));
const DISPATCH_STATUSES = Object.freeze(new Set([
  'completed', 'deferred_user_priority', 'outcome_unknown', 'pre_dispatch_failed',
  'provider_dispatched', 'technical_backpressure'
]));
const RECONCILE_STATUSES = Object.freeze(new Set([
  'completed', 'not_found', 'outcome_unknown', 'provider_dispatched'
]));
const IRREVERSIBLE_STATUSES = Object.freeze(new Set([
  'completed', 'outcome_unknown', 'provider_dispatched'
]));
const PROVIDER_BOUNDARY_FIELDS = Object.freeze(new Set([
  'inferenceAttemptRef', 'opportunityId', 'status'
]));

function runtimeAdapterError(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) {
    throw runtimeAdapterError('runtime_result_invalid', `${label} must be a plain object`);
  }
}

function requiredText(value, field) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw runtimeAdapterError('runtime_result_invalid', `${field} is required`);
  return text;
}

function optionalText(value, field) {
  if (value === undefined || value === null) return undefined;
  return requiredText(value, field);
}

function validateRuntimeAttemptResult(input, expectedOpportunityId, phase = 'dispatch') {
  assertPlainObject(input, 'Runtime InferenceAttempt result');
  assertNoAuthorityLeak(input);
  for (const key of Object.keys(input)) {
    if (!RESULT_FIELDS.has(key)) {
      throw runtimeAdapterError('runtime_result_invalid', `Unknown Runtime result field: ${key}`);
    }
  }
  const statuses = phase === 'reconcile' ? RECONCILE_STATUSES : DISPATCH_STATUSES;
  const status = requiredText(input.status, 'status');
  if (!statuses.has(status)) {
    throw runtimeAdapterError('runtime_result_invalid', `Unsupported Runtime result status: ${status}`);
  }
  const opportunityId = requiredText(input.opportunityId, 'opportunityId');
  if (opportunityId !== expectedOpportunityId) {
    throw runtimeAdapterError('runtime_result_identity_mismatch', 'Runtime result opportunityId does not match request');
  }
  const inferenceAttemptRef = optionalText(input.inferenceAttemptRef, 'inferenceAttemptRef');
  if (IRREVERSIBLE_STATUSES.has(status) && !inferenceAttemptRef) {
    throw runtimeAdapterError('runtime_result_invalid', `${status} requires inferenceAttemptRef`);
  }
  const agentRunRef = optionalText(input.agentRunRef, 'agentRunRef');
  if (status === 'completed' && !agentRunRef) {
    throw runtimeAdapterError('runtime_result_invalid', 'completed requires agentRunRef');
  }
  if (status === 'completed' && input.agentRunOccurredAtMs === undefined) {
    throw runtimeAdapterError(
      'runtime_result_invalid',
      'completed requires authoritative agentRunOccurredAtMs'
    );
  }
  if (input.retryable !== undefined && typeof input.retryable !== 'boolean') {
    throw runtimeAdapterError('runtime_result_invalid', 'retryable must be boolean');
  }
  if (input.agentRunOccurredAtMs !== undefined
    && (!Number.isSafeInteger(input.agentRunOccurredAtMs) || input.agentRunOccurredAtMs < 1)) {
    throw runtimeAdapterError('runtime_result_invalid', 'agentRunOccurredAtMs must be UTC epoch milliseconds');
  }
  const normalized = {
    status,
    opportunityId,
    ...(inferenceAttemptRef ? { inferenceAttemptRef } : {}),
    ...(agentRunRef ? { agentRunRef } : {}),
    ...(input.agentRunOccurredAtMs !== undefined ? { agentRunOccurredAtMs: input.agentRunOccurredAtMs } : {}),
    ...(input.outcome !== undefined ? { outcome: requiredText(input.outcome, 'outcome') } : {}),
    ...(input.resultRef !== undefined ? { resultRef: requiredText(input.resultRef, 'resultRef') } : {}),
    ...(input.reason !== undefined ? { reason: requiredText(input.reason, 'reason') } : {}),
    ...(input.retryable !== undefined ? { retryable: input.retryable } : {})
  };
  return Object.freeze(normalized);
}

function validateProviderBoundary(input, expectedOpportunityId) {
  assertPlainObject(input, 'Runtime provider boundary');
  for (const key of Object.keys(input)) {
    if (!PROVIDER_BOUNDARY_FIELDS.has(key)) {
      throw runtimeAdapterError(
        'runtime_provider_boundary_invalid',
        `Unknown provider boundary field: ${key}`
      );
    }
  }
  const boundary = validateRuntimeAttemptResult(input, expectedOpportunityId, 'dispatch');
  if (boundary.status !== 'provider_dispatched') {
    throw runtimeAdapterError('runtime_provider_boundary_invalid', 'Provider boundary must be provider_dispatched');
  }
  return boundary;
}

function sameProviderBoundary(left, right) {
  return left.status === right.status
    && left.opportunityId === right.opportunityId
    && left.inferenceAttemptRef === right.inferenceAttemptRef;
}

function createAuthoritativeRuntimeWakeDispatchPort(options = {}) {
  assertPlainObject(options, 'Runtime adapter options');
  for (const key of Object.keys(options)) {
    if (!ADAPTER_OPTION_FIELDS.has(key)) {
      throw runtimeAdapterError('runtime_adapter_authority_leak', `Runtime adapter option is forbidden: ${key}`);
    }
  }
  const runtime = options.runtime;
  if (!runtime || typeof runtime !== 'object') {
    throw runtimeAdapterError('runtime_authority_unavailable', 'Host Runtime authority is required');
  }
  if (typeof runtime.dispatchWakeInferenceAttempt !== 'function'
    || typeof runtime.reconcileWakeInferenceAttempt !== 'function') {
    throw runtimeAdapterError(
      'runtime_authority_incomplete',
      'Host Runtime must provide dispatchWakeInferenceAttempt and reconcileWakeInferenceAttempt'
    );
  }

  async function dispatch(rawRequest, hooks = {}) {
    const request = createWakeDispatchRequest(rawRequest);
    assertPlainObject(hooks, 'Runtime dispatch hooks');
    for (const key of Object.keys(hooks)) {
      if (!DISPATCH_HOOK_FIELDS.has(key)) {
        throw runtimeAdapterError('runtime_adapter_authority_leak', `Runtime dispatch hook is forbidden: ${key}`);
      }
    }
    const onProviderDispatched = hooks && typeof hooks.onProviderDispatched === 'function'
      ? hooks.onProviderDispatched
      : null;
    if (hooks.onProviderDispatched !== undefined && !onProviderDispatched) {
      throw runtimeAdapterError('runtime_adapter_hook_invalid', 'onProviderDispatched must be a function');
    }
    const signal = hooks && hooks.signal;
    if (signal !== undefined && (!signal || typeof signal !== 'object'
      || typeof signal.aborted !== 'boolean' || typeof signal.addEventListener !== 'function')) {
      throw runtimeAdapterError('runtime_adapter_hook_invalid', 'signal must be an AbortSignal');
    }
    let boundaryEntry = null;
    let dispatchClosed = false;
    const runtimeHooks = Object.freeze({
      ...(signal ? { signal } : {}),
      onProviderDispatched: async rawBoundary => {
        const boundary = validateProviderBoundary(rawBoundary, request.opportunityId);
        if (boundaryEntry) {
          if (!sameProviderBoundary(boundaryEntry.boundary, boundary)) {
            throw runtimeAdapterError(
              'runtime_provider_boundary_conflict',
              'Provider boundary cannot change inferenceAttemptRef'
            );
          }
          return boundaryEntry.receiptPromise;
        }
        if (dispatchClosed) {
          throw runtimeAdapterError(
            'runtime_provider_boundary_late',
            'Provider boundary arrived after dispatch was closed'
          );
        }
        const entry = { boundary, receiptPromise: null };
        entry.receiptPromise = (async () => {
          if (onProviderDispatched) await onProviderDispatched(boundary);
          return boundary;
        })();
        boundaryEntry = entry;
        return entry.receiptPromise;
      }
    });
    try {
      const rawResult = await runtime.dispatchWakeInferenceAttempt(request, runtimeHooks);
      const result = validateRuntimeAttemptResult(rawResult, request.opportunityId, 'dispatch');
      const frozenBoundary = boundaryEntry ? await boundaryEntry.receiptPromise : null;
      if (IRREVERSIBLE_STATUSES.has(result.status) && !frozenBoundary) {
        throw runtimeAdapterError(
          'runtime_provider_boundary_missing',
          `${result.status} requires an observed provider_dispatched boundary`
        );
      }
      if (frozenBoundary && !IRREVERSIBLE_STATUSES.has(result.status)) {
        throw runtimeAdapterError(
          'runtime_provider_boundary_regression',
          `Runtime cannot return ${result.status} after provider_dispatched`
        );
      }
      if (frozenBoundary && result.inferenceAttemptRef !== frozenBoundary.inferenceAttemptRef) {
        throw runtimeAdapterError(
          'runtime_provider_boundary_identity_mismatch',
          'Runtime result inferenceAttemptRef differs from the frozen provider boundary'
        );
      }
      return result;
    } finally {
      dispatchClosed = true;
    }
  }

  async function reconcile(opportunityIdInput) {
    const opportunityId = requiredText(opportunityIdInput, 'opportunityId');
    const rawResult = await runtime.reconcileWakeInferenceAttempt(Object.freeze({ opportunityId }));
    return validateRuntimeAttemptResult(rawResult, opportunityId, 'reconcile');
  }

  return Object.freeze({
    kind: 'authoritative_runtime_delegating',
    dispatch,
    reconcile
  });
}

module.exports = {
  createAuthoritativeRuntimeWakeDispatchPort,
  runtimeAdapterError,
  validateRuntimeAttemptResult
};
