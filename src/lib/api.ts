import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import type {
  AppSettings,
  BackupPayload,
  CommandError,
  Favorite,
  FavoriteGroup,
  FavoriteInput,
  HistoryRecord,
  SavedServerSnapshotProgressEvent,
  SavedServerSnapshotQueryParams,
  SavedServerSnapshotQueryResult,
  SearchHistoryRecord,
  ServerSnapshotUpdatedEvent,
  ServerDetails,
  ServerQueryParams,
  ServerQueryResult,
  ServerSnapshot,
} from "./types";

export const HISTORY_UPDATED_EVENT = "l4d2:history-updated";
export const SETTINGS_UPDATED_EVENT = "l4d2:settings-updated";
export const SERVER_SNAPSHOT_UPDATED_EVENT = "l4d2:server-snapshot-updated";
export const SAVED_SERVER_SNAPSHOT_PROGRESS_EVENT =
  "l4d2:saved-server-snapshot-progress";

function createRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

async function querySavedServerSnapshotsWithProgress(
  params: SavedServerSnapshotQueryParams,
  onProgress: (event: SavedServerSnapshotProgressEvent) => void,
): Promise<SavedServerSnapshotQueryResult> {
  const requestId = createRequestId();
  let unlisten: (() => void) | null = null;

  try {
    unlisten = await listen<SavedServerSnapshotProgressEvent>(
      SAVED_SERVER_SNAPSHOT_PROGRESS_EVENT,
      (event) => {
        if (event.payload.requestId === requestId) {
          onProgress(event.payload);
        }
      },
    );

    return await invoke<SavedServerSnapshotQueryResult>(
      "query_saved_server_snapshots",
      {
        params: { ...params, requestId },
      },
    );
  } finally {
    unlisten?.();
  }
}

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
  querySavedServerSnapshots: (params: SavedServerSnapshotQueryParams) =>
    invoke<SavedServerSnapshotQueryResult>("query_saved_server_snapshots", {
      params,
    }),
  querySavedServerSnapshotsWithProgress,
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
  updateSettings: async (settings: AppSettings) => {
    const saved = await invoke<AppSettings>("update_settings", { settings });
    await emit(SETTINGS_UPDATED_EVENT, saved);
    return saved;
  },
  emitServerSnapshotUpdated: (snapshot: ServerSnapshot) =>
    emit(SERVER_SNAPSHOT_UPDATED_EVENT, {
      snapshot,
    } satisfies ServerSnapshotUpdatedEvent),
  listenServerSnapshotUpdated: (
    onSnapshotUpdated: (payload: ServerSnapshotUpdatedEvent) => void,
  ) =>
    listen<ServerSnapshotUpdatedEvent>(
      SERVER_SNAPSHOT_UPDATED_EVENT,
      (event) => {
        onSnapshotUpdated(event.payload);
      },
    ),
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
