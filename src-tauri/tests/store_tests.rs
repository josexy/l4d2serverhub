use chrono::Utc;

#[tokio::test]
async fn sqlite_foreign_keys_are_enabled_for_pool_connections() {
    let pool = l4d2_server_hub_lib::create_pool("sqlite::memory:")
        .await
        .unwrap();

    let enabled: (i64,) = sqlx::query_as("PRAGMA foreign_keys")
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!(enabled.0, 1);
}

#[tokio::test]
async fn favorite_insert_with_missing_group_id_fails() {
    let pool = l4d2_server_hub_lib::create_pool("sqlite::memory:")
        .await
        .unwrap();

    let result = sqlx::query(
        "INSERT INTO favorites (
             id, address, server_id, group_id, custom_name, notes, tags_json,
             last_snapshot_json, created_at, updated_at, last_connected_at
         )
         VALUES (?, ?, NULL, ?, NULL, '', '[]', NULL, ?, ?, NULL)",
    )
    .bind("bad-favorite")
    .bind("127.0.0.1:27017")
    .bind("missing-group")
    .bind(Utc::now().to_rfc3339())
    .bind(Utc::now().to_rfc3339())
    .execute(&pool)
    .await;

    assert!(result.is_err());
}

#[tokio::test]
async fn alternate_memory_url_initializes_schema_on_query_connection() {
    let pool = l4d2_server_hub_lib::create_pool("sqlite::memory:?cache=shared")
        .await
        .unwrap();

    let groups = l4d2_server_hub_lib::favorites_store::list_groups(&pool)
        .await
        .unwrap();

    assert!(groups.iter().any(|group| group.id == "default"));
}

#[tokio::test]
async fn list_groups_returns_default_first() {
    let pool = l4d2_server_hub_lib::create_pool("sqlite::memory:")
        .await
        .unwrap();

    l4d2_server_hub_lib::favorites_store::create_group(&pool, "Alpha".to_string())
        .await
        .unwrap();

    let groups = l4d2_server_hub_lib::favorites_store::list_groups(&pool)
        .await
        .unwrap();

    assert_eq!(
        groups.first().map(|group| group.id.as_str()),
        Some("default")
    );
}

#[tokio::test]
async fn settings_round_trip_uses_defaults_then_saved_value() {
    let pool = l4d2_server_hub_lib::create_pool("sqlite::memory:")
        .await
        .unwrap();
    let settings = l4d2_server_hub_lib::settings_store::get_settings(&pool)
        .await
        .unwrap();
    assert_eq!(settings.server_browser.page_size, 50);
    assert!(settings
        .server_browser
        .filters
        .mode_selections
        .iter()
        .any(|mode| mode == "unknown"));
    assert!(matches!(
        settings.theme,
        l4d2_server_hub_lib::models::ThemePreference::Dark
    ));
    assert!(matches!(
        settings.language,
        l4d2_server_hub_lib::models::LanguagePreference::System
    ));
    assert!(matches!(
        settings.server_details_query_mode,
        l4d2_server_hub_lib::models::ServerDetailsQueryMode::A2sUdp
    ));
    assert!(matches!(
        settings.server_details_display_mode,
        l4d2_server_hub_lib::models::ServerDetailsDisplayMode::SidePanel
    ));
    assert!(matches!(
        settings.http_proxy.mode,
        l4d2_server_hub_lib::models::HttpProxyMode::System
    ));
    assert_eq!(settings.http_proxy.custom_url, "");
    assert!(!settings.logging.enabled);
    assert!(matches!(
        settings.logging.level,
        l4d2_server_hub_lib::models::LogLevel::Info
    ));

    let mut changed = settings.clone();
    changed.server_browser.page_size = 100;
    changed.server_browser.filters.query = "coop".to_string();
    changed.server_browser.sort = l4d2_server_hub_lib::models::ServerSort::PlayersDesc;
    changed.http_proxy.mode = l4d2_server_hub_lib::models::HttpProxyMode::Custom;
    changed.http_proxy.custom_url = "http://127.0.0.1:7890".to_string();
    changed.server_details_query_mode = l4d2_server_hub_lib::models::ServerDetailsQueryMode::Http;
    changed.server_details_display_mode =
        l4d2_server_hub_lib::models::ServerDetailsDisplayMode::Window;
    changed.logging.enabled = true;
    changed.logging.level = l4d2_server_hub_lib::models::LogLevel::Debug;
    l4d2_server_hub_lib::settings_store::save_settings(&pool, &changed)
        .await
        .unwrap();

    let loaded = l4d2_server_hub_lib::settings_store::get_settings(&pool)
        .await
        .unwrap();
    assert_eq!(loaded.server_browser.page_size, 100);
    assert_eq!(loaded.server_browser.filters.query, "coop");
    assert!(matches!(
        loaded.server_browser.sort,
        l4d2_server_hub_lib::models::ServerSort::PlayersDesc
    ));
    assert!(matches!(
        loaded.http_proxy.mode,
        l4d2_server_hub_lib::models::HttpProxyMode::Custom
    ));
    assert_eq!(loaded.http_proxy.custom_url, "http://127.0.0.1:7890");
    assert!(matches!(
        loaded.server_details_query_mode,
        l4d2_server_hub_lib::models::ServerDetailsQueryMode::Http
    ));
    assert!(matches!(
        loaded.server_details_display_mode,
        l4d2_server_hub_lib::models::ServerDetailsDisplayMode::Window
    ));
    assert!(loaded.logging.enabled);
    assert!(matches!(
        loaded.logging.level,
        l4d2_server_hub_lib::models::LogLevel::Debug
    ));
}

