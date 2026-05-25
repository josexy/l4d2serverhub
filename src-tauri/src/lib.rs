// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
pub mod commands;
pub mod errors;
pub mod favorites_store;
pub mod history_store;
pub mod import_export;
pub mod logging;
pub mod models;
pub mod search_history_store;
pub mod settings_store;
pub mod steam_launcher;
pub mod upstream_api;

use chrono::Utc;
use logging::LogState;
use sqlx::{
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
    SqlitePool,
};
use std::{
    io,
    path::{Path, PathBuf},
    str::FromStr,
    sync::Arc,
};
use tauri::{Listener, LogicalSize, Manager};
use tauri_plugin_log::{Target, TargetKind};
use tokio::sync::OnceCell;
use upstream_api::{UpstreamApiConfig, UpstreamClientCache};

pub struct AppState {
    pub pool: SqlitePool,
    pub upstream_config: Arc<OnceCell<UpstreamApiConfig>>,
    pub upstream_client_cache: UpstreamClientCache,
    pub log_state: Arc<LogState>,
}

pub type SharedState = Arc<AppState>;

const WINDOW_MAX_WORK_AREA_RATIO: f64 = 0.9;
const STARTUP_WIDTH_WORK_AREA_RATIO: f64 = 0.72;
const STARTUP_HEIGHT_WORK_AREA_RATIO: f64 = 0.78;
const MIN_WIDTH_WORK_AREA_RATIO: f64 = 0.5;
const MIN_HEIGHT_WORK_AREA_RATIO: f64 = 0.55;
const MIN_WIDTH_FLOOR: f64 = 720.0;
const MIN_HEIGHT_FLOOR: f64 = 520.0;
const MIN_WIDTH_CAP: f64 = 900.0;
const MIN_HEIGHT_CAP: f64 = 700.0;
const STARTUP_WIDTH_CAP: f64 = 1400.0;
const STARTUP_HEIGHT_CAP: f64 = 900.0;
const DATABASE_FILE_NAME: &str = "l4d2-server-hub.sqlite";
pub const LOG_FILE_NAME: &str = "l4d2-server-hub";

pub async fn create_pool(database_url: &str) -> Result<SqlitePool, sqlx::Error> {
    let max_connections = if is_in_memory_sqlite_url(database_url) {
        1
    } else {
        5
    };
    let connect_options = SqliteConnectOptions::from_str(database_url)?
        .create_if_missing(true)
        .foreign_keys(true);

    create_pool_with_options(connect_options, max_connections).await
}

pub async fn create_pool_at_path(
    database_path: impl AsRef<Path>,
) -> Result<SqlitePool, sqlx::Error> {
    let connect_options = SqliteConnectOptions::new()
        .filename(database_path.as_ref())
        .create_if_missing(true)
        .foreign_keys(true);

    create_pool_with_options(connect_options, 5).await
}

async fn create_pool_with_options(
    connect_options: SqliteConnectOptions,
    max_connections: u32,
) -> Result<SqlitePool, sqlx::Error> {
    let pool = SqlitePoolOptions::new()
        .max_connections(max_connections)
        .connect_with(connect_options)
        .await?;
    initialize_schema(&pool).await?;
    Ok(pool)
}

