# 安全策略（MVP）

## 角色与权限
- 角色：`viewer`（只读）、`editor`（读写）、`exporter`（读写+导出）、`admin`（管理）。
- 表级 ACL：为每个用户在表维度分配角色；控制读/写/导出权限。
- 导出权限：默认 `exporter/admin/editor` 可导出，`viewer` 不可；创建者可配置。
- 匿名访问：由表创建者控制，默认不允许。

## 行/列只读限制
- 字段只读：`fields.readonly` 与 `fields.readonly_roles`（仅特定角色只读）。
- 记录只读：`records.readonly` 与 `records.readonly_roles`。
- 前端：禁用对应编辑控件并提示只读原因。
- 后端：写入请求校验只读限制，拒绝并返回 `403`。

## 认证与会话
- JWT（`HS256`，默认过期 7d）。
- 登录：用户名+密码（Argon2/BCrypt 哈希）；成功返回 JWT。
- 会话：JWT 承载用户与角色；服务端验证与过期时间控制。
- 登录失败与错误提示统一：`{ code, message, details? }`。
- 速率限制：生产环境登录超限返回 `403`，消息“1分钟内只能登录5次”；开发环境或 `RATE_LIMIT_DISABLED=1` 时禁用；可通过环境变量调整窗口与次数，用于防止暴力破解。

## 授权校验点
- 所有表格操作仅管理员可用（`Role.admin`）。
- `GET /tables/:id`：校验表读权限。
- `POST/PUT/DELETE /tables/:id/fields`：校验表写权限。
- `POST /tables/:id/cells/batch`：
  - 校验表写权限；
  - 校验行/列只读；
  - 校验 `tables/views.revision`。
- 视图数据读取：
  - 匿名读取：`GET /views/:id/data`：校验表读权限；过滤结果按照视图配置返回；是否允许取决于视图 `anonymousEnabled`。
  - 登录态读取（新增）：`GET /views/:id/data/authed`：需 JWT，不受匿名开关限制。
- `POST /tables/:id/import`：校验表写权限。
- `GET /tables/:id/export`：校验导出权限（由表配置决定）。
- `POST /attachments/upload`：校验表写与大小/类型；重命名策略。
- `GET /attachments/:id/download`：校验表读权限。

## 输入校验与安全
- 输入校验：参数与主体字段类型、必填、范围验证。
- CORS：允许前端域名；限制方法与头部。
- XSS/注入：前端/后端统一清洗与编码；使用 Prisma 防 SQL 注入。
- 敏感信息：配置管理 JWT 秘钥与数据库路径；避免日志泄露。

## 审计与日志
- 记录事件：`login/import/export/save` 到 `logs`；包含用户、表/视图、时间与元数据。
- 查询：管理员可分页查看；用于追踪问题与合规。

## 并发与版本控制
- `tables.revision` 与 `views.revision`：保存递增。
- 冲突：版本落后返回 `409 Conflict` 与最新版本；前端提示刷新数据；不提供强制覆盖。

—— 完 ——