#[tokio::test]
async fn settings_store_backfills_missing_language_with_default() {
    let pool = l4d2_server_hub_lib::create_pool("sqlite::memory:")
        .await
        .unwrap();

    sqlx::query("INSERT INTO settings (key, value_json) VALUES (?, ?)")
        .bind("app")
        .bind(
            r#"{
                "queryRegion":"asia",
                "queryTimeoutMs":2500,
                "queryConcurrency":64,
                "theme":"dark"
            }"#,
        )
        .execute(&pool)
        .await
        .unwrap();

    let settings = l4d2_server_hub_lib::settings_store::get_settings(&pool)
        .await
        .unwrap();

    assert!(matches!(
        settings.language,
        l4d2_server_hub_lib::models::LanguagePreference::System
    ));
    assert!(matches!(
        settings.server_details_query_mode,
        l4d2_server_hub_lib::models::ServerDetailsQueryMode::A2sUdp
    ));
    assert!(matches!(
        settings.server_details_display_mode,
        l4d2_server_hub_lib::models::ServerDetailsDisplayMode::SidePanel
    ));
    assert!(matches!(
        settings.theme,
        l4d2_server_hub_lib::models::ThemePreference::Dark
    ));
    assert!(matches!(
        settings.http_proxy.mode,
        l4d2_server_hub_lib::models::HttpProxyMode::System
    ));
    assert_eq!(settings.server_browser.page_size, 50);
}

#[tokio::test]
async fn settings_store_rejects_invalid_custom_proxy_url() {
    let pool = l4d2_server_hub_lib::create_pool("sqlite::memory:")
        .await
        .unwrap();
    let mut settings = l4d2_server_hub_lib::models::AppSettings::default();
    settings.http_proxy.mode = l4d2_server_hub_lib::models::HttpProxyMode::Custom;

    for bad_url in ["", "socks5://127.0.0.1:1080", "http://"] {
        settings.http_proxy.custom_url = bad_url.to_string();
        let result = l4d2_server_hub_lib::settings_store::save_settings(&pool, &settings).await;

        assert!(matches!(
            result,
            Err(l4d2_server_hub_lib::errors::AppError::InvalidSettings(_))
        ));
    }
}

#[tokio::test]
async fn search_history_can_be_added_reused_listed_and_deleted() {
    let pool = l4d2_server_hub_lib::create_pool("sqlite::memory:")
        .await
        .unwrap();

    let first =
        l4d2_server_hub_lib::search_history_store::add_search_history(&pool, "coop".to_string())
            .await
            .unwrap();
    assert_eq!(first.len(), 1);
    assert_eq!(first[0].query, "coop");

    tokio::time::sleep(std::time::Duration::from_millis(1)).await;
    l4d2_server_hub_lib::search_history_store::add_search_history(&pool, "versus".to_string())
        .await
        .unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(1)).await;
    let reused =
        l4d2_server_hub_lib::search_history_store::add_search_history(&pool, "coop".to_string())
            .await
            .unwrap();

    assert_eq!(reused.len(), 2);
    assert_eq!(reused[0].query, "coop");
    assert_eq!(reused[1].query, "versus");

    l4d2_server_hub_lib::search_history_store::delete_search_history(&pool, reused[0].id.clone())
        .await
        .unwrap();

    let remaining = l4d2_server_hub_lib::search_history_store::list_search_history(&pool)
        .await
        .unwrap();
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].query, "versus");
}

