use crate::errors::{AppError, AppResult};
use chrono::Utc;
use sqlx::SqlitePool;

const UPSTREAM_NONCE_KEY: &str = "upstream_nonce";

pub async fn get_cached_nonce(pool: &SqlitePool) -> AppResult<Option<String>> {
    let row: Option<(String,)> = sqlx::query_as("SELECT value_json FROM app_cache WHERE key = ?")
        .bind(UPSTREAM_NONCE_KEY)
        .fetch_optional(pool)
        .await
        .map_err(database_error)?;

    match row {
        Some((json,)) => {
            let nonce = serde_json::from_str::<String>(&json).map_err(database_error)?;
            Ok(valid_cached_nonce(&nonce).then_some(nonce))
        }
        None => Ok(None),
    }
}

pub async fn save_cached_nonce(pool: &SqlitePool, nonce: &str) -> AppResult<()> {
    let nonce = nonce.trim();
    if !valid_cached_nonce(nonce) {
        return Err(AppError::UpstreamUnavailable(
            "refusing to cache invalid upstream nonce".to_string(),
        ));
    }

    let json = serde_json::to_string(nonce).map_err(database_error)?;
    sqlx::query(
        "INSERT INTO app_cache (key, value_json, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
            value_json = excluded.value_json,
            updated_at = excluded.updated_at",
    )
    .bind(UPSTREAM_NONCE_KEY)
    .bind(json)
    .bind(Utc::now().to_rfc3339())
    .execute(pool)
    .await
    .map_err(database_error)?;

    Ok(())
}

fn valid_cached_nonce(nonce: &str) -> bool {
    nonce.len() == 10 && nonce.chars().all(|character| character.is_ascii_hexdigit())
}

fn database_error(err: impl ToString) -> AppError {
    AppError::Database(err.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn cached_nonce_round_trips_when_valid() {
        let pool = crate::create_pool("sqlite::memory:").await.unwrap();

        save_cached_nonce(&pool, "f1375df788").await.unwrap();
        let cached = get_cached_nonce(&pool).await.unwrap();

        assert_eq!(cached.as_deref(), Some("f1375df788"));
    }

    #[tokio::test]
    async fn cached_nonce_ignores_corrupt_values() {
        let pool = crate::create_pool("sqlite::memory:").await.unwrap();

        sqlx::query("INSERT INTO app_cache (key, value_json, updated_at) VALUES (?, ?, ?)")
            .bind(UPSTREAM_NONCE_KEY)
            .bind(r#""not-a-valid-nonce""#)
            .bind(Utc::now().to_rfc3339())
            .execute(&pool)
            .await
            .unwrap();

        let cached = get_cached_nonce(&pool).await.unwrap();

        assert!(cached.is_none());
    }

    #[tokio::test]
    async fn save_cached_nonce_rejects_invalid_nonce() {
        let pool = crate::create_pool("sqlite::memory:").await.unwrap();

        let error = save_cached_nonce(&pool, "invalid").await.unwrap_err();

        assert!(matches!(error, AppError::UpstreamUnavailable(_)));
    }
}
