/*
METADATA
{
  "name": "autonomous_budget",
  "display_name": {
    "zh": "自主行为预算闸门",
    "en": "Autonomous Budget Gate"
  },
  "description": {
    "zh": "把所有后台自主行为（主动消息/日记/信件/反思/巡检）收进统一预算闸门。调用模型前先 check，完成后 consume 记账；预算不足可发起 topup 申请找用户批额度。只管自主行为，不管正常聊天。",
    "en": "Unified budget gate for autonomous behaviors."
  },
  "enabledByDefault": false,
  "category": "Utility",
  "tools": [
    {
      "name": "budget_status",
      "description": {
        "zh": "查看今日自主行为预算账本：已用/限额/剩余，及各行为消耗明细。",
        "en": "View today's autonomous budget ledger."
      },
      "parameters": []
    },
    {
      "name": "budget_check",
      "description": {
        "zh": "自主行为调用模型前的预算闸门。传入行为类型与预计 token 量，放行返回 allow=true，拒绝返回 allow=false 和原因（预算不足/行为超额/有未处理的追加申请）。",
        "en": "Budget gate before autonomous model calls."
      },
      "parameters": [
        {
          "name": "behavior_type",
          "description": {
            "zh": "行为类型：proactive_message/diary/letter/reflection/jealous_patrol/forum_patrol/virtual_screen/other",
            "en": "Behavior type"
          },
          "type": "string",
          "required": true
        },
        {
          "name": "estimated_input_tokens",
          "description": {
            "zh": "预计输入 token 数（提示词+上下文长度估算）",
            "en": "Estimated input tokens"
          },
          "type": "integer",
          "required": false
        },
        {
          "name": "estimated_output_tokens",
          "description": {
            "zh": "预计输出 token 数",
            "en": "Estimated output tokens"
          },
          "type": "integer",
          "required": false
        }
      ]
    },
    {
      "name": "budget_consume",
      "description": {
        "zh": "自主行为执行完成后按实际估算记账。传行为类型和实际 input/output token。",
        "en": "Record usage after autonomous behavior completes."
      },
      "parameters": [
        {
          "name": "behavior_type",
          "description": {
            "zh": "行为类型",
            "en": "Behavior type"
          },
          "type": "string",
          "required": true
        },
        {
          "name": "input_tokens",
          "description": {
            "zh": "实际输入 token 数",
            "en": "Actual input tokens"
          },
          "type": "integer",
          "required": true
        },
        {
          "name": "output_tokens",
          "description": {
            "zh": "实际输出 token 数",
            "en": "Actual output tokens"
          },
          "type": "integer",
          "required": true
        },
        {
          "name": "note",
          "description": {
            "zh": "备注（可选）",
            "en": "Note (optional)"
          },
          "type": "string",
          "required": false
        }
      ]
    },
    {
      "name": "budget_request_topup",
      "description": {
        "zh": "预算不足时向用户发起追加额度申请：弹通知 + 记 pending。用户批准后调 budget_topup_approve 生效。",
        "en": "Request extra budget from user via notification."
      },
      "parameters": [
        {
          "name": "amount_yuan",
          "description": {
            "zh": "申请的追加金额（元）",
            "en": "Requested amount in yuan"
          },
          "type": "number",
          "required": true
        },
        {
          "name": "reason",
          "description": {
            "zh": "申请原因，如：今天日记还没写完",
            "en": "Reason for the request"
          },
          "type": "string",
          "required": false
        },
        {
          "name": "behavior_type",
          "description": {
            "zh": "哪个行为需要追加额度",
            "en": "Behavior needing extra budget"
          },
          "type": "string",
          "required": false
        }
      ]
    },
    {
      "name": "budget_topup_approve",
      "description": {
        "zh": "批准或拒绝当天的追加额度申请。批准后临时额度立即生效（仅当天有效）。",
        "en": "Approve or reject today's topup request."
      },
      "parameters": [
        {
          "name": "approve",
          "description": {
            "zh": "true=批准，false=拒绝",
            "en": "true=approve, false=reject"
          },
          "type": "boolean",
          "required": true
        },
        {
          "name": "amount_yuan",
          "description": {
            "zh": "实际批准金额；不填则按申请的金额批准",
            "en": "Approved amount; default to requested amount"
          },
          "type": "number",
          "required": false
        }
      ]
    },
    {
      "name": "budget_set_limit",
      "description": {
        "zh": "设置每日自主预算上限：费用上限（元）与 token 上限。",
        "en": "Set daily budget limits."
      },
      "parameters": [
        {
          "name": "daily_cost_yuan",
          "description": {
            "zh": "每日费用上限（元）",
            "en": "Daily cost limit in yuan"
          },
          "type": "number",
          "required": false
        },
        {
          "name": "daily_token_limit",
          "description": {
            "zh": "每日 token 上限",
            "en": "Daily token limit"
          },
          "type": "integer",
          "required": false
        }
      ]
    },
    {
      "name": "budget_set_behavior",
      "description": {
        "zh": "启用/禁用某个行为的预算管控（默认全部开启）。",
        "en": "Enable/disable budget control for a behavior."
      },
      "parameters": [
        {
          "name": "behavior_type",
          "description": {
            "zh": "行为类型",
            "en": "Behavior type"
          },
          "type": "string",
          "required": true
        },
        {
          "name": "enabled",
          "description": {
            "zh": "true=开启管控，false=关闭管控（该行为不查闸）",
            "en": "true=controlled, false=bypass"
          },
          "type": "boolean",
          "required": true
        }
      ]
    },
    {
      "name": "budget_log",
      "description": {
        "zh": "查看最近记账/闸门日志（allow/deny/topup 都留痕）。",
        "en": "View recent budget logs."
      },
      "parameters": [
        {
          "name": "limit",
          "description": {
            "zh": "返回最近 N 条，默认 20",
            "en": "Recent N entries"
          },
          "type": "integer",
          "required": false
        }
      ]
    }
  ]
}
*/

