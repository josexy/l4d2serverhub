# AGENTS.md

Guidance for coding agents working in this repository.

## Project Overview

L4D2 Server Hub is a desktop Left 4 Dead 2 public server browser and launcher.

Core stack:

- Tauri 2 desktop shell with a Rust backend.
- React 19, TypeScript, and Vite for the frontend.
- Tailwind CSS 4, shadcn-style components, Radix UI, lucide-react, and sonner for UI.
- SQLite through sqlx for favorites, groups, history, search history, settings, and import/export data.

Core behavior:

- Query public L4D2 servers through the upstream API code in `src-tauri/src/upstream_api.rs`.
- Query individual server details and saved favorite/history snapshots through A2S UDP code in `src-tauri/src/a2s_query.rs` when the setting is enabled.
- Filter, sort, inspect, favorite, group, annotate, import/export, and launch servers.
- Launch Steam/L4D2 only through validated `host:port` server addresses.
- Keep frontend Tauri command calls centralized behind `src/lib/api.ts`.

## Repository Layout

- `src/` - React frontend source.
- `src/App.tsx` - Main page routing and app shell mounting.
- `src/pages/` - Top-level app pages: servers, favorites, history, settings, about.
- `src/components/` - App-specific React components.
- `src/components/ui/` - shadcn-style reusable UI primitives owned in-repo.
- `src/lib/` - Frontend API wrappers, shared types, filters, preferences, i18n, utilities.
- `src-tauri/src/` - Rust backend modules, Tauri commands, stores, models, errors, launcher, A2S query code, upstream API.
- `src-tauri/tests/` - Rust integration tests.
- `src-tauri/tauri.conf.json` - Tauri app configuration.
- `components.json` - shadcn project configuration.
- `dist/`, `node_modules/`, `src-tauri/target/`, and `src-tauri/gen/` are generated or tool-managed outputs.

## Setup And Commands

Run commands from the repository root unless a command explicitly sets a manifest path.

- Install frontend dependencies: `npm install`
- Run frontend only: `npm run dev`
- Run the Tauri desktop app: `npm run tauri dev`
- Build frontend: `npm run build`
- Build the Tauri desktop app bundle: `npm run tauri build`
- Preview frontend build: `npm run preview`
- Run Rust tests: `cargo test --manifest-path src-tauri/Cargo.toml`
- Check Rust formatting: `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- Format Rust: `cargo fmt --manifest-path src-tauri/Cargo.toml`
- Run Rust linting: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`

Before considering a change complete, prefer running the relevant subset:

1. `npm run build`
2. `cargo test --manifest-path src-tauri/Cargo.toml`
3. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
4. `cargo fmt --manifest-path src-tauri/Cargo.toml --check`

For UI, command wiring, or desktop integration changes, also smoke test with `npm run tauri dev`.

## Coding Guidelines

### General

- Keep changes focused on the requested behavior.
- Follow existing naming, module boundaries, and file organization before introducing new abstractions.
- Do not rewrite unrelated code or generated artifacts.
- Do not edit `dist/`, `node_modules/`, `src-tauri/target/`, or `src-tauri/gen/` unless explicitly requested.
- Treat the worktree as potentially dirty. Preserve user changes and avoid destructive git commands.
- Keep frontend and Rust types in sync when changing command payloads or responses.

### Rust / Tauri

