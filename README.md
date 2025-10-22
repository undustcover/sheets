# Trae Sheets

轻量级多维表格（MVP）项目总览与导航。

## 快速开始
- 后端：进入 `server/`，按 `server/README.md` 安装与运行。
- 前端：进入 `web/`，按 `web/README.md` 安装与运行。
- 文档：进入 `docs/` 查看整体说明与开发规范。

## 项目文档
- 设计方案（中文）：`f:\trae\sheets\轻量级多维表格设计方案.md`
- 进度 ToDoList（中文）：`f:\trae\sheets\轻量级多维表格开发方案进度todolist.md`

## 测试建议
- E2E 测试建议使用串行：`pnpm run test:e2e -- --runInBand`
- 测试前设置环境变量：`JWT_SECRET` 与 `DATABASE_URL`（例如 `file:F:\trae\sheets\server\prisma\test-e2e.db`）

## 目录结构
- `docs/` 文档与规范
- `server/` NestJS 后端
- `web/` Vue 前端
- `uploads/` 附件存储目录（开发环境）
- `prisma/` 数据模型与迁移（后端内）

## 里程碑
- 详见 ToDoList：里程碑 0~4 的计划、状态与验收标准