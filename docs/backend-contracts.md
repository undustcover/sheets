# 后端接口契约（MVP）

说明：`/api` 为统一前缀；所有响应采用统一错误结构 `{ code, message, details? }`；分页统一 `{ page, size }`；过滤 DSL `{ fieldId, op, value }`；排序 `{ fieldId, direction }`。

## Auth
- POST `/api/auth/login`
  - body: `{ username, password }`
  - 200: `{ token, user: { id, username, role } }`
  - 429/401/400
- POST `/api/auth/logout`
  - 200: `{ success: true }`
- GET `/api/auth/me`
  - header: `Authorization: Bearer <token>`
  - 200: `{ user: { id, username, role } }`

## Users（管理员）
- GET `/api/users` 需要 `admin`
- POST `/api/users` 需要 `admin`
- PUT `/api/users/:id` 需要 `admin`
- DELETE `/api/users/:id` 需要 `admin`

## Tables
- GET `/api/tables` 列表（分页）
- POST `/api/tables` 创建（需要 `admin` 或有相应权限）
- GET `/api/tables/:id` 详情
- PUT `/api/tables/:id` 更新（包含导出权限 `exportAllowedRoles`）
- DELETE `/api/tables/:id`

## Fields
- GET `/api/tables/:id/fields`
- POST `/api/tables/:id/fields`
- PUT `/api/fields/:id`
- DELETE `/api/fields/:id`

字段类型枚举：`text` | `number` | `date` | `boolean` | `select` | `multi_select` | `attachment` | `formula`

## Records（分页/过滤/排序）
- GET `/api/tables/:id/records?page&size&filters&sort`
  - `filters`: `[{ fieldId, op, value }]`；`op`: `eq|ne|lt|lte|gt|gte|contains|in|between|is_null|is_not_null`
  - `sort`: `{ fieldId, direction: 'asc'|'desc' }`
  - 200: `{ data: RecordDto[], page, size, total }`
- POST `/api/tables/:id/records`
  - body: `{ values: { [fieldId]: value } }`
- PUT `/api/records/:id`
- DELETE `/api/records/:id`

## Cells 批量写入（并发 + 只读）
- POST `/api/tables/:id/cells/batch`
  - body:
    ```json
    {
      "revision": 12,
      "updates": [
        {"recordId": 101, "fieldId": 5, "value": 123.45},
        {"recordId": 102, "fieldId": 6, "formula": "SUM(A1:A10)"}
      ]
    }
    ```
  - 200: `{ revision: 13, changed: n }`
  - 409: `{ code: 'REVISION_CONFLICT', current: 13 }`
  - 403: `{ code: 'READONLY', details: { recordId, fieldId } }`

备注：公式字段与单元格级公式并存；当字段为 `formula` 时，值由系统计算，写入只允许公式表达式；普通字段允许写入 `value`。

## Views（匿名开关）
- GET `/api/tables/:id/views`
- POST `/api/tables/:id/views`（最多 3 个视图）
- GET `/api/views/:id`
- PUT `/api/views/:id`（含 `anonymousEnabled`、过滤/排序/分组/聚合配置）
- DELETE `/api/views/:id`

匿名读取：
- GET `/api/views/:id/data?page&size&filters&sort`
  - 若 `anonymousEnabled=true`，允许无需 JWT 访问；只读视图，不返回敏感字段

## Attachments（10GB 总配额 + MIME 白名单 + 单文件 50MB）
- POST `/api/tables/:id/attachments`
  - 413: 超过单文件大小；415: MIME 不在白名单
- GET `/api/attachments/:id`
- DELETE `/api/attachments/:id`（硬删）

## Import（CSV/Excel ≤10MB）
- POST `/api/tables/:id/import`
  - 行为：
    - 宽松列头匹配；无法识别列自动新建字段，默认类型 `text`
    - 数值/日期本地化解析
  - 返回：`{ createdFields: FieldDto[], createdRecords: number, warnings: string[] }`

## Export（视图级导出 + 审计仅计数）
- POST `/api/views/:id/export`
  - body: `{ format: 'csv'|'xlsx' }`
  - 审计：仅记录导出记录数与字段数，不存储文件内容

## Logs（审计）
- GET `/api/logs?page&size&action&userId&tableId`

## 错误码
- `AUTH_FAILED` `FORBIDDEN` `NOT_FOUND` `VALIDATION_FAILED` `READONLY` `REVISION_CONFLICT` `RATE_LIMITED` `ATTACHMENT_MIME_INVALID` `ATTACHMENT_SIZE_EXCEEDED` `IMPORT_TOO_LARGE`

—— 完 ——