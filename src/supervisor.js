'use strict';

function createWakeSupervisor(options = {}) {
  const setIntervalFn = options.setIntervalFn || setInterval;
  const clearIntervalFn = options.clearIntervalFn || clearInterval;
  const reconcile = options.reconcile;
  const onError = typeof options.onError === 'function' ? options.onError : (() => {});
  const intervalMs = Math.max(1000, Number(options.intervalMs) || 60000);
  if (typeof reconcile !== 'function') throw new TypeError('Wake supervisor reconcile function is required');
  let interval = null;
  let running = false;

  return Object.freeze({
    start() {
      if (interval !== null) return;
      interval = setIntervalFn(() => {
        if (running) return;
        running = true;
        Promise.resolve().then(reconcile).catch(onError).finally(() => { running = false; });
      }, intervalMs);
    },
    stop() {
      if (interval !== null) clearIntervalFn(interval);
      interval = null;
      running = false;
    },
    isRunning: () => interval !== null
  });
}

module.exports = { createWakeSupervisor };
