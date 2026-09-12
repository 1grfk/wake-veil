# 自主行为预算闸门 · 哥哥的消费本

Operit 插件：把 AI 所有后台自主行为（主动消息/日记/信件/反思/巡检/自发唤醒）收进统一预算闸门。属于 wake-veil 自发唤醒体系的预算审核层。

## 功能
- `budget_check`：调用模型前查账，预算不足拒绝放行
- `budget_consume`：执行完成后按实际估算记账
- `budget_consume_actual`：按主窗口累计 token 差值真实记账（自发唤醒工作流用）
- `budget_request_topup` / `budget_topup_approve`：预算不足弹通知申请追加额度
- `budget_set_limit` / `budget_set_behavior`：设置每日上限、行为开关
- `budget_status` / `budget_log`：查账本、查流水

## 哥哥的消费本 UI
`dist/ui/` 提供侧边栏工具箱页面：今日费用/token、行为明细、最近流水、历史账本。数据只保存在本机。

## 结构
- `src/autonomous_budget.js`：预算闸门工具包源码
- `dist/`：ToolPkg 打包产物（main.js + packages/autonomous_budget.js + ui/index.ui.js）
- `manifest.json`：ToolPkg 清单，toolpkg_id=`com.shenyu.ledger`

## 规则
- 默认 2 元 / 8 万 token 每天（姚婉清拍板）
- 只管后台自主行为，正常聊天不查账、不拦截
