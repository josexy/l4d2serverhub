use chrono::Utc;
use l4d2_server_hub_lib::errors::AppError;
use l4d2_server_hub_lib::import_export::{export_data, import_data, BackupPayload};
use l4d2_server_hub_lib::models::{
    AppSettings, Favorite, FavoriteGroup, FavoriteInput, HistoryRecord, HttpProxyMode, LogLevel,
    ServerSnapshot, ServerSnapshotInput,
};

async fn memory_pool() -> sqlx::SqlitePool {
    l4d2_server_hub_lib::create_pool("sqlite::memory:")
        .await
        .unwrap()
}

fn valid_snapshot() -> ServerSnapshot {
    ServerSnapshot::try_new(ServerSnapshotInput {
        server_id: Some("server-test".to_string()),
        address: "127.0.0.1:27015".to_string(),
        ip: "127.0.0.1".to_string(),
        port: 27015,
        name: "Test Server".to_string(),
        map: "c1m1_hotel".to_string(),
        mode_tags: vec!["coop".to_string()],
        game_description: Some("Left 4 Dead 2".to_string()),
        server_type: Some("Dedicated".to_string()),
        environment: Some("Linux".to_string()),
        version: Some("2.2.4.3".to_string()),
        players: 4,
        max_players: 8,
        bots: 0,
        ping_ms: Some(42),
        vac_secured: true,
        last_seen_at: Utc::now(),
        last_query_error: None,
    })
    .unwrap()
}

fn default_group() -> FavoriteGroup {
    let now = Utc::now();
    FavoriteGroup {
        id: "default".to_string(),
        name: "Default".to_string(),
        created_at: now,
        updated_at: now,
    }
}

fn favorite(id: &str, address: &str, group_id: &str) -> Favorite {
    let now = Utc::now();
    Favorite {
        id: id.to_string(),
        address: address.to_string(),
        server_id: Some("server-test".to_string()),
        group_id: group_id.to_string(),
        custom_name: Some("Imported favorite".to_string()),
        notes: "Imported notes".to_string(),
        tags: vec!["coop".to_string(), "friends".to_string()],
        created_at: now,
        updated_at: now,
        last_connected_at: Some(now),
        last_snapshot: Some(valid_snapshot()),
    }
}

fn history_record(id: &str) -> HistoryRecord {
    let snapshot = valid_snapshot();
    HistoryRecord {
        id: id.to_string(),
        address: snapshot.address.clone(),
        server_id: snapshot.server_id.clone(),
        server_name: snapshot.name.clone(),
        map: snapshot.map.clone(),
        players: snapshot.players,
        max_players: snapshot.max_players,
        connected_at: Utc::now(),
        connection_count: 1,
        last_snapshot: Some(snapshot),
    }
}

async fn seed_existing_data(pool: &sqlx::SqlitePool) -> (FavoriteGroup, Favorite) {
    let mut existing_settings = AppSettings::default();
    existing_settings.server_browser.page_size = 25;
    l4d2_server_hub_lib::settings_store::save_settings(pool, &existing_settings)
        .await
        .unwrap();

    let existing_group =
        l4d2_server_hub_lib::favorites_store::create_group(pool, "Existing".to_string())
            .await
            .unwrap();
    let existing_favorite = l4d2_server_hub_lib::favorites_store::add_favorite(
        pool,
        FavoriteInput {
            address: "127.0.0.1:27016".to_string(),
            server_id: None,
            group_id: existing_group.id.clone(),
            custom_name: Some("Keep me".to_string()),
            notes: String::new(),
            tags: Vec::new(),
        },
    )
    .await
    .unwrap();

    (existing_group, existing_favorite)
}

async fn assert_existing_data_unchanged(
    pool: &sqlx::SqlitePool,
    existing_group: &FavoriteGroup,
    existing_favorite: &Favorite,
) {
    let settings = l4d2_server_hub_lib::settings_store::get_settings(pool)
        .await
        .unwrap();
    assert_eq!(settings.server_browser.page_size, 25);

    let groups = l4d2_server_hub_lib::favorites_store::list_groups(pool)
        .await
        .unwrap();
    assert!(groups.iter().any(|group| group.id == existing_group.id));

    let favorites = l4d2_server_hub_lib::favorites_store::list_favorites(pool)
        .await
        .unwrap();
    assert_eq!(favorites.len(), 1);
    assert_eq!(favorites[0].id, existing_favorite.id);
}

