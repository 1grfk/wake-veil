# CHANGELOG

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
