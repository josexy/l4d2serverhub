# L4D2 Server Hub

English | [中文](#中文)

L4D2 Server Hub is a desktop browser and launcher for Left 4 Dead 2 public servers. It helps players browse public servers, inspect details, manage favorites, and launch Steam/L4D2 connections from one desktop app.

## Features

- Browse public Left 4 Dead 2 servers.
- Filter, sort, and inspect server details.
- Manage favorite servers, groups, notes, and tags.
- Track connection history and search history.
- Import and export local backup data.
- Configure theme, language, page size, query timeout, server detail query method, and HTTP proxy preferences.
- Query server details directly with A2S UDP or through the HTTP upstream API.
- Refresh favorite and history server snapshots with A2S UDP for known server addresses.
- Launch Steam/L4D2 through validated server addresses.

## Tech Stack

- Desktop/backend: Tauri 2, Rust, Tokio
- Frontend: React 19, TypeScript, Vite
- UI: Tailwind CSS 4, shadcn-style components, Radix UI, lucide-react, sonner
- Storage: SQLite, sqlx
- Networking: reqwest, rustls, system proxy support, Source A2S UDP queries

## Upstream Data Source

The public server list data is queried from the public L4D2 server list service on [zhrradiant.com](https://zhrradiant.com). Thanks to zhrradiant.com for making this server data available to the community.

Upstream availability, freshness, and response format depend on that service, so please use the app responsibly and avoid excessive automated requests.

Known server addresses can also be queried directly through Source A2S UDP. A2S is used for server details and saved favorite/history refresh when enabled in Settings. A2S UDP does not use the HTTP proxy setting; public server discovery, search, filtering, sorting, and pagination still use the HTTP upstream service.

## Requirements

- Node.js and npm
- Rust toolchain
- Tauri 2 system dependencies for your platform

If this is your first Tauri setup, follow the official Tauri prerequisites for your operating system.

## Install

```bash
npm install
```

## Development

Run the frontend dev server only:

```bash
npm run dev
```

Run the Tauri desktop app:

```bash
npm run tauri dev
```

## Build

Build the frontend:

```bash
npm run build
```

Build the desktop app bundle:

```bash
npm run tauri build
```

## Test And Check

Run Rust tests:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Check Rust formatting:

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml --check
```

Run Rust linting:

```bash
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

Before submitting behavior changes, it is recommended to run at least:

```bash
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
```

## Project Structure

```text
.
|-- src/                    # React frontend
|   |-- components/          # App components
|   |-- components/ui/       # shadcn-style UI primitives
|   |-- lib/                 # API wrappers, types, utilities, preferences
|   `-- pages/               # Page views
|-- src-tauri/               # Tauri and Rust backend
|   |-- src/                 # Commands, models, stores, launcher, A2S query code, upstream API
|   |-- tests/               # Rust integration tests
|   `-- tauri.conf.json      # Tauri configuration
|-- public/                  # Static assets
|-- components.json          # shadcn configuration
|-- package.json             # Frontend scripts and dependencies
`-- vite.config.ts           # Vite configuration
```

## Development Notes

- Frontend components should call Tauri commands through `src/lib/api.ts`, not direct scattered `invoke` calls.
- Tauri command handlers should stay thin; reusable backend logic belongs in Rust modules.
- Public server list discovery belongs to the HTTP upstream API; A2S code is for known `host:port` addresses only.
- A2S details and saved-server refresh logic lives in `src-tauri/src/a2s_query.rs`.
- Treat server addresses, import data, proxy settings, and upstream responses as untrusted input.
- Changes to SQLite schema or persistence behavior should include Rust tests.
- A2S protocol changes should include deterministic Rust tests for packet parsing, challenge handling, split packets, timeout/error handling, and worker socket reuse.
- Do not commit generated directories such as `dist/`, `node_modules/`, or `src-tauri/target/`.

## Recommended IDE

- [VS Code](https://code.visualstudio.com/)
- [Tauri VS Code Extension](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode)
- [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

---

## 中文

L4D2 Server Hub 是一款用于浏览和启动《Left 4 Dead 2》公共服务器的桌面应用。它可以帮助玩家在一个应用中浏览公共服务器、查看服务器详情、管理收藏，并通过 Steam/L4D2 快速连接服务器。

## 功能

- 浏览《Left 4 Dead 2》公共服务器。
- 筛选、排序并查看服务器详情。
- 管理收藏服务器、分组、备注和标签。
- 记录连接历史和搜索历史。
- 导入和导出本地备份数据。
- 配置主题、语言、分页大小、查询超时、服务器详情查询方式和 HTTP 代理偏好。
- 通过 A2S UDP 或上游 HTTP 接口查询服务器详情。
- 对已知服务器地址使用 A2S UDP 刷新收藏和历史中的服务器快照。
- 通过经过校验的服务器地址启动 Steam/L4D2 连接。

## 技术栈

- 桌面/后端：Tauri 2、Rust、Tokio
- 前端：React 19、TypeScript、Vite
- UI：Tailwind CSS 4、shadcn-style components、Radix UI、lucide-react、sonner
- 存储：SQLite、sqlx
- 网络：reqwest、rustls、系统代理支持、Source A2S UDP 查询

## 上游数据源

公共服务器列表数据来自 [zhrradiant.com](https://zhrradiant.com) 提供的 L4D2 公共服务器列表服务。感谢 zhrradiant.com 为社区提供这些服务器数据。

上游服务的可用性、数据新鲜度和响应格式取决于该站点，请合理使用本应用，避免过于频繁的自动化请求。

已知服务器地址也可以通过 Source A2S UDP 直接查询。在设置中启用后，A2S 会用于服务器详情以及收藏/历史中的已保存服务器刷新。A2S UDP 不使用 HTTP 代理设置；公共服务器发现、搜索、筛选、排序和分页仍使用 HTTP 上游服务。

## 环境要求

- Node.js 和 npm
- Rust 工具链
- 当前平台所需的 Tauri 2 系统依赖

如果是第一次配置 Tauri 开发环境，请先按照 Tauri 官方文档安装对应平台依赖。

## 安装

```bash
npm install
```

## 开发

仅启动前端开发服务器：

```bash
npm run dev
```

启动 Tauri 桌面应用：

```bash
npm run tauri dev
```

## 构建

构建前端资源：

```bash
npm run build
```

构建桌面应用安装包：

```bash
npm run tauri build
```

## 测试与检查

运行 Rust 测试：

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

检查 Rust 格式：

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml --check
```

运行 Rust lint：

```bash
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

建议在提交行为变更前至少运行：

```bash
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
```

## 项目结构

```text
.
|-- src/                    # React 前端
|   |-- components/          # 应用组件
|   |-- components/ui/       # shadcn-style UI 基础组件
|   |-- lib/                 # API 封装、类型、工具和偏好设置
|   `-- pages/               # 页面视图
|-- src-tauri/               # Tauri 和 Rust 后端
|   |-- src/                 # 命令、模型、存储、启动器、A2S 查询代码、上游 API
|   |-- tests/               # Rust 集成测试
|   `-- tauri.conf.json      # Tauri 配置
|-- public/                  # 静态资源
|-- components.json          # shadcn 配置
|-- package.json             # 前端脚本和依赖
`-- vite.config.ts           # Vite 配置
```

## 开发约定

- 前端组件应通过 `src/lib/api.ts` 调用 Tauri 命令，不要在页面中分散直接调用 `invoke`。
- 后端 Tauri command 应保持轻量，复用逻辑放在对应 Rust 模块中。
- 公共服务器列表发现属于 HTTP 上游 API；A2S 代码只用于已知 `host:port` 地址。
- A2S 详情和已保存服务器刷新逻辑位于 `src-tauri/src/a2s_query.rs`。
- 地址、导入数据、代理配置和上游响应都应按不可信输入处理。
- 涉及 SQLite schema 或持久化逻辑的改动需要补充 Rust 测试。
- A2S 协议改动应包含确定性的 Rust 测试，覆盖包解析、challenge、split packet、超时/错误处理和 worker socket 复用。
- 不要提交 `dist/`、`node_modules/`、`src-tauri/target/` 等生成目录。

## 推荐 IDE

- [VS Code](https://code.visualstudio.com/)
- [Tauri VS Code Extension](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode)
- [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
