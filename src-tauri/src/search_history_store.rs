use crate::errors::{AppError, AppResult};
use crate::models::SearchHistoryRecord;
use chrono::{DateTime, Utc};
use sqlx::{Row, SqlitePool};
use uuid::Uuid;

const SEARCH_HISTORY_LIMIT: i64 = 20;

pub async fn list_search_history(pool: &SqlitePool) -> AppResult<Vec<SearchHistoryRecord>> {
    let rows = sqlx::query(
        "SELECT id, query, created_at, last_used_at
         FROM search_history
         ORDER BY last_used_at DESC
         LIMIT ?",
    )
    .bind(SEARCH_HISTORY_LIMIT)
    .fetch_all(pool)
    .await
    .map_err(database_error)?;

    rows.into_iter().map(search_history_from_row).collect()
}

pub async fn add_search_history(
    pool: &SqlitePool,
    query: String,
) -> AppResult<Vec<SearchHistoryRecord>> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return list_search_history(pool).await;
    }

    let now = Utc::now();
    sqlx::query(
        "INSERT INTO search_history (id, query, created_at, last_used_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(query) DO UPDATE SET last_used_at = excluded.last_used_at",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(trimmed)
    .bind(format_time(now))
    .bind(format_time(now))
    .execute(pool)
    .await
    .map_err(database_error)?;

    prune_search_history(pool).await?;

    let records = list_search_history(pool).await?;
    log::debug!("saved search history query; records={}", records.len());

    Ok(records)
}

pub async fn delete_search_history(pool: &SqlitePool, id: String) -> AppResult<()> {
    sqlx::query("DELETE FROM search_history WHERE id = ?")
        .bind(&id)
        .execute(pool)
        .await
        .map_err(database_error)?;

    log::debug!("deleted search history record '{}'", id);

    Ok(())
}

async fn prune_search_history(pool: &SqlitePool) -> AppResult<()> {
    sqlx::query(
        "DELETE FROM search_history
         WHERE id NOT IN (
             SELECT id FROM search_history
             ORDER BY last_used_at DESC
             LIMIT ?
         )",
    )
    .bind(SEARCH_HISTORY_LIMIT)
    .execute(pool)
    .await
    .map_err(database_error)?;

    Ok(())
}

fn search_history_from_row(row: sqlx::sqlite::SqliteRow) -> AppResult<SearchHistoryRecord> {
    Ok(SearchHistoryRecord {
        id: row.try_get("id").map_err(database_error)?,
        query: row.try_get("query").map_err(database_error)?,
        created_at: parse_time(
            row.try_get::<String, _>("created_at")
                .map_err(database_error)?,
        )?,
        last_used_at: parse_time(
            row.try_get::<String, _>("last_used_at")
                .map_err(database_error)?,
        )?,
    })
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
