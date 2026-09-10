'use strict';

const AGENT_RUN_FACT_FIELDS = Object.freeze([
  'agentRunRef', 'occurredAtMs', 'originOpportunityId', 'source'
]);

function requiredText(value, label) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new TypeError(`${label} is required`);
  return text;
}

function createAgentRunFact(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype) {
    throw new TypeError('AgentRunFact must be a plain object');
  }
  for (const key of Object.keys(input)) {
    if (!AGENT_RUN_FACT_FIELDS.includes(key)) throw new TypeError(`Unknown AgentRunFact field: ${key}`);
  }
  const occurredAtMs = Number(input.occurredAtMs);
  if (!Number.isSafeInteger(occurredAtMs) || occurredAtMs < 1) {
    throw new TypeError('AgentRunFact occurredAtMs must be UTC epoch milliseconds');
  }
  const fact = {
    agentRunRef: requiredText(input.agentRunRef, 'agentRunRef'),
    source: requiredText(input.source, 'source'),
    occurredAtMs
  };
  if (input.originOpportunityId !== undefined && input.originOpportunityId !== null) {
    fact.originOpportunityId = requiredText(input.originOpportunityId, 'originOpportunityId');
  }
  return Object.freeze(fact);
}

function sameAgentRunFact(leftInput, rightInput) {
  const left = createAgentRunFact(leftInput);
  const right = createAgentRunFact(rightInput);
  return left.agentRunRef === right.agentRunRef
    && left.source === right.source
    && left.occurredAtMs === right.occurredAtMs
    && (left.originOpportunityId || null) === (right.originOpportunityId || null);
}

function createNoopStateInputAdapter() {
  return Object.freeze({
    async readLatestAgentRunFact() {
      return Object.freeze({ status: 'unavailable', fact: null });
    }
  });
}

function createTestStateInputAdapter(initialFacts = []) {
  const facts = new Map();
  for (const item of initialFacts) record(item);

  function record(input) {
    const fact = createAgentRunFact(input);
    const existing = facts.get(fact.agentRunRef);
    if (existing && !sameAgentRunFact(existing, fact)) throw new Error('agent_run_fact_conflict');
    facts.set(fact.agentRunRef, fact);
    return fact;
  }

  return Object.freeze({
    async readLatestAgentRunFact() {
      const ordered = [...facts.values()].sort((left, right) => (
        left.occurredAtMs - right.occurredAtMs || left.agentRunRef.localeCompare(right.agentRunRef)
      ));
      const fact = ordered.length ? ordered[ordered.length - 1] : null;
      return Object.freeze({ status: fact ? 'available' : 'unavailable', fact });
    },
    inspect: () => [...facts.values()].map(item => ({ ...item })),
    record
  });
}

module.exports = {
  AGENT_RUN_FACT_FIELDS,
  createAgentRunFact,
  createNoopStateInputAdapter,
  createTestStateInputAdapter,
  sameAgentRunFact
};
