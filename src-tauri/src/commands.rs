use crate::errors::{AppError, AppResult, CommandError, CommandResult};
use crate::import_export::BackupPayload;
use crate::models::{
    AppSettings, Favorite, FavoriteGroup, FavoriteInput, HistoryRecord, SearchHistoryRecord,
    ServerDetails, ServerFilters, ServerQueryParams, ServerQueryResult, ServerSnapshot, ServerSort,
};
use crate::upstream_api::{UpstreamApiConfig, UpstreamClientCache, UpstreamServerClient};
use crate::{favorites_store, history_store, import_export, search_history_store, settings_store};
use crate::{steam_launcher, SharedState};
use sqlx::SqlitePool;
use std::{cmp::Reverse, path::Path, sync::Arc, time::Duration};
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;
use tokio::sync::OnceCell;

fn command_result<T>(operation: &str, result: AppResult<T>) -> CommandResult<T> {
    result.map_err(|error| {
        log_command_error(operation, &error);
        CommandError::from(error)
    })
}

fn log_command_error(operation: &str, error: &AppError) {
    match error {
        AppError::Database(_) | AppError::Unexpected(_) | AppError::LaunchFailed(_) => {
            log::error!("{operation} failed: {error}");
        }
        _ => {
            log::warn!("{operation} failed: {error}");
        }
    }
}

#[tauri::command]
pub async fn query_servers(
    state: State<'_, SharedState>,
    params: ServerQueryParams,
) -> CommandResult<ServerQueryResult> {
    command_result(
        "query_servers",
        query_servers_impl(
            &state.pool,
            &state.upstream_config,
            &state.upstream_client_cache,
            params,
        )
        .await,
    )
}

#[tauri::command]
pub async fn get_server_details(
    state: State<'_, SharedState>,
    address: String,
    server_id: Option<String>,
    fallback_name: Option<String>,
) -> CommandResult<ServerDetails> {
    command_result(
        "get_server_details",
        get_server_details_impl(
            &state.pool,
            &state.upstream_config,
            &state.upstream_client_cache,
            &address,
            server_id.as_deref(),
            fallback_name.as_deref(),
        )
        .await,
    )
}

#[tauri::command]
pub async fn connect_to_server(
    state: State<'_, SharedState>,
    address: String,
    history_snapshot: Option<ServerSnapshot>,
) -> CommandResult<()> {
    command_result(
        "connect_to_server",
        connect_to_server_impl(&state.pool, &address, history_snapshot.as_ref()).await,
    )
}

#[tauri::command]
pub async fn list_favorites(state: State<'_, SharedState>) -> CommandResult<Vec<Favorite>> {
    command_result("list_favorites", list_favorites_impl(&state.pool).await)
}

#[tauri::command]
pub async fn add_favorite(
    state: State<'_, SharedState>,
    input: FavoriteInput,
) -> CommandResult<Favorite> {
    command_result("add_favorite", add_favorite_impl(&state.pool, input).await)
}

#[tauri::command]
pub async fn update_favorite(
    state: State<'_, SharedState>,
    id: String,
    input: FavoriteInput,
) -> CommandResult<Favorite> {
    command_result(
        "update_favorite",
        update_favorite_impl(&state.pool, id, input).await,
    )
}

#[tauri::command]
pub async fn update_favorite_snapshot(
    state: State<'_, SharedState>,
    id: String,
    snapshot: ServerSnapshot,
) -> CommandResult<Favorite> {
    command_result(
        "update_favorite_snapshot",
        update_favorite_snapshot_impl(&state.pool, id, &snapshot).await,
    )
}

#[tauri::command]
pub async fn delete_favorite(state: State<'_, SharedState>, id: String) -> CommandResult<()> {
    command_result(
        "delete_favorite",
        delete_favorite_impl(&state.pool, id).await,
    )
}

#[tauri::command]
pub async fn list_groups(state: State<'_, SharedState>) -> CommandResult<Vec<FavoriteGroup>> {
    command_result(
        "list_groups",
        favorites_store::list_groups(&state.pool).await,
    )
}

#[tauri::command]
pub async fn create_group(
    state: State<'_, SharedState>,
    name: String,
) -> CommandResult<FavoriteGroup> {
    command_result(
        "create_group",
        favorites_store::create_group(&state.pool, name).await,
    )
}

#[tauri::command]
pub async fn update_group(
    state: State<'_, SharedState>,
    id: String,
    name: String,
) -> CommandResult<FavoriteGroup> {
    command_result(
        "update_group",
        favorites_store::update_group(&state.pool, id, name).await,
    )
}

#[tauri::command]
pub async fn delete_group(state: State<'_, SharedState>, id: String) -> CommandResult<()> {
    command_result(
        "delete_group",
        favorites_store::delete_group(&state.pool, id).await,
    )
}

#[tauri::command]
pub async fn list_history(state: State<'_, SharedState>) -> CommandResult<Vec<HistoryRecord>> {
    command_result(
        "list_history",
        history_store::list_history(&state.pool).await,
    )
}

