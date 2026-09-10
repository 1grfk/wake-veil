'use strict';
// wake-veil 沙盒冒烟测试：验证 kernel 完整生命周期在 QuickJS+shim 下可运行
require('./env');

const log = [];
const { createAuthoritativeRuntimeWakeDispatchPort } = require('./runtime-adapter');
const { createMemoryWakePersistence } = require('./persistence');
const { createStandaloneWakeKernel } = require('./engine');

const runtime = {
  async dispatchWakeInferenceAttempt(request, hooks) {
    log.push('dispatch:start:' + request.opportunityId + ':' + request.kind + ':' + request.source);
    const inferenceAttemptRef = 'attempt:' + request.opportunityId;
    await hooks.onProviderDispatched({
      status: 'provider_dispatched',
      opportunityId: request.opportunityId,
      inferenceAttemptRef
    });
    return {
      status: 'completed',
      opportunityId: request.opportunityId,
      inferenceAttemptRef,
      agentRunRef: 'run:' + request.opportunityId,
      agentRunOccurredAtMs: Date.now(),
      outcome: 'silent'
    };
  },
  async reconcileWakeInferenceAttempt({ opportunityId }) {
    return { status: 'not_found', opportunityId };
  }
};

async function main() {
  // 1. 基础 shim 自检
  log.push('shim:Buffer=' + (typeof Buffer !== 'undefined' && typeof Buffer.alloc === 'function'));
  log.push('shim:crypto=' + (typeof require('./shim').crypto.createHash === 'function'));
  log.push('shim:AbortController=' + (typeof AbortController !== 'undefined'));

  const dispatchPort = createAuthoritativeRuntimeWakeDispatchPort({ runtime });
  const persistence = createMemoryWakePersistence();
  const kernel = createStandaloneWakeKernel({
    persistence,
    dispatchPort,
    spontaneousEnabled: false
  });

  // 2. enable（自发关闭，纯外部事件模式）
  const enabled = await kernel.enable();
  log.push('enable:mode=' + enabled.mode + ', spontaneous=' + enabled.spontaneousEnabled);

  // 3. 提交外部事件
  const submitted = await kernel.submitExternalOpportunity({
    source: 'test-source',
    sourceRef: 'src-001',
    payloadRef: 'payload-001'
  });
  log.push('submit:status=' + (submitted && submitted.status));

  // 4. 等 dispatch 落定
  await new Promise(resolve => setTimeout(resolve, 50));

  // 5. 查看状态
  const state = kernel.inspect().state || persistence.read();
  const oppCount = Object.keys(state.opportunities || {}).length;
  const opp = Object.values(state.opportunities || {})[0];
  log.push('inspect:mode=' + state.mode + ', opportunities=' + oppCount);
  if (opp) log.push('opportunity:status=' + opp.status + ', kind=' + opp.kind + ', source=' + opp.sourceRef);

  // 6. disable 验证清理
  const disabled = await kernel.disable();
  log.push('disable:mode=' + (disabled.mode || (disabled.state && disabled.state.mode)));

  return JSON.stringify({ ok: true, log });
}

return main().then(
  res => res,
  err => JSON.stringify({ ok: false, error: String(err && err.message || err), stack: err && err.stack, log })
);