#[tokio::test]
async fn favorite_can_be_created_listed_updated_and_deleted() {
    let pool = l4d2_server_hub_lib::create_pool("sqlite::memory:")
        .await
        .unwrap();
    let group = l4d2_server_hub_lib::favorites_store::create_group(&pool, "Friends".to_string())
        .await
        .unwrap();
    let input = l4d2_server_hub_lib::models::FavoriteInput {
        address: "127.0.0.1:27015".to_string(),
        server_id: Some("server-local".to_string()),
        group_id: group.id.clone(),
        custom_name: Some("Local test".to_string()),
        notes: "Good config".to_string(),
        tags: vec!["coop".to_string()],
    };

    let favorite = l4d2_server_hub_lib::favorites_store::add_favorite(&pool, input.clone())
        .await
        .unwrap();
    assert_eq!(favorite.address, "127.0.0.1:27015");
    assert_eq!(favorite.server_id.as_deref(), Some("server-local"));

    let favorites = l4d2_server_hub_lib::favorites_store::list_favorites(&pool)
        .await
        .unwrap();
    assert_eq!(favorites.len(), 1);

    let updated_input = l4d2_server_hub_lib::models::FavoriteInput {
        custom_name: Some("Updated local test".to_string()),
        notes: "Updated config".to_string(),
        tags: vec!["coop".to_string(), "friends".to_string()],
        ..input
    };
    let updated = l4d2_server_hub_lib::favorites_store::update_favorite(
        &pool,
        favorite.id.clone(),
        updated_input,
    )
    .await
    .unwrap();
    assert_eq!(updated.custom_name.as_deref(), Some("Updated local test"));
    assert_eq!(
        updated.tags,
        vec!["coop".to_string(), "friends".to_string()]
    );
    assert_eq!(updated.created_at, favorite.created_at);
    assert_eq!(updated.last_connected_at, favorite.last_connected_at);
    assert_eq!(
        updated
            .last_snapshot
            .as_ref()
            .map(|snapshot| &snapshot.address),
        None
    );
    assert_eq!(updated.server_id.as_deref(), Some("server-local"));

    l4d2_server_hub_lib::favorites_store::delete_favorite(&pool, favorite.id)
        .await
        .unwrap();
    let favorites = l4d2_server_hub_lib::favorites_store::list_favorites(&pool)
        .await
        .unwrap();
    assert!(favorites.is_empty());
}

#[tokio::test]
async fn favorite_store_rejects_invalid_addresses_on_create_and_update() {
    let pool = l4d2_server_hub_lib::create_pool("sqlite::memory:")
        .await
        .unwrap();
    let group = l4d2_server_hub_lib::favorites_store::create_group(&pool, "Friends".to_string())
        .await
        .unwrap();
    let valid_input = l4d2_server_hub_lib::models::FavoriteInput {
        address: "127.0.0.1:27015".to_string(),
        server_id: None,
        group_id: group.id.clone(),
        custom_name: None,
        notes: String::new(),
        tags: Vec::new(),
    };

    let create_result = l4d2_server_hub_lib::favorites_store::add_favorite(
        &pool,
        l4d2_server_hub_lib::models::FavoriteInput {
            address: "bad host:27015".to_string(),
            ..valid_input.clone()
        },
    )
    .await;
    assert!(matches!(
        create_result,
        Err(l4d2_server_hub_lib::errors::AppError::InvalidAddress(_))
    ));

    let favorite = l4d2_server_hub_lib::favorites_store::add_favorite(&pool, valid_input.clone())
        .await
        .unwrap();
    let update_result = l4d2_server_hub_lib::favorites_store::update_favorite(
        &pool,
        favorite.id,
        l4d2_server_hub_lib::models::FavoriteInput {
            address: "bad host:27015".to_string(),
            ..valid_input
        },
    )
    .await;
    assert!(matches!(
        update_result,
        Err(l4d2_server_hub_lib::errors::AppError::InvalidAddress(_))
    ));
}

