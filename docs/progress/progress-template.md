# 进度记录模板（复制本文件创建当日记录）

> 对应《todolist-v2》第18节模板，分 Markdown 表格与 YAML 两种格式，请两者都填写并保留。

## Markdown 表格模板

| 日期 | 版本/里程碑 | 节点 ID/名称 | 计划起止 | 实际起止 | 完成度 | 状态 | PR/提交 | 预览链接 | 用时(h) | 风险/阻塞 | 调整动作 | 下个计划 | 责任人 | 审核人 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| YYYY-MM-DD | v0.0.4 / M2.x | <节点名称> | MM-DD~MM-DD | MM-DD~MM-DD | 0% | Green | <#PR> | http://localhost:5173/ | 0 | <风险> | <动作> | <下一步> | <FE/BE/OPS> | <Reviewer> |

## YAML 模板

```yaml
date: YYYY-MM-DD
version: v0.0.4
milestone: M2.x
node: <节点名称>
plan_range: YYYY-MM-DD ~ YYYY-MM-DD
actual_range: YYYY-MM-DD ~ YYYY-MM-DD
progress: 0%
status: Green
prs: ["<https://repo/pr/xxxx>"]
preview: "http://localhost:5173/"
hours: 0
risks: ["<风险或空数组>"]
actions: ["<纠偏动作或空数组>"]
next: "<下一步>"
owner: <FE/BE/OPS>
reviewer: <Reviewer>
```