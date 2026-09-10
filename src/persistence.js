'use strict';

require('./env');
const { crypto } = require('./shim');
const fs = require('fs');
const path = require('path');
const { ENTROPY_ALGORITHM_VERSION, INTEGRATOR_VERSION } = require('./entropy');
const { DEFAULT_POLICY } = require('./policy');
const { createAgentRunFact } = require('./state-input');

const STORE_SCHEMA_VERSION = 4;
const IRREVERSIBLE_ATTEMPT_STATUSES = new Set(['provider_dispatched', 'response_received', 'recovering']);
const OPPORTUNITY_STATUSES = new Set([
  'created', 'deferred_user_priority', 'technical_backpressure', 'pre_dispatch_failed',
  'dispatched', 'completed', 'outcome_unknown', 'superseded', 'owner_disabled', 'cancelled', 'expired'
]);
const ATTEMPT_STATUSES = new Set([
  'preparing', 'deferred_user_priority', 'pre_dispatch_failed',
  'provider_dispatched', 'response_received', 'recovering', 'completed', 'outcome_unknown'
]);
const AGENT_RUN_RECEIPT_STATUSES = new Set([
  'applied', 'recorded_no_spontaneous', 'confirmed_during_disable', 'state_input_anchor',
  'ignored_out_of_order', 'ignored_stale_cycle'
]);
const ATTEMPT_AUDIT_PHASES = new Set([
  'attempt_started', 'admission', 'provider_boundary', 'dispatch_result', 'reconcile', 'source_control'
]);
const CYCLE_TERMINAL_REASONS = new Set([
  'spontaneous_disabled', 'owner_disabled', 'agent_run_completed', 'technical_outcome_unknown'
]);

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function corrupt(condition) {
  if (!condition) throw new Error('wake_state_corrupt');
}