#[tokio::test]
async fn favorite_addresses_are_unique_within_each_group() {
    let pool = l4d2_server_hub_lib::create_pool("sqlite::memory:")
        .await
        .unwrap();
    let group_a =
        l4d2_server_hub_lib::favorites_store::create_group(&pool, "Campaign A".to_string())
            .await
            .unwrap();
    let group_b =
        l4d2_server_hub_lib::favorites_store::create_group(&pool, "Campaign B".to_string())
            .await
            .unwrap();
    let input = l4d2_server_hub_lib::models::FavoriteInput {
        address: "127.0.0.1:27015".to_string(),
        server_id: None,
        group_id: group_a.id.clone(),
        custom_name: None,
        notes: String::new(),
        tags: Vec::new(),
    };

    l4d2_server_hub_lib::favorites_store::add_favorite(&pool, input.clone())
        .await
        .unwrap();
    l4d2_server_hub_lib::favorites_store::add_favorite(
        &pool,
        l4d2_server_hub_lib::models::FavoriteInput {
            group_id: group_b.id,
            ..input.clone()
        },
    )
    .await
    .unwrap();
    let duplicate_in_same_group =
        l4d2_server_hub_lib::favorites_store::add_favorite(&pool, input).await;

    assert!(matches!(
        duplicate_in_same_group,
        Err(l4d2_server_hub_lib::errors::AppError::Database(_))
    ));
    let favorites = l4d2_server_hub_lib::favorites_store::list_favorites(&pool)
        .await
        .unwrap();
    assert_eq!(favorites.len(), 2);
}

#[tokio::test]
async fn group_delete_rejects_default_and_cascades_group_favorites() {
    let pool = l4d2_server_hub_lib::create_pool("sqlite::memory:")
        .await
        .unwrap();

    let groups = l4d2_server_hub_lib::favorites_store::list_groups(&pool)
        .await
        .unwrap();
    assert!(groups.iter().any(|group| group.id == "default"));

    let default_delete =
        l4d2_server_hub_lib::favorites_store::delete_group(&pool, "default".to_string()).await;
    assert!(default_delete.is_err());

    let group = l4d2_server_hub_lib::favorites_store::create_group(&pool, "Campaign".to_string())
        .await
        .unwrap();
    let input = l4d2_server_hub_lib::models::FavoriteInput {
        address: "127.0.0.1:27016".to_string(),
        server_id: None,
        group_id: group.id.clone(),
        custom_name: None,
        notes: String::new(),
        tags: Vec::new(),
    };
    l4d2_server_hub_lib::favorites_store::add_favorite(&pool, input)
        .await
        .unwrap();

    l4d2_server_hub_lib::favorites_store::delete_group(&pool, group.id)
        .await
        .unwrap();

    let groups = l4d2_server_hub_lib::favorites_store::list_groups(&pool)
        .await
        .unwrap();
    assert!(!groups.iter().any(|group| group.name == "Campaign"));

    let favorites = l4d2_server_hub_lib::favorites_store::list_favorites(&pool)
        .await
        .unwrap();
    assert!(favorites.is_empty());
}

