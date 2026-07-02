use std::io;

use crate::models::{AppSettings, LanguagePreference};
use tauri::{
    menu::{MenuBuilder, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Runtime, WebviewWindow, WindowEvent,
};

const MAIN_WINDOW_LABEL: &str = "main";
const MENU_OPEN_MAIN: &str = "open_main";
const MENU_QUIT: &str = "quit";
const TRAY_TOOLTIP: &str = "L4D2 Server Hub";

pub struct SystemTrayState<R: Runtime> {
    open_main_item: MenuItem<R>,
    quit_item: MenuItem<R>,
}

impl<R: Runtime> SystemTrayState<R> {
    fn new(open_main_item: MenuItem<R>, quit_item: MenuItem<R>) -> Self {
        Self {
            open_main_item,
            quit_item,
        }
    }
}

pub fn setup_system_tray<R: Runtime>(
    app: &tauri::App<R>,
    settings: &AppSettings,
) -> tauri::Result<()> {
    let labels = tray_labels(&settings.language);
    let open_main_item =
        MenuItem::with_id(app, MENU_OPEN_MAIN, labels.open_main, true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, MENU_QUIT, labels.quit, true, None::<&str>)?;
    let menu = MenuBuilder::new(app)
        .item(&open_main_item)
        .separator()
        .item(&quit_item)
        .build()?;

    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| tauri::Error::Io(io::Error::other("missing default window icon")))?;

    TrayIconBuilder::new()
        .icon(icon)
        .tooltip(TRAY_TOOLTIP)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            MENU_OPEN_MAIN => show_main_window(app),
            MENU_QUIT => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    app.manage(SystemTrayState::new(open_main_item, quit_item));

    Ok(())
}

pub fn apply_tray_language<R: Runtime>(
    app: &AppHandle<R>,
    language: &LanguagePreference,
) -> tauri::Result<()> {
    let Some(state) = app.try_state::<SystemTrayState<R>>() else {
        log::warn!("system tray state was not registered before language update");
        return Ok(());
    };
    let labels = tray_labels(language);
    state.open_main_item.set_text(labels.open_main)?;
    state.quit_item.set_text(labels.quit)?;
    Ok(())
}

pub fn register_close_to_tray<R: Runtime>(window: &WebviewWindow<R>) {
    let close_window = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            if let Err(err) = close_window.hide() {
                log::warn!("failed to hide main window to system tray: {err}");
            } else {
                log::debug!("main window hidden to system tray");
            }
        }
    });
}

pub fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
    let Some(window) = app_main_window(app) else {
        log::warn!("failed to find main window for system tray action");
        return;
    };

    if let Err(err) = window.show() {
        log::warn!("failed to show main window from system tray: {err}");
        return;
    }
    if let Err(err) = window.unminimize() {
        log::warn!("failed to unminimize main window from system tray: {err}");
    }
    if let Err(err) = window.set_focus() {
        log::warn!("failed to focus main window from system tray: {err}");
    }
}

fn app_main_window<R: Runtime>(app: &AppHandle<R>) -> Option<WebviewWindow<R>> {
    app.get_webview_window(MAIN_WINDOW_LABEL)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct TrayLabels {
    open_main: &'static str,
    quit: &'static str,
}

fn tray_labels(language: &LanguagePreference) -> TrayLabels {
    match resolve_tray_locale(language) {
        TrayLocale::En => TrayLabels {
            open_main: "Open Main Window",
            quit: "Quit",
        },
        TrayLocale::ZhCn => TrayLabels {
            open_main: "打开主界面",
            quit: "退出",
        },
    }
}

fn resolve_tray_locale(language: &LanguagePreference) -> TrayLocale {
    match language {
        LanguagePreference::En => TrayLocale::En,
        LanguagePreference::ZhCn => TrayLocale::ZhCn,
        LanguagePreference::System => system_tray_locale(),
    }
}

fn system_tray_locale() -> TrayLocale {
    let locale = sys_locale::get_locale()
        .or_else(system_locale_from_environment)
        .unwrap_or_default();

    if is_chinese_locale(&locale) {
        TrayLocale::ZhCn
    } else {
        TrayLocale::En
    }
}

fn system_locale_from_environment() -> Option<String> {
    ["LC_ALL", "LC_MESSAGES", "LANG"]
        .into_iter()
        .find_map(|key| {
            std::env::var(key)
                .ok()
                .filter(|value| !value.trim().is_empty())
        })
}

fn is_chinese_locale(locale: &str) -> bool {
    let normalized = locale.trim().to_ascii_lowercase().replace('_', "-");
    normalized == "zh" || normalized.starts_with("zh-")
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TrayLocale {
    En,
    ZhCn,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tray_labels_use_explicit_english() {
        assert_eq!(
            tray_labels(&LanguagePreference::En),
            TrayLabels {
                open_main: "Open Main Window",
                quit: "Quit",
            }
        );
    }

    #[test]
    fn tray_labels_use_explicit_chinese() {
        assert_eq!(
            tray_labels(&LanguagePreference::ZhCn),
            TrayLabels {
                open_main: "\u{6253}\u{5f00}\u{4e3b}\u{754c}\u{9762}",
                quit: "\u{9000}\u{51fa}",
            }
        );
    }

    #[test]
    fn chinese_locale_detection_accepts_common_windows_locale_names() {
        assert!(is_chinese_locale("zh-CN"));
        assert!(is_chinese_locale("zh_Hans_CN"));
        assert!(is_chinese_locale("ZH-cn"));
        assert!(!is_chinese_locale("en-US"));
    }
}
