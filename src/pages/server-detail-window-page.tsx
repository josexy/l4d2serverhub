import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ServerDetailContent } from "@/components/server-detail-panel";
import { FavoriteGroupPickerDialog } from "@/components/favorite-group-picker-dialog";
import { toast } from "@/components/ui/toast";
import { api, formatCommandError } from "@/lib/api";
import { useI18n } from "@/lib/app-preferences";
import {
  createFavoriteDraftFromSnapshot,
  indexFavoritesByAddress,
  type FavoriteDraft,
} from "@/lib/favorites";
import {
  readServerDetailWindowPayload,
  type ServerDetailWindowPayload,
} from "@/lib/server-detail-windows";
import type { Favorite, ServerSnapshot } from "@/lib/types";

function snapshotFromPayload(payload: ServerDetailWindowPayload): ServerSnapshot {
  if (payload.snapshot) {
    return payload.snapshot;
  }

  const [host, portText] = payload.address.split(":");
  const port = Number(portText);

  return {
    serverId: payload.serverId ?? null,
    address: payload.address,
    ip: host || payload.address,
    port: Number.isInteger(port) ? port : 0,
    name: payload.fallbackName?.trim() || payload.address,
    map: "",
    modeTags: [],
    gameDescription: null,
    serverType: null,
    environment: null,
    version: null,
    players: 0,
    maxPlayers: 0,
    bots: 0,
    pingMs: null,
    vacSecured: false,
    lastSeenAt: new Date().toISOString(),
    lastQueryError: null,
  };
}

export function ServerDetailWindowPage() {
  const { messages } = useI18n();
  const payload = useMemo(readServerDetailWindowPayload, []);
  const [server, setServer] = useState<ServerSnapshot | null>(
    payload ? snapshotFromPayload(payload) : null,
  );
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [favoriteDraft, setFavoriteDraft] = useState<FavoriteDraft | null>(null);
  const [connectPending, setConnectPending] = useState(false);
  const [favoriteActionPending, setFavoriteActionPending] = useState(false);
  const [favoriteMetadataStatus, setFavoriteMetadataStatus] = useState<
    "loading" | "ready" | "failed"
  >("loading");
  const [contextFavoriteId, setContextFavoriteId] = useState(
    payload?.favoriteId ?? null,
  );
  const persistingSnapshotRef = useRef(false);
  const favoriteMetadataRequestIdRef = useRef(0);

  const favoriteByAddress = useMemo(
    () => indexFavoritesByAddress(favorites),
    [favorites],
  );
  const favorite =
    favoriteMetadataStatus === "ready" && server
      ? favoriteByAddress.get(server.address) ?? null
      : null;
  const isFavorite =
    favoriteMetadataStatus === "ready"
      ? favorite !== null
      : contextFavoriteId !== null;
  const favoritePending =
    favoriteActionPending || favoriteMetadataStatus === "loading";

  const loadFavorites = useCallback(async () => {
    const requestId = favoriteMetadataRequestIdRef.current + 1;
    favoriteMetadataRequestIdRef.current = requestId;
    setFavoriteMetadataStatus("loading");

    try {
      const nextFavorites = await api.listFavorites();
      if (favoriteMetadataRequestIdRef.current !== requestId) {
        return false;
      }

      setFavorites(nextFavorites);
      setFavoriteMetadataStatus("ready");
      return true;
    } catch {
      if (favoriteMetadataRequestIdRef.current !== requestId) {
        return false;
      }

      setFavoriteMetadataStatus("failed");
      toast.warning(messages.serverList.toasts.favoritesMetadataUnavailable);
      return false;
    }
  }, [messages.serverList.toasts.favoritesMetadataUnavailable]);

  useEffect(() => {
    if (!server) {
      return;
    }

    document.title = server.name.trim() || server.address;
  }, [server]);

  useEffect(() => {
    const detailWindow = getCurrentWebviewWindow();
    const showReadyWindow = async () => {
      await detailWindow.show();
      await detailWindow.unminimize();
      await detailWindow.setFocus();
    };

    const timeoutId = window.setTimeout(() => {
      void showReadyWindow();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, []);

  useEffect(() => {
    void loadFavorites();

    return () => {
      favoriteMetadataRequestIdRef.current += 1;
    };
  }, [loadFavorites]);

  const handleConnect = async (nextServer: ServerSnapshot) => {
    if (connectPending) {
      return;
    }

    setConnectPending(true);
    try {
      await api.connectToServer(nextServer.address, nextServer);
      toast.success(messages.serverList.toasts.connectStarted(nextServer.address));
    } catch (connectError) {
      const message = formatCommandError(
        connectError,
        messages.serverList.toasts.connectFailed,
      );
      toast.error(message);
    } finally {
      setConnectPending(false);
    }
  };

  const handleToggleFavorite = async (nextServer: ServerSnapshot) => {
    if (favoriteMetadataStatus !== "ready") {
      await loadFavorites();
      return;
    }

    if (!favorite) {
      setFavoriteDraft(createFavoriteDraftFromSnapshot(nextServer));
      return;
    }

    if (favoriteActionPending) {
      return;
    }

    setFavoriteActionPending(true);
    try {
      await api.deleteFavorite(favorite.id);
      setFavorites((current) => current.filter((item) => item.id !== favorite.id));
      setContextFavoriteId((current) =>
        current === favorite.id ? null : current,
      );
      toast.success(messages.serverList.toasts.favoriteRemoved);
    } catch (favoriteError) {
      const message = formatCommandError(
        favoriteError,
        messages.serverList.toasts.favoriteRemoveFailed,
      );
      toast.error(message);
    } finally {
      setFavoriteActionPending(false);
    }
  };

  const handleUpdateServer = (nextServer: ServerSnapshot) => {
    setServer(nextServer);
    void api.emitServerSnapshotUpdated(nextServer);

    if (!payload || persistingSnapshotRef.current) {
      return;
    }

    const favoriteId = contextFavoriteId ?? favorite?.id ?? null;
    const historyRecordIds = payload.historyRecordIds ?? [];
    if (!favoriteId && historyRecordIds.length === 0) {
      return;
    }

    persistingSnapshotRef.current = true;
    Promise.all([
      favoriteId
        ? api.updateFavoriteSnapshot(favoriteId, nextServer).then((updatedFavorite) => {
            setFavorites((current) =>
              current.map((item) =>
                item.id === updatedFavorite.id ? updatedFavorite : item,
              ),
            );
          })
        : Promise.resolve(),
      ...historyRecordIds.map((recordId) =>
        api.updateHistorySnapshot(recordId, nextServer),
      ),
    ])
      .catch(() => {
        toast.error(messages.serverDetail.snapshotUnavailable);
      })
      .finally(() => {
        persistingSnapshotRef.current = false;
      });
  };

  return (
    <main className="h-screen min-h-0 bg-background text-foreground">
      <ServerDetailContent
        active={true}
        variant="window"
        server={server}
        onConnect={handleConnect}
        onToggleFavorite={handleToggleFavorite}
        onUpdateServer={handleUpdateServer}
        connectPending={connectPending}
        favoritePending={favoritePending}
        isFavorite={isFavorite}
      />
      <FavoriteGroupPickerDialog
        open={favoriteDraft !== null}
        draft={favoriteDraft}
        onOpenChange={(open) => {
          if (!open) {
            setFavoriteDraft(null);
          }
        }}
        onSaved={(favorite) => {
          setFavorites((current) => [...current, favorite]);
          setContextFavoriteId(favorite.id);
        }}
      />
    </main>
  );
}
