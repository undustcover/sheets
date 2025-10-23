# <节点ID> <节点名称> · 节点进度记录

> 按节点跟踪的标准模板。创建节点时先填写“计划”，开发中维护“实际进度”，完成当天填写“完成总结与计划调整”。

## 一、计划（创建节点时填写）
- 目标（Objective）：
- 任务清单（Tasks）：
  - [ ] 子任务1
  - [ ] 子任务2
- 依赖（Dependencies）：
- 验收标准（Acceptance）：
- 计划起止（Plan Range）：YYYY-MM-DD ~ YYYY-MM-DD
- 责任/审核（Owner/Reviewer）：

## 二、实际进度（开发中持续更新）
- 状态（Status）：Green | Yellow | Red
- 完成度（Progress）：0%
- 实际起止（Actual Range）：YYYY-MM-DD ~ YYYY-MM-DD
- PR/提交（PRs）：[ ]
- 预览链接（Preview）：
- 用时（Hours）：0
- 风险与阻塞（Risks）：
- 纠偏动作（Actions）：

## 三、完成总结与计划调整（节点完成当天必须填写）
- 验收结果：
- 与原计划差异：
- 对后续排期的影响与调整（必须）：
- 经验复盘（Retrospective）：

---

## 元数据（YAML，便于自动采集）
```yaml
id: <M2.x>
name: <节点名称>
version: v0.0.4
plan_range: YYYY-MM-DD ~ YYYY-MM-DD
actual_range: 
status: Green
progress: 0%
owner: 
reviewer: 
prs: []
preview: "http://localhost:5173/"
hours: 0
risks: []
actions: []
acceptance:
  - 
dependencies:
  - 
post_completion:
  plan_adjustments: "（完成后必填）"
  retrospective: ""
```