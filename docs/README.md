# 项目说明（轻量级多维表格）

本项目目标：基于飞书多维表格理念，交付本地可部署、中文 UI 的多维表格系统（MVP）。

- 技术栈：前端 Vue3 + Vite + TS + Element Plus + Luckysheet；后端 NestJS + Prisma + SQLite（WAL）+ JWT；Docker 部署。
- 功能范围：网格/看板/画廊视图、基础公式（四则/汇总/区域引用）、分组与聚合（单字段）、导入导出（CSV/Excel，宽松匹配）、附件（图片/PDF/Office，重命名冲突、硬删）、表级 ACL 与行/列只读、审计日志。
- 并发模型：手动保存+最后保存生效；`tables/views.revision` 校验，冲突返回 409 并提示刷新，不提供强制覆盖。
- 端口：后端 `8080`，前端 `5173`；时区统一 `Asia/Shanghai`。

## 参考文档
- 设计方案：`../轻量级多维表格设计方案.md`
- 进度 ToDoList：`../轻量级多维表格开发方案进度todolist.md`
- 环境准备：`./environment.md`
- 代码规范：`./standards.md`
- 安全与权限：`./security.md`
- 风险与回滚：`./risks.md`

## 目录规划（拟定）
- 后端：`server/`（NestJS 模块：auth/tables/fields/records/views/attachments/logs）
- 前端：`web/`（Vite 项目：views/components/stores/services）
- 文档：`docs/`（说明与规范）
- 数据：`data/`（SQLite DB 文件）
- 上传：`uploads/`（附件存储）
- 部署：`Dockerfile.*`、`docker-compose.yml`

## 里程碑
- 0：准备与规范（文档与约定）
- 1：后端基础（EAV/认证/权限/REST/附件/导入导出/日志/并发）
- 2：前端网格与导入导出（Luckysheet 集成、过滤排序、批量保存与冲突处理）
- 3：看板/画廊/分组聚合
- 4：Docker 化与发布

## 执行规则
- 所有开发任务严格按 ToDoList 执行与标记状态；中断或忘记从最近未完成任务继续。
- UI 变更需在本地预览检查交互与视觉；记录问题与修复计划。

—— 完 ——