async fn initialize_schema(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    let schema_statements = [
        "CREATE TABLE IF NOT EXISTS favorite_groups (
            id TEXT PRIMARY KEY NOT NULL,
            name TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )",
        "CREATE TABLE IF NOT EXISTS favorites (
            id TEXT PRIMARY KEY NOT NULL,
            address TEXT NOT NULL UNIQUE,
            server_id TEXT,
            group_id TEXT NOT NULL,
            custom_name TEXT,
            notes TEXT NOT NULL DEFAULT '',
            tags_json TEXT NOT NULL DEFAULT '[]',
            last_snapshot_json TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            last_connected_at TEXT,
            FOREIGN KEY(group_id) REFERENCES favorite_groups(id)
        )",
        "CREATE TABLE IF NOT EXISTS history_records (
            id TEXT PRIMARY KEY NOT NULL,
            address TEXT NOT NULL UNIQUE,
            server_id TEXT,
            server_name TEXT NOT NULL,
            map TEXT NOT NULL,
            players INTEGER NOT NULL,
            max_players INTEGER NOT NULL,
            connected_at TEXT NOT NULL,
            connection_count INTEGER NOT NULL DEFAULT 1,
            last_snapshot_json TEXT
        )",
        "CREATE INDEX IF NOT EXISTS idx_history_connected_at
            ON history_records(connected_at DESC)",
        "CREATE TABLE IF NOT EXISTS search_history (
            id TEXT PRIMARY KEY NOT NULL,
            query TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL,
            last_used_at TEXT NOT NULL
        )",
        "CREATE INDEX IF NOT EXISTS idx_search_history_last_used_at
            ON search_history(last_used_at DESC)",
        "CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY NOT NULL,
            value_json TEXT NOT NULL
        )",
    ];

    for statement in schema_statements {
        sqlx::query(statement).execute(pool).await?;
    }

    let now = Utc::now().to_rfc3339();
    sqlx::query(
        "INSERT OR IGNORE INTO favorite_groups (id, name, created_at, updated_at)
         VALUES ('default', 'Default', ?, ?)",
    )
    .bind(&now)
    .bind(&now)
    .execute(pool)
    .await?;

    Ok(())
}

fn is_in_memory_sqlite_url(database_url: &str) -> bool {
    database_url.contains(":memory:") || database_url.contains("mode=memory")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let context = tauri::generate_context!();
    let app_identifier = context.config().identifier.clone();
    let log_state = Arc::new(LogState::default());
    let log_filter_state = Arc::clone(&log_state);
    let mut log_targets = vec![log_file_target(&app_identifier)];
    #[cfg(debug_assertions)]
    log_targets.push(Target::new(TargetKind::Stdout));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets(log_targets)
                .level(log::LevelFilter::Trace)
                .max_file_size(5 * 1024 * 1024)
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepSome(5))
                .filter(move |metadata| log_filter_state.allows(metadata.level()))
                .build(),
        )
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir().map_err(|err| {
                io::Error::other(format!("failed to resolve app data directory: {err}"))
            })?;
            std::fs::create_dir_all(&app_data_dir).map_err(|err| {
                io::Error::other(format!(
                    "failed to create app data directory '{}': {err}",
                    app_data_dir.display()
                ))
            })?;
            let database_path = app_data_dir.join(DATABASE_FILE_NAME);
            let pool = tauri::async_runtime::block_on(create_pool_at_path(&database_path))
                .map_err(|err| {
                    io::Error::other(format!(
                        "failed to open or initialize SQLite database '{}': {err}",
                        database_path.display()
                    ))
                })?;
            match tauri::async_runtime::block_on(settings_store::get_settings(&pool)) {
                Ok(settings) => {
                    log_state.apply_settings(&settings.logging);
                    log::info!(
                        "applied persisted logging settings: enabled={}, level={:?}",
                        settings.logging.enabled,
                        settings.logging.level
                    );
                }
                Err(err) => {
                    log::warn!("failed to read logging settings during startup: {err}");
                }
            }
            log::info!("starting L4D2 Server Hub");
            log::info!(
                "using application database at '{}'",
                database_path.display()
            );

            let main_window = app.get_webview_window("main").ok_or_else(|| {
                io::Error::other("failed to find main webview window during startup")
            })?;
            if let Err(err) = configure_startup_window(&main_window) {
                log::warn!("failed to configure main window layout: {err}");
            } else {
                log::debug!("configured main window startup layout");
            }
            let startup_window = main_window.clone();
            app.listen("l4d2://frontend-ready", move |_| {
                if let Err(err) = startup_window.show() {
                    log::warn!("failed to show main window: {err}");
                } else {
                    log::debug!("main window shown after frontend ready event");
                }
            });

            let upstream_config = Arc::new(OnceCell::new());
            let init_pool = pool.clone();
            let init_upstream_config = Arc::clone(&upstream_config);
            tauri::async_runtime::spawn(async move {
                init_upstream_config
                    .get_or_init(|| async { load_startup_upstream_config(&init_pool).await })
                    .await;
            });

            app.manage(Arc::new(AppState {
                pool,
                upstream_config,
                upstream_client_cache: UpstreamClientCache::default(),
                log_state,
            }));

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::query_servers,
            commands::get_server_details,
            commands::connect_to_server,
            commands::list_favorites,
            commands::add_favorite,
            commands::update_favorite,
            commands::update_favorite_snapshot,
            commands::delete_favorite,
            commands::list_groups,
            commands::create_group,
            commands::update_group,
            commands::delete_group,
            commands::list_history,
            commands::update_history_snapshot,
            commands::delete_history,
            commands::clear_history,
            commands::list_search_history,
            commands::add_search_history,
            commands::delete_search_history,
            commands::get_settings,
            commands::update_settings,
            commands::export_data,
            commands::write_export_file,
            commands::import_data,
            commands::open_log_folder,
            commands::clear_log_files
        ])
        .run(context)
        .expect("error while running tauri application");
}

