import { createDefaultFilters } from "@/lib/filters";

export const DEFAULT_APP_SETTINGS = {
  queryTimeoutMs: 10000,
  serverDetailsQueryMode: "a2sUdp",
  theme: "dark",
  language: "system",
  httpProxy: {
    mode: "system",
    customUrl: "",
  },
  serverBrowser: {
    filters: createDefaultFilters(),
    sort: "none",
    pageSize: 50,
  },
  logging: {
    enabled: false,
    level: "info",
  },
} as const;
