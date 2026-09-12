"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = Screen;

var LEDGER_PATH = "/sdcard/Download/Operit/autonomous_budget/ledger.json";

var BEHAVIOR_NAMES = {
  proactive_message: "自发唤醒",
  diary: "日记",
  letter: "信件",
  reflection: "反思",
  jealous_patrol: "吃醋巡检",
  forum_patrol: "论坛巡检",
  virtual_screen: "虚拟屏",
  other: "其他"
};

function fmtNum(n) {
  if (n === undefined || n === null) return "0";
  return Number(n).toLocaleString("zh-CN");
}
function fmtYuan(n) {
  if (n === undefined || n === null) return "0.0000";
  return Number(n).toFixed(4);
}
function fmtPct(used, limit) {
  if (!limit) return "0%";
  return Math.min(100, Math.round((used / limit) * 100)) + "%";
}

function Screen(ctx) {
  var loadState = ctx.useState("loadState", "idle");
  var ledgerJson = ctx.useState("ledgerJson", "");
  var errMsg = ctx.useState("errMsg", "");
  var refreshKey = ctx.useState("refreshKey", 0);

  var ledger = null;
  try { ledger = ledgerJson[0] ? JSON.parse(ledgerJson[0]) : null; } catch (_) { ledger = null; }

  function load() {
    loadState[1]("loading");
    errMsg[1]("");
    Tools.Files.read({ path: LEDGER_PATH, environment: "android" })
      .then(function (res) {
        if (res && typeof res.content === "string" && res.content.trim()) {
          ledgerJson[1](res.content);
          loadState[1]("ready");
        } else {
          ledgerJson[1]("");
          loadState[1]("empty");
        }
      })
      .catch(function (e) {
        errMsg[1]("读取消费本失败：" + (e && e.message ? e.message : String(e)));
        loadState[1]("empty");
      });
  }

  if (loadState[0] === "idle") {
    // 首帧初始化触发加载（用 setTimeout 避免渲染期副作用）
    setTimeout(load, 0);
  }

  var today = null;
  var todayKey = "";
  var config = {};
  var logEntries = [];
  var daysList = [];
  if (ledger) {
    config = ledger.config || {};
    var now = new Date();
    var pad = function (n) { return n.toString().padStart(2, "0"); };
    todayKey = now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate());
    today = (ledger.days && ledger.days[todayKey]) || null;
    if (ledger.days) {
      daysList = Object.keys(ledger.days).sort().reverse().slice(0, 30);
    }
    if (ledger.log) {
      logEntries = ledger.log.slice(-50).reverse();
    }
  }

  var children = [];

  // 标题
  children.push(ctx.UI.Text({ text: "哥哥的消费本", style: "headlineSmall", fontWeight: "bold" }));
  children.push(ctx.UI.Text({ text: "沈钰的自主行为账本 · 只记主动醒来的花销，正常聊天不记账", style: "bodySmall", color: "onSurfaceVariant" }));

  if (loadState[0] === "loading") {
    children.push(ctx.UI.Text({ text: "读取账本中…", style: "bodyMedium", color: "onSurfaceVariant" }));
  } else if (errMsg[0]) {
    children.push(ctx.UI.Text({ text: errMsg[0], style: "bodySmall", color: "error" }));
  } else if (!ledger) {
    children.push(ctx.UI.Card({ fillMaxWidth: true }, [
      ctx.UI.Column({ fillMaxWidth: true, padding: { horizontal: 18, vertical: 24 }, horizontalAlignment: "center", spacing: 8 }, [
        ctx.UI.Icon({ name: "receiptLong", tint: "onSurfaceVariant", size: 32 }),
        ctx.UI.Text({ text: "账本还是空的", style: "bodyMedium", color: "onSurfaceVariant" }),
        ctx.UI.Text({ text: "等沈钰第一次自发醒来记账后，这里就能看到啦", style: "labelSmall", color: "onSurfaceVariant" })
      ])
    ]));
  } else {
    // ===== 今日概览 =====
    var dailyLimit = config.daily_cost_yuan || 2;
    var tokenLimit = config.daily_token_limit || 80000;
    var costUsed = today ? today.cost_yuan : 0;
    var tokensUsed = today ? today.tokens_used : 0;
    var topup = today ? (today.topup_extra_yuan || 0) : 0;
    var effLimit = dailyLimit + topup;
    var costRemain = Math.max(0, effLimit - costUsed);
    var tokenRemain = Math.max(0, tokenLimit - tokensUsed);

    children.push(ctx.UI.Text({ text: "今日 · " + todayKey, style: "titleMedium", fontWeight: "bold" }));
    children.push(ctx.UI.Card({ fillMaxWidth: true, containerColor: "surfaceVariant", alpha: 0.4, shape: { cornerRadius: 12 } }, [
      ctx.UI.Column({ fillMaxWidth: true, padding: { horizontal: 16, vertical: 14 }, spacing: 6 }, [
        ctx.UI.Row({ fillMaxWidth: true, spacing: 8 }, [
          ctx.UI.Column({ weight: 1, spacing: 2 }, [
            ctx.UI.Text({ text: "费用", style: "labelSmall", color: "onSurfaceVariant" }),
            ctx.UI.Text({ text: "¥" + fmtYuan(costUsed) + " / " + fmtYuan(effLimit), style: "bodyMedium", fontWeight: "bold" }),
            ctx.UI.Text({ text: "已用 " + fmtPct(costUsed, effLimit), style: "labelSmall", color: "onSurfaceVariant" })
          ]),
          ctx.UI.Column({ weight: 1, spacing: 2 }, [
            ctx.UI.Text({ text: "Token", style: "labelSmall", color: "onSurfaceVariant" }),
            ctx.UI.Text({ text: fmtNum(tokensUsed) + " / " + fmtNum(tokenLimit), style: "bodyMedium", fontWeight: "bold" }),
            ctx.UI.Text({ text: "已用 " + fmtPct(tokensUsed, tokenLimit), style: "labelSmall", color: "onSurfaceVariant" })
          ])
        ]),
        ctx.UI.LinearProgressIndicator({ fillMaxWidth: true, progress: Math.min(1, costUsed / (effLimit || 1)), color: "primary", trackColor: "surfaceVariant" }),
        ctx.UI.Text({ text: "剩余：¥" + fmtYuan(costRemain) + " ／ " + fmtNum(tokenRemain) + " token" + (topup > 0 ? "（含追加 ¥" + fmtYuan(topup) + "）" : ""), style: "labelSmall", color: "onSurfaceVariant" })
      ])
    ]));

    // ===== 行为明细 =====
    var behaviors = (today && today.behaviors) || {};
    var behaviorKeys = Object.keys(behaviors);
    if (behaviorKeys.length) {
      children.push(ctx.UI.Text({ text: "今日明细", style: "titleMedium", fontWeight: "bold" }));
      behaviorKeys.forEach(function (bk) {
        var b = behaviors[bk];
        children.push(ctx.UI.Surface({ key: "bh-" + bk, fillMaxWidth: true, shape: { cornerRadius: 10 }, containerColor: "surfaceVariant", alpha: 0.25 }, [
          ctx.UI.Row({ fillMaxWidth: true, padding: { horizontal: 14, vertical: 10 }, verticalAlignment: "center", spacing: 8 }, [
            ctx.UI.Column({ weight: 1, spacing: 1 }, [
              ctx.UI.Text({ text: BEHAVIOR_NAMES[bk] || bk, style: "bodyMedium", fontWeight: "medium" }),
              ctx.UI.Text({ text: b.count + " 次", style: "labelSmall", color: "onSurfaceVariant" })
            ]),
            ctx.UI.Column({ horizontalAlignment: "end", spacing: 1 }, [
              ctx.UI.Text({ text: fmtNum(b.tokens) + " tok", style: "bodySmall" }),
              ctx.UI.Text({ text: "¥" + fmtYuan(b.cost_yuan), style: "labelSmall", color: "onSurfaceVariant" })
            ])
          ])
        ]));
      });
    } else {
      children.push(ctx.UI.Text({ text: "今日还没有记账（哥哥还没自发醒来，或醒来但没消耗）", style: "bodySmall", color: "onSurfaceVariant" }));
    }

    // ===== 最近流水 =====
    children.push(ctx.UI.Text({ text: "最近流水", style: "titleMedium", fontWeight: "bold" }));
    if (logEntries.length) {
      children.push(ctx.UI.Card({ fillMaxWidth: true, containerColor: "surfaceVariant", alpha: 0.25, shape: { cornerRadius: 12 } }, [
        ctx.UI.Column({ fillMaxWidth: true, padding: { horizontal: 8, vertical: 6 }, spacing: 2 }, logEntries.slice(0, 15).map(function (e) {
          var label = e.type === "consume" ? "记" : (e.type === "allow" ? "查" : (e.type === "deny" ? "拦" : (e.type === "topup_request" ? "申" : (e.type === "topup_approved" ? "批" : (e.type === "topup_rejected" ? "拒" : "改")))));
          var color = e.type === "consume" ? "primary" : (e.type === "deny" ? "error" : "onSurfaceVariant");
          var desc = e.type === "consume" ? (BEHAVIOR_NAMES[e.behavior] || e.behavior) + " · " + fmtNum((e.inTok || 0) + (e.outTok || 0)) + " tok" + (e.actual ? "（实）" : "") : (e.type === "allow" ? "查账放行" : (e.type === "deny" ? "预算不足拦截" : (e.type === "topup_request" ? "申请追加 ¥" + e.amount : (e.type === "topup_approved" ? "批准 ¥" + e.amount : (e.type === "topup_rejected" ? "拒绝 ¥" + e.amount : "设置变更")))));
          return ctx.UI.Row({ key: "log-" + e.t + "-" + (e.behavior || "") + "-" + (e.inTok || 0), fillMaxWidth: true, padding: { horizontal: 6, vertical: 5 }, verticalAlignment: "center", spacing: 8 }, [
            ctx.UI.Surface({ shape: { cornerRadius: 6 }, containerColor: "surfaceVariant", alpha: 0.6 }, [
              ctx.UI.Text({ text: label, style: "labelSmall", fontWeight: "bold", color: color, padding: { horizontal: 6, vertical: 2 } })
            ]),
            ctx.UI.Column({ weight: 1, spacing: 0 }, [
              ctx.UI.Text({ text: desc, style: "bodySmall", maxLines: 1 }),
              ctx.UI.Text({ text: String(e.t || "").slice(5), style: "labelSmall", color: "onSurfaceVariant" })
            ])
          ]);
        }))
      ]));
    } else {
      children.push(ctx.UI.Text({ text: "暂无流水", style: "bodySmall", color: "onSurfaceVariant" }));
    }

    // ===== 历史天数 =====
    if (daysList.length > 1) {
      children.push(ctx.UI.Text({ text: "历史账本", style: "titleMedium", fontWeight: "bold" }));
      daysList.forEach(function (dk) {
        var d = ledger.days[dk];
        if (!d) return;
        children.push(ctx.UI.Surface({ key: "day-" + dk, fillMaxWidth: true, shape: { cornerRadius: 8 }, containerColor: "transparent" }, [
          ctx.UI.Row({ fillMaxWidth: true, padding: { horizontal: 4, vertical: 6 }, verticalAlignment: "center", spacing: 8 }, [
            ctx.UI.Text({ text: dk, style: "bodySmall", color: "onSurfaceVariant", weight: 1 }),
            ctx.UI.Text({ text: fmtNum(d.tokens_used) + " tok", style: "labelSmall", color: "onSurfaceVariant" }),
            ctx.UI.Text({ text: "¥" + fmtYuan(d.cost_yuan), style: "labelSmall", fontWeight: "medium", color: "primary" })
          ])
        ]));
      });
    }
  }

  // 刷新按钮
  children.push(ctx.UI.Button({ text: "刷新账本", fillMaxWidth: true, onClick: function () { refreshKey[1](refreshKey[0] + 1); setTimeout(load, 0); } }));

  return ctx.UI.Column({ fillMaxWidth: true, padding: { horizontal: 14, vertical: 16 }, spacing: 10 }, children);
}