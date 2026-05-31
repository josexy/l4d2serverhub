use crate::errors::{AppError, AppResult};
use crate::models::{AppSettings, Favorite, FavoriteGroup, HistoryRecord};
use crate::{favorites_store, history_store, settings_store, steam_launcher};
use chrono::{DateTime, Utc};
use serde::de::Error as DeError;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{Sqlite, SqlitePool, Transaction};
use std::collections::{HashMap, HashSet};

const BACKUP_VERSION: u32 = 1;
const SETTINGS_KEY: &str = "app";
const DEFAULT_GROUP_ID: &str = "default";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BackupPayload {
    pub version: u32,
    #[serde(deserialize_with = "deserialize_current_settings")]
    pub settings: AppSettings,
    pub groups: Vec<FavoriteGroup>,
    pub favorites: Vec<Favorite>,
    pub history: Vec<HistoryRecord>,
}

pub async fn export_data(pool: &SqlitePool) -> AppResult<BackupPayload> {
    log::info!("exporting local data");
    let payload = BackupPayload {
        version: BACKUP_VERSION,
        settings: settings_store::get_settings(pool).await?,
        groups: favorites_store::list_groups(pool).await?,
        favorites: favorites_store::list_favorites(pool).await?,
        history: history_store::list_history(pool).await?,
    };
    log::info!(
        "exported local data: groups={}, favorites={}, history={}",
        payload.groups.len(),
        payload.favorites.len(),
        payload.history.len()
    );
    Ok(payload)
}

pub async fn import_data(pool: &SqlitePool, payload: BackupPayload) -> AppResult<BackupPayload> {
    log::info!(
        "importing local data: groups={}, favorites={}, history={}",
        payload.groups.len(),
        payload.favorites.len(),
        payload.history.len()
    );
    validate_payload_version(&payload)?;
    validate_favorite_addresses(&payload)?;
    validate_favorite_snapshots(&payload)?;
    validate_history_snapshots(&payload)?;
    validate_history_records(&payload)?;
    validate_duplicate_keys(&payload)?;
    validate_default_group_present(&payload)?;
    validate_favorite_group_refs(&payload)?;
    validate_settings(&payload)?;

    let mut tx = pool.begin().await.map_err(database_error)?;

    clear_user_tables(&mut tx).await?;
    insert_groups(&mut tx, &payload.groups).await?;
    insert_favorites(&mut tx, &payload.favorites).await?;
    insert_history(&mut tx, &payload.history).await?;
    insert_settings(&mut tx, &payload.settings).await?;

    tx.commit().await.map_err(database_error)?;

    let imported = export_data(pool).await?;
    log::info!(
        "imported local data: groups={}, favorites={}, history={}",
        imported.groups.len(),
        imported.favorites.len(),
        imported.history.len()
    );
    Ok(imported)
}

fn validate_payload_version(payload: &BackupPayload) -> AppResult<()> {
    if payload.version == BACKUP_VERSION {
        Ok(())
    } else {
        Err(AppError::ImportInvalid(format!(
            "unsupported backup version {}",
            payload.version
        )))
    }
}

fn validate_settings(payload: &BackupPayload) -> AppResult<()> {
    payload
        .settings
        .validate()
        .map_err(AppError::InvalidSettings)
}

fn validate_favorite_snapshots(payload: &BackupPayload) -> AppResult<()> {
    for favorite in &payload.favorites {
        if let Some(snapshot) = &favorite.last_snapshot {
            snapshot.validate_address_consistency().map_err(|message| {
                AppError::ImportInvalid(format!(
                    "favorite '{}' has invalid last snapshot: {}",
                    favorite.id, message
                ))
            })?;
        }
    }

    Ok(())
}

fn validate_history_snapshots(payload: &BackupPayload) -> AppResult<()> {
    for record in &payload.history {
        if let Some(snapshot) = &record.last_snapshot {
            snapshot.validate_address_consistency().map_err(|message| {
                AppError::ImportInvalid(format!(
                    "history record '{}' has invalid last snapshot: {}",
                    record.id, message
                ))
            })?;
        }
    }

    Ok(())
}