#[tokio::test]
async fn favorites_can_be_moved_to_another_group_atomically() {
    let pool = l4d2_server_hub_lib::create_pool("sqlite::memory:")
        .await
        .unwrap();
    let source_group =
        l4d2_server_hub_lib::favorites_store::create_group(&pool, "Source".to_string())
            .await
            .unwrap();
    let target_group =
        l4d2_server_hub_lib::favorites_store::create_group(&pool, "Target".to_string())
            .await
            .unwrap();

    let favorite_a = l4d2_server_hub_lib::favorites_store::add_favorite(
        &pool,
        l4d2_server_hub_lib::models::FavoriteInput {
            address: "127.0.0.1:27015".to_string(),
            server_id: None,
            group_id: source_group.id.clone(),
            custom_name: None,
            notes: String::new(),
            tags: Vec::new(),
        },
    )
    .await
    .unwrap();
    let favorite_b = l4d2_server_hub_lib::favorites_store::add_favorite(
        &pool,
        l4d2_server_hub_lib::models::FavoriteInput {
            address: "127.0.0.1:27016".to_string(),
            server_id: None,
            group_id: source_group.id.clone(),
            custom_name: None,
            notes: String::new(),
            tags: Vec::new(),
        },
    )
    .await
    .unwrap();
    let untouched = l4d2_server_hub_lib::favorites_store::add_favorite(
        &pool,
        l4d2_server_hub_lib::models::FavoriteInput {
            address: "127.0.0.1:27017".to_string(),
            server_id: None,
            group_id: source_group.id.clone(),
            custom_name: None,
            notes: String::new(),
            tags: Vec::new(),
        },
    )
    .await
    .unwrap();

    let moved = l4d2_server_hub_lib::favorites_store::move_favorites_to_group(
        &pool,
        vec![
            favorite_a.id.clone(),
            favorite_b.id.clone(),
            favorite_a.id.clone(),
        ],
        target_group.id.clone(),
    )
    .await
    .unwrap();
    assert_eq!(moved.len(), 2);
    assert!(moved
        .iter()
        .all(|favorite| favorite.group_id == target_group.id));

    let favorites = l4d2_server_hub_lib::favorites_store::list_favorites(&pool)
        .await
        .unwrap();
    let moved_a = favorites
        .iter()
        .find(|favorite| favorite.id == favorite_a.id)
        .unwrap();
    let moved_b = favorites
        .iter()
        .find(|favorite| favorite.id == favorite_b.id)
        .unwrap();
    let remaining = favorites
        .iter()
        .find(|favorite| favorite.id == untouched.id)
        .unwrap();

    assert_eq!(moved_a.group_id, target_group.id);
    assert_eq!(moved_b.group_id, target_group.id);
    assert_eq!(remaining.group_id, source_group.id);
}

#[tokio::test]
async fn favorite_move_rejects_target_group_address_conflicts_without_changes() {
    let pool = l4d2_server_hub_lib::create_pool("sqlite::memory:")
        .await
        .unwrap();
    let source_group =
        l4d2_server_hub_lib::favorites_store::create_group(&pool, "Source".to_string())
            .await
            .unwrap();
    let target_group =
        l4d2_server_hub_lib::favorites_store::create_group(&pool, "Target".to_string())
            .await
            .unwrap();

    let moving = l4d2_server_hub_lib::favorites_store::add_favorite(
        &pool,
        l4d2_server_hub_lib::models::FavoriteInput {
            address: "127.0.0.1:27015".to_string(),
            server_id: None,
            group_id: source_group.id.clone(),
            custom_name: None,
            notes: String::new(),
            tags: Vec::new(),
        },
    )
    .await
    .unwrap();
    l4d2_server_hub_lib::favorites_store::add_favorite(
        &pool,
        l4d2_server_hub_lib::models::FavoriteInput {
            address: "127.0.0.1:27015".to_string(),
            server_id: None,
            group_id: target_group.id.clone(),
            custom_name: None,
            notes: String::new(),
            tags: Vec::new(),
        },
    )
    .await
    .unwrap();

    let result = l4d2_server_hub_lib::favorites_store::move_favorites_to_group(
        &pool,
        vec![moving.id.clone()],
        target_group.id,
    )
    .await;

    assert!(matches!(
        result,
        Err(l4d2_server_hub_lib::errors::AppError::Unexpected(_))
    ));
    let favorites = l4d2_server_hub_lib::favorites_store::list_favorites(&pool)
        .await
        .unwrap();
    let unmoved = favorites
        .iter()
        .find(|favorite| favorite.id == moving.id)
        .unwrap();
    assert_eq!(unmoved.group_id, source_group.id);
}

#[tokio::test]
async fn favorite_move_rejects_missing_group_without_changes() {
    let pool = l4d2_server_hub_lib::create_pool("sqlite::memory:")
        .await
        .unwrap();
    let favorite = l4d2_server_hub_lib::favorites_store::add_favorite(
        &pool,
        l4d2_server_hub_lib::models::FavoriteInput {
            address: "127.0.0.1:27015".to_string(),
            server_id: None,
            group_id: "default".to_string(),
            custom_name: None,
            notes: String::new(),
            tags: Vec::new(),
        },
    )
    .await
    .unwrap();

    let result = l4d2_server_hub_lib::favorites_store::move_favorites_to_group(
        &pool,
        vec![favorite.id.clone()],
        "missing-group".to_string(),
    )
    .await;
    assert!(result.is_err());

    let favorites = l4d2_server_hub_lib::favorites_store::list_favorites(&pool)
        .await
        .unwrap();
    assert_eq!(favorites[0].group_id, "default");
}