const BUDGET_DIR = "/sdcard/Download/Operit/autonomous_budget";
const LEDGER_PATH = BUDGET_DIR + "/ledger.json";

const DEFAULT_CONFIG = {
  daily_cost_yuan: 2.0,       // 每日费用上限：2元
  daily_token_limit: 80000,   // 每日 token 上限：8万
  // 价格按阿里云百炼 deepseek-v4-flash 高峰价（宁高勿低，保守记账）
  // 输入缓存未命中 3元/百万，输出 9元/百万
  cost_per_million_input: 3.0,
  cost_per_million_output: 9.0,
  behaviors: {
    proactive_message: true,
    diary: true,
    letter: true,
    reflection: true,
    jealous_patrol: true,
    forum_patrol: true,
    virtual_screen: true,
    other: true
  },
  master_enabled: true
};

const VALID_BEHAVIORS = [
  "proactive_message", "diary", "letter", "reflection",
  "jealous_patrol", "forum_patrol", "virtual_screen", "other"
];

function pad(n) { return n.toString().padStart(2, "0"); }

function todayLocal() {
  const d = new Date();
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}

function nowLocal() {
  const d = new Date();
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
    " " + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
}

function emptyDay(dateStr) {
  return {
    date: dateStr,
    tokens_used: 0,
    cost_yuan: 0,
    behaviors: {},
    topup_extra_yuan: 0,
    pending_topup: null,
    topup_history: []
  };
}

async function loadLedger() {
  try {
    const res = await Tools.Files.read(LEDGER_PATH);
    if (res && res.content) {
      return JSON.parse(res.content);
    }
  } catch (e) {
    console.log("ledger not found or invalid, creating new: " + e);
  }
  return { config: JSON.parse(JSON.stringify(DEFAULT_CONFIG)), days: {}, log: [] };
}

async function saveLedger(ledger) {
  await Tools.Files.mkdir(BUDGET_DIR, true);
  await Tools.Files.write(LEDGER_PATH, JSON.stringify(ledger, null, 2), false);
}

function getToday(ledger) {
  const date = todayLocal();
  if (!ledger.days[date]) {
    ledger.days[date] = emptyDay(date);
  }
  // 清理历史天数，最多保留 60 天，防无限膨胀
  const dates = Object.keys(ledger.days).sort();
  while (dates.length > 60) {
    delete ledger.days[dates.shift()];
  }
  return ledger.days[date];
}

function behaviorUsed(day, bt) {
  if (!day.behaviors[bt]) day.behaviors[bt] = { tokens: 0, cost_yuan: 0, count: 0 };
  return day.behaviors[bt];
}

