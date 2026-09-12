# CHANGELOG
## 2026-09-12 — UI冷却分钟不生效修复（同根因·宿主桥第二处）

### 问题
UI 调 cooldownMinutes=10 不生效，内核仍按硬编码默认 15 分钟冷却。

### 根因
第一轮只修了 entropy.js / engine.js 模块内的阈值系数数据流，但 dist 宿主桥段（wake_tick 内冷却门控 WV_CFG、TH_MULT、wake_set_config）仍走 globalThis.__wvCfg() 跨调用注入——Operit 每次工具调用独立 JS 运行时，globalThis 不保留，WV_CFG 恒为 {}，COOLDOWN_MS 静默回退到默认 15 分钟。冷却分钟从未生效。

### 修复
dist 中 3 处 `globalThis.__wvCfg()` 包装全部替换为 `readWvConfig() || {}`（readWvConfig 直读同一 SharedPreferences 并 JSON.parse，失败回退 {}）。
- wake_tick 冷却门控 COOLDOWN_MS：现在 = UI 值 10×60×1000
- TH_MULT / 3 小时封顶段：现在 = UI 值 4.5
- wake_set_config 读当前配置：现在读到真实 UI 配置

### 验证
- readWvConfig() || {} 出现 3 处、globalThis.__wvCfg() 读取残留 0 处
- 打包 fixed2（75014 字节）烧录安装 success:true
- 修复后：cooldownMinutes（UI 10 分钟）真实生效，不足 10 分钟返 contact_cooldown

### 教训
'只改 src 再打包'会漏掉打包时注入的宿主桥段（冷却门控不在 src/engine.js 里）。排查必须直接在 dist 层面对照检查，同一根因（globalThis 跨调用丢失）要全量扫 dist 里所有 __wvCfg / __wv 消费点。


## 2026-09-12 — UI阈值不生效根因修复（机制性）

### 问题
UI 调 thresholdMultiplier=4.5 不生效，内核仍按硬编码 1.4 抽样。

### 根因
宿主桥通过 globalThis.__wvEffectiveThreshold 注入有效阈值，但 Operit 每次工具调用是独立 JS 运行时，globalThis 跨调用不保留，后续 wake_tick 时包装为 undefined，三处比较全部静默回退到 entropy.js 硬编码 ×1.4。

### 修复
- entropy.js：createEntropyRecord 新增 thMult 读取（options.thresholdMultiplier，默认 1.4），thresholdSample = -log(uniform) × thMult
- engine.js：新增自包含 wvThMult() 直读 SharedPreferences（toolpkg_shenyu_wake_veil / wake_veil_config），失败回退 1.4；调用处传入 thresholdMultiplier: wvThMult()
- dist：移除三处 globalThis.__wvEffectiveThreshold 包装，直接使用已乘好的阈值

### 验证
- wvThMult 定义 1 处、engine 调用 1 处、globalThis 包装残留 0 处（仅剩 1 处死代码挂载，只写不读）
- 正式包 md5 与修复版一致，已烧录安装
- 修复后：thresholdSample = -log(uniform) × 4.5（UI 值），H(t) 需累计约 4.5 倍基线才 fire，3 小时封顶兜底

### 教训
globalThis 跨调用注入不可靠，数据流必须自包含（同一次调用内传参或直接读 SharedPreferences）。
