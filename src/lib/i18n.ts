import type { LanguagePreference } from "@/lib/types";
import { en } from "@/lib/i18n/locales/en";
import { zhCn } from "@/lib/i18n/locales/zh-CN";
import type { Messages } from "@/lib/i18n/types";

export type { Messages } from "@/lib/i18n/types";

export type UiLocale = "en" | "zh-CN";
export type ShellPage = "servers" | "favorites" | "history" | "settings" | "about";

export function resolveUiLocale(
  language: LanguagePreference,
  navigatorLanguage?: string,
): UiLocale {
  if (language === "en" || language === "zh-CN") {
    return language;
  }

  const candidate =
    navigatorLanguage ?? (typeof navigator !== "undefined" ? navigator.language : "en");
  return candidate.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

export function getMessages(locale: UiLocale): Messages {
  return locale === "zh-CN" ? zhCn : en;
}
