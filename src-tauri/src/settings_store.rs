use crate::errors::{AppError, AppResult};
use crate::models::AppSettings;
use sqlx::SqlitePool;

const SETTINGS_KEY: &str = "app";

pub async fn get_settings(pool: &SqlitePool) -> AppResult<AppSettings> {
    let row: Option<(String,)> = sqlx::query_as("SELECT value_json FROM settings WHERE key = ?")
        .bind(SETTINGS_KEY)
        .fetch_optional(pool)
        .await
        .map_err(database_error)?;

    match row {
        Some((json,)) => serde_json::from_str(&json).map_err(database_error),
        None => Ok(AppSettings::default()),
    }
}

pub async fn save_settings(pool: &SqlitePool, settings: &AppSettings) -> AppResult<AppSettings> {
    settings.validate().map_err(AppError::InvalidSettings)?;

    let json = serde_json::to_string(settings).map_err(database_error)?;

    sqlx::query(
        "INSERT INTO settings (key, value_json) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json",
    )
    .bind(SETTINGS_KEY)
    .bind(json)
    .execute(pool)
    .await
    .map_err(database_error)?;

    log::info!(
        "saved settings: logging_enabled={}, logging_level={:?}",
        settings.logging.enabled,
        settings.logging.level
    );

    Ok(settings.clone())
}

fn database_error(err: impl ToString) -> AppError {
    AppError::Database(err.to_string())
}
