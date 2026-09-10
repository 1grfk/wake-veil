'use strict';

const MAX_TIMEOUT_MS = 2147483647;

function createOneShotWakeScheduler(options = {}) {
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const setTimeoutFn = options.setTimeoutFn || setTimeout;
  const clearTimeoutFn = options.clearTimeoutFn || clearTimeout;
  const onError = typeof options.onError === 'function' ? options.onError : (() => {});
  let timer = null;
  let armed = null;

  function disarm() {
    if (timer !== null) clearTimeoutFn(timer);
    timer = null;
    armed = null;
  }

  function arm(projection, onFire) {
    disarm();
    const captured = Object.freeze({
      cycleId: projection.cycleId,
      derivedFromStateVersion: projection.derivedFromStateVersion,
      schedulerGeneration: projection.schedulerGeneration,
      candidateAtMs: projection.candidateAtMs
    });
    armed = captured;
    const scheduleSegment = () => {
      const remaining = Math.max(0, captured.candidateAtMs - now());
      const delay = Math.min(MAX_TIMEOUT_MS, remaining);
      timer = setTimeoutFn(() => {
        timer = null;
        const remainingAtFire = captured.candidateAtMs - now();
        if (remainingAtFire > 0) return scheduleSegment();
        armed = null;
        Promise.resolve().then(() => onFire(captured)).catch(onError);
      }, delay);
    };
    scheduleSegment();
    return captured;
  }

  return Object.freeze({
    arm,
    disarm,
    hasCurrent(projection) {
      return !!armed
        && armed.cycleId === projection.cycleId
        && armed.schedulerGeneration === projection.schedulerGeneration
        && armed.derivedFromStateVersion === projection.derivedFromStateVersion
        && armed.candidateAtMs === projection.candidateAtMs;
    },
    inspect: () => armed ? { ...armed } : null
  });
}

module.exports = { MAX_TIMEOUT_MS, createOneShotWakeScheduler };
