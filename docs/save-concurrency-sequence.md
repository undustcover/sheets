# 保存并发与版本校验时序（/tables/:id/cells/batch）

## 场景
- 前端带上当前 `revision`（表或视图，按实现选择表级为主）。
- 批量写入单元格（值或公式）。

## 时序步骤
1. 认证与 ACL 校验（`editor|exporter|admin`）
2. 读取当前 `table.revision`（或 `view.revision`）并与请求体 `revision` 比较
   - 不相等：返回 `409 REVISION_CONFLICT { current }`
3. 只读校验
   - 记录级只读：拒绝对应 `recordId`
   - 字段级只读：拒绝对应 `fieldId`
   - 返回 `403 READONLY { recordId, fieldId }`
4. 公式基本合法性校验（可选）
   - 语法、循环依赖的快速检测（完整计算在后台）
5. 事务写入
   - 对每个更新：
     - 若包含 `value`，写入 `CellValue.valueJson`
     - 若包含 `formula`，写入 `CellValue.formulaExpr` 并标记 `isDirty=true`
   - 提交后 `table.revision = table.revision + 1`
6. 返回 `{ revision, changed }`
7. 后台任务触发公式计算（可同步/异步，MVP 可同步小规模计算）

## 冲突与恢复
- 冲突后前端拉取最新数据与 `revision`，重放未提交更新
- 若只读冲突，提示并移除对应更新项

## 备注
- 视图复用同一工作表数据；`revision` 默认用表级，视图级仅用于影响展示配置变更。
- 计算列（字段级公式）不接受值写入，仅接受公式表达式变更。

—— 完 ——