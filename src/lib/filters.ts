import type { ServerCustomRules, ServerFilters } from "./types";

export const DEFAULT_MODE_SELECTIONS = [
  "versus",
  "realism",
  "coop",
  "survival",
  "scavenge",
  "unknown",
];

export function createDefaultCustomRules(): ServerCustomRules {
  return {
    priority: "blacklist",
    whitelist: {
      ip: "",
      text: "",
    },
    blacklist: {
      ip: "",
      text: "",
    },
  };
}

export function createDefaultFilters(): ServerFilters {
  return {
    query: "",
    showOnline: true,
    showEmpty: true,
    showOfficial: true,
    showThird: true,
    modeSelections: [...DEFAULT_MODE_SELECTIONS],
    customRules: createDefaultCustomRules(),
  };
}

export function parseIpRules(value: string): string[] {
  return value
    .split(/[\n,]+/)
    .map((rule) => rule.trim())
    .filter(Boolean);
}

export function countCustomRuleLines(rules: ServerCustomRules): number {
  return [
    rules.whitelist.ip,
    rules.whitelist.text,
    rules.blacklist.ip,
    rules.blacklist.text,
  ]
    .flatMap((value) => value.split(/\r?\n/))
    .map((value) => value.trim())
    .filter(Boolean).length;
}