function text(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function safeMs(value, nullable = false) {
  return (nullable && value === null) || (Number.isSafeInteger(value) && value >= 1);
}

function finite(value) {
  return Number.isFinite(value);
}

function bounded(value, min, max) {
  return finite(value) && value >= min && value <= max;
}

function expectedAttemptId(opportunityId, attemptSequence) {
  return 'wa_' + crypto.createHash('sha256')
    .update(`wake:technical-attempt:${opportunityId}:${attemptSequence}`)
    .digest('hex').slice(0, 24);
}

function validateActivationState(value) {
  corrupt(isPlainObject(value));
  corrupt(bounded(value.activationDrive, DEFAULT_POLICY.driveMin, DEFAULT_POLICY.driveMax));
  corrupt(bounded(value.latentActivityTone, DEFAULT_POLICY.toneMin, DEFAULT_POLICY.toneMax));
  corrupt(bounded(value.stochasticDriftState, DEFAULT_POLICY.driftMin, DEFAULT_POLICY.driftMax));
  corrupt(safeMs(value.lastAgentRunAtMs, true));
  corrupt(safeMs(value.lastSpontaneousWakeAtMs, true));
  corrupt(Number.isSafeInteger(value.stateVersion) && value.stateVersion >= 1);
  corrupt(value.policyVersion === DEFAULT_POLICY.policyVersion);
  if (value.lastAgentRunAtMs !== null && value.lastSpontaneousWakeAtMs !== null) {
    corrupt(value.lastSpontaneousWakeAtMs <= value.lastAgentRunAtMs);
  }
  return value;
}

function validateEntropy(value) {
  corrupt(isPlainObject(value));
  corrupt(text(value.cycleId));
  corrupt(finite(value.thresholdSample) && value.thresholdSample > 0);
  corrupt(typeof value.driftSeed === 'string' && /^[a-f0-9]{64}$/i.test(value.driftSeed));
  corrupt(value.policyVersion === DEFAULT_POLICY.policyVersion);
  corrupt(value.integratorVersion === INTEGRATOR_VERSION);
  corrupt(value.entropyAlgorithmVersion === ENTROPY_ALGORITHM_VERSION);
  corrupt(safeMs(value.cycleGridAnchorAtMs));
  corrupt(safeMs(value.createdAtMs));
  corrupt(value.createdAtMs === value.cycleGridAnchorAtMs);
  return value;
}

function validateProgress(value) {
  corrupt(isPlainObject(value));
  corrupt(text(value.cycleId));
  corrupt(finite(value.accumulatedHazard) && value.accumulatedHazard >= 0);
  corrupt(Number.isSafeInteger(value.activeElapsedMs) && value.activeElapsedMs >= 0);
  corrupt(safeMs(value.advancedThroughAtMs));
  corrupt(Number.isSafeInteger(value.projectionStepIndex) && value.projectionStepIndex >= 0);
  corrupt(Number.isSafeInteger(value.stateVersion) && value.stateVersion >= 1);
  corrupt(value.integratorVersion === INTEGRATOR_VERSION);
  corrupt(safeMs(value.thresholdCrossedAtMs, true));
  return value;
}

function validateProjection(value) {
  corrupt(isPlainObject(value));
  corrupt(text(value.cycleId));
  corrupt(Number.isSafeInteger(value.derivedFromStateVersion) && value.derivedFromStateVersion >= 1);
  corrupt(Number.isSafeInteger(value.schedulerGeneration) && value.schedulerGeneration >= 1);
  corrupt(safeMs(value.candidateAtMs));
  return value;
}

function validateOpportunity(value, dedupeKey) {
  corrupt(isPlainObject(value));
  corrupt(text(value.opportunityId));
  corrupt(text(value.activationId));
  corrupt(value.kind === 'spontaneous' || value.kind === 'external');
  corrupt(text(value.source));
  corrupt(text(value.dedupeKey) && value.dedupeKey === dedupeKey);
  corrupt(OPPORTUNITY_STATUSES.has(value.status));
  corrupt(safeMs(value.occurredAtMs));
  corrupt(safeMs(value.createdAtMs));
  corrupt(value.occurredAtMs <= value.createdAtMs);
  if (value.kind === 'spontaneous') {
    corrupt(value.source === 'spontaneous');
    corrupt(text(value.cycleId));
    corrupt(value.activationId === value.cycleId);
    corrupt(safeMs(value.thresholdCrossedAtMs));
    corrupt(value.thresholdCrossedAtMs <= value.occurredAtMs);
    corrupt(Number.isSafeInteger(value.stateVersion) && value.stateVersion >= 1);
    corrupt(Number.isSafeInteger(value.schedulerGeneration) && value.schedulerGeneration >= 1);
  } else {
    corrupt(value.source !== 'spontaneous');
    corrupt(text(value.sourceRef));
    corrupt(value.cycleId === undefined || value.cycleId === null);
    corrupt(value.createdInCycleId === undefined || value.createdInCycleId === null || text(value.createdInCycleId));
    corrupt(value.payloadRef === undefined || value.payloadRef === null || text(value.payloadRef));
  }
  for (const field of ['dispatchedAtMs', 'completedAtMs', 'thresholdCrossedAtMs']) {
    if (value[field] !== undefined && value[field] !== null) corrupt(safeMs(value[field]));
  }
  if (value.dispatchedAtMs !== undefined && value.dispatchedAtMs !== null) corrupt(value.dispatchedAtMs >= value.createdAtMs);
  if (value.completedAtMs !== undefined && value.completedAtMs !== null) corrupt(value.completedAtMs >= value.createdAtMs);
  if (value.dispatchedAtMs !== undefined && value.dispatchedAtMs !== null
    && value.completedAtMs !== undefined && value.completedAtMs !== null) {
    corrupt(value.completedAtMs >= value.dispatchedAtMs);
  }
  if (['dispatched'].includes(value.status)) corrupt(safeMs(value.dispatchedAtMs));
  if (['completed', 'outcome_unknown', 'superseded', 'owner_disabled', 'cancelled', 'expired'].includes(value.status)) {
    corrupt(safeMs(value.completedAtMs));
  }
  if (['technical_backpressure', 'pre_dispatch_failed', 'deferred_user_priority'].includes(value.status)) {
    corrupt(typeof value.retryable === 'boolean');
  }
  return value;
}

function validateAttempt(value, opportunityId, opportunitiesById) {
  corrupt(isPlainObject(value));
  corrupt(value.opportunityId === opportunityId);
  corrupt(opportunitiesById.has(opportunityId));
  corrupt(ATTEMPT_STATUSES.has(value.status));
  corrupt(text(value.attemptId));
  corrupt(Number.isSafeInteger(value.attemptSequence) && value.attemptSequence >= 1);
  corrupt(value.attemptId === expectedAttemptId(opportunityId, value.attemptSequence));
  corrupt(value.inferenceAttemptRef === null || value.inferenceAttemptRef === undefined || text(value.inferenceAttemptRef));
  corrupt(value.agentRunRef === null || value.agentRunRef === undefined || text(value.agentRunRef));
  corrupt(safeMs(value.updatedAtMs));
  if (['pre_dispatch_failed', 'deferred_user_priority'].includes(value.status)) corrupt(typeof value.retryable === 'boolean');
  return value;
}

function validateAudit(value, opportunityId, opportunitiesById) {
  corrupt(Array.isArray(value));
  corrupt(opportunitiesById.has(opportunityId));
  let prior = 0;
  let priorAttemptSequence = 0;
  let priorAtMs = 0;
  const startedSequences = new Set();
  const opportunity = opportunitiesById.get(opportunityId);
  for (const entry of value) {
    corrupt(isPlainObject(entry));
    corrupt(Number.isSafeInteger(entry.sequence) && entry.sequence === prior + 1);
    corrupt(entry.eventSequence === entry.sequence);
    corrupt(ATTEMPT_AUDIT_PHASES.has(entry.phase));
    corrupt(text(entry.status));
    corrupt(entry.reason === null || entry.reason === undefined || text(entry.reason));
    corrupt(entry.inferenceAttemptRef === null || entry.inferenceAttemptRef === undefined || text(entry.inferenceAttemptRef));
    corrupt(safeMs(entry.atMs));
    corrupt(entry.atMs >= opportunity.createdAtMs);
    corrupt(entry.atMs >= priorAtMs);
    const hasAttemptId = entry.attemptId !== null && entry.attemptId !== undefined;
    const hasAttemptSequence = entry.attemptSequence !== null && entry.attemptSequence !== undefined;
    corrupt(hasAttemptId === hasAttemptSequence);
    if (hasAttemptId) {
      corrupt(text(entry.attemptId));
      corrupt(Number.isSafeInteger(entry.attemptSequence) && entry.attemptSequence >= 1);
      corrupt(entry.attemptId === expectedAttemptId(opportunityId, entry.attemptSequence));
      corrupt(entry.attemptSequence >= priorAttemptSequence);
      if (entry.phase === 'attempt_started') {
        corrupt(entry.status === 'preparing');
        corrupt(entry.attemptSequence === startedSequences.size + 1);
        corrupt(!startedSequences.has(entry.attemptSequence));
        startedSequences.add(entry.attemptSequence);
      } else {
        corrupt(startedSequences.has(entry.attemptSequence));
      }
      priorAttemptSequence = entry.attemptSequence;
    } else {
      corrupt(entry.phase === 'source_control');
    }
    prior = entry.sequence;
    priorAtMs = entry.atMs;
  }
  return { maxAttemptSequence: priorAttemptSequence, startedSequences, lastAtMs: priorAtMs };
}

function validateAgentRunReceipt(value, agentRunRef) {
  corrupt(isPlainObject(value));
  const fact = validatePersistedAgentRunFact(value.fact);
  corrupt(fact.agentRunRef === agentRunRef);
  corrupt(AGENT_RUN_RECEIPT_STATUSES.has(value.status));
  corrupt(safeMs(value.recordedAtMs));
  corrupt(value.appliedCycleId === null || value.appliedCycleId === undefined || text(value.appliedCycleId));
  corrupt(value.createdCycleId === null || value.createdCycleId === undefined || text(value.createdCycleId));
  corrupt(fact.occurredAtMs <= value.recordedAtMs);
  if (value.status === 'applied') {
    corrupt(text(value.appliedCycleId));
    corrupt(text(value.createdCycleId));
  }
  return fact;
}

function validatePersistedAgentRunFact(value) {
  try {
    return createAgentRunFact(value);
  } catch (_) {
    throw new Error('wake_state_corrupt');
  }
}

function defaultWakeState(options = {}) {
  return {
    schemaVersion: STORE_SCHEMA_VERSION,
    mode: 'disabled_effective',
    spontaneousDesiredEnabled: options.spontaneousEnabled !== false,
    spontaneousConfigRevision: 0,
    spontaneousEnabled: false,
    activationState: null,
    entropy: null,
    progress: null,
    projection: null,
    opportunities: {},
    attempts: {},
    attemptAudit: {},
    agentRunReceipts: {},
    latestAgentRunFact: null,
    schedulerGeneration: 0,
    modulationMultiplier: 1,
    lastActivationSnapshot: null,
    cycleTerminal: null,
    updatedAtMs: null
  };
}

function validateWakeState(state) {
  if (!isPlainObject(state)) throw new Error('wake_state_corrupt');
  if (state.schemaVersion !== STORE_SCHEMA_VERSION) throw new Error('wake_state_version_unsupported');
  corrupt(['enabled', 'disable_pending', 'disabled_effective'].includes(state.mode));
  corrupt(typeof state.spontaneousDesiredEnabled === 'boolean');
  corrupt(Number.isSafeInteger(state.spontaneousConfigRevision) && state.spontaneousConfigRevision >= 0);
  corrupt(typeof state.spontaneousEnabled === 'boolean');
  corrupt(isPlainObject(state.opportunities));
  corrupt(isPlainObject(state.attempts));
  corrupt(isPlainObject(state.attemptAudit));
  corrupt(isPlainObject(state.agentRunReceipts));
  corrupt(Number.isSafeInteger(state.schedulerGeneration) && state.schedulerGeneration >= 0);
  corrupt(finite(state.modulationMultiplier) && state.modulationMultiplier > 0);
  corrupt(safeMs(state.updatedAtMs, true));

  if (state.activationState !== null) validateActivationState(state.activationState);
  if (state.entropy !== null) validateEntropy(state.entropy);
  if (state.progress !== null) validateProgress(state.progress);
  if (state.projection !== null) validateProjection(state.projection);
  if (state.lastActivationSnapshot !== null) validateActivationState(state.lastActivationSnapshot);
  if (state.latestAgentRunFact !== null) validatePersistedAgentRunFact(state.latestAgentRunFact);
  if (state.cycleTerminal !== null) {
    corrupt(isPlainObject(state.cycleTerminal));
    corrupt(text(state.cycleTerminal.cycleId));
    corrupt(CYCLE_TERMINAL_REASONS.has(state.cycleTerminal.reason));
    corrupt(safeMs(state.cycleTerminal.completedAtMs));
  }

  const activeParts = [state.activationState, state.entropy, state.progress];
  const activeCount = activeParts.filter(value => value !== null).length;
  corrupt(activeCount === 0 || activeCount === 3);
  if (activeCount === 3) {
    corrupt(state.entropy.cycleId === state.progress.cycleId);
    corrupt(state.activationState.stateVersion === state.progress.stateVersion);
    corrupt(state.progress.advancedThroughAtMs >= state.entropy.cycleGridAnchorAtMs);
    corrupt(state.progress.activeElapsedMs === state.progress.advancedThroughAtMs - state.entropy.cycleGridAnchorAtMs);
    corrupt(state.progress.projectionStepIndex === Math.floor(state.progress.activeElapsedMs / DEFAULT_POLICY.projectionStepMs));
    if (state.progress.thresholdCrossedAtMs !== null) {
      corrupt(state.progress.thresholdCrossedAtMs >= state.entropy.cycleGridAnchorAtMs);
      corrupt(state.progress.thresholdCrossedAtMs <= state.progress.advancedThroughAtMs);
    }
    if (state.activationState.lastAgentRunAtMs !== null) {
      corrupt(state.activationState.lastAgentRunAtMs <= state.progress.advancedThroughAtMs);
    }
    if (state.activationState.lastSpontaneousWakeAtMs !== null) {
      corrupt(state.activationState.lastSpontaneousWakeAtMs <= state.progress.advancedThroughAtMs);
    }
    corrupt(state.updatedAtMs !== null && state.updatedAtMs >= state.progress.advancedThroughAtMs);
    if (state.projection) {
      corrupt(state.projection.cycleId === state.entropy.cycleId);
      corrupt(state.projection.derivedFromStateVersion === state.activationState.stateVersion);
      corrupt(state.projection.schedulerGeneration === state.schedulerGeneration);
      corrupt(state.projection.candidateAtMs >= state.progress.advancedThroughAtMs);
    }
  } else {
    corrupt(state.projection === null);
  }
  if (state.mode === 'disabled_effective') corrupt(state.spontaneousEnabled === false);
  if (!state.spontaneousEnabled) corrupt(activeCount === 0);
  if (state.mode === 'enabled' && state.spontaneousEnabled) corrupt(activeCount === 3);
  if (state.spontaneousEnabled) corrupt(state.spontaneousDesiredEnabled === true);

  const opportunitiesById = new Map();
  for (const [dedupeKey, opportunity] of Object.entries(state.opportunities)) {
    validateOpportunity(opportunity, dedupeKey);
    corrupt(!opportunitiesById.has(opportunity.opportunityId));
    opportunitiesById.set(opportunity.opportunityId, opportunity);
  }
  for (const [opportunityId, attempt] of Object.entries(state.attempts)) {
    validateAttempt(attempt, opportunityId, opportunitiesById);
    const opportunity = opportunitiesById.get(opportunityId);
    corrupt(attempt.updatedAtMs >= opportunity.createdAtMs);
    corrupt(state.updatedAtMs !== null && attempt.updatedAtMs <= state.updatedAtMs);
  }
  const auditSummaries = new Map();
  for (const [opportunityId, entries] of Object.entries(state.attemptAudit)) {
    const summary = validateAudit(entries, opportunityId, opportunitiesById);
    corrupt(state.updatedAtMs !== null && summary.lastAtMs <= state.updatedAtMs);
    auditSummaries.set(opportunityId, summary);
  }
  for (const [opportunityId, attempt] of Object.entries(state.attempts)) {
    const summary = auditSummaries.get(opportunityId);
    corrupt(!!summary);
    corrupt(summary.maxAttemptSequence === attempt.attemptSequence);
    corrupt(summary.startedSequences.has(attempt.attemptSequence));
  }
  const latestEligibleFacts = [];
  for (const [agentRunRef, receipt] of Object.entries(state.agentRunReceipts)) {
    const fact = validateAgentRunReceipt(receipt, agentRunRef);
    if (fact.originOpportunityId !== undefined) corrupt(opportunitiesById.has(fact.originOpportunityId));
    if (!['ignored_out_of_order', 'ignored_stale_cycle'].includes(receipt.status)) latestEligibleFacts.push(fact);
    corrupt(state.updatedAtMs !== null && receipt.recordedAtMs <= state.updatedAtMs);
  }
  if (state.latestAgentRunFact === null) {
    corrupt(latestEligibleFacts.length === 0);
  } else {
    const latest = validatePersistedAgentRunFact(state.latestAgentRunFact);
    const matchingReceipt = state.agentRunReceipts[latest.agentRunRef];
    corrupt(!!matchingReceipt);
    corrupt(JSON.stringify(matchingReceipt.fact) === JSON.stringify(latest));
    const sorted = latestEligibleFacts.slice().sort((left, right) => left.occurredAtMs - right.occurredAtMs
      || left.agentRunRef.localeCompare(right.agentRunRef));
    corrupt(sorted.length > 0);
    corrupt(JSON.stringify(sorted[sorted.length - 1]) === JSON.stringify(latest));
  }
  if (state.mode === 'disabled_effective') {
    corrupt(!Object.values(state.attempts).some(attempt => IRREVERSIBLE_ATTEMPT_STATUSES.has(attempt.status)));
  }
  if (state.cycleTerminal !== null) corrupt(state.updatedAtMs !== null && state.cycleTerminal.completedAtMs <= state.updatedAtMs);
  return state;
}

function atomicWriteJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
  try {
    fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(temp, file);
  } finally {
    try { if (fs.existsSync(temp)) fs.unlinkSync(temp); } catch (_) {}
  }
}

function createMemoryWakePersistence(initialState) {
  let state = validateWakeState(clone(initialState || defaultWakeState()));
  return Object.freeze({
    kind: 'memory',
    exists: () => true,
    read: () => clone(state),
    transact(mutator) {
      const draft = clone(state);
      const result = mutator(draft);
      state = validateWakeState(draft);
      return { state: clone(state), result: clone(result) };
    }
  });
}

function createFileWakePersistence(file) {
  if (typeof file !== 'string' || !file.trim()) throw new TypeError('Wake state file is required');
  function read() {
    if (!fs.existsSync(file)) return defaultWakeState();
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (_) { throw new Error('wake_state_corrupt'); }
    return validateWakeState(parsed);
  }
  return Object.freeze({
    kind: 'file',
    file,
    exists: () => fs.existsSync(file),
    read: () => clone(read()),
    transact(mutator) {
      const draft = clone(read());
      const result = mutator(draft);
      validateWakeState(draft);
      atomicWriteJson(file, draft);
      return { state: clone(draft), result: clone(result) };
    }
  });
}

module.exports = {
  STORE_SCHEMA_VERSION,
  createFileWakePersistence,
  createMemoryWakePersistence,
  defaultWakeState,
  validateWakeState
};
