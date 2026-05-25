use crate::models::{LogLevel, LoggingSettings};
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};

#[derive(Debug)]
pub struct LogState {
    enabled: AtomicBool,
    level: AtomicU8,
}

impl Default for LogState {
    fn default() -> Self {
        Self::new(&LoggingSettings::default())
    }
}

impl LogState {
    pub fn new(settings: &LoggingSettings) -> Self {
        Self {
            enabled: AtomicBool::new(settings.enabled),
            level: AtomicU8::new(level_to_u8(settings.level)),
        }
    }

    pub fn apply_settings(&self, settings: &LoggingSettings) {
        self.level
            .store(level_to_u8(settings.level), Ordering::Relaxed);
        self.enabled.store(settings.enabled, Ordering::Relaxed);
    }

    pub fn enabled(&self) -> bool {
        self.enabled.load(Ordering::Relaxed)
    }

    pub fn level(&self) -> LogLevel {
        u8_to_level(self.level.load(Ordering::Relaxed))
    }

    pub fn allows(&self, level: log::Level) -> bool {
        self.enabled() && level <= self.level().to_log_level()
    }
}

impl LogLevel {
    pub fn to_log_level(self) -> log::Level {
        match self {
            LogLevel::Error => log::Level::Error,
            LogLevel::Warn => log::Level::Warn,
            LogLevel::Info => log::Level::Info,
            LogLevel::Debug => log::Level::Debug,
            LogLevel::Trace => log::Level::Trace,
        }
    }
}

fn level_to_u8(level: LogLevel) -> u8 {
    match level {
        LogLevel::Error => 1,
        LogLevel::Warn => 2,
        LogLevel::Info => 3,
        LogLevel::Debug => 4,
        LogLevel::Trace => 5,
    }
}

fn u8_to_level(value: u8) -> LogLevel {
    match value {
        1 => LogLevel::Error,
        2 => LogLevel::Warn,
        4 => LogLevel::Debug,
        5 => LogLevel::Trace,
        _ => LogLevel::Info,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn disabled_state_filters_all_levels() {
        let state = LogState::new(&LoggingSettings {
            enabled: false,
            level: LogLevel::Trace,
        });

        for level in [
            log::Level::Error,
            log::Level::Warn,
            log::Level::Info,
            log::Level::Debug,
            log::Level::Trace,
        ] {
            assert!(!state.allows(level));
        }
    }

    #[test]
    fn warn_state_allows_warn_and_above() {
        let state = LogState::new(&LoggingSettings {
            enabled: true,
            level: LogLevel::Warn,
        });

        assert!(state.allows(log::Level::Error));
        assert!(state.allows(log::Level::Warn));
        assert!(!state.allows(log::Level::Info));
        assert!(!state.allows(log::Level::Debug));
        assert!(!state.allows(log::Level::Trace));
    }

    #[test]
    fn trace_state_allows_all_levels() {
        let state = LogState::new(&LoggingSettings {
            enabled: true,
            level: LogLevel::Trace,
        });

        assert!(state.allows(log::Level::Error));
        assert!(state.allows(log::Level::Warn));
        assert!(state.allows(log::Level::Info));
        assert!(state.allows(log::Level::Debug));
        assert!(state.allows(log::Level::Trace));
    }
}