#[cfg(target_os = "windows")]
fn log_file_target(app_identifier: &str) -> Target {
    if let Some(path) = windows_log_dir_path(app_identifier) {
        return Target::new(TargetKind::Folder {
            path,
            file_name: Some(LOG_FILE_NAME.to_string()),
        });
    }

    Target::new(TargetKind::LogDir {
        file_name: Some(LOG_FILE_NAME.to_string()),
    })
}

#[cfg(not(target_os = "windows"))]
fn log_file_target(_app_identifier: &str) -> Target {
    Target::new(TargetKind::LogDir {
        file_name: Some(LOG_FILE_NAME.to_string()),
    })
}

#[cfg(target_os = "windows")]
pub fn windows_log_dir_path(app_identifier: &str) -> Option<PathBuf> {
    std::env::var_os("APPDATA")
        .map(|roaming_dir| PathBuf::from(roaming_dir).join(app_identifier).join("logs"))
}

pub fn app_log_dir_path<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<PathBuf> {
    #[cfg(target_os = "windows")]
    if let Some(path) = windows_log_dir_path(&app.config().identifier) {
        return Ok(path);
    }

    app.path().app_log_dir()
}

fn configure_startup_window<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
) -> tauri::Result<()> {
    let monitor = match window.current_monitor()? {
        Some(monitor) => Some(monitor),
        None => window.primary_monitor()?,
    };

    let Some(monitor) = monitor else {
        return Ok(());
    };

    let scale_factor = if monitor.scale_factor().is_finite() && monitor.scale_factor() > 0.0 {
        monitor.scale_factor()
    } else {
        1.0
    };
    let work_area = monitor.work_area();
    let work_width = f64::from(work_area.size.width) / scale_factor;
    let work_height = f64::from(work_area.size.height) / scale_factor;

    let Some(layout) = calculate_startup_window_layout(work_width, work_height) else {
        return Ok(());
    };

    window.set_min_size(Some(LogicalSize::new(
        f64::from(layout.min_width),
        f64::from(layout.min_height),
    )))?;
    window.set_size(LogicalSize::new(
        f64::from(layout.width),
        f64::from(layout.height),
    ))?;
    window.center()?;

    Ok(())
}

#[derive(Debug, PartialEq, Eq)]
struct StartupWindowLayout {
    width: u32,
    height: u32,
    min_width: u32,
    min_height: u32,
}

fn calculate_startup_window_layout(
    work_width: f64,
    work_height: f64,
) -> Option<StartupWindowLayout> {
    if !work_width.is_finite()
        || !work_height.is_finite()
        || work_width <= 0.0
        || work_height <= 0.0
    {
        return None;
    }

    let max_width = (work_width * WINDOW_MAX_WORK_AREA_RATIO).max(1.0);
    let max_height = (work_height * WINDOW_MAX_WORK_AREA_RATIO).max(1.0);
    let min_width = clamp_window_dimension(
        work_width * MIN_WIDTH_WORK_AREA_RATIO,
        MIN_WIDTH_FLOOR,
        MIN_WIDTH_CAP.min(max_width),
    );
    let min_height = clamp_window_dimension(
        work_height * MIN_HEIGHT_WORK_AREA_RATIO,
        MIN_HEIGHT_FLOOR,
        MIN_HEIGHT_CAP.min(max_height),
    );
    let width = clamp_window_dimension(
        work_width * STARTUP_WIDTH_WORK_AREA_RATIO,
        f64::from(min_width),
        STARTUP_WIDTH_CAP.min(max_width),
    );
    let height = clamp_window_dimension(
        work_height * STARTUP_HEIGHT_WORK_AREA_RATIO,
        f64::from(min_height),
        STARTUP_HEIGHT_CAP.min(max_height),
    );

    Some(StartupWindowLayout {
        width,
        height,
        min_width,
        min_height,
    })
}

