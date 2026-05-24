use crate::errors::{AppError, AppResult};
use crate::models::{HistoryRecord, ServerSnapshot};
use chrono::{DateTime, Utc};
use sqlx::{Row, SqlitePool};
use uuid::Uuid;

pub async fn list_history(pool: &SqlitePool) -> AppResult<Vec<HistoryRecord>> {
    let rows = sqlx::query(
        "SELECT id, address, server_id, server_name, map, players, max_players,
                connected_at, connection_count, last_snapshot_json
         FROM history_records
         ORDER BY connected_at DESC",
    )
    .fetch_all(pool)
    .await
    .map_err(database_error)?;

    rows.into_iter().map(history_from_row).collect()
}

pub async fn add_history(pool: &SqlitePool, snapshot: &ServerSnapshot) -> AppResult<HistoryRecord> {
    let record = HistoryRecord {
        id: Uuid::new_v4().to_string(),
        address: snapshot.address.clone(),
        server_id: snapshot.server_id.clone(),
        server_name: snapshot.name.clone(),
        map: snapshot.map.clone(),
        players: snapshot.players,
        max_players: snapshot.max_players,
        connected_at: Utc::now(),
        connection_count: 1,
        last_snapshot: Some(snapshot.clone()),
    };
    let last_snapshot_json = serde_json::to_string(snapshot).map_err(database_error)?;

    sqlx::query(
        "INSERT INTO history_records (
             id, address, server_id, server_name, map, players, max_players,
             connected_at, connection_count, last_snapshot_json
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(address) DO UPDATE SET
             server_id = COALESCE(excluded.server_id, history_records.server_id),
             server_name = excluded.server_name,
             map = excluded.map,
             players = excluded.players,
             max_players = excluded.max_players,
             connected_at = excluded.connected_at,
             connection_count = history_records.connection_count + 1,
             last_snapshot_json = excluded.last_snapshot_json",
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
    .execute(pool)
    .await
    .map_err(database_error)?;

    get_history_by_address(pool, &record.address).await
}

pub async fn update_history_snapshot(
    pool: &SqlitePool,
    id: String,
    snapshot: &ServerSnapshot,
) -> AppResult<HistoryRecord> {
    let last_snapshot_json = serde_json::to_string(snapshot).map_err(database_error)?;
    let result = sqlx::query(
        "UPDATE history_records
         SET address = ?,
             server_id = COALESCE(?, server_id),
             server_name = ?,
             map = ?,
             players = ?,
             max_players = ?,
             last_snapshot_json = ?
         WHERE id = ?",
    )
    .bind(&snapshot.address)
    .bind(&snapshot.server_id)
    .bind(&snapshot.name)
    .bind(&snapshot.map)
    .bind(i64::from(snapshot.players))
    .bind(i64::from(snapshot.max_players))
    .bind(last_snapshot_json)
    .bind(&id)
    .execute(pool)
    .await
    .map_err(database_error)?;

    if result.rows_affected() == 0 {
        return Err(AppError::Unexpected(format!(
            "history record '{}' was not found",
            id
        )));
    }

    get_history(pool, &id).await
}

pub async fn delete_history(pool: &SqlitePool, id: String) -> AppResult<()> {
    sqlx::query("DELETE FROM history_records WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await
        .map_err(database_error)?;

    Ok(())
}

pub async fn clear_history(pool: &SqlitePool) -> AppResult<()> {
    sqlx::query("DELETE FROM history_records")
        .execute(pool)
        .await
        .map_err(database_error)?;

    Ok(())
}

fn history_from_row(row: sqlx::sqlite::SqliteRow) -> AppResult<HistoryRecord> {
    let last_snapshot_json: Option<String> =
        row.try_get("last_snapshot_json").map_err(database_error)?;
    let last_snapshot = parse_optional_snapshot(last_snapshot_json)?;

    Ok(HistoryRecord {
        id: row.try_get("id").map_err(database_error)?,
        address: row.try_get("address").map_err(database_error)?,
        server_id: row.try_get("server_id").map_err(database_error)?,
        server_name: row.try_get("server_name").map_err(database_error)?,
        map: row.try_get("map").map_err(database_error)?,
        players: read_u32(&row, "players")?,
        max_players: read_u32(&row, "max_players")?,
        connected_at: parse_time(
            row.try_get::<String, _>("connected_at")
                .map_err(database_error)?,
        )?,
        connection_count: read_u32(&row, "connection_count")?.max(1),
        last_snapshot,
    })
}

async fn get_history(pool: &SqlitePool, id: &str) -> AppResult<HistoryRecord> {
    let row = sqlx::query(
        "SELECT id, address, server_id, server_name, map, players, max_players,
                connected_at, connection_count, last_snapshot_json
         FROM history_records
         WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
    .map_err(database_error)?;

    row.map(history_from_row)
        .transpose()?
        .ok_or_else(|| AppError::Unexpected(format!("history record '{}' was not found", id)))
}

async fn get_history_by_address(pool: &SqlitePool, address: &str) -> AppResult<HistoryRecord> {
    let row = sqlx::query(
        "SELECT id, address, server_id, server_name, map, players, max_players,
                connected_at, connection_count, last_snapshot_json
         FROM history_records
         WHERE address = ?",
    )
    .bind(address)
    .fetch_optional(pool)
    .await
    .map_err(database_error)?;

    row.map(history_from_row).transpose()?.ok_or_else(|| {
        AppError::Unexpected(format!("history record for '{}' was not found", address))
    })
}

fn parse_optional_snapshot(value: Option<String>) -> AppResult<Option<ServerSnapshot>> {
    value
        .map(|json| serde_json::from_str(&json).map_err(database_error))
        .transpose()
}

fn read_u32(row: &sqlx::sqlite::SqliteRow, column: &str) -> AppResult<u32> {
    let value: i64 = row.try_get(column).map_err(database_error)?;
    u32::try_from(value).map_err(database_error)
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
