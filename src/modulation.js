'use strict';

const { DEFAULT_POLICY, clamp } = require('./policy');

/**
 * Subjective modulation integration boundary.
 *
 * Hosts may provide only a derived, bounded SubjectiveWakeModulation.
 * Wake Veil does not infer emotion, appraisal, affect, need, mood, or other
 * subjective state from local heuristics such as silence duration, keywords,
 * reply latency, or message content.
 *
 * Missing or unavailable subjective-state input means neutral modulation: the
 * endogenous spontaneous activation dynamics continue normally.
 *
 * Keep provider-specific schemas, network calls, and subjective-state models
 * outside the kernel. Adapt them at the ModulationInputPort boundary.
 */
function createNoopSubjectiveWakeModulationAdapter() {
  return Object.freeze({
    async read() {
      return Object.freeze({ status: 'unavailable', multiplier: 1, contributions: [] });
    }
  });
}

function aggregateModulation(contributions, policy = DEFAULT_POLICY) {
  if (!Array.isArray(contributions) || contributions.length === 0) return 1;
  let logSum = 0;
  for (const contribution of contributions) {
    const multiplier = Number(contribution && contribution.multiplier);
    const confidence = Number(contribution && contribution.confidence);
    if (!Number.isFinite(multiplier) || multiplier <= 0) throw new TypeError('modulation multiplier must be positive');
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new TypeError('modulation confidence must be within 0..1');
    logSum += confidence * Math.log(multiplier);
  }
  return Math.exp(clamp(logSum, Math.log(policy.modulationMin), Math.log(policy.modulationMax)));
}

module.exports = { aggregateModulation, createNoopSubjectiveWakeModulationAdapter };