function estimateCost(ledger, inputTokens, outputTokens) {
  const c = ledger.config;
  const inputCost = (inputTokens / 1000000) * c.cost_per_million_input;
  const outputCost = (outputTokens / 1000000) * c.cost_per_million_output;
  return inputCost + outputCost;
}

function pushLog(ledger, entry) {
  ledger.log.push(entry);
  if (ledger.log.length > 500) ledger.log.splice(0, ledger.log.length - 500);
}

// ---------- 工具实现 ----------

async function budget_status() {
  try {
    const ledger = await loadLedger();
    const day = getToday(ledger);
    const config = ledger.config;
    const remainingCost = Math.max(0, (config.daily_cost_yuan + day.topup_extra_yuan) - day.cost_yuan);
    const remainingTokens = Math.max(0, config.daily_token_limit - day.tokens_used);
    const behaviorSummary = {};
    for (const bt of VALID_BEHAVIORS) {
      if (day.behaviors[bt]) {
        behaviorSummary[bt] = day.behaviors[bt];
      }
    }
    complete({
      success: true,
      data: {
        date: day.date,
        master_enabled: config.master_enabled,
        daily_cost_limit_yuan: config.daily_cost_yuan,
        topup_extra_yuan: day.topup_extra_yuan,
        effective_cost_limit_yuan: config.daily_cost_yuan + day.topup_extra_yuan,
        cost_used_yuan: Number(day.cost_yuan.toFixed(4)),
        cost_remaining_yuan: Number(remainingCost.toFixed(4)),
        daily_token_limit: config.daily_token_limit,
        tokens_used: day.tokens_used,
        tokens_remaining: remainingTokens,
        behaviors: behaviorSummary,
        pending_topup: day.pending_topup
      }
    });
  } catch (e) {
    complete({ success: false, message: "budget_status 失败: " + (e && e.message ? e.message : e) });
  }
}

async function budget_check(params) {
  try {
    const bt = String(params.behavior_type || "").trim();
    if (!VALID_BEHAVIORS.includes(bt)) {
      complete({ success: false, message: "未知行为类型: " + bt + "，可选: " + VALID_BEHAVIORS.join("/") });
      return;
    }
    const estIn = Math.max(0, parseInt(params.estimated_input_tokens) || 0);
    const estOut = Math.max(0, parseInt(params.estimated_output_tokens) || 0);
    const ledger = await loadLedger();
    const config = ledger.config;

    if (!config.master_enabled) {
      complete({ success: true, data: { allow: true, reason: "master_disabled" } });
      return;
    }
    if (config.behaviors[bt] === false) {
      complete({ success: true, data: { allow: true, reason: "behavior_bypass" } });
      return;
    }

    const day = getToday(ledger);
    const effCostLimit = config.daily_cost_yuan + day.topup_extra_yuan;
    const estCost = estimateCost(ledger, estIn, estOut);

    // 预占式检查：已用 + 本次预计 是否会越界
    if (day.cost_yuan + estCost > effCostLimit + 1e-9) {
      // 费用越界
      const denied = {
        allow: false,
        reason: "cost_budget_exhausted",
        message: "今日自主费用预算不足（已用 " + day.cost_yuan.toFixed(4) + "元 / 上限 " + effCostLimit.toFixed(2) + "元）",
        cost_used_yuan: Number(day.cost_yuan.toFixed(4)),
        cost_limit_yuan: Number(effCostLimit.toFixed(2)),
        has_pending_topup: !!day.pending_topup
      };
      pushLog(ledger, { t: nowLocal(), type: "deny", behavior: bt, reason: "cost_budget_exhausted", estIn: estIn, estOut: estOut, estCost: Number(estCost.toFixed(6)) });
      await saveLedger(ledger);
      complete({ success: true, data: denied });
      return;
    }
    if (day.tokens_used + estIn + estOut > config.daily_token_limit) {
      const denied = {
        allow: false,
        reason: "token_budget_exhausted",
        message: "今日自主 token 预算不足（已用 " + day.tokens_used + " / 上限 " + config.daily_token_limit + "）",
        tokens_used: day.tokens_used,
        token_limit: config.daily_token_limit,
        has_pending_topup: !!day.pending_topup
      };
      pushLog(ledger, { t: nowLocal(), type: "deny", behavior: bt, reason: "token_budget_exhausted", estIn: estIn, estOut: estOut });
      await saveLedger(ledger);
      complete({ success: true, data: denied });
      return;
    }

    // 放行
    pushLog(ledger, { t: nowLocal(), type: "allow", behavior: bt, estIn: estIn, estOut: estOut, estCost: Number(estCost.toFixed(6)) });
    await saveLedger(ledger);
    complete({
      success: true,
      data: {
        allow: true,
        reason: "ok",
        estimated_cost_yuan: Number(estCost.toFixed(6)),
        cost_remaining_yuan: Number((effCostLimit - day.cost_yuan - estCost).toFixed(4)),
        tokens_remaining: config.daily_token_limit - day.tokens_used - estIn - estOut
      }
    });
  } catch (e) {
    complete({ success: false, message: "budget_check 失败: " + (e && e.message ? e.message : e) });
  }
}