#[tauri::command]
pub async fn update_history_snapshot(
    state: State<'_, SharedState>,
    id: String,
    snapshot: ServerSnapshot,
) -> CommandResult<HistoryRecord> {
    command_result(
        "update_history_snapshot",
        history_store::update_history_snapshot(&state.pool, id, &snapshot).await,
    )
}

#[tauri::command]
pub async fn delete_history(state: State<'_, SharedState>, id: String) -> CommandResult<()> {
    command_result(
        "delete_history",
        history_store::delete_history(&state.pool, id).await,
    )
}

#[tauri::command]
pub async fn clear_history(state: State<'_, SharedState>) -> CommandResult<()> {
    command_result(
        "clear_history",
        history_store::clear_history(&state.pool).await,
    )
}

#[tauri::command]
pub async fn list_search_history(
    state: State<'_, SharedState>,
) -> CommandResult<Vec<SearchHistoryRecord>> {
    command_result(
        "list_search_history",
        search_history_store::list_search_history(&state.pool).await,
    )
}

#[tauri::command]
pub async fn add_search_history(
    state: State<'_, SharedState>,
    query: String,
) -> CommandResult<Vec<SearchHistoryRecord>> {
    command_result(
        "add_search_history",
        search_history_store::add_search_history(&state.pool, query).await,
    )
}

#[tauri::command]
pub async fn delete_search_history(state: State<'_, SharedState>, id: String) -> CommandResult<()> {
    command_result(
        "delete_search_history",
        search_history_store::delete_search_history(&state.pool, id).await,
    )
}

#[tauri::command]
pub async fn get_settings(state: State<'_, SharedState>) -> CommandResult<AppSettings> {
    command_result("get_settings", get_settings_impl(&state.pool).await)
}

#[tauri::command]
pub async fn update_settings(
    state: State<'_, SharedState>,
    settings: AppSettings,
) -> CommandResult<AppSettings> {
    command_result(
        "update_settings",
        update_settings_impl(&state.pool, &state.log_state, settings).await,
    )
}

#[tauri::command]
pub async fn export_data(state: State<'_, SharedState>) -> CommandResult<BackupPayload> {
    command_result("export_data", import_export::export_data(&state.pool).await)
}

#[tauri::command]
pub async fn write_export_file(path: String, contents: String) -> CommandResult<()> {
    command_result(
        "write_export_file",
        write_export_file_impl(&path, &contents).await,
    )
}

#[tauri::command]
pub async fn import_data(
    state: State<'_, SharedState>,
    payload: BackupPayload,
) -> CommandResult<BackupPayload> {
    command_result(
        "import_data",
        import_data_impl(&state.pool, &state.log_state, payload).await,
    )
}

#[tauri::command]
pub async fn open_log_folder(app: AppHandle) -> CommandResult<()> {
    command_result("open_log_folder", open_log_folder_impl(&app).await)
}

#[tauri::command]
pub async fn clear_log_files(app: AppHandle) -> CommandResult<u32> {
    command_result("clear_log_files", clear_log_files_impl(&app).await)
}

async fn query_servers_impl(
    pool: &SqlitePool,
    upstream_config: &Arc<OnceCell<UpstreamApiConfig>>,
    upstream_client_cache: &UpstreamClientCache,
    params: ServerQueryParams,
) -> AppResult<ServerQueryResult> {
    let settings = settings_store::get_settings(pool).await?;
    log::debug!(
        "query_servers requested: page={}, page_size={}, query='{}', addresses={}",
        params.page,
        params.page_size,
        params.filters.query,
        params.addresses.as_ref().map_or(0, Vec::len)
    );
    let upstream_config = upstream_config_for_request(pool, upstream_config).await;
    let client = upstream_client_cache
        .get_or_create(
            Duration::from_millis(settings.query_timeout_ms),
            upstream_config,
            &settings.http_proxy,
        )
        .await?;

    query_servers_with_client(params, &client).await
}

async fn query_servers_with_client(
    mut params: ServerQueryParams,
    client: &dyn UpstreamServerClient,
) -> AppResult<ServerQueryResult> {
    normalize_query_addresses(&mut params)?;
    let mut result = client.query_servers(&params).await?;
    sort_query_result_items(&mut result, &params.sort);
    Ok(result)
}

fn normalize_query_addresses(params: &mut ServerQueryParams) -> AppResult<()> {
    let Some(addresses) = &params.addresses else {
        return Ok(());
    };

    if addresses.is_empty() {
        params.addresses = None;
        return Ok(());
    }

    let mut normalized = Vec::with_capacity(addresses.len());
    for address in addresses {
        let parsed = steam_launcher::parse_server_address(address)?;
        let address = parsed.as_string();
        if !normalized.contains(&address) {
            normalized.push(address);
        }
    }

    params.addresses = if normalized.is_empty() {
        None
    } else {
        Some(normalized)
    };

    Ok(())
}

