use crate::errors::{AppResult, CommandResult};
use crate::import_export::BackupPayload;
use crate::models::{
    AppSettings, Favorite, FavoriteGroup, FavoriteInput, HistoryRecord, SearchHistoryRecord,
    ServerDetails, ServerQueryParams, ServerQueryResult, ServerSnapshot,
};
use crate::upstream_api::{HttpUpstreamServerClient, UpstreamApiConfig, UpstreamServerClient};
use crate::{favorites_store, history_store, import_export, search_history_store, settings_store};
use crate::{steam_launcher, SharedState};
use sqlx::SqlitePool;
use std::{path::Path, sync::Arc, time::Duration};
use tauri::State;
use tokio::sync::OnceCell;

fn command_result<T>(result: AppResult<T>) -> CommandResult<T> {
    result.map_err(Into::into)
}

#[tauri::command]
pub async fn query_servers(
    state: State<'_, SharedState>,
    params: ServerQueryParams,
) -> CommandResult<ServerQueryResult> {
    command_result(query_servers_impl(&state.pool, &state.upstream_config, params).await)
}

#[tauri::command]
pub async fn get_server_details(
    state: State<'_, SharedState>,
    server_id: String,
    fallback_address: Option<String>,
    fallback_name: Option<String>,
) -> CommandResult<ServerDetails> {
    command_result(
        get_server_details_impl(
            &state.pool,
            &state.upstream_config,
            &server_id,
            fallback_address.as_deref(),
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
    command_result(connect_to_server_impl(&state.pool, &address, history_snapshot.as_ref()).await)
}

#[tauri::command]
pub async fn list_favorites(state: State<'_, SharedState>) -> CommandResult<Vec<Favorite>> {
    command_result(list_favorites_impl(&state.pool).await)
}

#[tauri::command]
pub async fn add_favorite(
    state: State<'_, SharedState>,
    input: FavoriteInput,
) -> CommandResult<Favorite> {
    command_result(add_favorite_impl(&state.pool, input).await)
}

#[tauri::command]
pub async fn update_favorite(
    state: State<'_, SharedState>,
    id: String,
    input: FavoriteInput,
) -> CommandResult<Favorite> {
    command_result(update_favorite_impl(&state.pool, id, input).await)
}

#[tauri::command]
pub async fn update_favorite_snapshot(
    state: State<'_, SharedState>,
    id: String,
    snapshot: ServerSnapshot,
) -> CommandResult<Favorite> {
    command_result(update_favorite_snapshot_impl(&state.pool, id, &snapshot).await)
}

#[tauri::command]
pub async fn delete_favorite(state: State<'_, SharedState>, id: String) -> CommandResult<()> {
    command_result(delete_favorite_impl(&state.pool, id).await)
}

#[tauri::command]
pub async fn list_groups(state: State<'_, SharedState>) -> CommandResult<Vec<FavoriteGroup>> {
    command_result(favorites_store::list_groups(&state.pool).await)
}

#[tauri::command]
pub async fn create_group(
    state: State<'_, SharedState>,
    name: String,
) -> CommandResult<FavoriteGroup> {
    command_result(favorites_store::create_group(&state.pool, name).await)
}

#[tauri::command]
pub async fn update_group(
    state: State<'_, SharedState>,
    id: String,
    name: String,
) -> CommandResult<FavoriteGroup> {
    command_result(favorites_store::update_group(&state.pool, id, name).await)
}

#[tauri::command]
pub async fn delete_group(state: State<'_, SharedState>, id: String) -> CommandResult<()> {
    command_result(favorites_store::delete_group(&state.pool, id).await)
}

#[tauri::command]
pub async fn list_history(state: State<'_, SharedState>) -> CommandResult<Vec<HistoryRecord>> {
    command_result(history_store::list_history(&state.pool).await)
}

#[tauri::command]
pub async fn update_history_snapshot(
    state: State<'_, SharedState>,
    id: String,
    snapshot: ServerSnapshot,
) -> CommandResult<HistoryRecord> {
    command_result(history_store::update_history_snapshot(&state.pool, id, &snapshot).await)
}

#[tauri::command]
pub async fn delete_history(state: State<'_, SharedState>, id: String) -> CommandResult<()> {
    command_result(history_store::delete_history(&state.pool, id).await)
}

#[tauri::command]
pub async fn clear_history(state: State<'_, SharedState>) -> CommandResult<()> {
    command_result(history_store::clear_history(&state.pool).await)
}

#[tauri::command]
pub async fn list_search_history(
    state: State<'_, SharedState>,
) -> CommandResult<Vec<SearchHistoryRecord>> {
    command_result(search_history_store::list_search_history(&state.pool).await)
}

#[tauri::command]
pub async fn add_search_history(
    state: State<'_, SharedState>,
    query: String,
) -> CommandResult<Vec<SearchHistoryRecord>> {
    command_result(search_history_store::add_search_history(&state.pool, query).await)
}

#[tauri::command]
pub async fn delete_search_history(state: State<'_, SharedState>, id: String) -> CommandResult<()> {
    command_result(search_history_store::delete_search_history(&state.pool, id).await)
}

#[tauri::command]
pub async fn get_settings(state: State<'_, SharedState>) -> CommandResult<AppSettings> {
    command_result(get_settings_impl(&state.pool).await)
}

#[tauri::command]
pub async fn update_settings(
    state: State<'_, SharedState>,
    settings: AppSettings,
) -> CommandResult<AppSettings> {
    command_result(update_settings_impl(&state.pool, settings).await)
}

#[tauri::command]
pub async fn export_data(state: State<'_, SharedState>) -> CommandResult<BackupPayload> {
    command_result(import_export::export_data(&state.pool).await)
}

#[tauri::command]
pub async fn write_export_file(path: String, contents: String) -> CommandResult<()> {
    command_result(write_export_file_impl(&path, &contents).await)
}

#[tauri::command]
pub async fn import_data(
    state: State<'_, SharedState>,
    payload: BackupPayload,
) -> CommandResult<BackupPayload> {
    command_result(import_export::import_data(&state.pool, payload).await)
}

async fn query_servers_impl(
    pool: &SqlitePool,
    upstream_config: &Arc<OnceCell<UpstreamApiConfig>>,
    params: ServerQueryParams,
) -> AppResult<ServerQueryResult> {
    let settings = settings_store::get_settings(pool).await?;
    let upstream_config = upstream_config_for_request(pool, upstream_config).await;
    let client = HttpUpstreamServerClient::with_config_and_proxy(
        Duration::from_millis(settings.query_timeout_ms),
        upstream_config,
        &settings.http_proxy,
    )?;

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
            result
                .items
                .sort_by(|left, right| right.players.cmp(&left.players));
        }
        crate::models::ServerSort::PlayersAsc => {
            result
                .items
                .sort_by(|left, right| left.players.cmp(&right.players));
        }
    }
}

