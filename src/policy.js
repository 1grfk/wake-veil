'use strict';

const POLICY_VERSION = 'wake.activation.v1.0-dev';

const DEFAULT_POLICY = Object.freeze({
  policyVersion: POLICY_VERSION,
  driveInitial: 0.50,
  driveMean: 0.50,
  driveMin: 0.20,
  driveMax: 0.80,
  runKick: 0.02,
  driveHalfLifeHours: 12 / 60,
  toneInitial: 0.50,
  toneMean: 0.50,
  toneMin: 0.25,
  toneMax: 0.75,
  toneHalfLifeHours: 6,
  toneSigma: 0.10,
  driftInitial: 0,
  driftMin: -0.40,
  driftMax: 0.40,
  driftHalfLifeHours: 25 / 60,
  driftSigma: 0.18,
  lambdaBasePerHour: 1.80,
  betaDrive: 1.80,
  betaTone: 1.60,
  betaDrift: 1.20,
  lambdaMinPerHour: 0.15,
  lambdaMaxPerHour: 8.00,
  modulationMin: 0.60,
  modulationMax: 3.00,
  projectionStepMs: 30000
});

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function validateFinite(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
}

function createInitialActivationState(nowMs, policy = DEFAULT_POLICY) {
  if (!Number.isSafeInteger(nowMs) || nowMs < 1) throw new TypeError('nowMs must be UTC epoch milliseconds');
  return {
    activationDrive: policy.driveInitial,
    latentActivityTone: policy.toneInitial,
    stochasticDriftState: policy.driftInitial,
    lastAgentRunAtMs: null,
    lastSpontaneousWakeAtMs: null,
    stateVersion: 1,
    policyVersion: policy.policyVersion
  };
}

function computeLambdaPerHour(state, modulationMultiplier = 1, policy = DEFAULT_POLICY) {
  const drive = validateFinite(Number(state.activationDrive), 'activationDrive');
  const tone = validateFinite(Number(state.latentActivityTone), 'latentActivityTone');
  const drift = validateFinite(Number(state.stochasticDriftState), 'stochasticDriftState');
  const modulation = clamp(validateFinite(Number(modulationMultiplier), 'modulationMultiplier'), policy.modulationMin, policy.modulationMax);
  const exponent = policy.betaDrive * (drive - policy.driveMean)
    + policy.betaTone * (tone - policy.toneMean)
    + policy.betaDrift * drift;
  return clamp(policy.lambdaBasePerHour * Math.exp(exponent) * modulation, policy.lambdaMinPerHour, policy.lambdaMaxPerHour);
}

function meanReversion(value, mean, halfLifeHours, deltaHours) {
  const rho = Math.pow(2, -deltaHours / halfLifeHours);
  return mean + (value - mean) * rho;
}

function advanceStateAtCanonicalBoundary(state, epsilonTone, epsilonDrift, policy = DEFAULT_POLICY) {
  const deltaHours = policy.projectionStepMs / 3600000;
  const rhoTone = Math.pow(2, -deltaHours / policy.toneHalfLifeHours);
  const rhoDrift = Math.pow(2, -deltaHours / policy.driftHalfLifeHours);
  return {
    ...state,
    activationDrive: clamp(
      meanReversion(state.activationDrive, policy.driveMean, policy.driveHalfLifeHours, deltaHours),
      policy.driveMin,
      policy.driveMax
    ),
    latentActivityTone: clamp(
      policy.toneMean
        + (state.latentActivityTone - policy.toneMean) * rhoTone
        + policy.toneSigma * Math.sqrt(1 - rhoTone * rhoTone) * epsilonTone,
      policy.toneMin,
      policy.toneMax
    ),
    stochasticDriftState: clamp(
      state.stochasticDriftState * rhoDrift
        + policy.driftSigma * Math.sqrt(1 - rhoDrift * rhoDrift) * epsilonDrift,
      policy.driftMin,
      policy.driftMax
    )
  };
}

function applyAgentRunRelease(state, occurredAtMs, source, policy = DEFAULT_POLICY) {
  const next = {
    ...state,
    activationDrive: clamp(state.activationDrive - policy.runKick, policy.driveMin, policy.driveMax),
    lastAgentRunAtMs: occurredAtMs,
    stateVersion: state.stateVersion + 1
  };
  if (source === 'spontaneous') next.lastSpontaneousWakeAtMs = occurredAtMs;
  return next;
}

module.exports = {
  DEFAULT_POLICY,
  POLICY_VERSION,
  advanceStateAtCanonicalBoundary,
  applyAgentRunRelease,
  clamp,
  computeLambdaPerHour,
  createInitialActivationState,
  meanReversion
};