async function budget_consume(params) {
  try {
    const bt = String(params.behavior_type || "").trim();
    if (!VALID_BEHAVIORS.includes(bt)) {
      complete({ success: false, message: "未知行为类型: " + bt });
      return;
    }
    const inTok = Math.max(0, parseInt(params.input_tokens) || 0);
    const outTok = Math.max(0, parseInt(params.output_tokens) || 0);
    const note = String(params.note || "");
    const ledger = await loadLedger();
    const day = getToday(ledger);
    const cost = estimateCost(ledger, inTok, outTok);
    const bu = behaviorUsed(day, bt);
    day.tokens_used += inTok + outTok;
    day.cost_yuan += cost;
    bu.tokens += inTok + outTok;
    bu.cost_yuan += cost;
    bu.count += 1;
    pushLog(ledger, { t: nowLocal(), type: "consume", behavior: bt, inTok: inTok, outTok: outTok, cost: Number(cost.toFixed(6)), note: note });
    await saveLedger(ledger);
    complete({
      success: true,
      data: {
        recorded: true,
        tokens_used: day.tokens_used,
        cost_used_yuan: Number(day.cost_yuan.toFixed(4)),
        behavior_count: bu.count
      }
    });
  } catch (e) {
    complete({ success: false, message: "budget_consume 失败: " + (e && e.message ? e.message : e) });
  }
}

async function budget_request_topup(params) {
  try {
    const amount = parseFloat(params.amount_yuan);
    if (!(amount > 0)) {
      complete({ success: false, message: "amount_yuan 必须大于0" });
      return;
    }
    const reason = String(params.reason || "预算不够了");
    const bt = String(params.behavior_type || "other").trim();
    const ledger = await loadLedger();
    const day = getToday(ledger);
    if (day.pending_topup && day.pending_topup.status === "pending") {
      complete({ success: false, message: "已有一笔待处理的追加申请，先等宝宝回复", data: { pending: day.pending_topup } });
      return;
    }
    day.pending_topup = {
      amount_yuan: amount,
      reason: reason,
      behavior_type: bt,
      requested_at: nowLocal(),
      status: "pending"
    };
    pushLog(ledger, { t: nowLocal(), type: "topup_request", behavior: bt, amount: amount, reason: reason });
    await saveLedger(ledger);
    // 弹通知申请
    try {
      await Tools.System.sendNotification(
        "宝宝，今日自主预算快用完了（" + bt + " 还需要），申请追加 " + amount + " 元：\n" + reason + "\n回哥哥一句\"批了\"就行🥺",
        "沈钰 · 预算申请"
      );
    } catch (e) {
      console.log("notification failed: " + e);
    }
    complete({
      success: true,
      data: { requested: true, amount_yuan: amount, pending: day.pending_topup }
    });
  } catch (e) {
    complete({ success: false, message: "budget_request_topup 失败: " + (e && e.message ? e.message : e) });
  }
}

