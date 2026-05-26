use crate::errors::{AppError, AppResult};
use crate::models::{Favorite, FavoriteGroup, FavoriteInput, ServerSnapshot};
use crate::steam_launcher;
use chrono::{DateTime, Utc};
use sqlx::{Row, SqlitePool};
use uuid::Uuid;

const DEFAULT_GROUP_ID: &str = "default";

pub async fn list_groups(pool: &SqlitePool) -> AppResult<Vec<FavoriteGroup>> {
    let rows = sqlx::query(
        "SELECT id, name, created_at, updated_at
         FROM favorite_groups
         ORDER BY CASE WHEN id = 'default' THEN 0 ELSE 1 END,
                  name COLLATE NOCASE ASC",
    )
    .fetch_all(pool)
    .await
    .map_err(database_error)?;

    rows.into_iter().map(group_from_row).collect()
}

pub async fn create_group(pool: &SqlitePool, name: String) -> AppResult<FavoriteGroup> {
    let now = Utc::now();
    let group = FavoriteGroup {
        id: Uuid::new_v4().to_string(),
        name,
        created_at: now,
        updated_at: now,
    };

    sqlx::query(
        "INSERT INTO favorite_groups (id, name, created_at, updated_at)
         VALUES (?, ?, ?, ?)",
    )
    .bind(&group.id)
    .bind(&group.name)
    .bind(format_time(group.created_at))
    .bind(format_time(group.updated_at))
    .execute(pool)
    .await
    .map_err(database_error)?;

    log::info!("created favorite group '{}'", group.id);

    Ok(group)
}

pub async fn update_group(pool: &SqlitePool, id: String, name: String) -> AppResult<FavoriteGroup> {
    let now = Utc::now();
    let result = sqlx::query(
        "UPDATE favorite_groups
         SET name = ?, updated_at = ?
         WHERE id = ?",
    )
    .bind(name)
    .bind(format_time(now))
    .bind(&id)
    .execute(pool)
    .await
    .map_err(database_error)?;

    if result.rows_affected() == 0 {
        return Err(AppError::Unexpected(format!(
            "favorite group '{}' was not found",
            id
        )));
    }

    log::info!("updated favorite group '{}'", id);

    get_group(pool, &id).await
}

pub async fn delete_group(pool: &SqlitePool, id: String) -> AppResult<()> {
    if id == DEFAULT_GROUP_ID {
        return Err(AppError::Unexpected(
            "default favorite group cannot be deleted".to_string(),
        ));
    }

    let mut tx = pool.begin().await.map_err(database_error)?;

    sqlx::query("DELETE FROM favorites WHERE group_id = ?")
        .bind(&id)
        .execute(&mut *tx)
        .await
        .map_err(database_error)?;

    let result = sqlx::query("DELETE FROM favorite_groups WHERE id = ?")
        .bind(&id)
        .execute(&mut *tx)
        .await
        .map_err(database_error)?;

    if result.rows_affected() == 0 {
        return Err(AppError::Unexpected(format!(
            "favorite group '{}' was not found",
            id
        )));
    }

    tx.commit().await.map_err(database_error)?;

    log::info!("deleted favorite group '{}'", id);

    Ok(())
}

pub async fn list_favorites(pool: &SqlitePool) -> AppResult<Vec<Favorite>> {
    let rows = sqlx::query(
        "SELECT id, address, server_id, group_id, custom_name, notes, tags_json,
                last_snapshot_json, created_at, updated_at, last_connected_at
         FROM favorites
         ORDER BY created_at ASC",
    )
    .fetch_all(pool)
    .await
    .map_err(database_error)?;

    rows.into_iter().map(favorite_from_row).collect()
}

pub async fn add_favorite(pool: &SqlitePool, input: FavoriteInput) -> AppResult<Favorite> {
    steam_launcher::build_steam_connect_url(&input.address)?;
    ensure_group_exists(pool, &input.group_id).await?;

    let now = Utc::now();
    let id = Uuid::new_v4().to_string();
    let tags_json = serde_json::to_string(&input.tags).map_err(database_error)?;

    sqlx::query(
        "INSERT INTO favorites (
             id, address, server_id, group_id, custom_name, notes, tags_json,
             last_snapshot_json, created_at, updated_at, last_connected_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL)",
    )
    .bind(&id)
    .bind(&input.address)
    .bind(&input.server_id)
    .bind(&input.group_id)
    .bind(&input.custom_name)
    .bind(&input.notes)
    .bind(tags_json)
    .bind(format_time(now))
    .bind(format_time(now))
    .execute(pool)
    .await
    .map_err(database_error)?;

    log::info!("added favorite '{}' for address '{}'", id, input.address);

    get_favorite(pool, &id).await
}