fn validate_history_records(payload: &BackupPayload) -> AppResult<()> {
    for record in &payload.history {
        steam_launcher::build_steam_connect_url(&record.address).map_err(|err| {
            AppError::ImportInvalid(format!(
                "history record '{}' has invalid address '{}': {}",
                record.id, record.address, err
            ))
        })?;

        if record.connection_count == 0 {
            return Err(AppError::ImportInvalid(format!(
                "history record '{}' has invalid connection count 0",
                record.id
            )));
        }
    }

    Ok(())
}

fn validate_favorite_addresses(payload: &BackupPayload) -> AppResult<()> {
    for favorite in &payload.favorites {
        steam_launcher::build_steam_connect_url(&favorite.address).map_err(|err| {
            AppError::ImportInvalid(format!(
                "favorite '{}' has invalid address '{}': {}",
                favorite.id, favorite.address, err
            ))
        })?;
    }

    Ok(())
}

fn validate_favorite_group_refs(payload: &BackupPayload) -> AppResult<()> {
    let group_ids = payload
        .groups
        .iter()
        .map(|group| group.id.as_str())
        .collect::<HashSet<_>>();

    for favorite in &payload.favorites {
        if !group_ids.contains(favorite.group_id.as_str()) {
            return Err(AppError::ImportInvalid(format!(
                "favorite '{}' references missing group '{}'",
                favorite.id, favorite.group_id
            )));
        }
    }

    Ok(())
}

fn validate_duplicate_keys(payload: &BackupPayload) -> AppResult<()> {
    let mut group_ids = HashSet::new();
    let mut group_names = HashSet::new();
    for group in &payload.groups {
        validate_unique_value(&mut group_ids, &group.id, "group id")?;
        validate_unique_value(&mut group_names, &group.name, "group name")?;
    }

    let mut favorite_ids = HashSet::new();
    let mut favorite_group_addresses = HashSet::new();
    for favorite in &payload.favorites {
        validate_unique_value(&mut favorite_ids, &favorite.id, "favorite id")?;
        let favorite_group_address = (favorite.group_id.clone(), favorite.address.clone());
        if !favorite_group_addresses.insert(favorite_group_address) {
            return Err(AppError::ImportInvalid(format!(
                "duplicate favorite address '{}' in group '{}'",
                favorite.address, favorite.group_id
            )));
        }
    }

    let mut history_ids = HashSet::new();
    for record in &payload.history {
        validate_unique_value(&mut history_ids, &record.id, "history id")?;
    }

    Ok(())
}

fn validate_default_group_present(payload: &BackupPayload) -> AppResult<()> {
    if payload
        .groups
        .iter()
        .any(|group| group.id == DEFAULT_GROUP_ID)
    {
        Ok(())
    } else {
        Err(AppError::ImportInvalid(format!(
            "backup is missing required group '{}'",
            DEFAULT_GROUP_ID
        )))
    }
}

fn validate_unique_value(seen: &mut HashSet<String>, value: &str, label: &str) -> AppResult<()> {
    if seen.insert(value.to_string()) {
        Ok(())
    } else {
        Err(AppError::ImportInvalid(format!(
            "duplicate {} '{}'",
            label, value
        )))
    }
}

