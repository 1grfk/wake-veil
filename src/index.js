'use strict';

const { createStandaloneWakeKernel } = require('./engine');
const { createAuthoritativeRuntimeWakeDispatchPort } = require('./runtime-adapter');
const { createWakeSourceRegistry } = require('./source-registry');
const { createMemoryWakePersistence, createFileWakePersistence } = require('./persistence');
const { createOneShotWakeScheduler } = require('./scheduler');
const { createWakeSupervisor } = require('./supervisor');
const { createNoopStateInputAdapter } = require('./state-input');
const { createNoopSubjectiveWakeModulationAdapter, aggregateModulation } = require('./modulation');
const { createWakeDispatchRequest, buildDynamicWakeupContribution } = require('./contracts');
const { DEFAULT_POLICY, POLICY_VERSION, computeLambdaPerHour } = require('./policy');
const { ENTROPY_ALGORITHM_VERSION, INTEGRATOR_VERSION } = require('./entropy');

module.exports = Object.freeze({
  createStandaloneWakeKernel,
  createAuthoritativeRuntimeWakeDispatchPort,
  createWakeSourceRegistry,
  createMemoryWakePersistence,
  createFileWakePersistence,
  createOneShotWakeScheduler,
  createWakeSupervisor,
  createNoopStateInputAdapter,
  createNoopSubjectiveWakeModulationAdapter,
  aggregateModulation,
  createWakeDispatchRequest,
  buildDynamicWakeupContribution,
  computeLambdaPerHour,
  DEFAULT_POLICY,
  POLICY_VERSION,
  ENTROPY_ALGORITHM_VERSION,
  INTEGRATOR_VERSION
});