async fn get_server_details_impl(
    pool: &SqlitePool,
    upstream_config: &Arc<OnceCell<UpstreamApiConfig>>,
    server_id: &str,
    fallback_address: Option<&str>,
    fallback_name: Option<&str>,
) -> AppResult<ServerDetails> {
    let settings = settings_store::get_settings(pool).await?;
    let upstream_config = upstream_config_for_request(pool, upstream_config).await;
    let client = HttpUpstreamServerClient::with_config_and_proxy(
        Duration::from_millis(settings.query_timeout_ms),
        upstream_config,
        &settings.http_proxy,
    )?;

    get_server_details_with_client(server_id, &client, fallback_address, fallback_name).await
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
    server_id: &str,
    client: &dyn UpstreamServerClient,
    fallback_address: Option<&str>,
    fallback_name: Option<&str>,
) -> AppResult<ServerDetails> {
    client
        .get_server_details(server_id, fallback_address, fallback_name)
        .await
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
    launcher(address)?;

    if let Some(snapshot) = history_snapshot {
        history_store::add_history(pool, snapshot).await?;
    }

    Ok(())
}

async fn get_settings_impl(pool: &SqlitePool) -> AppResult<AppSettings> {
    settings_store::get_settings(pool).await
}

async fn update_settings_impl(pool: &SqlitePool, settings: AppSettings) -> AppResult<AppSettings> {
    settings_store::save_settings(pool, &settings).await
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::errors::AppError;
    use crate::models::ServerSnapshotInput;
    use crate::models::{
        LanguagePreference, ServerFilters, ServerPlayer, ServerSort, ThemePreference,
    };
    use async_trait::async_trait;
    use chrono::{Duration as ChronoDuration, TimeZone, Utc};
    use sqlx::SqlitePool;

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
        let client = FakeUpstreamClient {
            query_result: sample_query_result(),
            details: sample_details(),
        };

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
        let client = FakeUpstreamClient {
            query_result: sample_unsorted_query_result(),
            details: sample_details(),
        };

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
        let client = FakeUpstreamClient {
            query_result: sample_unsorted_query_result(),
            details: sample_details(),
        };

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
        let client = FakeUpstreamClient {
            query_result: sample_query_result(),
            details: sample_details(),
        };

        let error = query_servers_with_client(params, &client)
            .await
            .expect_err("invalid address filters should fail before upstream query");

        assert!(matches!(error, AppError::InvalidAddress(_)));
    }

    #[tokio::test]
    async fn get_server_details_returns_snapshot_and_players() {
        let client = FakeUpstreamClient {
            query_result: sample_query_result(),
            details: sample_details(),
        };

        let result = get_server_details_with_client("server854", &client, None, None)
            .await
            .unwrap();

        assert_eq!(result.snapshot.server_id.as_deref(), Some("server854"));
        assert_eq!(result.players.len(), 1);
        assert_eq!(result.players[0].name, "Alice");
    }

    #[tokio::test]
    async fn settings_command_wrapper_path_round_trips_store_value() {
        let pool = memory_pool().await;
        let mut settings = get_settings_impl(&pool).await.unwrap();
        settings.theme = ThemePreference::Dark;
        settings.language = LanguagePreference::ZhCn;
        settings.server_browser.page_size = 24;

        let saved = update_settings_impl(&pool, settings).await.unwrap();
        let loaded = get_settings_impl(&pool).await.unwrap();

        assert_eq!(saved.server_browser.page_size, 24);
        assert!(matches!(loaded.theme, ThemePreference::Dark));
        assert!(matches!(loaded.language, LanguagePreference::ZhCn));
        assert_eq!(loaded.server_browser.page_size, 24);
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

    struct FakeUpstreamClient {
        query_result: ServerQueryResult,
        details: ServerDetails,
    }

    #[async_trait]
    impl UpstreamServerClient for FakeUpstreamClient {
        async fn query_servers(&self, _params: &ServerQueryParams) -> AppResult<ServerQueryResult> {
            Ok(self.query_result.clone())
        }

        async fn get_server_details(
            &self,
            _server_id: &str,
            _fallback_address: Option<&str>,
            _fallback_name: Option<&str>,
        ) -> AppResult<ServerDetails> {
            Ok(self.details.clone())
        }
    }

    fn sample_query_result() -> ServerQueryResult {
        ServerQueryResult {
            items: vec![sample_snapshot(
                "103.28.54.212:27035",
                "Valve Left4Dead 2 Hong Kong Server",
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
        ServerDetails {
            snapshot: sample_snapshot("103.28.54.212:27035", "Valve Left4Dead 2 Hong Kong Server"),
            players: vec![ServerPlayer {
                name: "Alice".to_string(),
                score: 15,
                duration_sec: 1524.47,
                duration_formatted: "25分钟".to_string(),
            }],
        }
    }

    fn sample_snapshot(address: &str, name: &str) -> ServerSnapshot {
        sample_snapshot_with_players(address, name, 3)
    }

    fn sample_snapshot_with_players(address: &str, name: &str, players: u32) -> ServerSnapshot {
        let (ip, port) = address
            .split_once(':')
            .expect("test address should include port");
        let last_seen_at = Utc
            .with_ymd_and_hms(2026, 5, 23, 8, 0, 0)
            .single()
            .expect("test timestamp should be valid")
            + ChronoDuration::minutes(5);

        ServerSnapshot::try_new(ServerSnapshotInput {
            server_id: Some("server854".to_string()),
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
