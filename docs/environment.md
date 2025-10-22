# 环境准备（Node/Docker/SQLite WAL/时区/浏览器）

## 基础软件
- Node.js：建议 `>= 18.x`（LTS）。验证：`node -v`
- 包管理器：`npm`（或 `pnpm`/`yarn`，任选其一，一致使用）。
- Docker：`>= 24.x`；包含 Docker Compose。验证：`docker -v`、`docker compose version`
- SQLite：随后端镜像使用；本地调试可安装 sqlite3 客户端（可选）。

## 仓库结构（拟定）
- `server/` 后端（NestJS）
- `web/` 前端（Vite）
- `docs/` 文档
- `data/` SQLite DB 文件（挂载卷）
- `uploads/` 附件目录（挂载卷）

## 时区与语言配置
- 统一时区：`Asia/Shanghai`
  - Docker 容器内设置：
    - Debian/Ubuntu 基础镜像：`ENV TZ=Asia/Shanghai` 并 `ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone`
    - Alpine 基础镜像：安装 `tzdata` 后设置 `TZ`。
- 语言与本地化：前端中文 UI；日期与数字解析以中文环境为主（千分位、小数点、`YYYY-MM-DD`）。

## SQLite 与 WAL 模式
- 启用 WAL：提升并发读写性能，命令：
  - 初次连接后执行：`PRAGMA journal_mode=WAL;`
- 数据库文件位置：`./data/app.db`
- 备份策略：停机备份或使用复制策略（见 `docs/backup-restore.md`）。

## 浏览器支持
- 桌面：Chrome 最新版、Edge 最新版。
- 移动端：常见手机浏览器（网格编辑适度降级，保留浏览/检索）。

## 开发与运行（示例流程）
- 后端（本地）：
  - 安装依赖与生成 Prisma 客户端：`npm install`、`npx prisma generate`
  - 开发运行：`npm run start:dev`（NestJS）
  - 环境变量：`JWT_SECRET`、`DATABASE_URL`（示例：`file:./data/app.db`）、`UPLOAD_DIR`、`TZ=Asia/Shanghai`
- 前端（本地）：
  - 安装依赖：`npm install`
  - 开发运行：`npm run dev`（Vite 默认 `5173`）
  - 代理与后端联通：配置开发代理指向 `http://localhost:8080`

## Docker 与 Compose（示例约定）
- 后端服务：端口 `8080`；卷挂载 `./data:/app/data`、`./uploads:/app/uploads`；`ENV TZ=Asia/Shanghai`
- 前端服务：端口 `5173`（开发）或静态托管端口（生产）；与后端通过内部网络通信。

## 验证清单
- Node/Docker 版本满足要求，`TZ` 环境生效。
- `data/` 与 `uploads/` 可读写；WAL 模式已启用（日志文件存在）。
- 浏览器打开前端可访问；可连接到后端基础路由（如 `/health`）。

—— 完 ——