#[tokio::test]
async fn backup_payload_round_trips_between_databases() {
    let source = memory_pool().await;
    let target = memory_pool().await;

    let mut settings = AppSettings::default();
    settings.server_browser.page_size = 25;
    l4d2_server_hub_lib::settings_store::save_settings(&source, &settings)
        .await
        .unwrap();

    let group =
        l4d2_server_hub_lib::favorites_store::create_group(&source, "Campaign Crew".to_string())
            .await
            .unwrap();
    let favorite_input = FavoriteInput {
        address: "127.0.0.1:27015".to_string(),
        server_id: Some("server-test".to_string()),
        group_id: group.id.clone(),
        custom_name: Some("Local test".to_string()),
        notes: "Good config".to_string(),
        tags: vec!["coop".to_string(), "friends".to_string()],
    };
    let favorite = l4d2_server_hub_lib::favorites_store::add_favorite(&source, favorite_input)
        .await
        .unwrap();

    let history = l4d2_server_hub_lib::history_store::add_history(&source, &valid_snapshot())
        .await
        .unwrap();

    let exported = export_data(&source).await.unwrap();
    let exported_value = serde_json::to_value(&exported).unwrap();
    let exported_settings = exported_value["settings"]
        .as_object()
        .expect("settings should be an object");
    assert!(exported_settings.contains_key("httpProxy"));
    assert!(exported_settings.contains_key("logging"));
    assert!(!exported_settings.contains_key("defaultPageSize"));
    assert!(!exported_settings.contains_key("autoRefreshEnabled"));
    assert!(!exported_settings.contains_key("autoRefreshIntervalSec"));
    assert!(!exported_settings.contains_key("launchMethod"));

    let imported = import_data(&target, exported.clone()).await.unwrap();

    assert_eq!(imported.version, 1);
    assert_eq!(imported.settings.server_browser.page_size, 25);
    assert!(matches!(
        imported.settings.http_proxy.mode,
        HttpProxyMode::System
    ));
    assert!(!imported.settings.logging.enabled);
    assert!(matches!(imported.settings.logging.level, LogLevel::Info));
    assert_eq!(imported.groups.len(), exported.groups.len());
    assert!(imported
        .groups
        .iter()
        .any(|imported_group| imported_group.id == group.id
            && imported_group.name == "Campaign Crew"));
    assert!(imported
        .groups
        .iter()
        .any(|imported_group| imported_group.id == "default"));

    let imported_favorites = l4d2_server_hub_lib::favorites_store::list_favorites(&target)
        .await
        .unwrap();
    assert_eq!(imported_favorites.len(), 1);
    assert_eq!(imported_favorites[0].id, favorite.id);
    assert_eq!(imported_favorites[0].address, favorite.address);
    assert_eq!(imported_favorites[0].server_id, favorite.server_id);
    assert_eq!(imported_favorites[0].group_id, group.id);
    assert_eq!(imported_favorites[0].tags, favorite.tags);

    let imported_history = l4d2_server_hub_lib::history_store::list_history(&target)
        .await
        .unwrap();
    assert_eq!(imported_history.len(), 1);
    assert_eq!(imported_history[0].id, history.id);
    assert_eq!(imported_history[0].address, history.address);
    assert_eq!(imported_history[0].server_id, history.server_id);
    assert_eq!(imported_history[0].server_name, history.server_name);
    assert_eq!(imported_history[0].connection_count, 1);
    assert_eq!(
        imported_history[0]
            .last_snapshot
            .as_ref()
            .map(|snapshot| snapshot.address.as_str()),
        Some(history.address.as_str())
    );

    let imported_settings = l4d2_server_hub_lib::settings_store::get_settings(&target)
        .await
        .unwrap();
    assert_eq!(imported_settings.server_browser.page_size, 25);
    assert!(matches!(
        imported_settings.http_proxy.mode,
        HttpProxyMode::System
    ));
}