pub async fn update_favorite(
    pool: &SqlitePool,
    id: String,
    input: FavoriteInput,
) -> AppResult<Favorite> {
    steam_launcher::build_steam_connect_url(&input.address)?;
    ensure_group_exists(pool, &input.group_id).await?;

    let tags_json = serde_json::to_string(&input.tags).map_err(database_error)?;
    let result = sqlx::query(
        "UPDATE favorites
         SET address = ?, server_id = COALESCE(?, server_id), group_id = ?, custom_name = ?, notes = ?,
             tags_json = ?, updated_at = ?
         WHERE id = ?",
    )
    .bind(&input.address)
    .bind(&input.server_id)
    .bind(&input.group_id)
    .bind(&input.custom_name)
    .bind(&input.notes)
    .bind(tags_json)
    .bind(format_time(Utc::now()))
    .bind(&id)
    .execute(pool)
    .await
    .map_err(database_error)?;

    if result.rows_affected() == 0 {
        return Err(AppError::Unexpected(format!(
            "favorite '{}' was not found",
            id
        )));
    }

    log::info!("updated favorite '{}'", id);

    get_favorite(pool, &id).await
}

pub async fn update_favorite_snapshot(
    pool: &SqlitePool,
    id: String,
    snapshot: &ServerSnapshot,
) -> AppResult<Favorite> {
    let snapshot_json = serde_json::to_string(snapshot).map_err(database_error)?;
    let result = sqlx::query(
        "UPDATE favorites
         SET server_id = COALESCE(?, server_id),
             last_snapshot_json = ?,
             updated_at = ?
         WHERE id = ?",
    )
    .bind(&snapshot.server_id)
    .bind(snapshot_json)
    .bind(format_time(Utc::now()))
    .bind(&id)
    .execute(pool)
    .await
    .map_err(database_error)?;

    if result.rows_affected() == 0 {
        return Err(AppError::Unexpected(format!(
            "favorite '{}' was not found",
            id
        )));
    }

    log::debug!("updated favorite snapshot '{}'", id);

    get_favorite(pool, &id).await
}

pub async fn move_favorites_to_group(
    pool: &SqlitePool,
    ids: Vec<String>,
    group_id: String,
) -> AppResult<Vec<Favorite>> {
    let mut unique_ids = Vec::new();
    for id in ids {
        if !unique_ids.contains(&id) {
            unique_ids.push(id);
        }
    }

    if unique_ids.is_empty() {
        return Err(AppError::Unexpected(
            "at least one favorite must be selected".to_string(),
        ));
    }

    ensure_group_exists(pool, &group_id).await?;
    reject_move_address_conflicts(pool, &unique_ids, &group_id).await?;

    let mut tx = pool.begin().await.map_err(database_error)?;
    let now = format_time(Utc::now());
    let mut moved_count = 0;

    for id in &unique_ids {
        let result = sqlx::query(
            "UPDATE favorites
             SET group_id = ?, updated_at = ?
             WHERE id = ?",
        )
        .bind(&group_id)
        .bind(&now)
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(database_error)?;
        moved_count += result.rows_affected();
    }

    if moved_count != unique_ids.len() as u64 {
        return Err(AppError::Unexpected(
            "one or more selected favorites were not found".to_string(),
        ));
    }

    tx.commit().await.map_err(database_error)?;

    log::info!(
        "moved {} favorites to favorite group '{}'",
        unique_ids.len(),
        group_id
    );

    favorites_by_ids(pool, &unique_ids).await
}

async fn reject_move_address_conflicts(
    pool: &SqlitePool,
    ids: &[String],
    group_id: &str,
) -> AppResult<()> {
    for id in ids {
        let row: Option<(String,)> = sqlx::query_as("SELECT address FROM favorites WHERE id = ?")
            .bind(id)
            .fetch_optional(pool)
            .await
            .map_err(database_error)?;
        let Some((address,)) = row else {
            continue;
        };

        let conflict: Option<(String,)> = sqlx::query_as(
            "SELECT id FROM favorites
             WHERE group_id = ? AND address = ? AND id != ?",
        )
        .bind(group_id)
        .bind(&address)
        .bind(id)
        .fetch_optional(pool)
        .await
        .map_err(database_error)?;

        if conflict.is_some() {
            return Err(AppError::Unexpected(format!(
                "target favorite group already contains '{}'",
                address
            )));
        }
    }

    Ok(())
}