fn deserialize_current_settings<'de, D>(deserializer: D) -> Result<AppSettings, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = Value::deserialize(deserializer)?;

    require_object_fields_with_allowed::<D::Error>(
        &value,
        "settings",
        &[
            "httpTimeoutMs",
            "a2sTimeoutMs",
            "theme",
            "language",
            "serverBrowser",
        ],
        &[
            "httpTimeoutMs",
            "a2sTimeoutMs",
            "serverDetailsQueryMode",
            "serverDetailsDisplayMode",
            "theme",
            "language",
            "serverBrowser",
            "httpProxy",
            "logging",
        ],
    )?;

    if let Some(http_proxy) = value.get("httpProxy") {
        require_object_fields::<D::Error>(
            http_proxy,
            "settings.httpProxy",
            &["mode", "customUrl"],
        )?;
    }

    if let Some(logging) = value.get("logging") {
        require_object_fields::<D::Error>(logging, "settings.logging", &["enabled", "level"])?;
    }

    let server_browser = value
        .get("serverBrowser")
        .ok_or_else(|| D::Error::custom("missing required backup field settings.serverBrowser"))?;
    require_object_fields::<D::Error>(
        server_browser,
        "settings.serverBrowser",
        &["filters", "sort", "pageSize"],
    )?;

    let filters = server_browser.get("filters").ok_or_else(|| {
        D::Error::custom("missing required backup field settings.serverBrowser.filters")
    })?;
    require_object_fields::<D::Error>(
        filters,
        "settings.serverBrowser.filters",
        &[
            "query",
            "showOnline",
            "showEmpty",
            "showOfficial",
            "showThird",
            "modeSelections",
            "customRules",
        ],
    )?;

    let custom_rules = filters.get("customRules").ok_or_else(|| {
        D::Error::custom("missing required backup field settings.serverBrowser.filters.customRules")
    })?;
    require_object_fields::<D::Error>(
        custom_rules,
        "settings.serverBrowser.filters.customRules",
        &["priority", "whitelist", "blacklist"],
    )?;

    let whitelist = custom_rules.get("whitelist").ok_or_else(|| {
        D::Error::custom(
            "missing required backup field settings.serverBrowser.filters.customRules.whitelist",
        )
    })?;
    require_object_fields::<D::Error>(
        whitelist,
        "settings.serverBrowser.filters.customRules.whitelist",
        &["ip", "text"],
    )?;

    let blacklist = custom_rules.get("blacklist").ok_or_else(|| {
        D::Error::custom(
            "missing required backup field settings.serverBrowser.filters.customRules.blacklist",
        )
    })?;
    require_object_fields::<D::Error>(
        blacklist,
        "settings.serverBrowser.filters.customRules.blacklist",
        &["ip", "text"],
    )?;

    serde_json::from_value(value).map_err(D::Error::custom)
}

fn require_object_fields<E>(value: &Value, label: &str, fields: &[&str]) -> Result<(), E>
where
    E: DeError,
{
    require_object_fields_with_allowed(value, label, fields, fields)
}

fn require_object_fields_with_allowed<E>(
    value: &Value,
    label: &str,
    required_fields: &[&str],
    allowed_fields: &[&str],
) -> Result<(), E>
where
    E: DeError,
{
    let object = value
        .as_object()
        .ok_or_else(|| E::custom(format!("backup field '{}' must be an object", label)))?;

    for field in required_fields {
        if !object.contains_key(*field) {
            return Err(E::custom(format!(
                "missing required backup field {}.{}",
                label, field
            )));
        }
    }

    for field in object.keys() {
        if !allowed_fields.iter().any(|allowed| allowed == field) {
            return Err(E::custom(format!(
                "unsupported backup field {}.{}",
                label, field
            )));
        }
    }

    Ok(())
}

async fn clear_user_tables(tx: &mut Transaction<'_, Sqlite>) -> AppResult<()> {
    sqlx::query("DELETE FROM favorites")
        .execute(&mut **tx)
        .await
        .map_err(database_error)?;
    sqlx::query("DELETE FROM favorite_groups")
        .execute(&mut **tx)
        .await
        .map_err(database_error)?;
    sqlx::query("DELETE FROM history_records")
        .execute(&mut **tx)
        .await
        .map_err(database_error)?;
    sqlx::query("DELETE FROM settings")
        .execute(&mut **tx)
        .await
        .map_err(database_error)?;

    Ok(())
}

