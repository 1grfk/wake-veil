'use strict';

require('./env');
const { crypto } = require('./shim');
const { createWakeDispatchRequest } = require('./contracts');
const { createEntropyRecord } = require('./entropy');
const { canonicalExternalIdentity } = require('./external-identity');
const { advanceCycleTo, createCycleProgress, projectCandidateAt } = require('./integrator');
const { createNoopSubjectiveWakeModulationAdapter } = require('./modulation');
const { DEFAULT_POLICY, applyAgentRunRelease, createInitialActivationState } = require('./policy');
const { createMemoryWakePersistence } = require('./persistence');
const { createOneShotWakeScheduler } = require('./scheduler');
const { createAgentRunFact, createNoopStateInputAdapter, sameAgentRunFact } = require('./state-input');
const { createWakeSupervisor } = require('./supervisor');

function deterministicOpportunityId(cycleId) {
  return 'wk_' + crypto.createHash('sha256').update(`wake:spontaneous:${cycleId}`).digest('hex').slice(0, 24);
}

function deterministicAttemptId(opportunityId, attemptSequence) {
  return 'wa_' + crypto.createHash('sha256')
    .update(`wake:technical-attempt:${opportunityId}:${attemptSequence}`)
    .digest('hex').slice(0, 24);
}

const TERMINAL_OPPORTUNITY_STATUSES = Object.freeze(new Set([
  'completed', 'outcome_unknown', 'superseded', 'owner_disabled', 'cancelled', 'expired'
]));
const TERMINAL_ATTEMPT_STATUSES = Object.freeze(new Set(['completed', 'outcome_unknown']));
const IRREVERSIBLE_ATTEMPT_STATUSES = Object.freeze(new Set([
  'provider_dispatched', 'response_received', 'recovering'
]));
const LIFECYCLE_TRANSITION_GRAPH = Object.freeze({
  disabled_effective: Object.freeze(new Set(['enabled'])),
  enabled: Object.freeze(new Set(['disable_pending'])),
  disable_pending: Object.freeze(new Set(['disabled_effective']))
});

function isTerminalOpportunityStatus(status) {
  return TERMINAL_OPPORTUNITY_STATUSES.has(String(status || ''));
}

function hasIrreversibleDispatchKnowledge(attempt) {
  return !!attempt && IRREVERSIBLE_ATTEMPT_STATUSES.has(String(attempt.status || ''));
}

function transitionLifecycle(draft, nextMode) {
  const currentMode = String(draft.mode || '');
  if (currentMode === nextMode) return currentMode;
  const allowed = LIFECYCLE_TRANSITION_GRAPH[currentMode];
  if (!allowed || !allowed.has(nextMode)) {
    throw new Error(`wake_lifecycle_transition_forbidden:${currentMode}->${nextMode}`);
  }
  draft.mode = nextMode;
  return nextMode;
}

function mergeAttemptResult(existingAttempt, opportunityId, rawResult, atMs) {
  const result = rawResult && typeof rawResult === 'object' ? rawResult : {};
  const incomingStatus = typeof result.status === 'string' && result.status.trim()
    ? result.status.trim()
    : 'unknown';
  const incomingRef = typeof result.inferenceAttemptRef === 'string' && result.inferenceAttemptRef.trim()
    ? result.inferenceAttemptRef.trim()
    : null;
  const incomingRunRef = typeof result.agentRunRef === 'string' && result.agentRunRef.trim()
    ? result.agentRunRef.trim()
    : null;
  const existingRef = existingAttempt && typeof existingAttempt.inferenceAttemptRef === 'string'
    && existingAttempt.inferenceAttemptRef.trim()
    ? existingAttempt.inferenceAttemptRef.trim()
    : null;
  const existingRunRef = existingAttempt && typeof existingAttempt.agentRunRef === 'string'
    && existingAttempt.agentRunRef.trim()
    ? existingAttempt.agentRunRef.trim()
    : null;
  const attemptSequence = existingAttempt && Number.isSafeInteger(existingAttempt.attemptSequence)
    ? existingAttempt.attemptSequence
    : 1;
  const attemptId = existingAttempt && typeof existingAttempt.attemptId === 'string' && existingAttempt.attemptId.trim()
    ? existingAttempt.attemptId.trim()
    : deterministicAttemptId(opportunityId, attemptSequence);
  const identity = { opportunityId, attemptId, attemptSequence };

  if (existingAttempt && TERMINAL_ATTEMPT_STATUSES.has(existingAttempt.status)) {
    return {
      ...existingAttempt,
      ...identity,
      inferenceAttemptRef: existingRef || incomingRef,
      agentRunRef: existingRunRef || incomingRunRef,
      updatedAtMs: atMs
    };
  }

  if (hasIrreversibleDispatchKnowledge(existingAttempt)) {
    if (TERMINAL_ATTEMPT_STATUSES.has(incomingStatus)) {
      return {
        ...existingAttempt,
        ...identity,
        inferenceAttemptRef: existingRef || incomingRef,
        agentRunRef: existingRunRef || incomingRunRef,
        status: incomingStatus,
        retryable: false,
        reconcilePending: false,
        lastReconcileStatus: incomingStatus,
        updatedAtMs: atMs
      };
    }
    return {
      ...existingAttempt,
      ...identity,
      inferenceAttemptRef: existingRef || incomingRef,
      agentRunRef: existingRunRef || incomingRunRef,
      status: 'provider_dispatched',
      retryable: false,
      reconcilePending: true,
      lastReconcileStatus: incomingStatus,
      lastReconcileReason: result.reason || result.message || null,
      updatedAtMs: atMs
    };
  }

  if (IRREVERSIBLE_ATTEMPT_STATUSES.has(incomingStatus)) {
    return {
      ...identity,
      inferenceAttemptRef: existingRef || incomingRef,
      agentRunRef: existingRunRef || incomingRunRef,
      status: 'provider_dispatched',
      retryable: false,
      reconcilePending: incomingStatus !== 'provider_dispatched',
      lastReconcileStatus: incomingStatus,
      updatedAtMs: atMs
    };
  }

  if (TERMINAL_ATTEMPT_STATUSES.has(incomingStatus)) {
    return {
      ...identity,
      inferenceAttemptRef: existingRef || incomingRef,
      agentRunRef: existingRunRef || incomingRunRef,
      status: incomingStatus,
      retryable: false,
      reconcilePending: false,
      updatedAtMs: atMs
    };
  }

  return {
    ...identity,
    inferenceAttemptRef: existingRef || incomingRef,
    agentRunRef: existingRunRef || incomingRunRef,
    status: incomingStatus === 'deferred_user_priority' ? incomingStatus : 'pre_dispatch_failed',
    retryable: result.retryable !== false,
    lastResultStatus: incomingStatus,
    lastFailure: result.reason || result.message || incomingStatus,
    updatedAtMs: atMs
  };
}

function preProviderCancelledError(reason) {
  const error = new Error(reason || 'wake_pre_provider_cancelled');
  error.code = 'wake_pre_provider_cancelled';
  error.preDispatch = true;
  return error;
}

