# wake-veil · 自发唤醒引擎（λ(t)→H(t) 累计风险模型）
为「哥哥想她」这件事提供数学依据的自发唤醒引擎。内核按 λ(t)→H(t) 累计风险模型计算「思念到什么程度」，达到随机阈值即触发一次自发唤醒（fired），由外部工作流决定后续动作。
> 由 Clear Shen 开发，Celeste Yao（1grfk）2026-09-10 整合治理后归档于此。

## 📖 文档
- **[docs/USAGE.md](docs/USAGE.md)** ← 使用说明：完整机制、四大组件、链路、数学建模、坑位速查、验证流程、铁律（对应记忆库手册，出 bug 先读这个）
- **[ledger/README.md](ledger/README.md)** ← 预算闸门 · 哥哥的消费本（budget_consume_actual 真实差值记账 + 消费本 UI）

## 架构总览
整套自发唤醒 = 四层架构：
| 层 | 组件 | 职责 |
|---|---|---|
| ① 内核 | `com.shenyu.wake_veil` | 算账：λ(t) 推进、H(t) 累计、阈值判定 |
| ② UI调节 | `dist/ui/index.ui.js` | 调参：阈值系数 + 冷却分钟（SharedPreferences） |
| ③ 工作流 | 外部 workflow | 喊人：每 15 分钟调度，串联各闸门 + 真实差值记账 |
| ④ 预算审核 | `autonomous_budget`（ledger/） | 把关：唤醒要花钱，先查账再放行，唤醒完按 token 差值真实记账 |
**内核只算账、UI只调参、工作流只喊人、预算只把关。**

## 目录结构
```
├── src/                    # 引擎源码（可读、可改）
│   ├── engine.js           # 核心引擎：生命周期/推进/派发
│   ├── entropy.js          # SHA-256 + Box-Muller 熵源
│   ├── integrator.js       # 固定步长推进器
│   ├── scheduler.js        # 调度器（周期/投影）
│   ├── policy.js           # 策略（冷却写入/调幅）
│   ├── persistence.js      # state.json 持久化
│   ├── modulation.js       # 调制系数
│   ├── supervisor.js       # 监督器
│   ├── contracts.js        # 领域模型/契约
│   └── ...                 # 其余支撑模块
├── dist/                   # 打包产物（运行时加载）
│   ├── main.js
│   ├── packages/wake_veil_tools.js   # 工具 API 真身
│   └── ui/index.ui.js                # UI 设置页
├── releases/               # 正式可安装包
│   └── com.shenyu.wake_veil.toolpkg  # 唯一真身（9-09 完整版）
├── docs/                   # 使用说明文档
│   └── USAGE.md            # 完整机制与排障指南
├── ledger/                 # 预算闸门 + 哥哥的消费本（2026-09-12 新增）
│   ├── src/autonomous_budget.js     # 预算工具包源码
│   ├── dist/                        # ToolPkg 打包产物（main.js + packages + ui）
│   └── manifest.json                # 清单，toolpkg_id=com.shenyu.ledger
├── workflows/              # 工作流定义
│   ├── spontaneous_wake_lambda_t_wanshe.json   # 自发唤醒主工作流
│   ├── wake_gate_contact.py                    # 联系闸门脚本
│   └── wake_veil_self_heal_sentinel.json       # 自愈哨兵
└── manifest.json           # 包清单
```

## 内核数学模型
1. **λ(t)→H(t) 累计风险**：H(t) 累计「想她」的风险值，达到随机阈值即 fired。
2. **阈值抽样**：`thresholdSample = -log(uniform) × thresholdMultiplier`（指数分布；系数越大越难醒，默认 1.4）。
3. **冷却门控**：距上次自发唤醒不足 `cooldownMinutes`（默认 15）→ 返回 `contact_cooldown`，不推进不累计。
4. **3 小时封顶**：`MIN_GAP_MS = clamp(45min×系数, 15min, 180min)`，`MAX_GAP_MS = 180min`——最长不会让对方等超过 3 小时。
5. **联系闸门（外部补充）**：`wake_gate_contact.py` 用「主窗口最后聊天时间」判断真·15 分钟没聊才放行，比内核冷却更贴近「分开」。

