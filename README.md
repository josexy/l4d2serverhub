<p align="center">
  <img src="src-tauri/icons/128x128@2x.png" alt="L4D2 Server Hub logo" width="96" height="96" />
</p>

<h1 align="center">L4D2 Server Hub</h1>

<p align="center">Browse servers, keep your favorites, and join your next Left 4 Dead 2 game.</p>

<p align="center">
  English · <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="https://github.com/josexy/l4d2serverhub/releases/latest">Download</a> ·
  <a href="#development">Build from source</a> ·
  <a href="https://github.com/josexy/l4d2serverhub/issues">Report an issue</a>
</p>

L4D2 Server Hub is a desktop server browser and launcher built with Tauri, React, and Rust. Search public servers, check their maps and player counts, organize favorites, and connect through Steam. Favorites, history, and preferences are stored locally in SQLite.

## Features

- **Server browser** — search by name, filter by player activity, official or third-party maps, and game mode; sort results and apply custom IP/text allowlists and blocklists.
- **Server details** — inspect server information and player lists in a side panel or a separate window. Keep the detail view open to receive a free-slot reminder or connect automatically.
- **Favorites** — save servers into groups, add custom names, notes, and tags, and move or remove multiple entries at once.
- **History** — revisit recently connected servers and reuse previous searches.
- **Direct queries** — refresh known servers through Source A2S UDP, or use the upstream HTTP query mode.
- **Appearance** — English and Simplified Chinese; system, light, and dark themes. The sidebar theme shortcut saves your choice and stays in sync with Settings.
- **Local data** — export and import JSON backups of settings, groups, favorites, and connection history.

## Screenshots

Captured from the current application frontend with demonstration server data. These images show the development UI; a published release may look different.

### Public servers · Light theme

![Public server browser with search, filters, player counts, latency, and connection actions](docs/screenshots/servers-light.png)

<details>
<summary><strong>Favorites and groups · Dark theme</strong></summary>

![Favorites organized into groups in the dark theme](docs/screenshots/favorites-dark.png)

</details>

## Download and install

Get the package for your platform from [GitHub Releases](https://github.com/josexy/l4d2serverhub/releases/latest).

| Platform | Packages |
| --- | --- |
| Windows x64 | MSI installer or portable ZIP |
| macOS, Apple Silicon and Intel | Universal DMG or app ZIP |
| Linux x64 | AppImage, DEB, or RPM |

Windows requires the [Microsoft Edge WebView2 Runtime](https://v2.tauri.app/start/prerequisites/#webview2). macOS release builds are ad-hoc signed and are not notarized.

To connect to a server, you need a working Steam and Left 4 Dead 2 installation on your system. The app opens a `steam://connect/host:port` URL; it does not include the game.

## Quick start

1. Open **Servers** and search or filter the public list.
2. Click a server name to inspect its details, or click **Connect** to open it through Steam.
3. Click the star to save a server. Use **Favorites** to organize groups, add an address manually, and edit notes or tags.
4. Use **History** to return to previously connected servers.
5. Open **Settings** to configure language, query methods, timeouts, proxy, and backups. The icon below **About** cycles through system, light, and dark themes.

Closing the main window hides the app to the system tray. Use the tray menu to reopen it or quit.

## Data and networking

### Local storage and backups

The app stores its database, `l4d2-server-hub.sqlite`, in the operating system's application data directory. The Windows portable ZIP also uses that directory for settings and saved servers.

In **Settings**, export a JSON backup before moving to another computer or replacing your data. Import validates the backup and **replaces existing settings, groups, favorites, and connection history**. Search history is not included in the backup.

### Server queries

Public server discovery, search, filtering, sorting, and pagination use the L4D2 server list service at [zhrradiant.com](https://zhrradiant.com). Thanks to its maintainers for providing server data to the community.

For known server addresses, the configured query method controls server details and favorites/history refresh:

| Query method | Connection | Proxy |
| --- | --- | --- |
| A2S UDP | Queries the game server directly | Does not use the HTTP proxy |
| HTTP | Queries the upstream service | Uses the configured no-proxy, system-proxy, or custom-proxy mode |

Public list availability depends on the upstream service. If direct queries time out, check UDP connectivity and the A2S timeout in Settings; changing the HTTP proxy does not affect UDP traffic.

## Development

### Prerequisites

- Node.js **22.12+** and npm; CI uses Node.js 22.
- A stable Rust toolchain, including `rustfmt` and `clippy`.
- The [Tauri 2 system prerequisites](https://v2.tauri.app/start/prerequisites/) for your operating system.

### Run locally

```bash
git clone https://github.com/josexy/l4d2serverhub.git
cd l4d2serverhub
npm install
npm run tauri dev
```

`npm run tauri dev` starts both the Vite frontend and the desktop app. For frontend layout work, `npm run dev` starts Vite at `http://localhost:1420`; server queries, persistence, and Steam launching require the Tauri backend.

### Build and check

```bash
# Build frontend assets
npm run build

# Build the desktop app and platform bundles
npm run tauri build

# Run backend tests and checks
cargo test --manifest-path src-tauri/Cargo.toml
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

Default local bundles are written to `src-tauri/target/release/bundle/`. For the platform-specific packaging commands, see the [release workflow](.github/workflows/release.yml).

### Stack and layout

| Layer | Technologies |
| --- | --- |
| Desktop and backend | Tauri 2, Rust, Tokio |
| Frontend | React 19, TypeScript, Vite |
| UI | Tailwind CSS 4, shadcn-style components, Radix UI, lucide-react |
| Storage and networking | SQLite, sqlx, reqwest, rustls, Source A2S UDP |

```text
src/
  components/       App components and reusable UI primitives
  lib/              Tauri API wrappers, types, preferences, and i18n
  pages/            Servers, favorites, history, settings, and about
src-tauri/
  src/              Commands, storage, server queries, and Steam launcher
  tests/            Rust integration tests
  icons/            Application icons
docs/screenshots/   README screenshots
.github/workflows/  Build checks and release packaging
```

## Contributing

Bug reports and pull requests are welcome. Include your OS, app version, reproduction steps, and relevant errors when [opening an issue](https://github.com/josexy/l4d2serverhub/issues).

Keep changes focused, follow the repository's [development guidelines](AGENTS.md), and run the checks relevant to your change. Frontend changes should pass `npm run build`; backend behavior changes should include deterministic Rust tests. Smoke test desktop integration changes with `npm run tauri dev`.

## License

Licensed under the [MIT License](LICENSE).