#[tokio::test]
async fn favorite_move_rejects_missing_favorite_without_partial_changes() {
    let pool = l4d2_server_hub_lib::create_pool("sqlite::memory:")
        .await
        .unwrap();
    let target_group =
        l4d2_server_hub_lib::favorites_store::create_group(&pool, "Target".to_string())
            .await
            .unwrap();
    let favorite = l4d2_server_hub_lib::favorites_store::add_favorite(
        &pool,
        l4d2_server_hub_lib::models::FavoriteInput {
            address: "127.0.0.1:27015".to_string(),
            server_id: None,
            group_id: "default".to_string(),
            custom_name: None,
            notes: String::new(),
            tags: Vec::new(),
        },
    )
    .await
    .unwrap();

    let result = l4d2_server_hub_lib::favorites_store::move_favorites_to_group(
        &pool,
        vec![favorite.id.clone(), "missing-favorite".to_string()],
        target_group.id,
    )
    .await;
    assert!(result.is_err());

    let favorites = l4d2_server_hub_lib::favorites_store::list_favorites(&pool)
        .await
        .unwrap();
    assert_eq!(favorites[0].group_id, "default");
}

#[tokio::test]
async fn favorite_move_rejects_empty_selection() {
    let pool = l4d2_server_hub_lib::create_pool("sqlite::memory:")
        .await
        .unwrap();

    let result = l4d2_server_hub_lib::favorites_store::move_favorites_to_group(
        &pool,
        Vec::new(),
        "default".to_string(),
    )
    .await;

    assert!(matches!(
        result,
        Err(l4d2_server_hub_lib::errors::AppError::Unexpected(_))
    ));
}

#[tokio::test]
async fn favorite_snapshot_update_persists_snapshot_and_server_id() {
    let pool = l4d2_server_hub_lib::create_pool("sqlite::memory:")
        .await
        .unwrap();
    let input = l4d2_server_hub_lib::models::FavoriteInput {
        address: "127.0.0.1:27015".to_string(),
        server_id: None,
        group_id: "default".to_string(),
        custom_name: None,
        notes: String::new(),
        tags: Vec::new(),
    };
    let favorite = l4d2_server_hub_lib::favorites_store::add_favorite(&pool, input)
        .await
        .unwrap();
    let snapshot = l4d2_server_hub_lib::models::ServerSnapshot::try_new(
        l4d2_server_hub_lib::models::ServerSnapshotInput {
            server_id: Some("server-updated".to_string()),
            address: "127.0.0.1:27015".to_string(),
            ip: "127.0.0.1".to_string(),
            port: 27015,
            name: "Updated Server".to_string(),
            map: "c2m1_highway".to_string(),
            mode_tags: vec!["versus".to_string()],
            game_description: Some("Left 4 Dead 2".to_string()),
            server_type: Some("Dedicated".to_string()),
            environment: Some("Linux".to_string()),
            version: Some("2.2.4.3".to_string()),
            players: 6,
            max_players: 8,
            bots: 0,
            ping_ms: Some(55),
            vac_secured: true,
            last_seen_at: Utc::now(),
            last_query_error: None,
        },
    )
    .unwrap();

    let updated = l4d2_server_hub_lib::favorites_store::update_favorite_snapshot(
        &pool,
        favorite.id,
        &snapshot,
    )
    .await
    .unwrap();

    assert_eq!(updated.server_id.as_deref(), Some("server-updated"));
    assert_eq!(
        updated
            .last_snapshot
            .as_ref()
            .map(|snapshot| snapshot.map.as_str()),
        Some("c2m1_highway")
    );
}