- Keep Tauri command handlers in `src-tauri/src/commands.rs` thin; put reusable behavior in backend modules.
- Use typed models from `src-tauri/src/models.rs` and typed errors from `src-tauri/src/errors.rs`.
- Validate all externally supplied addresses before using them for networking, persistence, or Steam launch.
- Public server list search, filtering, sorting, and pagination still belong to `src-tauri/src/upstream_api.rs`; A2S is only for known `host:port` addresses.
- Keep A2S query behavior in `src-tauri/src/a2s_query.rs`. Details may use `A2S_INFO` plus `A2S_PLAYER`; saved favorite/history refresh should use `A2S_INFO` only.
- A2S UDP does not use HTTP proxy settings. Use `queryTimeoutMs` for UDP timeouts and return per-address errors for batch refresh instead of failing or deleting the whole saved list.
- When changing the A2S worker, preserve challenge retry, uncompressed split-packet assembly, per-address timeout handling, and deterministic non-live tests.
- Keep `ServerSnapshot` validation semantics intact. Deserialization must continue to reject inconsistent `address`, `ip`, and `port` data.
- When changing persistence, update schema initialization in `src-tauri/src/lib.rs` and add or adjust store tests.
- When changing import/export, validate the complete payload before replacing existing data.
- Network/upstream code should return clear errors for malformed, unsupported, or failed responses instead of panicking.
- Tests should be deterministic; do not make normal test runs depend on live public servers.

### React / Frontend

- Use existing page and component patterns before adding new layout abstractions.
- Keep Tauri invocations behind `src/lib/api.ts`; components should call the API wrapper rather than `invoke` directly.
- Use shared frontend types from `src/lib/types.ts`.
- Prefer shadcn-style primitives from `src/components/ui/` for buttons, dialogs, tables, tabs, inputs, toasts, and other common UI.
- Use lucide-react icons for icon buttons and common actions.
- Use `cn()` from `src/lib/utils.ts` for conditional classes.
- Keep desktop workflows dense, scannable, and practical. This is an operational app, not a marketing page.
- Do not add explanatory product copy unless it directly supports the workflow.

### Styling

- Prefer the existing Tailwind CSS 4 setup in `src/index.css`.
- Use semantic design tokens and existing component variants where possible.
- Keep text from overflowing compact buttons, table cells, panels, dialogs, and sidebars.
- Use stable dimensions for fixed-format controls such as icon buttons, tables, counters, and toolbars.
- Avoid decorative gradients, floating ornaments, and card-heavy layouts in core app screens.
- Use cards only for repeated items, dialogs, and genuinely framed tools.

### shadcn Components

- Check existing files in `src/components/ui/` before adding a new UI primitive.
- If adding or updating shadcn components, use the project package runner and shadcn CLI, for example `npx shadcn@latest add <component>`.
- Preview component updates with dry runs or diffs before overwriting local component files.
- Keep Dialog, Sheet, Tabs, Select, DropdownMenu, Tooltip, and other composed primitives accessible according to their existing local patterns.
- For icons inside buttons, prefer the local component conventions and avoid hand-drawn SVGs when lucide-react has an appropriate icon.

## Testing Expectations

- Backend model, store, import/export, settings, history, favorites, launcher, and command changes need Rust tests.
- Frontend-only changes should at least pass `npm run build`.
- Cross-boundary changes should pass both `npm run build` and `cargo test --manifest-path src-tauri/Cargo.toml`.
- Persistence changes should include in-memory or temporary-file SQLite coverage.
- Launcher and address parsing changes should cover invalid input as well as valid `host:port` cases.
- A2S protocol changes should cover parser behavior, challenge handling, split packets, timeout/error snapshots, and worker socket reuse without depending on live public servers.

## Security And Safety Notes

- Treat server addresses, import files, persisted records, proxy settings, and upstream data as untrusted input.
- Treat A2S UDP responses as untrusted input; parse defensively and return clear errors for malformed packets.
- Do not build shell commands from raw user or server input.
- Steam launch URLs must be created only from validated addresses.
- Do not add kicking, banning, RCON, or remote server administration features unless explicitly requested.
- Avoid logging sensitive local paths or user-provided payloads unless needed for a clear error.

## Commit Guidance

- Use concise commit messages such as `feat: ...`, `fix: ...`, `chore: ...`, or `test: ...`.
- Keep commits scoped to one coherent change.
- Include tests with behavior changes when practical.
