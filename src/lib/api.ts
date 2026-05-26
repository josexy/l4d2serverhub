import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import type {
  AppSettings,
  BackupPayload,
  CommandError,
  Favorite,
  FavoriteGroup,
  FavoriteInput,
  HistoryRecord,
  SearchHistoryRecord,
  ServerDetails,
  ServerQueryParams,
  ServerQueryResult,
  ServerSnapshot,
} from "./types";

export const HISTORY_UPDATED_EVENT = "l4d2:history-updated";

export const api = {
  getAppVersion: () => getVersion(),
  queryServers: (params: ServerQueryParams) =>
    invoke<ServerQueryResult>("query_servers", { params }),
  getServerDetails: ({
    address,
    serverId = null,
    fallbackName = null,
  }: {
    address: string;
    serverId?: string | null;
    fallbackName?: string | null;
  }) =>
    invoke<ServerDetails>("get_server_details", {
      address,
      serverId,
      fallbackName,
    }),
  connectToServer: (
    address: string,
    historySnapshot: ServerSnapshot | null = null,
  ) =>
    invoke<void>("connect_to_server", { address, historySnapshot }).then(
      (result) => {
        if (historySnapshot && typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent(HISTORY_UPDATED_EVENT));
        }

        return result;
      },
    ),
  listFavorites: () => invoke<Favorite[]>("list_favorites"),
  addFavorite: (input: FavoriteInput) =>
    invoke<Favorite>("add_favorite", { input }),
  updateFavorite: (id: string, input: FavoriteInput) =>
    invoke<Favorite>("update_favorite", { id, input }),
  updateFavoriteSnapshot: (id: string, snapshot: ServerSnapshot) =>
    invoke<Favorite>("update_favorite_snapshot", { id, snapshot }),
  moveFavoritesToGroup: (ids: string[], groupId: string) =>
    invoke<Favorite[]>("move_favorites_to_group", { ids, groupId }),
  deleteFavorite: (id: string) => invoke<void>("delete_favorite", { id }),
  listGroups: () => invoke<FavoriteGroup[]>("list_groups"),
  createGroup: (name: string) => invoke<FavoriteGroup>("create_group", { name }),
  updateGroup: (id: string, name: string) =>
    invoke<FavoriteGroup>("update_group", { id, name }),
  deleteGroup: (id: string) => invoke<void>("delete_group", { id }),
  listHistory: () => invoke<HistoryRecord[]>("list_history"),
  updateHistorySnapshot: (id: string, snapshot: ServerSnapshot) =>
    invoke<HistoryRecord>("update_history_snapshot", { id, snapshot }),
  deleteHistory: (id: string) => invoke<void>("delete_history", { id }),
  clearHistory: () => invoke<void>("clear_history"),
  listSearchHistory: () => invoke<SearchHistoryRecord[]>("list_search_history"),
  addSearchHistory: (query: string) =>
    invoke<SearchHistoryRecord[]>("add_search_history", { query }),
  deleteSearchHistory: (id: string) =>
    invoke<void>("delete_search_history", { id }),
  getSettings: () => invoke<AppSettings>("get_settings"),
  updateSettings: (settings: AppSettings) =>
    invoke<AppSettings>("update_settings", { settings }),
  exportData: () => invoke<BackupPayload>("export_data"),
  openLogFolder: () => invoke<void>("open_log_folder"),
  clearLogFiles: () => invoke<number>("clear_log_files"),
  writeExportFile: (path: string, contents: string) =>
    invoke<void>("write_export_file", { path, contents }),
  importData: (payload: BackupPayload) =>
    invoke<BackupPayload>("import_data", { payload }),
};

export function formatCommandError(
  error: unknown,
  fallback = "Unexpected command error.",
): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string" && error.trim()) {
    return error;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as CommandError).message === "string"
  ) {
    return (error as CommandError).message;
  }

  return fallback;
}