#[tokio::test]
async fn import_normalizes_duplicate_history_addresses() {
    let pool = memory_pool().await;
    let older_connected_at = Utc::now() - chrono::Duration::minutes(5);
    let newer_connected_at = Utc::now();
    let mut older = history_record("older-history");
    older.connected_at = older_connected_at;
    older.connection_count = 2;
    let mut newer = history_record("newer-history");
    newer.connected_at = newer_connected_at;
    newer.connection_count = 3;
    newer.server_name = "Latest imported history".to_string();

    let imported = import_data(
        &pool,
        BackupPayload {
            version: 1,
            settings: AppSettings::default(),
            groups: vec![default_group()],
            favorites: Vec::new(),
            history: vec![older, newer],
        },
    )
    .await
    .unwrap();

    assert_eq!(imported.history.len(), 1);
    assert_eq!(imported.history[0].id, "newer-history");
    assert_eq!(imported.history[0].server_name, "Latest imported history");
    assert_eq!(imported.history[0].connection_count, 5);
}

#[tokio::test]
async fn import_rejects_unsupported_version() {
    let pool = memory_pool().await;
    let payload = BackupPayload {
        version: 2,
        settings: AppSettings::default(),
        groups: vec![default_group()],
        favorites: Vec::new(),
        history: Vec::new(),
    };

    let error = import_data(&pool, payload)
        .await
        .expect_err("unsupported backup version should fail");

    assert!(matches!(error, AppError::ImportInvalid(_)));
}

#[tokio::test]
async fn import_rejects_invalid_custom_proxy_before_replacing_data() {
    let pool = memory_pool().await;
    let (existing_group, existing_favorite) = seed_existing_data(&pool).await;
    let mut settings = AppSettings::default();
    settings.http_proxy.mode = HttpProxyMode::Custom;
    settings.http_proxy.custom_url = "socks5://127.0.0.1:1080".to_string();

    let payload = BackupPayload {
        version: 1,
        settings,
        groups: vec![default_group()],
        favorites: Vec::new(),
        history: Vec::new(),
    };

    let result = import_data(&pool, payload).await;

    assert!(matches!(result, Err(AppError::InvalidSettings(_))));
    assert_existing_data_unchanged(&pool, &existing_group, &existing_favorite).await;
}

#[tokio::test]
async fn import_rejects_missing_group_before_replacing_data() {
    let pool = memory_pool().await;

    let (existing_group, existing_favorite) = seed_existing_data(&pool).await;

    let payload = BackupPayload {
        version: 1,
        settings: AppSettings::default(),
        groups: vec![default_group()],
        favorites: vec![favorite("bad-favorite", "127.0.0.1:27017", "missing-group")],
        history: vec![history_record("new-history")],
    };

    let result = import_data(&pool, payload).await;
    assert!(matches!(result, Err(AppError::ImportInvalid(_))));
    assert_existing_data_unchanged(&pool, &existing_group, &existing_favorite).await;

    let history = l4d2_server_hub_lib::history_store::list_history(&pool)
        .await
        .unwrap();
    assert!(history.is_empty());
}

#[tokio::test]
async fn import_rejects_invalid_favorite_address_before_replacing_data() {
    let pool = memory_pool().await;
    let (existing_group, existing_favorite) = seed_existing_data(&pool).await;

    let mut bad_favorite = favorite("bad-address", "bad host:27015", "default");
    bad_favorite.last_snapshot = None;
    let payload = BackupPayload {
        version: 1,
        settings: AppSettings::default(),
        groups: vec![default_group()],
        favorites: vec![bad_favorite],
        history: Vec::new(),
    };

    let result = import_data(&pool, payload).await;

    assert!(matches!(result, Err(AppError::ImportInvalid(_))));
    assert_existing_data_unchanged(&pool, &existing_group, &existing_favorite).await;
}

#[tokio::test]
async fn import_rejects_inconsistent_last_snapshot_before_replacing_data() {
    let pool = memory_pool().await;

    let (existing_group, existing_favorite) = seed_existing_data(&pool).await;

    let now = Utc::now();
    let inconsistent_snapshot = ServerSnapshot {
        server_id: None,
        address: "10.0.0.1:27015".to_string(),
        ip: "127.0.0.1".to_string(),
        port: 27015,
        name: "Invalid Snapshot Server".to_string(),
        map: "c1m1_hotel".to_string(),
        mode_tags: vec!["coop".to_string()],
        game_description: None,
        server_type: None,
        environment: None,
        version: None,
        players: 4,
        max_players: 8,
        bots: 0,
        ping_ms: Some(42),
        vac_secured: true,
        last_seen_at: now,
        last_query_error: None,
    };

    let mut bad_favorite = favorite("bad-snapshot", "127.0.0.1:27017", "default");
    bad_favorite.last_snapshot = Some(inconsistent_snapshot);

    let result = import_data(
        &pool,
        BackupPayload {
            version: 1,
            settings: AppSettings::default(),
            groups: vec![default_group()],
            favorites: vec![bad_favorite],
            history: Vec::new(),
        },
    )
    .await;

    assert!(matches!(result, Err(AppError::ImportInvalid(_))));
    assert_existing_data_unchanged(&pool, &existing_group, &existing_favorite).await;
}

