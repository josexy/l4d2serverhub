export type QueryRegion = "asia" | "all";
export type ThemePreference = "system" | "light" | "dark";
export type LanguagePreference = "system" | "en" | "zh-CN";
export type HttpProxyMode = "none" | "system" | "custom";
export type LogLevel = "error" | "warn" | "info" | "debug" | "trace";
export type CommandErrorKind =
  | "networkTimeout"
  | "upstreamUnavailable"
  | "invalidAddress"
  | "launchFailed"
  | "database"
  | "importInvalid"
  | "invalidSettings"
  | "exportFailed"
  | "unexpected";
export type ServerSort = "none" | "playersDesc" | "playersAsc";
export type CustomRulePriority = "whitelist" | "blacklist";

export interface CommandError {
  kind: CommandErrorKind;
  message: string;
}

export interface ServerAddress {
  ip: string;
  port: number;
}

export interface ServerSnapshot {
  serverId: string | null;
  address: string;
  ip: string;
  port: number;
  name: string;
  map: string;
  modeTags: string[];
  gameDescription: string | null;
  serverType: string | null;
  environment: string | null;
  version: string | null;
  players: number;
  maxPlayers: number;
  bots: number;
  pingMs: number | null;
  vacSecured: boolean;
  lastSeenAt: string;
  lastQueryError: string | null;
}

export interface ServerPlayer {
  name: string;
  score: number;
  durationSec: number;
  durationFormatted: string;
}

export interface ServerDetails {
  snapshot: ServerSnapshot;
  players: ServerPlayer[];
}

export interface Favorite {
  id: string;
  address: string;
  serverId: string | null;
  groupId: string;
  customName: string | null;
  notes: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  lastConnectedAt: string | null;
  lastSnapshot: ServerSnapshot | null;
}

export interface FavoriteInput {
  address: string;
  serverId?: string | null;
  groupId: string;
  customName: string | null;
  notes: string;
  tags: string[];
}

export interface FavoriteGroup {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface HistoryRecord {
  id: string;
  address: string;
  serverId: string | null;
  serverName: string;
  map: string;
  players: number;
  maxPlayers: number;
  connectedAt: string;
  connectionCount: number;
  lastSnapshot: ServerSnapshot | null;
}

export interface SearchHistoryRecord {
  id: string;
  query: string;
  createdAt: string;
  lastUsedAt: string;
}

export interface AppSettings {
  queryTimeoutMs: number;
  theme: ThemePreference;
  language: LanguagePreference;
  httpProxy: HttpProxySettings;
  serverBrowser: ServerBrowserSettings;
  logging: LoggingSettings;
}

export interface HttpProxySettings {
  mode: HttpProxyMode;
  customUrl: string;
}

export interface LoggingSettings {
  enabled: boolean;
  level: LogLevel;
}

export interface CustomRuleBlock {
  ip: string;
  text: string;
}

export interface ServerCustomRules {
  priority: CustomRulePriority;
  whitelist: CustomRuleBlock;
  blacklist: CustomRuleBlock;
}

export interface ServerFilters {
  query: string;
  showOnline: boolean;
  showEmpty: boolean;
  showOfficial: boolean;
  showThird: boolean;
  modeSelections: string[];
  customRules: ServerCustomRules;
}

export interface ServerBrowserSettings {
  filters: ServerFilters;
  sort: ServerSort;
  pageSize: number;
}

export interface ServerQueryParams {
  page: number;
  pageSize: number;
  filters: ServerFilters;
  sort: ServerSort;
  addresses?: string[];
}

export interface ServerQueryResult {
  items: ServerSnapshot[];
  page: number;
  pageSize: number;
  total: number;
  refreshedAt: string | null;
}

export interface BackupPayload {
  version: number;
  settings: AppSettings;
  groups: FavoriteGroup[];
  favorites: Favorite[];
  history: HistoryRecord[];
}
