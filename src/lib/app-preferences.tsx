import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useTheme } from "next-themes";

import { api } from "@/lib/api";
import { DEFAULT_APP_SETTINGS, getMessages, resolveUiLocale, type UiLocale } from "@/lib/i18n";
import type { AppSettings } from "@/lib/types";

type EffectiveTheme = "light" | "dark";

type AppPreferencesContextValue = {
  settings: AppSettings;
  settingsLoaded: boolean;
  settingsLoadFailed: boolean;
  effectiveLocale: UiLocale;
  effectiveTheme: EffectiveTheme;
  saveSettings: (settings: AppSettings) => Promise<AppSettings>;
  replaceSettings: (settings: AppSettings) => void;
};

const AppPreferencesContext = createContext<AppPreferencesContextValue | null>(
  null,
);

const defaultSettings: AppSettings = { ...DEFAULT_APP_SETTINGS };

export function AppPreferencesProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [settingsLoadFailed, setSettingsLoadFailed] = useState(false);
  const { resolvedTheme, setTheme } = useTheme();

  useEffect(() => {
    let isMounted = true;

    const loadSettings = async () => {
      try {
        const loaded = await api.getSettings();
        if (isMounted) {
          setSettings(loaded);
          setSettingsLoadFailed(false);
        }
      } catch {
        if (isMounted) {
          setSettingsLoadFailed(true);
        }
      } finally {
        if (isMounted) {
          setSettingsLoaded(true);
        }
      }
    };

    void loadSettings();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    setTheme(settings.theme);
  }, [setTheme, settings.theme]);

  const effectiveLocale = useMemo(
    () => resolveUiLocale(settings.language),
    [settings.language],
  );
  const effectiveTheme: EffectiveTheme =
    resolvedTheme === "light" ? "light" : "dark";
  const saveSettings = useCallback(async (nextSettings: AppSettings) => {
    const saved = await api.updateSettings(nextSettings);
    setSettings(saved);
    return saved;
  }, []);
  const replaceSettings = useCallback((nextSettings: AppSettings) => {
    setSettings(nextSettings);
  }, []);

  const value = useMemo<AppPreferencesContextValue>(
    () => ({
      settings,
      settingsLoaded,
      settingsLoadFailed,
      effectiveLocale,
      effectiveTheme,
      saveSettings,
      replaceSettings,
    }),
    [
      effectiveLocale,
      effectiveTheme,
      replaceSettings,
      saveSettings,
      settings,
      settingsLoaded,
      settingsLoadFailed,
    ],
  );

  return (
    <AppPreferencesContext.Provider value={value}>
      {children}
    </AppPreferencesContext.Provider>
  );
}

export function useAppPreferences() {
  const context = useContext(AppPreferencesContext);

  if (!context) {
    throw new Error("useAppPreferences must be used within AppPreferencesProvider.");
  }

  return context;
}

export function useI18n() {
  const { effectiveLocale } = useAppPreferences();
  const messages = useMemo(() => getMessages(effectiveLocale), [effectiveLocale]);

  return {
    locale: effectiveLocale,
    messages,
    formatDateTime: (
      value: string | number | Date,
      options?: Intl.DateTimeFormatOptions,
    ) =>
      new Intl.DateTimeFormat(effectiveLocale, options).format(new Date(value)),
  };
}