fn sort_query_result_items(result: &mut ServerQueryResult, sort: &crate::models::ServerSort) {
    match sort {
        crate::models::ServerSort::None => {}
        crate::models::ServerSort::PlayersDesc => {
            result.items.sort_by_key(|item| Reverse(item.players));
        }
        crate::models::ServerSort::PlayersAsc => {
            result.items.sort_by_key(|item| item.players);
        }
    }
}

async fn get_server_details_impl(
    pool: &SqlitePool,
    upstream_config: &Arc<OnceCell<UpstreamApiConfig>>,
    upstream_client_cache: &UpstreamClientCache,
    address: &str,
    server_id: Option<&str>,
    fallback_name: Option<&str>,
) -> AppResult<ServerDetails> {
    let settings = settings_store::get_settings(pool).await?;
    let upstream_config = upstream_config_for_request(pool, upstream_config).await;
    let client = upstream_client_cache
        .get_or_create(
            Duration::from_millis(settings.query_timeout_ms),
            upstream_config,
            &settings.http_proxy,
        )
        .await?;

    get_server_details_with_client(address, server_id, &client, fallback_name).await
}

async fn upstream_config_for_request(
    pool: &SqlitePool,
    upstream_config: &Arc<OnceCell<UpstreamApiConfig>>,
) -> UpstreamApiConfig {
    upstream_config
        .get_or_init(|| async { crate::load_startup_upstream_config(pool).await })
        .await
        .clone()
}

async fn get_server_details_with_client(
    address: &str,
    _server_id: Option<&str>,
    client: &dyn UpstreamServerClient,
    fallback_name: Option<&str>,
) -> AppResult<ServerDetails> {
    let normalized_address = normalize_server_address(address)?;
    let resolved_server_id =
        resolve_server_id_for_address_with_client(client, &normalized_address).await?;

    log::debug!(
        "resolved old server id {} to server id '{}' for address '{}'",
        _server_id.unwrap_or("unknown"),
        resolved_server_id,
        normalized_address
    );

    client
        .get_server_details(
            &resolved_server_id,
            Some(&normalized_address),
            fallback_name,
        )
        .await
}

fn normalize_server_address(address: &str) -> AppResult<String> {
    Ok(steam_launcher::parse_server_address(address)?.as_string())
}

async fn resolve_server_id_for_address_with_client(
    client: &dyn UpstreamServerClient,
    normalized_address: &str,
) -> AppResult<String> {
    let result = query_servers_with_client(
        ServerQueryParams {
            page: 1,
            page_size: 1,
            filters: ServerFilters::default(),
            sort: ServerSort::None,
            addresses: Some(vec![normalized_address.to_string()]),
        },
        client,
    )
    .await?;

    let snapshot = result
        .items
        .into_iter()
        .find(|snapshot| snapshot.address == normalized_address)
        .ok_or_else(|| {
            crate::errors::AppError::UpstreamUnavailable(format!(
                "upstream did not return server metadata for address '{}'",
                normalized_address
            ))
        })?;

    snapshot
        .server_id
        .as_deref()
        .map(str::trim)
        .filter(|server_id| !server_id.is_empty())
        .map(str::to_string)
        .ok_or_else(|| {
            crate::errors::AppError::UpstreamUnavailable(format!(
                "upstream did not return a server id for address '{}'",
                normalized_address
            ))
        })
}

async fn connect_to_server_impl(
    pool: &SqlitePool,
    address: &str,
    history_snapshot: Option<&ServerSnapshot>,
) -> AppResult<()> {
    connect_to_server_with_launcher(pool, address, history_snapshot, steam_launcher::launch).await
}

async fn list_favorites_impl(pool: &SqlitePool) -> AppResult<Vec<Favorite>> {
    favorites_store::list_favorites(pool).await
}

async fn add_favorite_impl(pool: &SqlitePool, input: FavoriteInput) -> AppResult<Favorite> {
    favorites_store::add_favorite(pool, input).await
}

async fn update_favorite_impl(
    pool: &SqlitePool,
    id: String,
    input: FavoriteInput,
) -> AppResult<Favorite> {
    favorites_store::update_favorite(pool, id, input).await
}

async fn update_favorite_snapshot_impl(
    pool: &SqlitePool,
    id: String,
    snapshot: &ServerSnapshot,
) -> AppResult<Favorite> {
    favorites_store::update_favorite_snapshot(pool, id, snapshot).await
}

async fn delete_favorite_impl(pool: &SqlitePool, id: String) -> AppResult<()> {
    favorites_store::delete_favorite(pool, id).await
}

async fn connect_to_server_with_launcher(
    pool: &SqlitePool,
    address: &str,
    history_snapshot: Option<&ServerSnapshot>,
    launcher: impl FnOnce(&str) -> AppResult<()>,
) -> AppResult<()> {
    let normalized_address = normalize_server_address(address)?;
    log::info!("launching server connection for '{}'", normalized_address);
    launcher(&normalized_address)?;

    if let Some(snapshot) = history_snapshot {
        history_store::add_history(pool, snapshot).await?;
    }

    Ok(())
}