#[tokio::test]
async fn import_rejects_inconsistent_history_snapshot_before_replacing_data() {
    let pool = memory_pool().await;

    let (existing_group, existing_favorite) = seed_existing_data(&pool).await;

    let now = Utc::now();
    let inconsistent_snapshot = ServerSnapshot {
        server_id: Some("bad-history-server".to_string()),
        address: "10.0.0.1:27015".to_string(),
        ip: "127.0.0.1".to_string(),
        port: 27015,
        name: "Invalid History Snapshot".to_string(),
        map: "c1m1_hotel".to_string(),
        mode_tags: vec!["coop".to_string()],
        game_description: None,
        server_type: None,
        environment: None,
        version: None,
        players: 4,
        max_players: 8,
        bots: 0,
        ping_ms: Some(42),
        vac_secured: true,
        last_seen_at: now,
        last_query_error: None,
    };
    let mut bad_history = history_record("bad-history-snapshot");
    bad_history.last_snapshot = Some(inconsistent_snapshot);

    let result = import_data(
        &pool,
        BackupPayload {
            version: 1,
            settings: AppSettings::default(),
            groups: vec![default_group()],
            favorites: Vec::new(),
            history: vec![bad_history],
        },
    )
    .await;

    assert!(matches!(result, Err(AppError::ImportInvalid(_))));
    assert_existing_data_unchanged(&pool, &existing_group, &existing_favorite).await;
}

#[tokio::test]
async fn import_rejects_duplicate_favorite_address_in_same_group_before_replacing_data() {
    let pool = memory_pool().await;
    let (existing_group, existing_favorite) = seed_existing_data(&pool).await;

    let duplicate_address = "127.0.0.1:27017";
    let payload = BackupPayload {
        version: 1,
        settings: AppSettings::default(),
        groups: vec![default_group()],
        favorites: vec![
            favorite("first", duplicate_address, "default"),
            favorite("second", duplicate_address, "default"),
        ],
        history: Vec::new(),
    };

    let result = import_data(&pool, payload).await;

    assert!(matches!(result, Err(AppError::ImportInvalid(_))));
    assert_existing_data_unchanged(&pool, &existing_group, &existing_favorite).await;
}

#[tokio::test]
async fn import_allows_duplicate_favorite_address_in_different_groups() {
    let pool = memory_pool().await;
    let duplicate_address = "127.0.0.1:27017";
    let other_group = FavoriteGroup {
        id: "other".to_string(),
        name: "Other".to_string(),
        created_at: Utc::now(),
        updated_at: Utc::now(),
    };
    let payload = BackupPayload {
        version: 1,
        settings: AppSettings::default(),
        groups: vec![default_group(), other_group.clone()],
        favorites: vec![
            favorite("first", duplicate_address, "default"),
            favorite("second", duplicate_address, &other_group.id),
        ],
        history: Vec::new(),
    };

    import_data(&pool, payload).await.unwrap();

    let favorites = l4d2_server_hub_lib::favorites_store::list_favorites(&pool)
        .await
        .unwrap();
    assert_eq!(favorites.len(), 2);
    assert!(favorites
        .iter()
        .any(|favorite| favorite.address == duplicate_address && favorite.group_id == "default"));
    assert!(favorites.iter().any(
        |favorite| favorite.address == duplicate_address && favorite.group_id == other_group.id
    ));
}