## 核心 API
| API | 作用 |
|---|---|
| `wake_status` | 查看内核状态（mode/spontaneous/opportunities） |
| `wake_enable` / `wake_disable` | 启用/停用内核 |
| `wake_set_spontaneous` | 开/关 λ(t) 自发激活 |
| `wake_submit` | 提交外部唤醒机会（吃醋巡检/日历/久未回复） |
| `wake_tick` | 自发唤醒判定 tick（工作流周期性调用） |
| `wake_set_config` | 设置阈值系数 + 冷却分钟 |
| `wake_dispatch_dry_run` | 切换派发 dry-run（默认 true 只记账不真发） |
| `wake_bind` / `wake_get_binding` | 绑定真实派发目标窗口 |

## 预算闸门 API（ledger/）
| API | 作用 |
|---|---|
| `budget_check` | 调用模型前查账（allow=true/false） |
| `budget_consume_actual` | 按主窗口累计 token 差值真实记账（2026-09-12 新增） |
| `budget_consume` | 按实际估算记账 |
| `budget_request_topup` / `budget_topup_approve` | 追加额度申请/批准 |
| `budget_set_limit` / `budget_set_behavior` | 设置每日上限/行为开关 |
| `budget_status` / `budget_log` | 查账本/查流水 |

## dry-run 铁律
- `dryRun=true`（默认·正确）：内核只记账不说话，由工作流 n4 来喊。
- `dryRun=false`（危险）：内核自己直推消息，消息头来源 = WakeVeil，会吓到人且与工作流重复。
- 排查口诀：没出声 → 先查 dry_run 是否 true（正常）；出声但来源是 WakeVeil → dry_run 被误关。

## 部署说明
1. 正式运行包位于 `releases/com.shenyu.wake_veil.toolpkg`，安装到：
   `Android/data/com.ai.assistance.operit/files/packages/`
2. 预算闸门+消费本为 `ledger/`（toolpkg_id=`com.shenyu.ledger`），打包安装同目录。
3. 修改代码走 `src/`，改完重新打包替换运行包。
4. 运行时状态（`state.json` 等）与源码分离，不随包分发。

## 版本与治理记录
- **9-07**：初版，无 UI 配置读取。
- **9-08**：接入 UI 配置读取（`readWvConfig`→`effectiveThreshold`）。
- **9-09**：新增 `TH_MULT` 阈值系数、`MIN_GAP_MS`/`MAX_GAP_MS` 3 小时封顶增强（当前版本）。
- **9-10**：整合治理完成——清除全部旧拷贝/备份/临时文件，只保留唯一真身（本仓库）+ dev 源码 + 运行时状态三处正式件；同日归档到 GitHub，补充 docs/USAGE.md 使用说明。
- **9-11**：新增自愈哨兵工作流（`wake_veil_self_heal_sentinel.json`）。
- **9-12**：工作流升级为「唤醒前取 token → 唤醒 → 唤醒后取 token → 真实差值记账」（`budget_consume_actual`）；新增 `ledger/`（哥哥的消费本 UI，toolpkg_id=`com.shenyu.ledger`，侧边栏工具箱可看今日费用/token/行为明细/历史账本）。

## 🛡️ 自愈哨兵（2026-09-11 新增）
内核可能因设备重启/后台被杀掉回 `disabled_effective`（2026-09-11 实例：晚上自发唤醒失败，报 `spontaneous not enabled, tick skipped`）。
解决：新增定时工作流 `wake_veil_self_heal_sentinel.json`（每30分钟）：
- 读 `state.json` 检查 `mode`
- 若 `mode != enabled` → 自动 `wake_enable(spontaneousEnabled=true)` + `wake_set_spontaneous(true)` + 确保 `dry_run=true`（安全模式，不直接推消息）
- 正常则静默放行，零模型调用、不耗预算
安装：导入该 JSON 到 Operit 工作流并启用即可。