function createStandaloneWakeKernel(options = {}) {
  const policy = options.policy || DEFAULT_POLICY;
  const persistence = options.persistence || createMemoryWakePersistence();
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const randomBytes = options.randomBytes || crypto.randomBytes;
  const makeCycleId = options.makeCycleId || (() => 'wc_' + crypto.randomUUID());
  const dispatchPort = options.dispatchPort;
  const modulationPort = options.modulationPort || createNoopSubjectiveWakeModulationAdapter();
  const stateInputPort = options.stateInputPort || createNoopStateInputAdapter();
  if (!dispatchPort || typeof dispatchPort.dispatch !== 'function' || typeof dispatchPort.reconcile !== 'function') {
    throw new TypeError('WakeDispatchPort with dispatch/reconcile is required');
  }
  if (!stateInputPort || typeof stateInputPort.readLatestAgentRunFact !== 'function') {
    throw new TypeError('StateInputPort with readLatestAgentRunFact is required');
  }
  const scheduler = options.scheduler || createOneShotWakeScheduler({ now });
  const dispatching = new Map();
  const quiescenceWaiters = new Set();
  const configuredBound = Number(options.maxDispatchInFlight);
  const maxDispatchInFlight = Number.isSafeInteger(configuredBound) && configuredBound >= 1
    ? Math.min(configuredBound, 1000)
    : 8;
  let maxObservedDispatchInFlight = 0;
  let lifecycleControlGeneration = 0;
  let activeDisableOperation = null;
  let initial = persistence.read();
  if (options.spontaneousEnabled !== undefined
    && initial.mode === 'disabled_effective'
    && initial.spontaneousConfigRevision === 0) {
    const configuredAtMs = Math.max(now(), Number(initial.updatedAtMs || 0));
    persistence.transact(draft => {
      draft.spontaneousDesiredEnabled = options.spontaneousEnabled === true;
      draft.spontaneousConfigRevision = 1;
      draft.spontaneousEnabled = false;
      draft.updatedAtMs = configuredAtMs;
      return { spontaneousDesiredEnabled: draft.spontaneousDesiredEnabled };
    });
    initial = persistence.read();
  }

  function captureLifecycleAuthority(kind) {
    return Object.freeze({ kind, generation: lifecycleControlGeneration });
  }

  function advanceLifecycleAuthority(kind) {
    lifecycleControlGeneration += 1;
    return captureLifecycleAuthority(kind);
  }

  function hasLifecycleAuthority(token, state, allowedModes) {
    return !!token
      && token.generation === lifecycleControlGeneration
      && !!state
      && allowedModes.includes(state.mode);
  }

  function bindSpontaneousControlAuthority(token, state, desiredEnabled) {
    return Object.freeze({
      ...token,
      spontaneousDesiredEnabled: desiredEnabled,
      spontaneousConfigRevision: state.spontaneousConfigRevision
    });
  }

  function hasSpontaneousControlAuthority(token, state, allowedModes = ['enabled']) {
    return hasLifecycleAuthority(token, state, allowedModes)
      && state.spontaneousDesiredEnabled === token.spontaneousDesiredEnabled
      && state.spontaneousConfigRevision === token.spontaneousConfigRevision;
  }

  function staleLifecycleControl(reason = 'stale_lifecycle_control') {
    return { noOp: true, reason };
  }

  function captureCycleInputAuthority(state, lifecycleToken) {
    if (!state || !state.entropy || !state.activationState || !state.progress) return null;
    return Object.freeze({
      lifecycleGeneration: lifecycleToken.generation,
      cycleId: state.entropy.cycleId,
      expectedStateVersion: state.activationState.stateVersion
    });
  }

  function hasCycleInputAuthority(cycleInput, lifecycleToken, state) {
    return !!cycleInput
      && hasLifecycleAuthority(lifecycleToken, state, ['enabled'])
      && state.spontaneousEnabled === true
      && !!state.entropy
      && !!state.activationState
      && !!state.progress
      && cycleInput.lifecycleGeneration === lifecycleToken.generation
      && cycleInput.cycleId === state.entropy.cycleId
      && cycleInput.cycleId === state.progress.cycleId
      && cycleInput.expectedStateVersion === state.activationState.stateVersion
      && cycleInput.expectedStateVersion === state.progress.stateVersion;
  }

  function signalDispatchQuiescence() {
    if (dispatching.size !== 0) return;
    for (const resolve of quiescenceWaiters) resolve();
    quiescenceWaiters.clear();
  }

  function waitForDispatchQuiescence() {
    if (dispatching.size === 0) return Promise.resolve();
    return new Promise(resolve => { quiescenceWaiters.add(resolve); });
  }

  function cancelPreProviderWork() {
    for (const entry of dispatching.values()) {
      if (!entry.providerDispatched && !entry.controller.signal.aborted) {
        entry.controller.abort(preProviderCancelledError('owner_disabled'));
      }
    }
  }

  function cancelPreProviderSpontaneousWork(reason = 'spontaneous_disabled') {
    const pending = [];
    const snapshot = persistence.read();
    for (const [opportunityId, entry] of dispatching) {
      if (entry.kind !== 'spontaneous') continue;
      if (hasIrreversibleDispatchKnowledge(snapshot.attempts[opportunityId])) continue;
      if (!entry.providerDispatched && !entry.controller.signal.aborted) {
        entry.controller.abort(preProviderCancelledError(reason));
        pending.push(entry.settled);
      }
    }
    return pending;
  }

  function waitForOpportunityQuiescence(opportunityId) {
    const entry = dispatching.get(opportunityId);
    return entry ? entry.settled : Promise.resolve();
  }

  function appendAttemptAudit(draft, opportunityId, phase, result, atMs) {
    const entries = draft.attemptAudit[opportunityId] || [];
    const raw = result && typeof result === 'object' ? result : {};
    const attempt = draft.attempts[opportunityId] || null;
    entries.push({
      sequence: entries.length + 1,
      eventSequence: entries.length + 1,
      attemptId: attempt ? attempt.attemptId : null,
      attemptSequence: attempt ? attempt.attemptSequence : null,
      phase,
      status: String(raw.status || 'unknown'),
      reason: raw.reason || raw.message || null,
      inferenceAttemptRef: raw.inferenceAttemptRef || null,
      atMs
    });
    draft.attemptAudit[opportunityId] = entries;
  }

  function beginTechnicalAttempt(opportunityId, atMs) {
    return persistence.transact(draft => {
      if (draft.mode !== 'enabled') return { noOp: true, reason: 'wake_disabled' };
      const opportunity = findOpportunityById(draft, opportunityId);
      if (!opportunity) return { noOp: true, reason: 'opportunity_not_found' };
      if (isTerminalOpportunityStatus(opportunity.status)) {
        return { noOp: true, reason: 'opportunity_terminal', status: opportunity.status };
      }
      const existing = draft.attempts[opportunityId];
      if (hasIrreversibleDispatchKnowledge(existing)) return { irreversible: true, attempt: existing };
      if (existing && TERMINAL_ATTEMPT_STATUSES.has(existing.status)) {
        return { noOp: true, reason: 'attempt_terminal' };
      }
      const attemptSequence = existing && Number.isSafeInteger(existing.attemptSequence)
        ? existing.attemptSequence + 1
        : 1;
      const attempt = {
        opportunityId,
        attemptId: deterministicAttemptId(opportunityId, attemptSequence),
        attemptSequence,
        status: 'preparing',
        retryable: true,
        updatedAtMs: atMs
      };
      draft.attempts[opportunityId] = attempt;
      appendAttemptAudit(draft, opportunityId, 'attempt_started', { status: 'preparing' }, atMs);
      draft.updatedAtMs = atMs;
      return { attempt };
    });
  }

  function createCycleInDraft(draft, atMs, baseState) {
    const cycleId = makeCycleId();
    const state = baseState ? { ...baseState } : createInitialActivationState(atMs, policy);
    state.policyVersion = policy.policyVersion;
    const entropy = createEntropyRecord({
      cycleId,
      nowMs: atMs,
      randomBytes,
      policyVersion: policy.policyVersion
    });
    const progress = createCycleProgress(cycleId, atMs, state.stateVersion);
    draft.activationState = state;
    draft.entropy = entropy;
    draft.progress = progress;
    return cycleId;
  }

  function projectInDraft(draft) {
    draft.schedulerGeneration = Number(draft.schedulerGeneration || 0) + 1;
    draft.projection = {
      cycleId: draft.entropy.cycleId,
      derivedFromStateVersion: draft.activationState.stateVersion,
      schedulerGeneration: draft.schedulerGeneration,
      candidateAtMs: Math.max(draft.progress.advancedThroughAtMs, projectCandidateAt({
        state: draft.activationState,
        progress: draft.progress,
        entropy: draft.entropy,
        modulationMultiplier: draft.modulationMultiplier,
        policy
      }))
    };
    return draft.projection;
  }

  function advanceCurrentCycleInDraft(draft, targetAtMs) {
    if (!draft.activationState || !draft.progress || !draft.entropy) return { advanced: false };
    if (targetAtMs < draft.progress.advancedThroughAtMs) {
      return { advanced: false, clockRegression: true, effectiveAtMs: draft.progress.advancedThroughAtMs };
    }
    if (targetAtMs === draft.progress.advancedThroughAtMs) {
      return { advanced: false, effectiveAtMs: targetAtMs };
    }
    const advanced = advanceCycleTo({
      state: draft.activationState,
      progress: draft.progress,
      entropy: draft.entropy,
      modulationMultiplier: draft.modulationMultiplier,
      targetAtMs,
      policy
    });
    draft.activationState = advanced.state;
    draft.progress = advanced.progress;
    draft.activationState.stateVersion += 1;
    draft.progress.stateVersion = draft.activationState.stateVersion;
    return { advanced: true, effectiveAtMs: targetAtMs };
  }

  function clearSpontaneousCycleInDraft(draft, atMs, reason) {
    const boundary = advanceCurrentCycleInDraft(draft, atMs);
    const completedAtMs = boundary.effectiveAtMs || atMs;
    const cycleId = draft.entropy && draft.entropy.cycleId;
    if (draft.activationState) draft.lastActivationSnapshot = { ...draft.activationState };
    if (cycleId) draft.cycleTerminal = { cycleId, reason, completedAtMs };
    draft.activationState = null;
    draft.entropy = null;
    draft.progress = null;
    draft.projection = null;
    draft.schedulerGeneration = Number(draft.schedulerGeneration || 0) + 1;
  }

  function unresolvedIrreversibleAttempts(state) {
    return Object.values(state.attempts).filter(hasIrreversibleDispatchKnowledge);
  }

  function shouldRunSupervisor(state) {
    return state.mode === 'enabled'
      && (state.spontaneousEnabled === true || unresolvedIrreversibleAttempts(state).length > 0);
  }

  function armCurrentProjection(snapshot) {
    if (snapshot.mode !== 'enabled' || !snapshot.spontaneousEnabled || !snapshot.projection) return null;
    return scheduler.arm(snapshot.projection, handleScheduledFire);
  }

  async function currentModulation() {
    const value = await modulationPort.read();
    const multiplier = Number(value && value.multiplier);
    return Number.isFinite(multiplier) ? multiplier : 1;
  }

  async function latestStateInputFact() {
    const value = await stateInputPort.readLatestAgentRunFact();
    if (!value || value.status === 'unavailable' || value.fact === null || value.fact === undefined) return null;
    return createAgentRunFact(value.fact);
  }

  function recordAgentRunReceiptInDraft(draft, factInput, status, atMs, details = {}) {
    const fact = createAgentRunFact(factInput);
    const existing = draft.agentRunReceipts[fact.agentRunRef];
    if (existing) {
      if (!sameAgentRunFact(existing.fact, fact)) throw new Error('agent_run_fact_conflict');
      return { duplicate: true, receipt: existing };
    }
    const receipt = {
      fact: { ...fact },
      status,
      recordedAtMs: atMs,
      appliedCycleId: details.appliedCycleId || null,
      createdCycleId: details.createdCycleId || null
    };
    draft.agentRunReceipts[fact.agentRunRef] = receipt;
    if (details.updateLatest !== false) {
      if (!draft.latestAgentRunFact
        || fact.occurredAtMs > draft.latestAgentRunFact.occurredAtMs
        || (fact.occurredAtMs === draft.latestAgentRunFact.occurredAtMs
          && fact.agentRunRef.localeCompare(draft.latestAgentRunFact.agentRunRef) > 0)) {
        draft.latestAgentRunFact = { ...fact };
      }
    }
    return { duplicate: false, receipt };
  }

  function baseStateWithFactualAnchor(draft, atMs, stateInputFact) {
    const base = draft.lastActivationSnapshot
      ? { ...draft.lastActivationSnapshot, stateVersion: Number(draft.lastActivationSnapshot.stateVersion || 0) + 1 }
      : createInitialActivationState(atMs, policy);
    const candidates = [draft.latestAgentRunFact, stateInputFact].filter(Boolean);
    candidates.sort((left, right) => left.occurredAtMs - right.occurredAtMs
      || left.agentRunRef.localeCompare(right.agentRunRef));
    const latestFact = candidates.length ? candidates[candidates.length - 1] : null;
    if (latestFact) {
      if (latestFact.occurredAtMs > atMs) throw new Error('agent_run_fact_future');
      recordAgentRunReceiptInDraft(draft, latestFact, 'state_input_anchor', atMs);
      base.lastAgentRunAtMs = latestFact.occurredAtMs;
    }
    base.policyVersion = policy.policyVersion;
    return base;
  }

  async function enable() {
    const before = persistence.read();
    if (before.mode === 'disable_pending') return staleLifecycleControl('disable_in_progress');
    if (before.mode === 'enabled') return recover();
    const control = advanceLifecycleAuthority('enable');
    const desiredEnabled = before.spontaneousDesiredEnabled;
    const configRevision = before.spontaneousConfigRevision;
    let modulationMultiplier = 1;
    let stateInputFact = null;
    if (desiredEnabled) {
      modulationMultiplier = await currentModulation();
      let checkpoint = persistence.read();
      if (!hasLifecycleAuthority(control, checkpoint, ['disabled_effective'])
        || checkpoint.spontaneousDesiredEnabled !== desiredEnabled
        || checkpoint.spontaneousConfigRevision !== configRevision) {
        return staleLifecycleControl();
      }
      stateInputFact = await latestStateInputFact();
      checkpoint = persistence.read();
      if (!hasLifecycleAuthority(control, checkpoint, ['disabled_effective'])
        || checkpoint.spontaneousDesiredEnabled !== desiredEnabled
        || checkpoint.spontaneousConfigRevision !== configRevision) {
        return staleLifecycleControl();
      }
    }
    const latest = persistence.read();
    if (!hasLifecycleAuthority(control, latest, ['disabled_effective'])
      || latest.spontaneousDesiredEnabled !== desiredEnabled
      || latest.spontaneousConfigRevision !== configRevision) return staleLifecycleControl();
    const atMs = Math.max(now(), Number(latest.updatedAtMs || 0));
    const { state, result } = persistence.transact(draft => {
      if (!hasLifecycleAuthority(control, draft, ['disabled_effective'])
        || draft.spontaneousDesiredEnabled !== desiredEnabled
        || draft.spontaneousConfigRevision !== configRevision) return staleLifecycleControl();
      transitionLifecycle(draft, 'enabled');
      draft.spontaneousEnabled = desiredEnabled;
      draft.cycleTerminal = null;
      if (desiredEnabled) {
        draft.modulationMultiplier = modulationMultiplier;
        const base = baseStateWithFactualAnchor(draft, atMs, stateInputFact);
        createCycleInDraft(draft, atMs, base);
        projectInDraft(draft);
      } else {
        clearSpontaneousCycleInDraft(draft, atMs, 'spontaneous_disabled');
      }
      draft.updatedAtMs = atMs;
      return { enabled: true, spontaneousEnabled: desiredEnabled };
    });
    if (result.noOp) return result;
    if (!hasLifecycleAuthority(control, state, ['enabled'])
      || state.spontaneousDesiredEnabled !== desiredEnabled
      || state.spontaneousConfigRevision !== configRevision) return staleLifecycleControl();
    if (state.spontaneousEnabled) armCurrentProjection(state);
    if (shouldRunSupervisor(state)) supervisor.start();
    return inspect();
  }

  async function setSpontaneousEnabled(enabledInput) {
    const enabled = enabledInput === true;
    const before = persistence.read();
    if (before.mode === 'disable_pending') return staleLifecycleControl('disable_in_progress');
    const baseControl = advanceLifecycleAuthority(enabled ? 'spontaneous_enable' : 'spontaneous_disable');
    if (!enabled) {
      scheduler.disarm();
      supervisor.stop();
    }
    const atMs = Math.max(now(), Number(before.updatedAtMs || 0));
    const { state: configuredState, result: configuredResult } = persistence.transact(draft => {
      if (!hasLifecycleAuthority(baseControl, draft, ['enabled', 'disabled_effective'])) {
        return staleLifecycleControl();
      }
      draft.spontaneousDesiredEnabled = enabled;
      draft.spontaneousConfigRevision = Number(draft.spontaneousConfigRevision || 0) + 1;
      if (draft.mode === 'disabled_effective') {
        draft.spontaneousEnabled = false;
        draft.updatedAtMs = atMs;
        return {
          configured: true,
          spontaneousDesiredEnabled: enabled,
          spontaneousConfigRevision: draft.spontaneousConfigRevision,
          deferredUntilEnable: true
        };
      }
      if (!enabled) {
        const cycleId = draft.entropy && draft.entropy.cycleId;
        for (const opportunity of Object.values(draft.opportunities)) {
          if (opportunity.kind === 'spontaneous' && opportunity.cycleId === cycleId
            && !isTerminalOpportunityStatus(opportunity.status)) {
            const attempt = draft.attempts[opportunity.opportunityId];
            if (hasIrreversibleDispatchKnowledge(attempt)) continue;
            opportunity.status = 'cancelled';
            opportunity.cancelReason = 'spontaneous_disabled';
            opportunity.completedAtMs = atMs;
            if (attempt) {
              attempt.status = 'pre_dispatch_failed';
              attempt.retryable = false;
              attempt.lastResultStatus = 'cancelled';
              attempt.lastFailure = 'spontaneous_disabled';
              attempt.updatedAtMs = atMs;
            }
          }
        }
        draft.spontaneousEnabled = false;
        clearSpontaneousCycleInDraft(draft, atMs, 'spontaneous_disabled');
        draft.updatedAtMs = atMs;
        return {
          configured: true,
          spontaneousEnabled: false,
          spontaneousDesiredEnabled: false,
          spontaneousConfigRevision: draft.spontaneousConfigRevision
        };
      }
      draft.updatedAtMs = atMs;
      return {
        configured: true,
        spontaneousEnabled: draft.spontaneousEnabled,
        spontaneousDesiredEnabled: true,
        spontaneousConfigRevision: draft.spontaneousConfigRevision,
        activationRequired: draft.spontaneousEnabled !== true
      };
    });
    if (configuredResult.noOp) return configuredResult;
    const control = bindSpontaneousControlAuthority(baseControl, configuredState, enabled);
    if (configuredState.mode === 'disabled_effective') return configuredResult;

    if (!enabled) {
      const pending = cancelPreProviderSpontaneousWork('spontaneous_disabled');
      if (pending.length) await Promise.allSettled(pending);
      const latest = persistence.read();
      if (!hasSpontaneousControlAuthority(control, latest)) return staleLifecycleControl();
      if (shouldRunSupervisor(latest)) supervisor.start();
      return inspect();
    }

    if (!configuredResult.activationRequired) {
      if (!hasSpontaneousControlAuthority(control, configuredState)) return staleLifecycleControl();
      return inspect();
    }

    const modulationMultiplier = await currentModulation();
    let latest = persistence.read();
    if (!hasSpontaneousControlAuthority(control, latest) || latest.spontaneousEnabled) {
      return staleLifecycleControl();
    }
    const stateInputFact = await latestStateInputFact();
    latest = persistence.read();
    if (!hasSpontaneousControlAuthority(control, latest) || latest.spontaneousEnabled) {
      return staleLifecycleControl();
    }
    const activationAtMs = Math.max(now(), Number(latest.updatedAtMs || 0));
    const { state, result } = persistence.transact(draft => {
      if (!hasSpontaneousControlAuthority(control, draft) || draft.spontaneousEnabled) {
        return staleLifecycleControl();
      }
      draft.spontaneousEnabled = true;
      draft.modulationMultiplier = modulationMultiplier;
      const base = baseStateWithFactualAnchor(draft, activationAtMs, stateInputFact);
      createCycleInDraft(draft, activationAtMs, base);
      projectInDraft(draft);
      draft.updatedAtMs = activationAtMs;
      return { spontaneousEnabled: true };
    });
    if (result.noOp) return result;
    if (!hasSpontaneousControlAuthority(control, state)) return staleLifecycleControl();
    armCurrentProjection(state);
    supervisor.start();
    return inspect();
  }

  function terminalizeForDisable(draft, atMs) {
    if (dispatching.size !== 0) throw new Error('wake_disable_not_quiescent');
    for (const opportunity of Object.values(draft.opportunities)) {
      if (!isTerminalOpportunityStatus(opportunity.status)) {
        opportunity.status = 'owner_disabled';
        opportunity.completedAtMs = atMs;
        const attempt = draft.attempts[opportunity.opportunityId];
        if (attempt && !hasIrreversibleDispatchKnowledge(attempt)) {
          attempt.status = 'pre_dispatch_failed';
          attempt.retryable = false;
          attempt.lastResultStatus = 'owner_disabled';
          attempt.lastFailure = 'owner_disabled';
          attempt.updatedAtMs = atMs;
        }
      }
    }
    clearSpontaneousCycleInDraft(draft, atMs, 'owner_disabled');
    draft.spontaneousEnabled = false;
    transitionLifecycle(draft, 'disabled_effective');
    draft.updatedAtMs = atMs;
  }

  function hasProviderDispatchedInFlight(state) {
    return unresolvedIrreversibleAttempts(state).length > 0;
  }

  async function runDisable(control) {
    scheduler.disarm();
    supervisor.stop();
    cancelPreProviderWork();
    const before = persistence.read();
    if (before.mode === 'disabled_effective') {
      await waitForDispatchQuiescence();
      return inspect();
    }
    const atMs = Math.max(now(), Number(before.updatedAtMs || 0));
    const hasLocalInFlight = dispatching.size > 0;
    const { state } = persistence.transact(draft => {
      if (draft.mode === 'enabled') transitionLifecycle(draft, 'disable_pending');
      draft.projection = null;
      draft.schedulerGeneration = Number(draft.schedulerGeneration || 0) + 1;
      if (!hasLocalInFlight && !hasProviderDispatchedInFlight(draft)) terminalizeForDisable(draft, atMs);
      else draft.updatedAtMs = atMs;
      return { mode: draft.mode };
    });
    if (state.mode === 'disable_pending') {
      cancelPreProviderWork();
      await waitForDispatchQuiescence();
      await reconcileDisable({ controlToken: control });
    }
    return inspect();
  }

  function disable() {
    if (activeDisableOperation) return activeDisableOperation;
    const control = advanceLifecycleAuthority('disable');
    const operation = runDisable(control);
    activeDisableOperation = operation;
    operation.then(
      () => { if (activeDisableOperation === operation) activeDisableOperation = null; },
      () => { if (activeDisableOperation === operation) activeDisableOperation = null; }
    );
    return operation;
  }

  async function reconcileDisable(options = {}) {
    const control = options.controlToken || captureLifecycleAuthority('reconcile_disable');
    const snapshot = persistence.read();
    if (!hasLifecycleAuthority(control, snapshot, ['disable_pending'])) return inspect();
    const inFlight = unresolvedIrreversibleAttempts(snapshot);
    for (const attempt of inFlight) {
      let result;
      try {
        result = await dispatchPort.reconcile(attempt.opportunityId);
      } catch (error) {
        result = { status: 'reconcile_error', reason: error && error.message ? error.message : 'reconcile_transport_error' };
      }
      const beforeApply = persistence.read();
      if (!hasLifecycleAuthority(control, beforeApply, ['disable_pending'])) return inspect();
      await applyDispatchResult(attempt.opportunityId, result, { skipDisableReconcile: true, phase: 'reconcile' });
    }
    const after = persistence.read();
    if (hasLifecycleAuthority(control, after, ['disable_pending'])
      && !hasProviderDispatchedInFlight(after) && dispatching.size === 0) {
      persistence.transact(draft => {
        if (hasLifecycleAuthority(control, draft, ['disable_pending'])) terminalizeForDisable(draft, now());
        return { mode: draft.mode };
      });
    }
    return inspect();
  }

  async function reproject(atMs = now(), modulationMultiplier, options = {}) {
    const control = options.controlToken || captureLifecycleAuthority('reproject');
    const before = persistence.read();
    if (!hasLifecycleAuthority(control, before, ['enabled']) || !before.spontaneousEnabled) {
      return { noOp: true, reason: 'spontaneous_disabled' };
    }
    if (atMs < before.progress.advancedThroughAtMs) return { noOp: true, reason: 'clock_regression' };
    const cycleInput = options.cycleInput || captureCycleInputAuthority(before, control);
    if (!hasCycleInputAuthority(cycleInput, control, before)) return { noOp: true, reason: 'stale_cycle_input' };
    const nextModulation = modulationMultiplier === undefined ? await currentModulation() : Number(modulationMultiplier);
    const latest = persistence.read();
    if (!hasCycleInputAuthority(cycleInput, control, latest)) return { noOp: true, reason: 'stale_cycle_input' };
    if (atMs < latest.progress.advancedThroughAtMs) return { noOp: true, reason: 'clock_regression' };
    const { state, result } = persistence.transact(draft => {
      if (!hasCycleInputAuthority(cycleInput, control, draft)) return { noOp: true, reason: 'stale_cycle_input' };
      if (atMs < draft.progress.advancedThroughAtMs) return { noOp: true, reason: 'clock_regression' };
      const advanced = advanceCycleTo({
        state: draft.activationState,
        progress: draft.progress,
        entropy: draft.entropy,
        modulationMultiplier: draft.modulationMultiplier,
        targetAtMs: atMs,
        policy
      });
      draft.activationState = advanced.state;
      draft.progress = advanced.progress;
      draft.activationState.stateVersion += 1;
      draft.progress.stateVersion = draft.activationState.stateVersion;
      draft.modulationMultiplier = nextModulation;
      const projection = projectInDraft(draft);
      draft.updatedAtMs = atMs;
      return { projection };
    });
    if (!result.noOp) armCurrentProjection(state);
    return result;
  }

  function materializeSpontaneous(captured, atMs) {
    const before = persistence.read();
    if (before.mode !== 'enabled' || !before.spontaneousEnabled) {
      return { state: before, result: { noOp: true, reason: 'spontaneous_disabled' } };
    }
    if (atMs < before.progress.advancedThroughAtMs) {
      return { state: before, result: { noOp: true, reason: 'clock_regression' } };
    }
    const { state, result } = persistence.transact(draft => {
      if (draft.mode !== 'enabled' || !draft.spontaneousEnabled) return { noOp: true, reason: 'spontaneous_disabled' };
      const projection = draft.projection;
      if (!projection
        || projection.cycleId !== captured.cycleId
        || projection.derivedFromStateVersion !== captured.derivedFromStateVersion
        || projection.schedulerGeneration !== captured.schedulerGeneration) {
        return { noOp: true, reason: 'stale_generation' };
      }
      if (atMs < draft.progress.advancedThroughAtMs) return { noOp: true, reason: 'clock_regression' };
      const advanced = advanceCycleTo({
        state: draft.activationState,
        progress: draft.progress,
        entropy: draft.entropy,
        modulationMultiplier: draft.modulationMultiplier,
        targetAtMs: atMs,
        policy
      });
      draft.activationState = advanced.state;
      draft.progress = advanced.progress;
      draft.activationState.stateVersion += 1;
      draft.progress.stateVersion = draft.activationState.stateVersion;
      draft.projection = null;
      draft.schedulerGeneration = Number(draft.schedulerGeneration || 0) + 1;
      draft.updatedAtMs = atMs;
      if (draft.progress.accumulatedHazard < draft.entropy.thresholdSample) {
        return { noOp: true, reason: 'threshold_not_reached' };
      }
      const dedupeKey = `wake:spontaneous:${draft.entropy.cycleId}`;
      let opportunity = draft.opportunities[dedupeKey];
      if (!opportunity) {
        opportunity = {
          opportunityId: deterministicOpportunityId(draft.entropy.cycleId),
          activationId: draft.entropy.cycleId,
          kind: 'spontaneous',
          cycleId: draft.entropy.cycleId,
          source: 'spontaneous',
          dedupeKey,
          stateVersion: draft.activationState.stateVersion,
          schedulerGeneration: captured.schedulerGeneration,
          status: 'created',
          occurredAtMs: atMs,
          thresholdCrossedAtMs: draft.progress.thresholdCrossedAtMs,
          createdAtMs: atMs
        };
        draft.opportunities[dedupeKey] = opportunity;
      }
      return { opportunity };
    });
    return { state, result };
  }

  async function handleScheduledFire(captured) {
    const atMs = now();
    const materialized = materializeSpontaneous(captured, atMs);
    if (materialized.result.opportunity) return dispatchOpportunity(materialized.result.opportunity.opportunityId);
    if (materialized.state.mode === 'enabled' && materialized.state.spontaneousEnabled
      && materialized.result.reason === 'threshold_not_reached') {
      return reproject(atMs, materialized.state.modulationMultiplier);
    }
    return materialized.result;
  }

  function findOpportunityById(state, opportunityId) {
    return Object.values(state.opportunities).find(item => item && item.opportunityId === opportunityId) || null;
  }

  function findRetryableSpontaneousOpportunity(state) {
    if (!state || state.mode !== 'enabled' || !state.spontaneousEnabled || !state.entropy) return null;
    return Object.values(state.opportunities).find(opportunity => {
      if (!opportunity || opportunity.kind !== 'spontaneous' || opportunity.cycleId !== state.entropy.cycleId) return false;
      if (isTerminalOpportunityStatus(opportunity.status) || opportunity.status === 'dispatched') return false;
      const attempt = state.attempts[opportunity.opportunityId];
      if (hasIrreversibleDispatchKnowledge(attempt) || (attempt && TERMINAL_ATTEMPT_STATUSES.has(attempt.status))) return false;
      return opportunity.status === 'created'
        || (['technical_backpressure', 'pre_dispatch_failed', 'deferred_user_priority'].includes(opportunity.status)
          && opportunity.retryable === true);
    }) || null;
  }

  async function submitExternalOpportunity(input = {}) {
    const source = typeof input.source === 'string' ? input.source.trim() : '';
    const sourceRef = typeof input.sourceRef === 'string' ? input.sourceRef.trim() : '';
    const payloadRef = input.payloadRef === undefined || input.payloadRef === null
      ? null
      : (typeof input.payloadRef === 'string' ? input.payloadRef.trim() : '');
    const occurredAtMs = Number(input.occurredAtMs || now());
    if (!source || source === 'spontaneous') throw new TypeError('External Wake source is invalid');
    if (!sourceRef) throw new TypeError('External Wake sourceRef is required');
    if (input.payloadRef !== undefined && !payloadRef) throw new TypeError('External Wake payloadRef is invalid');
    if (!Number.isSafeInteger(occurredAtMs) || occurredAtMs < 1) throw new TypeError('occurredAtMs must be UTC epoch milliseconds');
    const receivedAtMs = now();
    if (occurredAtMs > receivedAtMs) throw new TypeError('External Wake occurredAtMs must not be in the future');
    const snapshot = persistence.read();
    if (snapshot.mode !== 'enabled') {
      return { noOp: true, reason: 'wake_disabled', dispatchResult: { noOp: true, reason: 'wake_disabled' } };
    }
    const identity = canonicalExternalIdentity(source, sourceRef);
    const { result } = persistence.transact(draft => {
      if (draft.mode !== 'enabled') return { noOp: true, reason: 'wake_disabled' };
      let opportunity = draft.opportunities[identity.dedupeKey];
      if (opportunity) {
        if (opportunity.source !== source || opportunity.sourceRef !== sourceRef
          || (opportunity.payloadRef || null) !== payloadRef || opportunity.occurredAtMs !== occurredAtMs) {
          throw new Error('external_opportunity_conflict');
        }
        return { opportunity, duplicate: true };
      }
      opportunity = {
        opportunityId: identity.opportunityId,
        activationId: identity.activationId,
        kind: 'external',
        cycleId: null,
        createdInCycleId: draft.entropy ? draft.entropy.cycleId : null,
        source,
        sourceRef,
        ...(payloadRef ? { payloadRef } : {}),
        dedupeKey: identity.dedupeKey,
        status: 'created',
        occurredAtMs,
        createdAtMs: receivedAtMs
      };
      draft.opportunities[identity.dedupeKey] = opportunity;
      draft.updatedAtMs = receivedAtMs;
      return { opportunity, duplicate: false };
    });
    if (result.noOp) return { ...result, dispatchResult: result };
    const dispatchResult = await dispatchOpportunity(result.opportunity.opportunityId);
    return { ...result, dispatchResult };
  }

  async function cancelExternalOpportunity(input = {}) {
    const source = typeof input.source === 'string' ? input.source.trim() : '';
    const sourceRef = typeof input.sourceRef === 'string' ? input.sourceRef.trim() : '';
    const reason = input.reason === 'source_expired' ? 'source_expired' : 'source_cancelled';
    if (!source || source === 'spontaneous' || !sourceRef) throw new TypeError('External cancel identity is invalid');
    const identity = canonicalExternalIdentity(source, sourceRef);
    const snapshot = persistence.read();
    const opportunity = snapshot.opportunities[identity.dedupeKey];
    if (!opportunity) return { noOp: true, reason: 'opportunity_not_found' };
    const attempt = snapshot.attempts[opportunity.opportunityId];
    if (hasIrreversibleDispatchKnowledge(attempt)) {
      return { noOp: true, reason: 'provider_dispatched_irreversible', retryable: false };
    }
    if (isTerminalOpportunityStatus(opportunity.status)) {
      return { noOp: true, reason: 'opportunity_terminal', status: opportunity.status };
    }
    const atMs = Math.max(now(), Number(snapshot.updatedAtMs || 0), Number(opportunity.createdAtMs || 0));
    const { result } = persistence.transact(draft => {
      const current = draft.opportunities[identity.dedupeKey];
      const currentAttempt = current && draft.attempts[current.opportunityId];
      if (!current) return { noOp: true, reason: 'opportunity_not_found' };
      if (hasIrreversibleDispatchKnowledge(currentAttempt)) {
        return { noOp: true, reason: 'provider_dispatched_irreversible' };
      }
      if (isTerminalOpportunityStatus(current.status)) {
        return { noOp: true, reason: 'opportunity_terminal', status: current.status };
      }
      current.status = reason === 'source_expired' ? 'expired' : 'cancelled';
      current.cancelReason = reason;
      current.completedAtMs = atMs;
      if (currentAttempt) {
        currentAttempt.status = 'pre_dispatch_failed';
        currentAttempt.retryable = false;
        currentAttempt.lastResultStatus = current.status;
        currentAttempt.lastFailure = reason;
        currentAttempt.updatedAtMs = atMs;
      }
      appendAttemptAudit(draft, current.opportunityId, 'source_control', { status: current.status, reason }, atMs);
      draft.updatedAtMs = atMs;
      return { status: current.status };
    });
    const local = dispatching.get(opportunity.opportunityId);
    if (result && (result.status === 'cancelled' || result.status === 'expired')
      && local && !local.providerDispatched && !local.controller.signal.aborted) {
      local.controller.abort(preProviderCancelledError(reason));
      await waitForOpportunityQuiescence(opportunity.opportunityId);
    }
    return result;
  }

  function startNewCycleAfterAgentRunInDraft(draft, fact, atMs) {
    const oldCycleId = draft.entropy && draft.entropy.cycleId;
    const advancedOld = advanceCycleTo({
      state: draft.activationState,
      progress: draft.progress,
      entropy: draft.entropy,
      modulationMultiplier: draft.modulationMultiplier,
      targetAtMs: fact.occurredAtMs,
      policy
    });
    draft.activationState = advancedOld.state;
    draft.progress = advancedOld.progress;
    const base = applyAgentRunRelease(advancedOld.state, fact.occurredAtMs, fact.source, policy);
    draft.lastActivationSnapshot = { ...base };
    draft.cycleTerminal = { cycleId: oldCycleId, reason: 'agent_run_completed', completedAtMs: fact.occurredAtMs };
    for (const opportunity of Object.values(draft.opportunities)) {
      if (opportunity.kind !== 'spontaneous' || opportunity.cycleId !== oldCycleId
        || isTerminalOpportunityStatus(opportunity.status)) continue;
      const attempt = draft.attempts[opportunity.opportunityId];
      if (hasIrreversibleDispatchKnowledge(attempt)) continue;
      opportunity.status = 'superseded';
      opportunity.completedAtMs = atMs;
      if (attempt) {
        attempt.status = 'pre_dispatch_failed';
        attempt.retryable = false;
        attempt.lastResultStatus = 'superseded';
        attempt.lastFailure = 'agent_run_superseded';
        attempt.updatedAtMs = atMs;
      }
    }
    const createdCycleId = createCycleInDraft(draft, fact.occurredAtMs, base);
    advanceCurrentCycleInDraft(draft, atMs);
    projectInDraft(draft);
    return { oldCycleId, createdCycleId };
  }

  function applyAgentRunFactInDraft(draft, factInput, atMs) {
    const fact = createAgentRunFact(factInput);
    const existing = draft.agentRunReceipts[fact.agentRunRef];
    if (existing) {
      if (!sameAgentRunFact(existing.fact, fact)) throw new Error('agent_run_fact_conflict');
      return { noOp: true, reason: 'agent_run_already_recorded', receipt: existing };
    }
    const latest = draft.latestAgentRunFact;
    if (fact.occurredAtMs > atMs) {
      return { noOp: true, reason: 'agent_run_future' };
    }
    if (latest && fact.occurredAtMs < latest.occurredAtMs) {
      const recorded = recordAgentRunReceiptInDraft(draft, fact, 'ignored_out_of_order', atMs, { updateLatest: false });
      return { noOp: true, reason: 'agent_run_out_of_order', receipt: recorded.receipt };
    }
    if (draft.mode !== 'enabled') {
      const recorded = recordAgentRunReceiptInDraft(draft, fact, 'confirmed_during_disable', atMs);
      return { applied: false, receipt: recorded.receipt };
    }
    if (!draft.spontaneousEnabled || !draft.activationState || !draft.entropy || !draft.progress) {
      const recorded = recordAgentRunReceiptInDraft(draft, fact, 'recorded_no_spontaneous', atMs);
      return { applied: false, receipt: recorded.receipt };
    }
    if (fact.occurredAtMs < draft.progress.advancedThroughAtMs) {
      const recorded = recordAgentRunReceiptInDraft(draft, fact, 'ignored_stale_cycle', atMs, { updateLatest: false });
      return { noOp: true, reason: 'agent_run_stale_cycle', receipt: recorded.receipt };
    }
    const cycle = startNewCycleAfterAgentRunInDraft(draft, fact, atMs);
    const recorded = recordAgentRunReceiptInDraft(draft, fact, 'applied', atMs, {
      appliedCycleId: cycle.oldCycleId,
      createdCycleId: cycle.createdCycleId
    });
    return { applied: true, receipt: recorded.receipt, ...cycle };
  }

  async function recordAgentRun(input = {}) {
    const fact = createAgentRunFact(input);
    const before = persistence.read();
    if (before.mode !== 'enabled') return { noOp: true, reason: 'wake_disabled' };
    const atMs = now();
    const existing = before.agentRunReceipts[fact.agentRunRef];
    if (existing) {
      if (!sameAgentRunFact(existing.fact, fact)) throw new Error('agent_run_fact_conflict');
      return { noOp: true, reason: 'agent_run_already_recorded', receipt: existing };
    }
    if (fact.occurredAtMs > atMs) return { noOp: true, reason: 'agent_run_future' };
    const { state, result } = persistence.transact(draft => {
      if (draft.mode !== 'enabled') return { noOp: true, reason: 'wake_disabled' };
      const applied = applyAgentRunFactInDraft(draft, fact, atMs);
      draft.updatedAtMs = atMs;
      return applied;
    });
    if (result.applied && state.projection) armCurrentProjection(state);
    if (shouldRunSupervisor(state)) supervisor.start();
    return result;
  }

  function agentRunFactFromCompletion(opportunity, attempt, result, atMs) {
    const agentRunRef = result.agentRunRef || attempt.agentRunRef || attempt.inferenceAttemptRef;
    if (!agentRunRef) throw new Error('agent_run_ref_missing');
    const occurredAtMs = Number(result.agentRunOccurredAtMs || atMs);
    return createAgentRunFact({
      agentRunRef,
      source: opportunity.source,
      occurredAtMs,
      originOpportunityId: opportunity.opportunityId
    });
  }

  async function applyDispatchResult(opportunityId, result, options = {}) {
    const before = persistence.read();
    const beforeOpportunity = findOpportunityById(before, opportunityId);
    const atMs = Math.max(
      now(),
      Number(before.updatedAtMs || 0),
      Number(beforeOpportunity && beforeOpportunity.createdAtMs || 0),
      Number(beforeOpportunity && beforeOpportunity.dispatchedAtMs || 0)
    );
    const { state, result: applied } = persistence.transact(draft => {
      const opportunity = findOpportunityById(draft, opportunityId);
      if (!opportunity) return { missing: true };
      const wasTerminal = isTerminalOpportunityStatus(opportunity.status);
      const attempt = mergeAttemptResult(draft.attempts[opportunityId], opportunityId, result, atMs);
      draft.attempts[opportunityId] = attempt;
      appendAttemptAudit(draft, opportunityId, options.phase || 'dispatch_result', result, atMs);
      if (wasTerminal) {
        draft.updatedAtMs = atMs;
        return { status: attempt.status, noOp: true, reason: 'opportunity_terminal' };
      }
      let agentRun = null;
      if (attempt.status === 'completed') {
        opportunity.status = 'completed';
        opportunity.outcome = result.outcome || 'silent';
        opportunity.completedAtMs = atMs;
        const fact = agentRunFactFromCompletion(opportunity, attempt, result, atMs);
        agentRun = applyAgentRunFactInDraft(draft, fact, atMs);
      } else if (attempt.status === 'outcome_unknown') {
        opportunity.status = 'outcome_unknown';
        opportunity.completedAtMs = atMs;
        const isCurrentSpontaneous = opportunity.kind === 'spontaneous'
          && draft.entropy && opportunity.cycleId === draft.entropy.cycleId;
        if (draft.mode === 'enabled' && draft.spontaneousEnabled && isCurrentSpontaneous) {
          const oldCycleId = draft.entropy.cycleId;
          advanceCurrentCycleInDraft(draft, atMs);
          const base = { ...draft.activationState, stateVersion: draft.activationState.stateVersion + 1 };
          draft.lastActivationSnapshot = { ...base };
          draft.cycleTerminal = { cycleId: oldCycleId, reason: 'technical_outcome_unknown', completedAtMs: atMs };
          createCycleInDraft(draft, atMs, base);
          projectInDraft(draft);
        }
      } else if (attempt.status === 'provider_dispatched') {
        opportunity.status = 'dispatched';
        opportunity.dispatchedAtMs = atMs;
        if (attempt.reconcilePending) {
          opportunity.lastReconcileStatus = attempt.lastReconcileStatus;
          opportunity.lastReconcileReason = attempt.lastReconcileReason || null;
        }
      } else if (attempt.status === 'deferred_user_priority') {
        opportunity.status = 'deferred_user_priority';
        opportunity.retryable = attempt.retryable === true;
      } else {
        opportunity.status = result.status === 'technical_backpressure'
          ? 'technical_backpressure'
          : 'pre_dispatch_failed';
        opportunity.retryable = attempt.retryable === true;
        opportunity.lastFailure = attempt.lastFailure || attempt.lastResultStatus;
      }
      draft.updatedAtMs = atMs;
      return {
        status: result && result.status === 'technical_backpressure' ? 'technical_backpressure' : attempt.status,
        reconcileStatus: attempt.lastReconcileStatus || null,
        inferenceAttemptRef: attempt.inferenceAttemptRef || null,
        agentRun
      };
    });
    if (state.mode === 'enabled' && state.spontaneousEnabled && state.projection) armCurrentProjection(state);
    if (state.mode === 'disable_pending' && !options.skipDisableReconcile) await reconcileDisable();
    return applied;
  }

  async function dispatchOpportunity(opportunityId) {
    if (dispatching.has(opportunityId)) return { noOp: true, reason: 'dispatch_in_flight' };
    const snapshot = persistence.read();
    if (snapshot.mode !== 'enabled' && snapshot.mode !== 'disable_pending') return { noOp: true, reason: 'wake_disabled' };
    const opportunity = findOpportunityById(snapshot, opportunityId);
    if (!opportunity) return { noOp: true, reason: 'opportunity_not_found' };
    if (isTerminalOpportunityStatus(opportunity.status)) {
      return { noOp: true, reason: 'opportunity_terminal', status: opportunity.status };
    }
    let existingAttempt = snapshot.attempts[opportunityId];
    if (existingAttempt && TERMINAL_ATTEMPT_STATUSES.has(existingAttempt.status)) {
      return { noOp: true, reason: 'attempt_terminal' };
    }
    if (snapshot.mode === 'disable_pending' && !hasIrreversibleDispatchKnowledge(existingAttempt)) {
      return { noOp: true, reason: 'owner_disabled' };
    }
    if (opportunity.kind === 'spontaneous' && !snapshot.spontaneousEnabled
      && !hasIrreversibleDispatchKnowledge(existingAttempt)) {
      return { noOp: true, reason: 'spontaneous_disabled' };
    }
    if (!hasIrreversibleDispatchKnowledge(existingAttempt)) {
      const started = beginTechnicalAttempt(opportunityId, Math.max(
        now(), Number(snapshot.updatedAtMs || 0), Number(opportunity.createdAtMs || 0)
      ));
      if (started.result && started.result.noOp) return started.result;
      existingAttempt = started.result.attempt;
    }
    if (!hasIrreversibleDispatchKnowledge(existingAttempt) && dispatching.size >= maxDispatchInFlight) {
      const result = { status: 'technical_backpressure', reason: 'local_dispatch_capacity', retryable: true };
      return applyDispatchResult(opportunityId, result, { phase: 'admission' });
    }

    let resolveSettled;
    const settled = new Promise(resolve => { resolveSettled = resolve; });
    const dispatchEntry = {
      controller: new AbortController(),
      providerDispatched: hasIrreversibleDispatchKnowledge(existingAttempt),
      kind: opportunity.kind,
      settled,
      resolveSettled
    };
    dispatching.set(opportunityId, dispatchEntry);
    maxObservedDispatchInFlight = Math.max(maxObservedDispatchInFlight, dispatching.size);
    try {
      const request = createWakeDispatchRequest({
        opportunityId: opportunity.opportunityId,
        activationId: opportunity.activationId,
        ...(opportunity.kind === 'spontaneous' ? { cycleId: opportunity.cycleId } : {}),
        source: opportunity.source,
        occurredAt: opportunity.occurredAtMs,
        ...(opportunity.sourceRef ? { sourceRef: opportunity.sourceRef } : {}),
        ...(opportunity.payloadRef ? { payloadRef: opportunity.payloadRef } : {})
      });
      const onProviderDispatched = async attempt => {
        const { result: boundary } = persistence.transact(draft => {
          const current = findOpportunityById(draft, opportunityId);
          if (!current) return { missing: true };
          const atMs = Math.max(now(), Number(draft.updatedAtMs || 0), Number(current.createdAtMs || 0));
          const currentAttempt = draft.attempts[opportunityId];
          const alreadyIrreversible = hasIrreversibleDispatchKnowledge(currentAttempt);
          const cancellationReason = isTerminalOpportunityStatus(current.status)
            ? (current.cancelReason || current.status || 'opportunity_terminal')
            : (draft.mode !== 'enabled' || dispatchEntry.controller.signal.aborted ? 'owner_disabled' : null);
          if (!alreadyIrreversible && cancellationReason) {
            if (cancellationReason === 'owner_disabled' && !isTerminalOpportunityStatus(current.status)) {
              current.status = 'owner_disabled';
              current.completedAtMs = atMs;
              draft.updatedAtMs = atMs;
            }
            return { cancelled: true, reason: cancellationReason };
          }
          draft.attempts[opportunityId] = mergeAttemptResult(
            currentAttempt,
            opportunityId,
            { ...attempt, status: 'provider_dispatched' },
            atMs
          );
          appendAttemptAudit(draft, opportunityId, 'provider_boundary', {
            ...attempt,
            status: 'provider_dispatched'
          }, atMs);
          if (!isTerminalOpportunityStatus(current.status)) {
            current.status = 'dispatched';
            current.dispatchedAtMs = atMs;
          }
          draft.updatedAtMs = atMs;
          return { status: draft.attempts[opportunityId].status };
        });
        if (boundary && boundary.cancelled) throw preProviderCancelledError(boundary.reason);
        if (boundary && boundary.missing) throw preProviderCancelledError('opportunity_not_found');
        dispatchEntry.providerDispatched = true;
      };
      let result;
      if (hasIrreversibleDispatchKnowledge(existingAttempt)) {
        try {
          result = await dispatchPort.reconcile(opportunityId);
        } catch (error) {
          result = { status: 'reconcile_error', reason: error && error.message ? error.message : 'reconcile_transport_error' };
        }
        return applyDispatchResult(opportunityId, result, { phase: 'reconcile' });
      }
      try {
        result = await dispatchPort.dispatch(request, {
          onProviderDispatched,
          signal: dispatchEntry.controller.signal
        });
      } catch (error) {
        if (dispatchEntry.controller.signal.aborted || (error && error.code === 'wake_pre_provider_cancelled')) {
          const signalReason = dispatchEntry.controller.signal.reason;
          return {
            noOp: true,
            reason: signalReason && signalReason.message
              ? signalReason.message
              : (error && error.message ? error.message : 'owner_disabled')
          };
        }
        throw error;
      }
      return applyDispatchResult(opportunityId, result);
    } finally {
      dispatching.delete(opportunityId);
      signalDispatchQuiescence();
      dispatchEntry.resolveSettled();
    }
  }

  async function recoverIrreversibleAttempts() {
    const snapshot = persistence.read();
    const attempts = unresolvedIrreversibleAttempts(snapshot);
    for (const attempt of attempts) await dispatchOpportunity(attempt.opportunityId);
    return unresolvedIrreversibleAttempts(persistence.read());
  }

  async function recoverRetryableSpontaneousOpportunity() {
    const opportunity = findRetryableSpontaneousOpportunity(persistence.read());
    if (!opportunity) return null;
    return dispatchOpportunity(opportunity.opportunityId);
  }

  async function recover() {
    const control = captureLifecycleAuthority('recover');
    const snapshot = persistence.read();
    if (snapshot.mode === 'disabled_effective') return inspect();
    if (snapshot.mode === 'disable_pending') return reconcileDisable({ controlToken: control });
    if (!hasLifecycleAuthority(control, snapshot, ['enabled'])) return staleLifecycleControl();

    const unresolved = await recoverIrreversibleAttempts();
    if (!hasLifecycleAuthority(control, persistence.read(), ['enabled'])) return staleLifecycleControl();
    if (unresolved.length > 0) {
      scheduler.disarm();
      supervisor.start();
      return inspect();
    }
    const afterAttempts = persistence.read();
    const retryableSpontaneous = findRetryableSpontaneousOpportunity(afterAttempts);
    if (retryableSpontaneous) {
      await dispatchOpportunity(retryableSpontaneous.opportunityId);
      if (!hasLifecycleAuthority(control, persistence.read(), ['enabled'])) return staleLifecycleControl();
      if (shouldRunSupervisor(persistence.read())) supervisor.start();
      return inspect();
    }
    if (!afterAttempts.spontaneousEnabled) {
      scheduler.disarm();
      supervisor.stop();
      return inspect();
    }
    const atMs = Math.max(now(), Number(afterAttempts.updatedAtMs || 0));
    const captured = afterAttempts.projection;
    const cycleInput = captureCycleInputAuthority(afterAttempts, control);
    if (captured && captured.candidateAtMs <= atMs) {
      const materialized = materializeSpontaneous(captured, atMs);
      if (materialized.result.opportunity) await dispatchOpportunity(materialized.result.opportunity.opportunityId);
      else if (materialized.state.mode === 'enabled' && materialized.state.spontaneousEnabled) {
        await reproject(atMs, materialized.state.modulationMultiplier, { controlToken: control, cycleInput });
      }
    } else if (captured) {
      if (!hasCycleInputAuthority(cycleInput, control, persistence.read())) {
        return { noOp: true, reason: 'stale_cycle_input' };
      }
      armCurrentProjection(afterAttempts);
    } else {
      await reproject(atMs, afterAttempts.modulationMultiplier, { controlToken: control, cycleInput });
    }
    if (!hasLifecycleAuthority(control, persistence.read(), ['enabled'])) return staleLifecycleControl();
    if (shouldRunSupervisor(persistence.read())) supervisor.start();
    return inspect();
  }

  async function reconcileScheduler() {
    const snapshot = persistence.read();
    if (snapshot.mode !== 'enabled') return { noOp: true, reason: 'no_active_projection' };
    const unresolved = unresolvedIrreversibleAttempts(snapshot);
    if (unresolved.length > 0) {
      for (const attempt of unresolved) await dispatchOpportunity(attempt.opportunityId);
      return {
        repairedAttempts: unresolved.length,
        remainingIrreversibleAttempts: unresolvedIrreversibleAttempts(persistence.read()).length
      };
    }
    const after = persistence.read();
    const retryableSpontaneous = findRetryableSpontaneousOpportunity(after);
    if (retryableSpontaneous) {
      const result = await recoverRetryableSpontaneousOpportunity();
      return { repairedRetryableOpportunity: retryableSpontaneous.opportunityId, result };
    }
    if (!after.spontaneousEnabled || !after.projection) return { noOp: true, reason: 'no_active_projection' };
    if (after.projection.candidateAtMs <= now()) return handleScheduledFire(after.projection);
    if (!scheduler.hasCurrent(after.projection)) {
      armCurrentProjection(after);
      return { repaired: true, schedulerGeneration: after.projection.schedulerGeneration };
    }
    return { repaired: false, schedulerGeneration: after.projection.schedulerGeneration };
  }

  const supervisor = options.supervisor || createWakeSupervisor({
    intervalMs: options.supervisorIntervalMs,
    setIntervalFn: options.setIntervalFn,
    clearIntervalFn: options.clearIntervalFn,
    reconcile: reconcileScheduler
  });

  function inspect() {
    return {
      state: persistence.read(),
      timer: scheduler.inspect(),
      supervisorRunning: supervisor.isRunning(),
      dispatchInFlight: dispatching.size,
      maxDispatchInFlight,
      maxObservedDispatchInFlight
    };
  }

  return Object.freeze({
    cancelExternalOpportunity,
    disable,
    dispatchOpportunity,
    enable,
    handleScheduledFire,
    inspect,
    materializeSpontaneous,
    recordAgentRun,
    reconcileDisable,
    reconcileScheduler,
    recover,
    reproject,
    setSpontaneousEnabled,
    submitExternalOpportunity
  });
}

module.exports = { createStandaloneWakeKernel, deterministicOpportunityId };
