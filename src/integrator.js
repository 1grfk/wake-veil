'use strict';

const { DEFAULT_POLICY, advanceStateAtCanonicalBoundary, computeLambdaPerHour } = require('./policy');
const { ENTROPY_ALGORITHM_VERSION, INTEGRATOR_VERSION, normalFromSeed } = require('./entropy');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertCycleVersions(state, progress, entropy, policy = DEFAULT_POLICY) {
  if (state.policyVersion !== entropy.policyVersion || entropy.policyVersion !== policy.policyVersion) {
    throw new Error('wake_policy_version_unsupported');
  }
  if (progress.integratorVersion !== INTEGRATOR_VERSION || entropy.integratorVersion !== INTEGRATOR_VERSION) {
    throw new Error('wake_integrator_version_unsupported');
  }
  if (entropy.entropyAlgorithmVersion !== ENTROPY_ALGORITHM_VERSION) {
    throw new Error('wake_entropy_version_unsupported');
  }
  if (progress.cycleId !== entropy.cycleId) throw new Error('wake_cycle_mismatch');
}

function createCycleProgress(cycleId, nowMs, stateVersion) {
  return {
    cycleId,
    accumulatedHazard: 0,
    activeElapsedMs: 0,
    advancedThroughAtMs: nowMs,
    projectionStepIndex: 0,
    stateVersion,
    integratorVersion: INTEGRATOR_VERSION,
    thresholdCrossedAtMs: null
  };
}

function stepRemainderMs(activeElapsedMs, stepMs) {
  const partial = activeElapsedMs % stepMs;
  return partial === 0 ? stepMs : stepMs - partial;
}

function consumeBoundary(state, progress, entropy, policy) {
  const stepIndex = progress.projectionStepIndex;
  const nextState = advanceStateAtCanonicalBoundary(
    state,
    normalFromSeed(entropy.driftSeed, 'tone', stepIndex),
    normalFromSeed(entropy.driftSeed, 'drift', stepIndex),
    policy
  );
  progress.projectionStepIndex += 1;
  return nextState;
}

function advanceCycleTo(input) {
  const policy = input.policy || DEFAULT_POLICY;
  let state = clone(input.state);
  const progress = clone(input.progress);
  const entropy = input.entropy;
  const modulation = Number(input.modulationMultiplier === undefined ? 1 : input.modulationMultiplier);
  const targetAtMs = Number(input.targetAtMs);
  assertCycleVersions(state, progress, entropy, policy);
  if (!Number.isSafeInteger(targetAtMs) || targetAtMs < progress.advancedThroughAtMs) {
    throw new TypeError('targetAtMs must not precede advancedThroughAtMs');
  }

  let wallAtMs = progress.advancedThroughAtMs;
  while (wallAtMs < targetAtMs) {
    const remainingToBoundary = stepRemainderMs(progress.activeElapsedMs, policy.projectionStepMs);
    const segmentMs = Math.min(targetAtMs - wallAtMs, remainingToBoundary);
    if (progress.accumulatedHazard < entropy.thresholdSample) {
      const lambda = computeLambdaPerHour(state, modulation, policy);
      const deltaHazard = lambda * segmentMs / 3600000;
      if (progress.accumulatedHazard + deltaHazard >= entropy.thresholdSample) {
        const exactOffsetMs = (entropy.thresholdSample - progress.accumulatedHazard) / lambda * 3600000;
        progress.thresholdCrossedAtMs = progress.thresholdCrossedAtMs || wallAtMs + Math.ceil(exactOffsetMs);
        progress.accumulatedHazard = entropy.thresholdSample;
      } else {
        progress.accumulatedHazard += deltaHazard;
      }
    }
    wallAtMs += segmentMs;
    progress.activeElapsedMs += segmentMs;
    progress.advancedThroughAtMs = wallAtMs;
    if (progress.activeElapsedMs % policy.projectionStepMs === 0) {
      state = consumeBoundary(state, progress, entropy, policy);
    }
  }
  return { state, progress };
}

function projectCandidateAt(input) {
  const policy = input.policy || DEFAULT_POLICY;
  let state = clone(input.state);
  const progress = clone(input.progress);
  const entropy = input.entropy;
  const modulation = Number(input.modulationMultiplier === undefined ? 1 : input.modulationMultiplier);
  assertCycleVersions(state, progress, entropy, policy);
  let wallAtMs = progress.advancedThroughAtMs;
  if (progress.accumulatedHazard >= entropy.thresholdSample) return wallAtMs;

  let guard = 0;
  while (progress.accumulatedHazard < entropy.thresholdSample) {
    if (++guard > 5000000) throw new Error('wake_projection_numerical_guard');
    const segmentMs = stepRemainderMs(progress.activeElapsedMs, policy.projectionStepMs);
    const lambda = computeLambdaPerHour(state, modulation, policy);
    const deltaHazard = lambda * segmentMs / 3600000;
    if (progress.accumulatedHazard + deltaHazard >= entropy.thresholdSample) {
      const exactOffsetMs = (entropy.thresholdSample - progress.accumulatedHazard) / lambda * 3600000;
      return wallAtMs + Math.ceil(exactOffsetMs);
    }
    progress.accumulatedHazard += deltaHazard;
    wallAtMs += segmentMs;
    progress.activeElapsedMs += segmentMs;
    progress.advancedThroughAtMs = wallAtMs;
    state = consumeBoundary(state, progress, entropy, policy);
  }
  return wallAtMs;
}

module.exports = {
  advanceCycleTo,
  assertCycleVersions,
  createCycleProgress,
  projectCandidateAt,
  stepRemainderMs
};
