# 后端项目结构与模块划分（NestJS + Prisma + SQLite）

## 目标
- 明确后端模块结构、横切关注点与环境变量设计，便于后续直接按此骨架实现。

## 模块划分
- `auth`：认证、JWT 策略、登录限流
- `users`：用户管理（管理员权限）
- `tables`：表的 CRUD、ACL 配置、导出权限配置
- `fields`：字段 CRUD、只读配置（字段级）
- `records`：记录 CRUD、只读配置（记录级）
- `cells`：单元格批量写入、公式校验、并发版本校验
- `views`：视图 CRUD、配置（过滤/排序/分组/聚合/匿名开关）与数据读取
- `attachments`：上传下载、大小/MIME 校验、重命名策略、硬删
- `importExport`：CSV/Excel 导入（宽松匹配/本地化解析/新字段创建）与导出（当前视图）
- `logs`：审计日志记录与分页查询

## 横切关注点
- 守卫与拦截器：
  - `JwtAuthGuard`：认证校验
  - `RolesGuard`：角色与表级 ACL 校验
  - `ReadonlyGuard`：行/列只读校验（在写入路径拦截）
  - `RateLimit`：登录与导入接口限流
- 过滤器（异常）：统一错误结构 `{ code, message, details? }`
- CORS：仅允许前端来源；限制方法与头部
- 输入校验：DTO + class-validator；参数类型与范围校验

## 环境变量
- `JWT_SECRET`：JWT 秘钥（必须）
- `JWT_EXPIRES_IN=2h`：访问令牌有效期
- `DATABASE_URL=file:./data/app.db`：SQLite 文件位置
- `UPLOAD_DIR=./uploads`：附件目录
- `TZ=Asia/Shanghai`：时区
- `RATE_LIMIT_WINDOW_SEC=60`：登录接口限流窗口秒数（默认 60）
- `RATE_LIMIT_MAX=5`：登录接口窗口内允许的最大请求数（默认 5）

## 路由前缀与版本
- REST 前缀：`/api`
- 版本策略：MVP 不做多版本；变更通过文档与前端兼容处理

## 伪代码骨架（示例）
```ts
@Module({ imports: [PrismaModule, AuthModule, UsersModule, TablesModule, FieldsModule, RecordsModule, CellsModule, ViewsModule, AttachmentsModule, ImportExportModule, LogsModule] })
export class AppModule {}

@Controller('tables/:id/cells')
export class CellsController {
  @Post('batch')
  @UseGuards(JwtAuthGuard, RolesGuard, ReadonlyGuard)
  async batchWrite(@Param('id') tableId: number, @Body() dto: BatchWriteDto, @Req() req) {
    // 1) ACL 校验（editor/exporter/admin）
    // 2) 版本校验（tables.revision/views.revision）
    // 3) 只读校验（记录/字段）
    // 4) 公式基本合法性校验（可选）
    // 5) 事务写入 cell_values（value_json / formula_expr / computed_at / is_dirty）
    // 6) revision++ 并返回最新版本
  }
}
```

—— 完 ——

## 认证账号初始化（开发环境）
- 在 `server/.env` 设置：
  - `ADMIN_USERNAME=admin`
  - `ADMIN_PASSWORD=admin123`
  - `ADMIN_ROLE=admin`
- 应用启动时将自动种子一个管理员用户（若不存在），密码以 Argon2 存储。
- 登录接口：`POST /api/auth/login`，成功后返回 JWT；`GET /api/auth/me` 校验令牌并返回当前用户。