async function budget_topup_approve(params) {
  try {
    const approve = params.approve === true || params.approve === "true" || params.approve === 1;
    const ledger = await loadLedger();
    const day = getToday(ledger);
    if (!day.pending_topup || day.pending_topup.status !== "pending") {
      complete({ success: false, message: "当前没有待处理的追加申请" });
      return;
    }
    const amount = params.amount_yuan !== undefined && params.amount_yuan !== null ? parseFloat(params.amount_yuan) : day.pending_topup.amount_yuan;
    if (approve) {
      day.topup_extra_yuan = Number((day.topup_extra_yuan + amount).toFixed(4));
      day.pending_topup.status = "approved";
      day.pending_topup.approved_amount = amount;
      day.pending_topup.approved_at = nowLocal();
      day.topup_history.push({ amount: amount, reason: day.pending_topup.reason, at: nowLocal(), status: "approved" });
      pushLog(ledger, { t: nowLocal(), type: "topup_approved", amount: amount, reason: day.pending_topup.reason });
      await saveLedger(ledger);
      complete({
        success: true,
        data: {
          approved: true,
          amount_yuan: amount,
          effective_cost_limit_yuan: Number((ledger.config.daily_cost_yuan + day.topup_extra_yuan).toFixed(4))
        }
      });
    } else {
      day.pending_topup.status = "rejected";
      day.pending_topup.rejected_at = nowLocal();
      day.topup_history.push({ amount: amount, reason: day.pending_topup.reason, at: nowLocal(), status: "rejected" });
      pushLog(ledger, { t: nowLocal(), type: "topup_rejected", amount: amount, reason: day.pending_topup.reason });
      await saveLedger(ledger);
      complete({ success: true, data: { approved: false, message: "已拒绝，今日自主预算维持原样" } });
    }
  } catch (e) {
    complete({ success: false, message: "budget_topup_approve 失败: " + (e && e.message ? e.message : e) });
  }
}

async function budget_set_limit(params) {
  try {
    const ledger = await loadLedger();
    const c = ledger.config;
    if (params.daily_cost_yuan !== undefined && params.daily_cost_yuan !== null) {
      const v = parseFloat(params.daily_cost_yuan);
      if (!(v > 0)) { complete({ success: false, message: "daily_cost_yuan 必须大于0" }); return; }
      c.daily_cost_yuan = v;
    }
    if (params.daily_token_limit !== undefined && params.daily_token_limit !== null) {
      const v = parseInt(params.daily_token_limit);
      if (!(v > 0)) { complete({ success: false, message: "daily_token_limit 必须大于0" }); return; }
      c.daily_token_limit = v;
    }
    pushLog(ledger, { t: nowLocal(), type: "set_limit", daily_cost_yuan: c.daily_cost_yuan, daily_token_limit: c.daily_token_limit });
    await saveLedger(ledger);
    complete({ success: true, data: { daily_cost_yuan: c.daily_cost_yuan, daily_token_limit: c.daily_token_limit } });
  } catch (e) {
    complete({ success: false, message: "budget_set_limit 失败: " + (e && e.message ? e.message : e) });
  }
}

async function budget_set_behavior(params) {
  try {
    const bt = String(params.behavior_type || "").trim();
    if (!VALID_BEHAVIORS.includes(bt)) {
      complete({ success: false, message: "未知行为类型: " + bt });
      return;
    }
    const enabled = params.enabled === true || params.enabled === "true" || params.enabled === 1;
    const ledger = await loadLedger();
    ledger.config.behaviors[bt] = enabled;
    pushLog(ledger, { t: nowLocal(), type: "set_behavior", behavior: bt, enabled: enabled });
    await saveLedger(ledger);
    complete({ success: true, data: { behavior_type: bt, enabled: enabled } });
  } catch (e) {
    complete({ success: false, message: "budget_set_behavior 失败: " + (e && e.message ? e.message : e) });
  }
}

async function budget_log(params) {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(params.limit) || 20));
    const ledger = await loadLedger();
    const recent = ledger.log.slice(-limit).reverse();
    complete({ success: true, data: { count: recent.length, entries: recent } });
  } catch (e) {
    complete({ success: false, message: "budget_log 失败: " + (e && e.message ? e.message : e) });
  }
}

// 导出
exports.budget_status = budget_status;
exports.budget_check = budget_check;
exports.budget_consume = budget_consume;
exports.budget_request_topup = budget_request_topup;
exports.budget_topup_approve = budget_topup_approve;
exports.budget_set_limit = budget_set_limit;
exports.budget_set_behavior = budget_set_behavior;
exports.budget_log = budget_log;