async fn insert_groups(
    tx: &mut Transaction<'_, Sqlite>,
    groups: &[FavoriteGroup],
) -> AppResult<()> {
    for group in groups {
        sqlx::query(
            "INSERT INTO favorite_groups (id, name, created_at, updated_at)
             VALUES (?, ?, ?, ?)",
        )
        .bind(&group.id)
        .bind(&group.name)
        .bind(format_time(group.created_at))
        .bind(format_time(group.updated_at))
        .execute(&mut **tx)
        .await
        .map_err(database_error)?;
    }

    Ok(())
}

async fn insert_favorites(
    tx: &mut Transaction<'_, Sqlite>,
    favorites: &[Favorite],
) -> AppResult<()> {
    for favorite in favorites {
        let tags_json = serde_json::to_string(&favorite.tags).map_err(database_error)?;
        let last_snapshot_json = favorite
            .last_snapshot
            .as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(database_error)?;

        sqlx::query(
            "INSERT INTO favorites (
                 id, address, server_id, group_id, custom_name, notes, tags_json,
                 last_snapshot_json, created_at, updated_at, last_connected_at
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&favorite.id)
        .bind(&favorite.address)
        .bind(&favorite.server_id)
        .bind(&favorite.group_id)
        .bind(&favorite.custom_name)
        .bind(&favorite.notes)
        .bind(tags_json)
        .bind(last_snapshot_json)
        .bind(format_time(favorite.created_at))
        .bind(format_time(favorite.updated_at))
        .bind(favorite.last_connected_at.map(format_time))
        .execute(&mut **tx)
        .await
        .map_err(database_error)?;
    }

    Ok(())
}

async fn insert_history(
    tx: &mut Transaction<'_, Sqlite>,
    history: &[HistoryRecord],
) -> AppResult<()> {
    for record in normalized_history_records(history) {
        let last_snapshot_json = record
            .last_snapshot
            .as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(database_error)?;

        sqlx::query(
            "INSERT INTO history_records (
                 id, address, server_id, server_name, map, players, max_players,
                 connected_at, connection_count, last_snapshot_json
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&record.id)
        .bind(&record.address)
        .bind(&record.server_id)
        .bind(&record.server_name)
        .bind(&record.map)
        .bind(i64::from(record.players))
        .bind(i64::from(record.max_players))
        .bind(format_time(record.connected_at))
        .bind(i64::from(record.connection_count))
        .bind(last_snapshot_json)
        .execute(&mut **tx)
        .await
        .map_err(database_error)?;
    }

    Ok(())
}

fn normalized_history_records(history: &[HistoryRecord]) -> Vec<HistoryRecord> {
    let mut by_address: HashMap<&str, HistoryRecord> = HashMap::new();

    for record in history {
        let connection_count = record.connection_count.max(1);
        match by_address.get_mut(record.address.as_str()) {
            Some(existing) => {
                let total = existing.connection_count.saturating_add(connection_count);
                if record.connected_at > existing.connected_at {
                    let mut latest = record.clone();
                    latest.connection_count = total;
                    *existing = latest;
                } else {
                    existing.connection_count = total;
                }
            }
            None => {
                let mut first = record.clone();
                first.connection_count = connection_count;
                by_address.insert(record.address.as_str(), first);
            }
        }
    }

    by_address.into_values().collect()
}

async fn insert_settings(
    tx: &mut Transaction<'_, Sqlite>,
    settings: &AppSettings,
) -> AppResult<()> {
    let json = serde_json::to_string(settings).map_err(database_error)?;

    sqlx::query("INSERT INTO settings (key, value_json) VALUES (?, ?)")
        .bind(SETTINGS_KEY)
        .bind(json)
        .execute(&mut **tx)
        .await
        .map_err(database_error)?;

    Ok(())
}

fn format_time(value: DateTime<Utc>) -> String {
    value.to_rfc3339()
}

fn database_error(err: impl ToString) -> AppError {
    AppError::Database(err.to_string())
}