#[tokio::test]
async fn import_rejects_duplicate_group_id_or_name() {
    let pool = memory_pool().await;
    let now = Utc::now();

    let duplicate_id = import_data(
        &pool,
        BackupPayload {
            version: 1,
            settings: AppSettings::default(),
            groups: vec![
                default_group(),
                FavoriteGroup {
                    id: "default".to_string(),
                    name: "Other".to_string(),
                    created_at: now,
                    updated_at: now,
                },
            ],
            favorites: Vec::new(),
            history: Vec::new(),
        },
    )
    .await;
    assert!(matches!(duplicate_id, Err(AppError::ImportInvalid(_))));

    let duplicate_name = import_data(
        &pool,
        BackupPayload {
            version: 1,
            settings: AppSettings::default(),
            groups: vec![
                default_group(),
                FavoriteGroup {
                    id: "other".to_string(),
                    name: "Default".to_string(),
                    created_at: now,
                    updated_at: now,
                },
            ],
            favorites: Vec::new(),
            history: Vec::new(),
        },
    )
    .await;
    assert!(matches!(duplicate_name, Err(AppError::ImportInvalid(_))));
}

#[tokio::test]
async fn import_rejects_duplicate_history_id() {
    let pool = memory_pool().await;

    let payload = BackupPayload {
        version: 1,
        settings: AppSettings::default(),
        groups: vec![default_group()],
        favorites: Vec::new(),
        history: vec![history_record("history"), history_record("history")],
    };

    let result = import_data(&pool, payload).await;

    assert!(matches!(result, Err(AppError::ImportInvalid(_))));
}

#[tokio::test]
async fn import_rejects_payload_that_lacks_default_group() {
    let pool = memory_pool().await;
    let now = Utc::now();
    let (existing_group, existing_favorite) = seed_existing_data(&pool).await;
    let payload = BackupPayload {
        version: 1,
        settings: AppSettings::default(),
        groups: vec![FavoriteGroup {
            id: "custom".to_string(),
            name: "Default".to_string(),
            created_at: now,
            updated_at: now,
        }],
        favorites: Vec::new(),
        history: Vec::new(),
    };

    let result = import_data(&pool, payload).await;

    assert!(matches!(result, Err(AppError::ImportInvalid(_))));
    assert_existing_data_unchanged(&pool, &existing_group, &existing_favorite).await;
}

#[test]
fn backup_payload_deserialization_rejects_missing_language() {
    let payload = BackupPayload {
        version: 1,
        settings: AppSettings::default(),
        groups: vec![default_group()],
        favorites: Vec::new(),
        history: Vec::new(),
    };
    let mut value = serde_json::to_value(payload).unwrap();
    value["settings"]
        .as_object_mut()
        .expect("settings should be an object")
        .remove("language");

    let error = serde_json::from_value::<BackupPayload>(value)
        .expect_err("missing language should be rejected");

    assert!(error.to_string().contains("settings.language"));
}

#[test]
fn backup_payload_deserialization_backfills_missing_http_proxy() {
    let payload = BackupPayload {
        version: 1,
        settings: AppSettings::default(),
        groups: vec![default_group()],
        favorites: Vec::new(),
        history: Vec::new(),
    };
    let mut value = serde_json::to_value(payload).unwrap();
    value["settings"]
        .as_object_mut()
        .expect("settings should be an object")
        .remove("httpProxy");

    let payload = serde_json::from_value::<BackupPayload>(value)
        .expect("missing httpProxy should be accepted for old backups");

    assert!(matches!(
        payload.settings.http_proxy.mode,
        HttpProxyMode::System
    ));
    assert_eq!(payload.settings.http_proxy.custom_url, "");
}

#[test]
fn backup_payload_deserialization_backfills_missing_logging() {
    let payload = BackupPayload {
        version: 1,
        settings: AppSettings::default(),
        groups: vec![default_group()],
        favorites: Vec::new(),
        history: Vec::new(),
    };
    let mut value = serde_json::to_value(payload).unwrap();
    value["settings"]
        .as_object_mut()
        .expect("settings should be an object")
        .remove("logging");

    let payload = serde_json::from_value::<BackupPayload>(value)
        .expect("missing logging should be accepted for old backups");

    assert!(!payload.settings.logging.enabled);
    assert!(matches!(payload.settings.logging.level, LogLevel::Info));
}

#[test]
fn backup_payload_deserialization_rejects_partial_logging() {
    let payload = BackupPayload {
        version: 1,
        settings: AppSettings::default(),
        groups: vec![default_group()],
        favorites: Vec::new(),
        history: Vec::new(),
    };
    let mut value = serde_json::to_value(payload).unwrap();
    value["settings"]["logging"]
        .as_object_mut()
        .expect("logging should be an object")
        .remove("level");

    let error = serde_json::from_value::<BackupPayload>(value)
        .expect_err("partial logging should be rejected");

    assert!(error.to_string().contains("settings.logging.level"));
}