async fn get_settings_impl(pool: &SqlitePool) -> AppResult<AppSettings> {
    settings_store::get_settings(pool).await
}

async fn update_settings_impl(
    pool: &SqlitePool,
    log_state: &crate::logging::LogState,
    settings: AppSettings,
) -> AppResult<AppSettings> {
    let saved = settings_store::save_settings(pool, &settings).await?;
    log_state.apply_settings(&saved.logging);
    log::info!(
        "updated logging settings: enabled={}, level={:?}",
        saved.logging.enabled,
        saved.logging.level
    );
    Ok(saved)
}

async fn import_data_impl(
    pool: &SqlitePool,
    log_state: &crate::logging::LogState,
    payload: BackupPayload,
) -> AppResult<BackupPayload> {
    let imported = import_export::import_data(pool, payload).await?;
    log_state.apply_settings(&imported.settings.logging);
    log::info!(
        "applied imported logging settings: enabled={}, level={:?}",
        imported.settings.logging.enabled,
        imported.settings.logging.level
    );
    Ok(imported)
}

async fn write_export_file_impl(path: &str, contents: &str) -> AppResult<()> {
    let path = Path::new(path);
    if path.as_os_str().is_empty() {
        return Err(crate::errors::AppError::ExportFailed(
            "export path is empty".to_string(),
        ));
    }

    tokio::fs::write(path, contents)
        .await
        .map_err(|err| crate::errors::AppError::ExportFailed(err.to_string()))
}

async fn open_log_folder_impl(app: &AppHandle) -> AppResult<()> {
    let log_dir = crate::app_log_dir_path(app)
        .map_err(|err| crate::errors::AppError::LogOperationFailed(err.to_string()))?;
    tokio::fs::create_dir_all(&log_dir)
        .await
        .map_err(|err| crate::errors::AppError::LogOperationFailed(err.to_string()))?;

    app.opener()
        .open_path(log_dir.to_string_lossy().into_owned(), None::<&str>)
        .map_err(|err| crate::errors::AppError::LogOperationFailed(err.to_string()))
}

async fn clear_log_files_impl(app: &AppHandle) -> AppResult<u32> {
    let log_dir = crate::app_log_dir_path(app)
        .map_err(|err| crate::errors::AppError::LogOperationFailed(err.to_string()))?;
    let cleared = clear_log_files_in_dir(&log_dir).await?;
    log::info!("cleared {cleared} log file(s)");
    Ok(cleared)
}

async fn clear_log_files_in_dir(log_dir: &Path) -> AppResult<u32> {
    tokio::fs::create_dir_all(log_dir)
        .await
        .map_err(|err| crate::errors::AppError::LogOperationFailed(err.to_string()))?;

    let mut entries = tokio::fs::read_dir(log_dir)
        .await
        .map_err(|err| crate::errors::AppError::LogOperationFailed(err.to_string()))?;
    let mut cleared = 0;

    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|err| crate::errors::AppError::LogOperationFailed(err.to_string()))?
    {
        let path = entry.path();
        let file_type = entry
            .file_type()
            .await
            .map_err(|err| crate::errors::AppError::LogOperationFailed(err.to_string()))?;
        if !file_type.is_file() || !is_app_log_file(&path) {
            continue;
        }

        if is_active_log_file(&path) {
            truncate_log_file(&path).await?;
        } else {
            tokio::fs::remove_file(&path)
                .await
                .map_err(|err| crate::errors::AppError::LogOperationFailed(err.to_string()))?;
        }

        cleared += 1;
    }

    Ok(cleared)
}

async fn truncate_log_file(path: &Path) -> AppResult<()> {
    tokio::fs::OpenOptions::new()
        .write(true)
        .truncate(true)
        .open(path)
        .await
        .map(|_| ())
        .map_err(|err| crate::errors::AppError::LogOperationFailed(err.to_string()))
}

fn is_app_log_file(path: &Path) -> bool {
    let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
        return false;
    };

    file_name.starts_with(crate::LOG_FILE_NAME)
        && (file_name.ends_with(".log") || file_name.ends_with(".log.bak"))
}