#[tokio::test]
async fn history_can_be_added_listed_deleted_and_cleared() {
    let pool = l4d2_server_hub_lib::create_pool("sqlite::memory:")
        .await
        .unwrap();
    let snapshot = l4d2_server_hub_lib::models::ServerSnapshot::try_new(
        l4d2_server_hub_lib::models::ServerSnapshotInput {
            server_id: Some("server-history".to_string()),
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
        },
    )
    .unwrap();

    let first = l4d2_server_hub_lib::history_store::add_history(&pool, &snapshot)
        .await
        .unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(1)).await;
    let second = l4d2_server_hub_lib::history_store::add_history(&pool, &snapshot)
        .await
        .unwrap();

    let history = l4d2_server_hub_lib::history_store::list_history(&pool)
        .await
        .unwrap();
    assert_eq!(history.len(), 1);
    assert_eq!(history[0].id, second.id);
    assert_eq!(second.id, first.id);
    assert_eq!(history[0].connection_count, 2);
    assert_eq!(history[0].server_id.as_deref(), Some("server-history"));
    assert_eq!(
        history[0]
            .last_snapshot
            .as_ref()
            .map(|snapshot| snapshot.address.as_str()),
        Some("127.0.0.1:27015")
    );

    l4d2_server_hub_lib::history_store::delete_history(&pool, first.id)
        .await
        .unwrap();
    let history = l4d2_server_hub_lib::history_store::list_history(&pool)
        .await
        .unwrap();
    assert!(history.is_empty());

    l4d2_server_hub_lib::history_store::add_history(&pool, &snapshot)
        .await
        .unwrap();
    l4d2_server_hub_lib::history_store::clear_history(&pool)
        .await
        .unwrap();
    let history = l4d2_server_hub_lib::history_store::list_history(&pool)
        .await
        .unwrap();
    assert!(history.is_empty());
}

#[tokio::test]
async fn history_snapshot_update_persists_snapshot_and_server_id() {
    let pool = l4d2_server_hub_lib::create_pool("sqlite::memory:")
        .await
        .unwrap();
    let snapshot = l4d2_server_hub_lib::models::ServerSnapshot::try_new(
        l4d2_server_hub_lib::models::ServerSnapshotInput {
            server_id: None,
            address: "127.0.0.1:27016".to_string(),
            ip: "127.0.0.1".to_string(),
            port: 27016,
            name: "Old Server".to_string(),
            map: "c1m1_hotel".to_string(),
            mode_tags: vec!["coop".to_string()],
            game_description: Some("Left 4 Dead 2".to_string()),
            server_type: Some("Dedicated".to_string()),
            environment: Some("Linux".to_string()),
            version: Some("2.2.4.3".to_string()),
            players: 1,
            max_players: 8,
            bots: 0,
            ping_ms: Some(80),
            vac_secured: true,
            last_seen_at: Utc::now(),
            last_query_error: None,
        },
    )
    .unwrap();
    let record = l4d2_server_hub_lib::history_store::add_history(&pool, &snapshot)
        .await
        .unwrap();
    let updated_snapshot = l4d2_server_hub_lib::models::ServerSnapshot::try_new(
        l4d2_server_hub_lib::models::ServerSnapshotInput {
            server_id: Some("server-updated-history".to_string()),
            address: "127.0.0.1:27016".to_string(),
            ip: "127.0.0.1".to_string(),
            port: 27016,
            name: "Updated Server".to_string(),
            map: "c2m1_highway".to_string(),
            mode_tags: vec!["versus".to_string()],
            game_description: Some("Left 4 Dead 2".to_string()),
            server_type: Some("Dedicated".to_string()),
            environment: Some("Linux".to_string()),
            version: Some("2.2.4.3".to_string()),
            players: 6,
            max_players: 8,
            bots: 1,
            ping_ms: Some(45),
            vac_secured: true,
            last_seen_at: Utc::now(),
            last_query_error: None,
        },
    )
    .unwrap();

    let updated = l4d2_server_hub_lib::history_store::update_history_snapshot(
        &pool,
        record.id.clone(),
        &updated_snapshot,
    )
    .await
    .unwrap();

    assert_eq!(updated.server_id.as_deref(), Some("server-updated-history"));
    assert_eq!(updated.server_name, "Updated Server");
    assert_eq!(updated.map, "c2m1_highway");
    assert_eq!(updated.players, 6);
    assert_eq!(
        updated
            .last_snapshot
            .as_ref()
            .map(|snapshot| snapshot.mode_tags.as_slice()),
        Some(&["versus".to_string()][..])
    );
}