#[test]
fn backup_payload_deserialization_rejects_invalid_logging_level() {
    let payload = BackupPayload {
        version: 1,
        settings: AppSettings::default(),
        groups: vec![default_group()],
        favorites: Vec::new(),
        history: Vec::new(),
    };
    let mut value = serde_json::to_value(payload).unwrap();
    value["settings"]["logging"]["level"] = serde_json::json!("verbose");

    let error = serde_json::from_value::<BackupPayload>(value)
        .expect_err("invalid logging level should be rejected");

    assert!(error.to_string().contains("verbose"));
}

#[test]
fn backup_payload_deserialization_rejects_partial_http_proxy() {
    let payload = BackupPayload {
        version: 1,
        settings: AppSettings::default(),
        groups: vec![default_group()],
        favorites: Vec::new(),
        history: Vec::new(),
    };
    let mut value = serde_json::to_value(payload).unwrap();
    value["settings"]["httpProxy"]
        .as_object_mut()
        .expect("httpProxy should be an object")
        .remove("customUrl");

    let error = serde_json::from_value::<BackupPayload>(value)
        .expect_err("partial httpProxy should be rejected");

    assert!(error.to_string().contains("settings.httpProxy.customUrl"));
}

#[test]
fn backup_payload_deserialization_rejects_removed_settings_fields() {
    let payload = BackupPayload {
        version: 1,
        settings: AppSettings::default(),
        groups: vec![default_group()],
        favorites: Vec::new(),
        history: Vec::new(),
    };
    let mut value = serde_json::to_value(payload).unwrap();
    value["settings"]["defaultPageSize"] = serde_json::json!(50);

    let error = serde_json::from_value::<BackupPayload>(value)
        .expect_err("removed settings fields should be rejected");

    assert!(error.to_string().contains("defaultPageSize"));
}

#[test]
fn backup_payload_deserialization_rejects_missing_favorite_server_id() {
    let payload = BackupPayload {
        version: 1,
        settings: AppSettings::default(),
        groups: vec![default_group()],
        favorites: vec![favorite("favorite", "127.0.0.1:27015", "default")],
        history: Vec::new(),
    };
    let mut value = serde_json::to_value(payload).unwrap();
    value["favorites"][0]
        .as_object_mut()
        .expect("favorite should be an object")
        .remove("serverId");

    let error = serde_json::from_value::<BackupPayload>(value)
        .expect_err("missing favorite serverId should be rejected");

    assert!(error.to_string().contains("serverId"));
}

#[test]
fn backup_payload_deserialization_rejects_missing_history_snapshot_fields() {
    let payload = BackupPayload {
        version: 1,
        settings: AppSettings::default(),
        groups: vec![default_group()],
        favorites: Vec::new(),
        history: vec![history_record("history")],
    };
    let mut value = serde_json::to_value(payload).unwrap();
    value["history"][0]
        .as_object_mut()
        .expect("history should be an object")
        .remove("serverId");
    value["history"][0]
        .as_object_mut()
        .expect("history should be an object")
        .remove("lastSnapshot");

    let error = serde_json::from_value::<BackupPayload>(value)
        .expect_err("missing history snapshot fields should be rejected");

    assert!(error.to_string().contains("serverId") || error.to_string().contains("lastSnapshot"));
}

#[test]
fn backup_payload_deserialization_rejects_invalid_server_snapshot() {
    let payload = BackupPayload {
        version: 1,
        settings: AppSettings::default(),
        groups: vec![default_group()],
        favorites: vec![favorite("favorite", "127.0.0.1:27015", "default")],
        history: Vec::new(),
    };
    let mut value = serde_json::to_value(payload).unwrap();
    value["favorites"][0]["lastSnapshot"]["address"] =
        serde_json::Value::String("10.0.0.1:27015".to_string());

    let error = serde_json::from_value::<BackupPayload>(value)
        .expect_err("invalid snapshot should fail checked deserialization");

    assert!(error.to_string().contains("10.0.0.1:27015"));
    assert!(error.to_string().contains("127.0.0.1:27015"));
}