fn is_active_log_file(path: &Path) -> bool {
    path.file_name().and_then(|name| name.to_str())
        == Some(&format!("{}.log", crate::LOG_FILE_NAME))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::errors::AppError;
    use crate::logging::LogState;
    use crate::models::ServerSnapshotInput;
    use crate::models::{
        LanguagePreference, LogLevel, ServerFilters, ServerPlayer, ServerSort, ThemePreference,
    };
    use async_trait::async_trait;
    use chrono::{Duration as ChronoDuration, TimeZone, Utc};
    use sqlx::SqlitePool;
    use std::collections::HashMap;
    use std::sync::Mutex;

    async fn memory_pool() -> SqlitePool {
        crate::create_pool("sqlite::memory:").await.unwrap()
    }

    #[tokio::test]
    async fn query_servers_command_path_returns_upstream_page() {
        let params = ServerQueryParams {
            page: 2,
            page_size: 25,
            filters: ServerFilters::default(),
            sort: ServerSort::PlayersDesc,
            addresses: None,
        };
        let client =
            FakeUpstreamClient::with_single_detail(sample_query_result(), sample_details());

        let result = query_servers_with_client(params, &client).await.unwrap();

        assert_eq!(result.page, 1);
        assert_eq!(result.page_size, 50);
        assert_eq!(result.total, 247);
        assert_eq!(result.items[0].server_id.as_deref(), Some("server854"));
    }

    #[tokio::test]
    async fn query_servers_resorts_page_items_by_players_desc() {
        let params = ServerQueryParams {
            page: 1,
            page_size: 50,
            filters: ServerFilters::default(),
            sort: ServerSort::PlayersDesc,
            addresses: None,
        };
        let client = FakeUpstreamClient::with_single_detail(
            sample_unsorted_query_result(),
            sample_details(),
        );

        let result = query_servers_with_client(params, &client).await.unwrap();

        assert_eq!(
            result
                .items
                .iter()
                .map(|item| item.players)
                .collect::<Vec<_>>(),
            vec![9, 4, 1]
        );
    }

    #[tokio::test]
    async fn query_servers_resorts_page_items_by_players_asc() {
        let params = ServerQueryParams {
            page: 1,
            page_size: 50,
            filters: ServerFilters::default(),
            sort: ServerSort::PlayersAsc,
            addresses: None,
        };
        let client = FakeUpstreamClient::with_single_detail(
            sample_unsorted_query_result(),
            sample_details(),
        );

        let result = query_servers_with_client(params, &client).await.unwrap();

        assert_eq!(
            result
                .items
                .iter()
                .map(|item| item.players)
                .collect::<Vec<_>>(),
            vec![1, 4, 9]
        );
    }

    #[tokio::test]
    async fn query_servers_rejects_invalid_address_filters() {
        let params = ServerQueryParams {
            page: 1,
            page_size: 50,
            filters: ServerFilters::default(),
            sort: ServerSort::None,
            addresses: Some(vec!["https://1.2.3.4:27015".to_string()]),
        };
        let client =
            FakeUpstreamClient::with_single_detail(sample_query_result(), sample_details());

        let error = query_servers_with_client(params, &client)
            .await
            .expect_err("invalid address filters should fail before upstream query");

        assert!(matches!(error, AppError::InvalidAddress(_)));
    }

    #[tokio::test]
    async fn get_server_details_returns_snapshot_and_players() {
        let client =
            FakeUpstreamClient::with_single_detail(sample_query_result(), sample_details());

        let result =
            get_server_details_with_client("103.28.54.212:27035", Some("server854"), &client, None)
                .await
                .unwrap();

        assert_eq!(result.snapshot.server_id.as_deref(), Some("server854"));
        assert_eq!(result.players.len(), 1);
        assert_eq!(result.players[0].name, "Alice");
    }

    #[tokio::test]
    async fn get_server_details_resolves_authoritative_server_id_from_address() {
        let client = FakeUpstreamClient::with_single_detail(
            sample_query_result_with_server_id("2.2.2.2:9999", "server2"),
            sample_details_with_server_id("2.2.2.2:9999", "server2"),
        );

        let result = get_server_details_with_client(
            "2.2.2.2:9999",
            Some("server1"),
            &client,
            Some("Renamed server"),
        )
        .await
        .unwrap();

        let query_calls = client.take_query_calls();
        assert_eq!(query_calls.len(), 1);
        assert_eq!(query_calls[0].page, 1);
        assert_eq!(query_calls[0].page_size, 1);
        assert_eq!(query_calls[0].sort, ServerSort::None);
        assert_eq!(query_calls[0].filters, ServerFilters::default());
        assert_eq!(
            query_calls[0].addresses.as_ref(),
            Some(&vec!["2.2.2.2:9999".to_string()])
        );

        let detail_calls = client.take_detail_calls();
        assert_eq!(detail_calls.len(), 1);
        assert_eq!(detail_calls[0].server_id, "server2");
        assert_eq!(
            detail_calls[0].fallback_address.as_deref(),
            Some("2.2.2.2:9999")
        );
        assert_eq!(
            detail_calls[0].fallback_name.as_deref(),
            Some("Renamed server")
        );
        assert_eq!(result.snapshot.server_id.as_deref(), Some("server2"));
    }

    #[tokio::test]
    async fn get_server_details_errors_when_address_lookup_returns_no_match() {
        let client = FakeUpstreamClient::with_single_detail(
            ServerQueryResult {
                items: Vec::new(),
                page: 1,
                page_size: 1,
                total: 0,
                refreshed_at: None,
            },
            sample_details(),
        );

        let error =
            get_server_details_with_client("103.28.54.212:27035", Some("server854"), &client, None)
                .await
                .expect_err("missing address lookup should fail");

        assert!(matches!(error, AppError::UpstreamUnavailable(_)));
        assert!(client.take_detail_calls().is_empty());
    }

    #[tokio::test]
    async fn get_server_details_succeeds_without_cached_server_id() {
        let client =
            FakeUpstreamClient::with_single_detail(sample_query_result(), sample_details());

        let result = get_server_details_with_client("103.28.54.212:27035", None, &client, None)
            .await
            .unwrap();

        assert_eq!(result.snapshot.server_id.as_deref(), Some("server854"));
        let detail_calls = client.take_detail_calls();
        assert_eq!(detail_calls.len(), 1);
        assert_eq!(detail_calls[0].server_id, "server854");
    }

    #[tokio::test]
    async fn get_server_details_rejects_invalid_address_before_upstream_queries() {
        let client =
            FakeUpstreamClient::with_single_detail(sample_query_result(), sample_details());

        let error = get_server_details_with_client("https://1.2.3.4:27015", None, &client, None)
            .await
            .expect_err("invalid address should fail before upstream query");

        assert!(matches!(error, AppError::InvalidAddress(_)));
        assert!(client.take_query_calls().is_empty());
        assert!(client.take_detail_calls().is_empty());
    }

    #[tokio::test]
    async fn settings_command_wrapper_path_round_trips_store_value() {
        let pool = memory_pool().await;
        let mut settings = get_settings_impl(&pool).await.unwrap();
        settings.theme = ThemePreference::Dark;
        settings.language = LanguagePreference::ZhCn;
        settings.server_browser.page_size = 24;

        let log_state = LogState::default();
        let saved = update_settings_impl(&pool, &log_state, settings)
            .await
            .unwrap();
        let loaded = get_settings_impl(&pool).await.unwrap();

        assert_eq!(saved.server_browser.page_size, 24);
        assert!(matches!(loaded.theme, ThemePreference::Dark));
        assert!(matches!(loaded.language, LanguagePreference::ZhCn));
        assert_eq!(loaded.server_browser.page_size, 24);
    }

    #[tokio::test]
    async fn update_settings_command_applies_logging_state() {
        let pool = memory_pool().await;
        let log_state = LogState::default();
        let mut settings = get_settings_impl(&pool).await.unwrap();
        settings.logging.enabled = true;
        settings.logging.level = LogLevel::Debug;

        update_settings_impl(&pool, &log_state, settings)
            .await
            .unwrap();

        assert!(log_state.enabled());
        assert!(matches!(log_state.level(), LogLevel::Debug));
    }

    #[tokio::test]
    async fn import_data_command_applies_imported_logging_state() {
        let pool = memory_pool().await;
        let log_state = LogState::default();
        let mut settings = AppSettings::default();
        settings.logging.enabled = true;
        settings.logging.level = LogLevel::Trace;

        import_data_impl(
            &pool,
            &log_state,
            BackupPayload {
                version: 1,
                settings,
                groups: vec![FavoriteGroup {
                    id: "default".to_string(),
                    name: "Default".to_string(),
                    created_at: Utc::now(),
                    updated_at: Utc::now(),
                }],
                favorites: Vec::new(),
                history: Vec::new(),
            },
        )
        .await
        .unwrap();

        assert!(log_state.enabled());
        assert!(matches!(log_state.level(), LogLevel::Trace));
    }

    #[tokio::test]
    async fn write_export_file_command_writes_contents_to_selected_path() {
        let temp_dir =
            std::env::temp_dir().join(format!("l4d2-server-hub-export-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let path = temp_dir.join("backup.json");

        write_export_file_impl(path.to_str().unwrap(), r#"{"version":1}"#)
            .await
            .unwrap();

        let contents = std::fs::read_to_string(&path).unwrap();
        assert_eq!(contents, r#"{"version":1}"#);

        std::fs::remove_dir_all(temp_dir).unwrap();
    }

    #[tokio::test]
    async fn clear_log_files_truncates_active_log_and_removes_rotated_logs() {
        let temp_dir =
            std::env::temp_dir().join(format!("l4d2-server-hub-logs-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let current_log = temp_dir.join("l4d2-server-hub.log");
        let rotated_log = temp_dir.join("l4d2-server-hub_2026-05-25.log");
        let unrelated_log = temp_dir.join("other.log");
        let nested_dir = temp_dir.join("l4d2-server-hub_nested.log");
        std::fs::write(&current_log, "current").unwrap();
        std::fs::write(&rotated_log, "rotated").unwrap();
        std::fs::write(&unrelated_log, "other").unwrap();
        std::fs::create_dir_all(&nested_dir).unwrap();

        let cleared = clear_log_files_in_dir(&temp_dir).await.unwrap();

        assert_eq!(cleared, 2);
        assert!(current_log.exists());
        assert_eq!(std::fs::read_to_string(&current_log).unwrap(), "");
        assert!(!rotated_log.exists());
        assert!(unrelated_log.exists());
        assert!(nested_dir.exists());

        std::fs::remove_dir_all(temp_dir).unwrap();
    }

    #[tokio::test]
    async fn favorite_command_wrapper_path_creates_lists_updates_and_deletes() {
        let pool = memory_pool().await;
        let input = FavoriteInput {
            address: "10.0.0.1:27015".to_string(),
            server_id: Some("server10".to_string()),
            group_id: "default".to_string(),
            custom_name: Some("Alpha shortcut".to_string()),
            notes: "Original notes".to_string(),
            tags: vec!["coop".to_string()],
        };

        let favorite = add_favorite_impl(&pool, input.clone()).await.unwrap();
        let favorites = list_favorites_impl(&pool).await.unwrap();

        assert_eq!(favorite.address, input.address);
        assert_eq!(favorites.len(), 1);
        assert_eq!(favorites[0].id, favorite.id);

        let updated_input = FavoriteInput {
            custom_name: Some("Updated Alpha".to_string()),
            notes: "Updated notes".to_string(),
            tags: vec!["coop".to_string(), "friends".to_string()],
            ..input
        };
        let updated = update_favorite_impl(&pool, favorite.id.clone(), updated_input)
            .await
            .unwrap();

        assert_eq!(updated.custom_name.as_deref(), Some("Updated Alpha"));
        assert_eq!(updated.notes, "Updated notes");
        assert_eq!(
            updated.tags,
            vec!["coop".to_string(), "friends".to_string()]
        );
        assert_eq!(updated.server_id.as_deref(), Some("server10"));

        let snapshot = sample_details().snapshot;
        let refreshed = update_favorite_snapshot_impl(&pool, favorite.id.clone(), &snapshot)
            .await
            .unwrap();
        assert_eq!(refreshed.server_id.as_deref(), Some("server854"));
        assert_eq!(
            refreshed
                .last_snapshot
                .as_ref()
                .map(|snapshot| snapshot.address.as_str()),
            Some("103.28.54.212:27035")
        );

        delete_favorite_impl(&pool, favorite.id).await.unwrap();
        let favorites = list_favorites_impl(&pool).await.unwrap();

        assert!(favorites.is_empty());
    }

    #[tokio::test]
    async fn update_favorite_snapshot_command_errors_for_missing_favorite() {
        let pool = memory_pool().await;
        let snapshot = sample_details().snapshot;

        let error = update_favorite_snapshot_impl(&pool, "missing".to_string(), &snapshot)
            .await
            .expect_err("missing favorite should fail");

        assert!(matches!(error, AppError::Unexpected(_)));
    }

    #[tokio::test]
    async fn connect_to_server_writes_history_when_snapshot_is_supplied() {
        let pool = memory_pool().await;
        let snapshot = sample_snapshot("10.0.0.1:27015", "Alpha Safe Room");

        connect_to_server_with_launcher(&pool, &snapshot.address, Some(&snapshot), |_| Ok(()))
            .await
            .unwrap();
        let history = history_store::list_history(&pool).await.unwrap();

        assert_eq!(history.len(), 1);
        assert_eq!(history[0].address, snapshot.address);
        assert_eq!(history[0].server_name, snapshot.name);
    }

    #[tokio::test]
    async fn connect_to_server_skips_history_when_snapshot_is_absent() {
        let pool = memory_pool().await;

        connect_to_server_with_launcher(&pool, "10.0.0.1:27015", None, |_| Ok(()))
            .await
            .unwrap();
        let history = history_store::list_history(&pool).await.unwrap();

        assert!(history.is_empty());
    }

    #[tokio::test]
    async fn connect_to_server_does_not_write_history_when_launcher_fails() {
        let pool = memory_pool().await;
        let snapshot = sample_snapshot("10.0.0.1:27015", "Alpha Safe Room");

        let result =
            connect_to_server_with_launcher(&pool, &snapshot.address, Some(&snapshot), |_| {
                Err(AppError::LaunchFailed("launcher unavailable".to_string()))
            })
            .await;
        let history = history_store::list_history(&pool).await.unwrap();

        assert!(matches!(result, Err(AppError::LaunchFailed(_))));
        assert!(history.is_empty());
    }

    #[derive(Debug, Clone, PartialEq, Eq)]
    struct DetailCall {
        server_id: String,
        fallback_address: Option<String>,
        fallback_name: Option<String>,
    }

    struct FakeUpstreamClient {
        query_result: ServerQueryResult,
        details_by_server_id: HashMap<String, ServerDetails>,
        query_calls: Mutex<Vec<ServerQueryParams>>,
        detail_calls: Mutex<Vec<DetailCall>>,
    }

    impl FakeUpstreamClient {
        fn with_single_detail(query_result: ServerQueryResult, details: ServerDetails) -> Self {
            let detail_server_id = details
                .snapshot
                .server_id
                .clone()
                .expect("test details should include a server id");
            let mut details_by_server_id = HashMap::new();
            details_by_server_id.insert(detail_server_id, details);

            Self {
                query_result,
                details_by_server_id,
                query_calls: Mutex::new(Vec::new()),
                detail_calls: Mutex::new(Vec::new()),
            }
        }

        fn take_query_calls(&self) -> Vec<ServerQueryParams> {
            self.query_calls.lock().unwrap().clone()
        }

        fn take_detail_calls(&self) -> Vec<DetailCall> {
            self.detail_calls.lock().unwrap().clone()
        }
    }

    #[async_trait]
    impl UpstreamServerClient for FakeUpstreamClient {
        async fn query_servers(&self, params: &ServerQueryParams) -> AppResult<ServerQueryResult> {
            self.query_calls.lock().unwrap().push(params.clone());
            Ok(self.query_result.clone())
        }

        async fn get_server_details(
            &self,
            server_id: &str,
            fallback_address: Option<&str>,
            fallback_name: Option<&str>,
        ) -> AppResult<ServerDetails> {
            self.detail_calls.lock().unwrap().push(DetailCall {
                server_id: server_id.to_string(),
                fallback_address: fallback_address.map(str::to_string),
                fallback_name: fallback_name.map(str::to_string),
            });

            self.details_by_server_id
                .get(server_id)
                .cloned()
                .ok_or_else(|| {
                    AppError::Unexpected(format!("unexpected detail request '{}'", server_id))
                })
        }
    }

    fn sample_query_result() -> ServerQueryResult {
        sample_query_result_with_server_id("103.28.54.212:27035", "server854")
    }

    fn sample_query_result_with_server_id(address: &str, server_id: &str) -> ServerQueryResult {
        ServerQueryResult {
            items: vec![sample_snapshot_with_server_id(
                address,
                "Valve Left4Dead 2 Hong Kong Server",
                server_id,
            )],
            page: 1,
            page_size: 50,
            total: 247,
            refreshed_at: Some(
                Utc.with_ymd_and_hms(2026, 5, 24, 8, 0, 0)
                    .single()
                    .expect("test timestamp should be valid"),
            ),
        }
    }

    fn sample_unsorted_query_result() -> ServerQueryResult {
        ServerQueryResult {
            items: vec![
                sample_snapshot_with_players("10.0.0.1:27015", "Middle", 4),
                sample_snapshot_with_players("10.0.0.2:27015", "Low", 1),
                sample_snapshot_with_players("10.0.0.3:27015", "High", 9),
            ],
            page: 1,
            page_size: 50,
            total: 3,
            refreshed_at: Some(
                Utc.with_ymd_and_hms(2026, 5, 24, 8, 0, 0)
                    .single()
                    .expect("test timestamp should be valid"),
            ),
        }
    }

    fn sample_details() -> ServerDetails {
        sample_details_with_server_id("103.28.54.212:27035", "server854")
    }

    fn sample_details_with_server_id(address: &str, server_id: &str) -> ServerDetails {
        ServerDetails {
            snapshot: sample_snapshot_with_server_id(
                address,
                "Valve Left4Dead 2 Hong Kong Server",
                server_id,
            ),
            players: vec![ServerPlayer {
                name: "Alice".to_string(),
                score: 15,
                duration_sec: 1524.47,
                duration_formatted: "25分钟".to_string(),
            }],
        }
    }

    fn sample_snapshot(address: &str, name: &str) -> ServerSnapshot {
        sample_snapshot_with_server_id(address, name, "server854")
    }

    fn sample_snapshot_with_server_id(
        address: &str,
        name: &str,
        server_id: &str,
    ) -> ServerSnapshot {
        sample_snapshot_with_players_and_server_id(address, name, 3, server_id)
    }

    fn sample_snapshot_with_players(address: &str, name: &str, players: u32) -> ServerSnapshot {
        sample_snapshot_with_players_and_server_id(address, name, players, "server854")
    }

    fn sample_snapshot_with_players_and_server_id(
        address: &str,
        name: &str,
        players: u32,
        server_id: &str,
    ) -> ServerSnapshot {
        let (ip, port) = address
            .split_once(':')
            .expect("test address should include port");
        let last_seen_at = Utc
            .with_ymd_and_hms(2026, 5, 23, 8, 0, 0)
            .single()
            .expect("test timestamp should be valid")
            + ChronoDuration::minutes(5);

        ServerSnapshot::try_new(ServerSnapshotInput {
            server_id: Some(server_id.to_string()),
            address: address.to_string(),
            ip: ip.to_string(),
            port: port.parse().expect("test port should be valid"),
            name: name.to_string(),
            map: "c12m4_barn".to_string(),
            mode_tags: vec!["coop".to_string(), "secure".to_string()],
            game_description: Some("Left 4 Dead 2".to_string()),
            server_type: Some("Dedicated".to_string()),
            environment: Some("Linux".to_string()),
            version: Some("2.2.4.3".to_string()),
            players,
            max_players: 16,
            bots: 0,
            ping_ms: Some(793),
            vac_secured: true,
            last_seen_at,
            last_query_error: None,
        })
        .expect("test snapshot should be valid")
    }
}
