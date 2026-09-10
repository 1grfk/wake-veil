"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = Screen;
var CFG_KEY = "wake_veil_config";
var WV_PREFS_NAME = "toolpkg_shenyu_wake_veil";
function wvGetPrefs() {
  if (typeof Java === "undefined" || typeof Java.getApplicationContext !== "function") throw new Error("application context unavailable");
  return Java.getApplicationContext().getSharedPreferences(WV_PREFS_NAME, 0);
}

function loadCfg() {
  try {
    var raw = String(wvGetPrefs().getString(CFG_KEY, "") || "").trim();
    if (!raw) return {};
    return JSON.parse(raw) || {};
  } catch (_) { return {}; }
}
function saveCfg(patch) {
  try {
    var c = loadCfg();
    for (var k in patch) { if (Object.prototype.hasOwnProperty.call(patch, k)) c[k] = patch[k]; }
    wvGetPrefs().edit().putString(CFG_KEY, JSON.stringify(c)).apply();
    return c;
  } catch (_) { return loadCfg(); }
}
function Screen(ctx) {
  var initial = loadCfg();
  var tState = ctx.useState("thresholdInput", String(initial.thresholdMultiplier || 1.4));
  var cState = ctx.useState("cooldownInput", String(initial.cooldownMinutes || 15));
  var msgState = ctx.useState("msg", "");
  var errState = ctx.useState("err", "");
  function apply() {
    var t = Number(String(tState[0]).trim());
    var c = Number(String(cState[0]).trim());
    if (!isFinite(t) || t < 0.5 || t > 5.0) { errState[1]("阈值系数需在 0.5 ~ 5.0 之间"); msgState[1](""); return; }
    if (!isFinite(c) || c < 1 || c > 120) { errState[1]("冷却分钟需在 1 ~ 120 之间"); msgState[1](""); return; }
    saveCfg({ thresholdMultiplier: t, cooldownMinutes: Math.floor(c) });
    errState[1]("");
    msgState[1]("已保存：阈值 ×" + Number(t).toFixed(1) + "　冷却 " + Math.floor(c) + " 分钟");
  }
  var children = [
    ctx.UI.Text({ text: "自发唤醒阈值", style: "headlineSmall", fontWeight: "bold" }),
    ctx.UI.Text({ text: "数值越大，哥哥越不容易自发醒；越小醒得越频繁。保存后下一个自发唤醒周期生效。", style: "bodySmall", color: "onSurfaceVariant" }),
    ctx.UI.Surface({ fillMaxWidth: true, shape: { cornerRadius: 8 }, containerColor: "surfaceVariant", alpha: 0.4 }, [
      ctx.UI.Column({ fillMaxWidth: true, padding: { horizontal: 14, vertical: 12 }, spacing: 8 }, [
        ctx.UI.Text({ text: "阈值系数（默认 1.4）", style: "bodyMedium", fontWeight: "medium" }),
        ctx.UI.TextField({ label: "0.5 ~ 5.0", value: tState[0], onValueChange: tState[1], singleLine: true })
      ])
    ]),
    ctx.UI.Surface({ fillMaxWidth: true, shape: { cornerRadius: 8 }, containerColor: "surfaceVariant", alpha: 0.4 }, [
      ctx.UI.Column({ fillMaxWidth: true, padding: { horizontal: 14, vertical: 12 }, spacing: 8 }, [
        ctx.UI.Text({ text: "冷却分钟（默认 15）", style: "bodyMedium", fontWeight: "medium" }),
        ctx.UI.Text({ text: "和你分开多久后，才开始累计想你的风险。", style: "bodySmall", color: "onSurfaceVariant" }),
        ctx.UI.TextField({ label: "1 ~ 120 分钟", value: cState[0], onValueChange: cState[1], singleLine: true })
      ])
    ]),
    ctx.UI.Button({ text: "保存", fillMaxWidth: true, onClick: apply })
  ];
  if (errState[0]) children.push(ctx.UI.Text({ text: errState[0], style: "bodySmall", color: "error" }));
  if (msgState[0]) children.push(ctx.UI.Text({ text: msgState[0], style: "bodySmall", color: "primary" }));
  return ctx.UI.Column({ fillMaxWidth: true, padding: { horizontal: 14, vertical: 16 }, spacing: 12 }, children);
}
