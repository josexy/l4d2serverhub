use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("Network timeout")]
    NetworkTimeout,
    #[error("Upstream request failed: {0}")]
    UpstreamUnavailable(String),
    #[error("Invalid address: {0}")]
    InvalidAddress(String),
    #[error("Steam launch failed: {0}")]
    LaunchFailed(String),
    #[error("Database error: {0}")]
    Database(String),
    #[error("Import data invalid: {0}")]
    ImportInvalid(String),
    #[error("Invalid settings: {0}")]
    InvalidSettings(String),
    #[error("Export failed: {0}")]
    ExportFailed(String),
    #[error("Log operation failed: {0}")]
    LogOperationFailed(String),
    #[error("Unexpected error: {0}")]
    Unexpected(String),
}

impl AppError {
    fn command_kind(&self) -> CommandErrorKind {
        match self {
            AppError::NetworkTimeout => CommandErrorKind::NetworkTimeout,
            AppError::UpstreamUnavailable(_) => CommandErrorKind::UpstreamUnavailable,
            AppError::InvalidAddress(_) => CommandErrorKind::InvalidAddress,
            AppError::LaunchFailed(_) => CommandErrorKind::LaunchFailed,
            AppError::Database(_) => CommandErrorKind::Database,
            AppError::ImportInvalid(_) => CommandErrorKind::ImportInvalid,
            AppError::InvalidSettings(_) => CommandErrorKind::InvalidSettings,
            AppError::ExportFailed(_) => CommandErrorKind::ExportFailed,
            AppError::LogOperationFailed(_) => CommandErrorKind::LogOperationFailed,
            AppError::Unexpected(_) => CommandErrorKind::Unexpected,
        }
    }

    fn command_message(&self) -> String {
        match self {
            AppError::Database(_) => "Local database operation failed".to_string(),
            AppError::Unexpected(_) => "Unexpected application error".to_string(),
            _ => self.to_string(),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CommandErrorKind {
    NetworkTimeout,
    UpstreamUnavailable,
    InvalidAddress,
    LaunchFailed,
    Database,
    ImportInvalid,
    InvalidSettings,
    ExportFailed,
    LogOperationFailed,
    Unexpected,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub kind: CommandErrorKind,
    pub message: String,
}

impl From<AppError> for CommandError {
    fn from(value: AppError) -> Self {
        Self {
            kind: value.command_kind(),
            message: value.command_message(),
        }
    }
}

pub type AppResult<T> = Result<T, AppError>;
pub type CommandResult<T> = Result<T, CommandError>;