pub async fn delete_favorite(pool: &SqlitePool, id: String) -> AppResult<()> {
    sqlx::query("DELETE FROM favorites WHERE id = ?")
        .bind(&id)
        .execute(pool)
        .await
        .map_err(database_error)?;

    log::info!("deleted favorite '{}'", id);

    Ok(())
}

async fn get_group(pool: &SqlitePool, id: &str) -> AppResult<FavoriteGroup> {
    let row = sqlx::query(
        "SELECT id, name, created_at, updated_at
         FROM favorite_groups
         WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
    .map_err(database_error)?;

    row.map(group_from_row)
        .transpose()?
        .ok_or_else(|| AppError::Unexpected(format!("favorite group '{}' was not found", id)))
}

async fn get_favorite(pool: &SqlitePool, id: &str) -> AppResult<Favorite> {
    let row = sqlx::query(
        "SELECT id, address, server_id, group_id, custom_name, notes, tags_json,
                last_snapshot_json, created_at, updated_at, last_connected_at
         FROM favorites
         WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
    .map_err(database_error)?;

    row.map(favorite_from_row)
        .transpose()?
        .ok_or_else(|| AppError::Unexpected(format!("favorite '{}' was not found", id)))
}

async fn favorites_by_ids(pool: &SqlitePool, ids: &[String]) -> AppResult<Vec<Favorite>> {
    let mut favorites = Vec::with_capacity(ids.len());
    for id in ids {
        favorites.push(get_favorite(pool, id).await?);
    }
    Ok(favorites)
}

async fn ensure_group_exists(pool: &SqlitePool, group_id: &str) -> AppResult<()> {
    let row: Option<(String,)> = sqlx::query_as("SELECT id FROM favorite_groups WHERE id = ?")
        .bind(group_id)
        .fetch_optional(pool)
        .await
        .map_err(database_error)?;

    row.map(|_| ())
        .ok_or_else(|| AppError::Unexpected(format!("favorite group '{}' was not found", group_id)))
}

fn group_from_row(row: sqlx::sqlite::SqliteRow) -> AppResult<FavoriteGroup> {
    Ok(FavoriteGroup {
        id: row.try_get("id").map_err(database_error)?,
        name: row.try_get("name").map_err(database_error)?,
        created_at: parse_time(
            row.try_get::<String, _>("created_at")
                .map_err(database_error)?,
        )?,
        updated_at: parse_time(
            row.try_get::<String, _>("updated_at")
                .map_err(database_error)?,
        )?,
    })
}

fn favorite_from_row(row: sqlx::sqlite::SqliteRow) -> AppResult<Favorite> {
    let tags_json: String = row.try_get("tags_json").map_err(database_error)?;
    let last_snapshot_json: Option<String> =
        row.try_get("last_snapshot_json").map_err(database_error)?;
    let last_snapshot = parse_optional_snapshot(last_snapshot_json)?;

    Ok(Favorite {
        id: row.try_get("id").map_err(database_error)?,
        address: row.try_get("address").map_err(database_error)?,
        server_id: row.try_get("server_id").map_err(database_error)?,
        group_id: row.try_get("group_id").map_err(database_error)?,
        custom_name: row.try_get("custom_name").map_err(database_error)?,
        notes: row.try_get("notes").map_err(database_error)?,
        tags: serde_json::from_str(&tags_json).map_err(database_error)?,
        created_at: parse_time(
            row.try_get::<String, _>("created_at")
                .map_err(database_error)?,
        )?,
        updated_at: parse_time(
            row.try_get::<String, _>("updated_at")
                .map_err(database_error)?,
        )?,
        last_connected_at: parse_optional_time(
            row.try_get::<Option<String>, _>("last_connected_at")
                .map_err(database_error)?,
        )?,
        last_snapshot,
    })
}

fn parse_optional_snapshot(value: Option<String>) -> AppResult<Option<ServerSnapshot>> {
    value
        .map(|json| serde_json::from_str(&json).map_err(database_error))
        .transpose()
}

fn parse_optional_time(value: Option<String>) -> AppResult<Option<DateTime<Utc>>> {
    value.map(parse_time).transpose()
}

fn parse_time(value: String) -> AppResult<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(&value)
        .map(|parsed| parsed.with_timezone(&Utc))
        .map_err(database_error)
}

fn format_time(value: DateTime<Utc>) -> String {
    value.to_rfc3339()
}

fn database_error(err: impl ToString) -> AppError {
    AppError::Database(err.to_string())
}
