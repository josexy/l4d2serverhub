# L4D2 Server Hub

L4D2 Server Hub 是一个用于浏览和启动《Left 4 Dead 2》公共服务器的桌面应用。它基于 Tauri 2、Rust、React、TypeScript 和 Vite 构建，适合在桌面端快速筛选服务器、管理收藏并通过 Steam 启动连接。

## 功能

- 浏览 L4D2 公共服务器列表。
- 按条件筛选、排序并查看服务器详情。
- 管理收藏服务器、分组、备注和标签。
- 记录连接历史和搜索历史。
- 导入、导出本地数据备份。
- 配置主题、语言、分页、查询超时和 HTTP 代理等偏好。
- 通过经过校验的服务器地址启动 Steam/L4D2 连接。

## 技术栈

- 桌面与后端：Tauri 2、Rust、Tokio
- 前端：React 19、TypeScript、Vite
- UI：Tailwind CSS 4、shadcn-style components、Radix UI、lucide-react、sonner
- 数据存储：SQLite、sqlx
- 网络：reqwest、rustls、系统代理支持

## 环境要求

- Node.js 与 npm
- Rust toolchain
- Tauri 2 所需的系统依赖

如果是首次配置 Tauri 开发环境，请参考 Tauri 官方文档安装对应平台依赖。

## 安装依赖

```bash
npm install
```

## 开发运行

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

建议在提交功能性改动前至少运行：

```bash
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
```

## 项目结构

```text
.
├── src/                    # React 前端
│   ├── components/          # 应用组件
│   ├── components/ui/       # shadcn-style UI 基础组件
│   ├── lib/                 # API 封装、类型、工具、偏好设置
│   └── pages/               # 页面视图
├── src-tauri/               # Tauri 与 Rust 后端
│   ├── src/                 # 命令、模型、存储、启动器、上游 API
│   ├── tests/               # Rust 集成测试
│   └── tauri.conf.json      # Tauri 配置
├── public/                  # 静态资源
├── components.json          # shadcn 配置
├── package.json             # 前端脚本与依赖
└── vite.config.ts           # Vite 配置
```

## 开发约定

- 前端组件通过 `src/lib/api.ts` 调用 Tauri 命令，不直接在页面中散落 `invoke`。
- 后端 Tauri command 保持薄封装，业务逻辑放在对应 Rust 模块中。
- 地址、导入数据、代理配置和上游返回值都按不可信输入处理。
- 涉及 SQLite schema 或存储逻辑的改动需要补充 Rust 测试。
- 不提交 `dist/`、`node_modules/`、`src-tauri/target/` 等生成目录。

## 推荐 IDE

- [VS Code](https://code.visualstudio.com/)
- [Tauri VS Code Extension](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode)
- [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