fn clamp_window_dimension(preferred: f64, min: f64, max: f64) -> u32 {
    let bounded = if max < min {
        max
    } else {
        preferred.clamp(min, max)
    };

    bounded.round().max(1.0) as u32
}

async fn load_startup_upstream_config(pool: &SqlitePool) -> UpstreamApiConfig {
    let settings = match settings_store::get_settings(pool).await {
        Ok(settings) => settings,
        Err(err) => {
            log::warn!("failed to read settings before nonce fetch, using defaults: {err}");
            models::AppSettings::default()
        }
    };

    match upstream_api::HttpUpstreamServerClient::startup_config(
        std::time::Duration::from_millis(settings.query_timeout_ms),
        &settings.http_proxy,
    )
    .await
    {
        Ok(config) => {
            log::info!(
                "loaded startup nonce from public servers page: {}",
                config.nonce
            );
            config
        }
        Err(err) => {
            log::warn!("failed to load startup nonce, falling back to bundled default: {err}");
            UpstreamApiConfig::default()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    #[tokio::test]
    async fn create_pool_at_path_opens_file_backed_database_and_initializes_schema() {
        let temp_dir =
            std::env::temp_dir().join(format!("l4d2-server-hub-test-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let database_path = temp_dir.join("app.sqlite");

        let pool = create_pool_at_path(&database_path).await.unwrap();
        let groups = crate::favorites_store::list_groups(&pool).await.unwrap();

        assert!(database_path.exists());
        assert!(groups.iter().any(|group| group.id == "default"));

        pool.close().await;
        drop(pool);
        remove_dir_all_with_retries(&temp_dir);
    }

    fn remove_dir_all_with_retries(path: impl AsRef<std::path::Path>) {
        let path = path.as_ref();
        const ATTEMPTS: usize = 20;
        const RETRY_DELAY: std::time::Duration = std::time::Duration::from_millis(100);

        for attempt in 1..=ATTEMPTS {
            match std::fs::remove_dir_all(path) {
                Ok(()) => return,
                Err(err) if attempt == ATTEMPTS => {
                    panic!(
                        "failed to remove temporary directory '{}' after {ATTEMPTS} attempts: {err}",
                        path.display()
                    );
                }
                Err(_) => std::thread::sleep(RETRY_DELAY),
            }
        }
    }

    #[test]
    fn startup_window_layout_scales_for_full_hd_work_area() {
        assert_eq!(
            calculate_startup_window_layout(1920.0, 1040.0),
            Some(StartupWindowLayout {
                width: 1382,
                height: 811,
                min_width: 900,
                min_height: 572,
            })
        );
    }

    #[test]
    fn startup_window_layout_caps_large_displays() {
        assert_eq!(
            calculate_startup_window_layout(3840.0, 2160.0),
            Some(StartupWindowLayout {
                width: 1400,
                height: 900,
                min_width: 900,
                min_height: 700,
            })
        );
    }

    #[test]
    fn startup_window_layout_fits_small_work_area() {
        assert_eq!(
            calculate_startup_window_layout(1024.0, 560.0),
            Some(StartupWindowLayout {
                width: 737,
                height: 504,
                min_width: 720,
                min_height: 504,
            })
        );
    }

    #[test]
    fn startup_window_layout_ignores_invalid_work_area() {
        assert_eq!(calculate_startup_window_layout(0.0, 1080.0), None);
        assert_eq!(calculate_startup_window_layout(1920.0, f64::NAN), None);
    }
}
