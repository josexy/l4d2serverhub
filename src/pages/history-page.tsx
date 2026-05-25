import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  History,
  RefreshCw,
  Star,
  Trash2,
} from "lucide-react";

import { ServerDetailPanel } from "@/components/server-detail-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { HISTORY_UPDATED_EVENT, api, formatCommandError } from "@/lib/api";
import { useI18n } from "@/lib/app-preferences";
import { createDefaultFilters } from "@/lib/filters";
import { getDisplayModeTags, MODE_TAG_CLASS_NAMES } from "@/lib/mode-tags";
import { cn } from "@/lib/utils";
import type {
  Favorite,
  FavoriteGroup,
  FavoriteInput,
  HistoryRecord,
  ServerQueryResult,
  ServerSnapshot,
} from "@/lib/types";

const FALLBACK_GROUP_ID = "default";
const DEFAULT_ADDRESS_PAGE_SIZE = 50;
const ADDRESS_PAGE_SIZE_OPTIONS = [25, 50, 100];
const SELECT_COLUMN_WIDTH = 44;
const ACTIONS_COLUMN_WIDTH = 132;

type HistoryResizableColumnId =
  | "server"
  | "address"
  | "map"
  | "players"
  | "ping"
  | "tags"
  | "status"
  | "connected";

type HistoryColumnWidths = Record<HistoryResizableColumnId, number>;

type HistoryServerRow = {
  key: string;
  records: HistoryRecord[];
  latest: HistoryRecord;
  connectionCount: number;
  snapshot: ServerSnapshot | null;
  serverId: string | null;
  address: string;
  name: string;
};

const DEFAULT_COLUMN_WIDTHS: HistoryColumnWidths = {
  server: 280,
  address: 190,
  map: 150,
  players: 88,
  ping: 88,
  tags: 160,
  status: 96,
  connected: 168,
};

const MIN_COLUMN_WIDTHS: HistoryColumnWidths = {
  server: 220,
  address: 170,
  map: 120,
  players: 84,
  ping: 84,
  tags: 112,
  status: 88,
  connected: 148,
};

function formatConnectedAt(
  value: string,
  formatDateTime: ReturnType<typeof useI18n>["formatDateTime"],
): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : formatDateTime(date, {
        dateStyle: "medium",
        timeStyle: "short",
      });
}

function rowServerId(record: HistoryRecord): string | null {
  return record.serverId ?? record.lastSnapshot?.serverId ?? null;
}

function historyRecordConnectionCount(record: HistoryRecord): number {
  return Number.isFinite(record.connectionCount) && record.connectionCount > 0
    ? record.connectionCount
    : 1;
}

function historyRecordWithSnapshot(
  record: HistoryRecord,
  snapshot: ServerSnapshot,
): HistoryRecord {
  return {
    ...record,
    address: snapshot.address,
    serverId: snapshot.serverId ?? record.serverId,
    serverName: snapshot.name,
    map: snapshot.map,
    players: snapshot.players,
    maxPlayers: snapshot.maxPlayers,
    lastSnapshot: snapshot,
  };
}

function favoriteInputForHistoryRow(
  row: HistoryServerRow,
  groupId: string,
): FavoriteInput {
  return {
    address: row.address,
    serverId: row.serverId,
    groupId,
    customName: row.name || null,
    notes: "",
    tags: row.snapshot?.modeTags ?? [],
  };
}

async function resolveHistoryRowSnapshot(
  row: HistoryServerRow,
): Promise<ServerSnapshot | null> {
  if (row.snapshot) {
    return row.snapshot;
  }

  if (!row.address.trim()) {
    return null;
  }

  const details = await api.getServerDetails({
    address: row.address,
    serverId: row.serverId,
    fallbackName: row.name,
  });
  return details.snapshot;
}

function formatPing(
  pingMs: number | null | undefined,
  unknownLabel: string,
): string {
  return pingMs === null || pingMs === undefined ? unknownLabel : `${pingMs} ms`;
}

async function queryAddressSnapshots(
  addresses: string[],
  page: number,
  pageSize: number,
): Promise<{
  pageResult: ServerQueryResult;
  snapshotsByAddress: Map<string, ServerSnapshot>;
}> {
  const params = {
    page,
    pageSize,
    filters: createDefaultFilters(),
    sort: "none" as const,
    addresses,
  };
  const firstResult = await api.queryServers(params);
  const snapshotsByAddress = new Map(
    firstResult.items.map((server) => [server.address, server]),
  );
  const totalPages = Math.max(
    1,
    Math.ceil(firstResult.total / Math.max(firstResult.pageSize || pageSize, 1)),
  );
  const boundedPage = Math.min(Math.max(page, 1), totalPages);
  const extraPages = Array.from({ length: totalPages }, (_, index) => index + 1)
    .filter((nextPage) => nextPage !== firstResult.page);

  const extraResults = await Promise.all(
    extraPages.map((nextPage) =>
      api.queryServers({
        ...params,
        page: nextPage,
      }),
    ),
  );

  for (const result of extraResults) {
    for (const server of result.items) {
      snapshotsByAddress.set(server.address, server);
    }
  }

  return {
    pageResult:
      firstResult.page === boundedPage
        ? firstResult
        : extraResults.find((result) => result.page === boundedPage) ?? firstResult,
    snapshotsByAddress,
  };
}

function clampColumnWidth(
  columnId: HistoryResizableColumnId,
  width: number,
): number {
  return Math.max(MIN_COLUMN_WIDTHS[columnId], Math.round(width));
}

function ResizeHandle({
  onPointerDown,
}: {
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      className="absolute right-0 top-0 h-full w-3 cursor-col-resize touch-none"
      onPointerDown={onPointerDown}
    >
      <div className="mx-auto h-full w-px bg-border/80 transition-colors hover:bg-primary" />
    </div>
  );
}

function HistoryModeTags({
  tags,
  modeLabels,
}: {
  tags: string[];
  modeLabels: Record<string, string>;
}) {
  const displayTags = getDisplayModeTags(tags);

  if (displayTags.length === 0) {
    return <span className="text-xs text-muted-foreground">-</span>;
  }

  return (
    <div className="flex w-full min-w-0 flex-nowrap items-center gap-1 overflow-hidden py-1">
      {displayTags.map((tag) => (
        <Badge
          key={tag}
          variant="outline"
          className={cn("max-w-28 truncate", MODE_TAG_CLASS_NAMES[tag])}
        >
          {modeLabels[tag] ?? tag}
        </Badge>
      ))}
    </div>
  );
}

function getHistoryStatus(
  snapshot: ServerSnapshot | null,
  isRefreshing: boolean,
  refreshError: string | undefined,
  labels: ReturnType<typeof useI18n>["messages"]["serverTable"]["statuses"],
  refreshingLabel: string,
) {
  if (isRefreshing) {
    return { label: refreshingLabel, variant: "outline" as const };
  }

  if (refreshError || snapshot?.lastQueryError) {
    return { label: labels.error, variant: "destructive" as const };
  }

  if (!snapshot) {
    return null;
  }

  if (snapshot.maxPlayers > 0 && snapshot.players >= snapshot.maxPlayers) {
    return { label: labels.full, variant: "secondary" as const };
  }

  if (snapshot.players === 0) {
    return { label: labels.empty, variant: "outline" as const };
  }

  return { label: labels.open, variant: "default" as const };
}

function dedupeHistoryRows(history: HistoryRecord[]): HistoryServerRow[] {
  const rows: HistoryServerRow[] = [];
  const rowIndexByKey = new Map<string, number>();
  const rowKeyByServerId = new Map<string, string>();
  const rowKeyByAddress = new Map<string, string>();

  for (const record of history) {
    const serverId = rowServerId(record);
    const existingKey = serverId
      ? rowKeyByServerId.get(serverId) ?? rowKeyByAddress.get(record.address)
      : rowKeyByAddress.get(record.address);

    if (existingKey) {
      const rowIndex = rowIndexByKey.get(existingKey);
      if (rowIndex !== undefined) {
        const row = rows[rowIndex];
        row.records.push(record);
        row.connectionCount += historyRecordConnectionCount(record);
        if (serverId) {
          if (row.key.startsWith("address:")) {
            const nextKey = `server:${serverId}`;
            rowIndexByKey.delete(row.key);
            row.key = nextKey;
            rowIndexByKey.set(nextKey, rowIndex);
            rowKeyByAddress.set(row.address, nextKey);
          }
          rowKeyByServerId.set(serverId, row.key);
        }
      }
      continue;
    }

    const key = serverId ? `server:${serverId}` : `address:${record.address}`;
    const snapshot = record.lastSnapshot;
    const row: HistoryServerRow = {
      key,
      records: [record],
      latest: record,
      connectionCount: historyRecordConnectionCount(record),
      snapshot,
      serverId,
      address: snapshot?.address ?? record.address,
      name: snapshot?.name || record.serverName || record.address,
    };
    rowIndexByKey.set(key, rows.length);
    rowKeyByAddress.set(record.address, key);
    if (serverId) {
      rowKeyByServerId.set(serverId, key);
    }
    rows.push(row);
  }

  return rows.map((row) => {
    const snapshot =
      row.latest.lastSnapshot ??
      row.records.find((record) => record.lastSnapshot)?.lastSnapshot ??
      null;
    const serverId =
      rowServerId(row.latest) ??
      row.records.map(rowServerId).find((id): id is string => id !== null) ??
      null;

    return {
      ...row,
      snapshot,
      serverId,
      address: snapshot?.address ?? row.latest.address,
      name: snapshot?.name || row.latest.serverName || row.latest.address,
    };
  });
}

type HistoryPageProps = {
  isActive?: boolean;
};

export function HistoryPage({ isActive = true }: HistoryPageProps) {
  const { messages, formatDateTime } = useI18n();
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [groups, setGroups] = useState<FavoriteGroup[]>([]);
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [selectedHistoryKeys, setSelectedHistoryKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingConnectAddress, setPendingConnectAddress] = useState<
    string | null
  >(null);
  const [pendingFavoriteAddress, setPendingFavoriteAddress] = useState<
    string | null
  >(null);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(() => new Set());
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const [deleteSelectionOpen, setDeleteSelectionOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedDetailKey, setSelectedDetailKey] = useState<string | null>(
    null,
  );
  const [selectedServer, setSelectedServer] = useState<ServerSnapshot | null>(
    null,
  );
  const [loadingDetailKey, setLoadingDetailKey] = useState<string | null>(null);
  const [refreshingDetails, setRefreshingDetails] = useState(false);
  const [refreshingHistoryKeys, setRefreshingHistoryKeys] = useState<
    Set<string>
  >(() => new Set());
  const [historyRefreshErrors, setHistoryRefreshErrors] = useState<
    Map<string, string>
  >(() => new Map());
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize, setHistoryPageSize] = useState(
    DEFAULT_ADDRESS_PAGE_SIZE,
  );
  const [historyQueryResult, setHistoryQueryResult] =
    useState<ServerQueryResult | null>(null);
  const [columnWidths, setColumnWidths] = useState<HistoryColumnWidths>(
    DEFAULT_COLUMN_WIDTHS,
  );
  const [resizingColumn, setResizingColumn] =
    useState<HistoryResizableColumnId | null>(null);
  const pendingConnectAddressRef = useRef<string | null>(null);
  const pendingFavoriteAddressRef = useRef<string | null>(null);
  const deletingIdsRef = useRef<Set<string>>(new Set());
  const clearingRef = useRef(false);
  const historyLoadedRef = useRef(false);
  const refreshRunIdRef = useRef(0);
  const refreshingDetailsRef = useRef(false);
  const selectedDetailKeyRef = useRef<string | null>(null);
  const selectedDetailRecordIdsRef = useRef<string[]>([]);
  const activeColumnResizeRef = useRef<{
    columnId: HistoryResizableColumnId;
    startX: number;
    startWidth: number;
  } | null>(null);

  const rows = useMemo(() => dedupeHistoryRows(history), [history]);
  const rowByAddress = useMemo(
    () => new Map(rows.map((row) => [row.address, row] as const)),
    [rows],
  );
  const displayedRows = useMemo(() => {
    if (historyQueryResult) {
      return historyQueryResult.items
        .map((server) => rowByAddress.get(server.address))
        .filter((row): row is HistoryServerRow => row !== undefined);
    }

    const start = (historyPage - 1) * historyPageSize;
    return rows.slice(start, start + historyPageSize);
  }, [historyPage, historyPageSize, historyQueryResult, rowByAddress, rows]);
  const favoriteAddresses = useMemo(
    () => new Set(favorites.map((favorite) => favorite.address)),
    [favorites],
  );
  const defaultGroupId =
    groups.find((group) => group.id === FALLBACK_GROUP_ID)?.id ??
    FALLBACK_GROUP_ID;
  const currentRowKeys = useMemo(
    () => new Set(displayedRows.map((row) => row.key)),
    [displayedRows],
  );
  const selectedCurrentRows = displayedRows.filter((row) =>
    selectedHistoryKeys.has(row.key),
  );
  const selectedCurrentCount = selectedCurrentRows.length;
  const allCurrentSelected =
    displayedRows.length > 0 &&
    displayedRows.every((row) => selectedHistoryKeys.has(row.key));
  const selectionChecked = allCurrentSelected
    ? true
    : selectedCurrentCount > 0
      ? "indeterminate"
      : false;
  const historyTotal = historyQueryResult?.total ?? rows.length;
  const historyTotalPages = Math.max(
    1,
    Math.ceil(historyTotal / Math.max(historyPageSize, 1)),
  );
  const historyPageSizeChoices = useMemo(
    () =>
      [...new Set([...ADDRESS_PAGE_SIZE_OPTIONS, historyPageSize])].sort(
        (left, right) => left - right,
      ),
    [historyPageSize],
  );
  const tableMinWidth = useMemo(
    () =>
      SELECT_COLUMN_WIDTH +
      ACTIONS_COLUMN_WIDTH +
      Object.values(columnWidths).reduce((total, width) => total + width, 0),
    [columnWidths],
  );
  const detailFavoritePending =
    selectedServer !== null && pendingFavoriteAddress === selectedServer.address;
  const detailIsFavorite =
    selectedServer !== null && favoriteAddresses.has(selectedServer.address);

  const loadHistory = useCallback(async (showLoading = true) => {
    if (showLoading) {
      setLoading(true);
    }
    setError(null);

    try {
      const [historyResult, groupsResult, favoritesResult] = await Promise.all([
        api.listHistory(),
        api.listGroups(),
        api.listFavorites(),
      ]);
      setHistory(historyResult);
      setGroups(groupsResult);
      setFavorites(favoritesResult);
      setHistoryQueryResult(null);
      historyLoadedRef.current = true;
      return historyResult;
    } catch (loadError) {
      const message = formatCommandError(
        loadError,
        messages.history.toasts.loadFailed,
      );
      setError(message);
      toast.error(message);
      return null;
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  }, [messages.history.toasts.loadFailed]);

  useEffect(() => {
    if (!isActive) {
      return;
    }

    void loadHistory(!historyLoadedRef.current);
  }, [isActive, loadHistory]);

  useEffect(() => {
    const handleHistoryUpdated = () => {
      void loadHistory(false);
    };

    window.addEventListener(HISTORY_UPDATED_EVENT, handleHistoryUpdated);

    return () => {
      window.removeEventListener(HISTORY_UPDATED_EVENT, handleHistoryUpdated);
    };
  }, [loadHistory]);

  useEffect(() => {
    setSelectedHistoryKeys((current) => {
      const next = new Set([...current].filter((key) => currentRowKeys.has(key)));
      return next.size === current.size ? current : next;
    });
  }, [currentRowKeys]);

  useEffect(() => {
    setHistoryPage((current) => Math.min(current, historyTotalPages));
  }, [historyTotalPages]);

  useEffect(() => {
    if (!resizingColumn) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const activeResize = activeColumnResizeRef.current;
      if (!activeResize) {
        return;
      }

      const nextWidth = clampColumnWidth(
        activeResize.columnId,
        activeResize.startWidth + (event.clientX - activeResize.startX),
      );

      setColumnWidths((current) =>
        current[activeResize.columnId] === nextWidth
          ? current
          : {
              ...current,
              [activeResize.columnId]: nextWidth,
            },
      );
    };

    const handlePointerUp = () => {
      activeColumnResizeRef.current = null;
      setResizingColumn(null);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [resizingColumn]);

  const updateRecordsWithSnapshot = useCallback(
    (recordIds: string[], snapshot: ServerSnapshot) => {
      const idSet = new Set(recordIds);
      setHistory((current) =>
        current.map((record) =>
          idSet.has(record.id) ? historyRecordWithSnapshot(record, snapshot) : record,
        ),
      );
    },
    [],
  );

  const persistRecordsWithSnapshot = useCallback(
    async (recordIds: string[], snapshot: ServerSnapshot) => {
      const updatedRecords = await Promise.all(
        recordIds.map((id) => api.updateHistorySnapshot(id, snapshot)),
      );
      const updatedById = new Map(
        updatedRecords.map((record) => [record.id, record]),
      );
      setHistory((current) =>
        current.map((record) => updatedById.get(record.id) ?? record),
      );
    },
    [],
  );

  const refreshHistoryDetails = async (
    sourceRows = rows,
    requestedPage = historyPage,
    requestedPageSize = historyPageSize,
  ) => {
    if (refreshingDetailsRef.current) {
      return;
    }

    const targets = sourceRows;
    const addresses = [...new Set(targets.map((row) => row.address))];

    if (targets.length === 0) {
      toast.info(messages.history.toasts.refreshUnavailable);
      return;
    }

    const runId = refreshRunIdRef.current + 1;
    refreshRunIdRef.current = runId;
    refreshingDetailsRef.current = true;
    setRefreshingDetails(true);
    setRefreshingHistoryKeys(new Set(targets.map((row) => row.key)));
    setHistoryRefreshErrors((current) => {
      const next = new Map(current);
      targets.forEach((row) => next.delete(row.key));
      return next;
    });

    try {
      const { pageResult, snapshotsByAddress } = await queryAddressSnapshots(
        addresses,
        requestedPage,
        requestedPageSize,
      );

      if (refreshRunIdRef.current !== runId) {
        return;
      }

      const invalidRows = targets.filter(
        (row) => !snapshotsByAddress.has(row.address),
      );
      const invalidIds = invalidRows.flatMap((row) =>
        row.records.map((record) => record.id),
      );
      const updatedRecords = await Promise.all(
        targets.flatMap((row) => {
          const snapshot = snapshotsByAddress.get(row.address);
          return snapshot
            ? row.records.map((record) =>
                api.updateHistorySnapshot(record.id, snapshot),
              )
            : [];
        }),
      );

      await Promise.all(invalidIds.map((id) => api.deleteHistory(id)));

      if (refreshRunIdRef.current !== runId) {
        return;
      }

      const updatedById = new Map(
        updatedRecords.map((record) => [record.id, record]),
      );
      const invalidIdSet = new Set(invalidIds);
      setHistory((current) =>
        current
          .filter((record) => !invalidIdSet.has(record.id))
          .map((record) => updatedById.get(record.id) ?? record),
      );
      setHistoryQueryResult(pageResult);
      setHistoryPage(pageResult.page);
      setSelectedHistoryKeys((current) => {
        const next = new Set(current);
        invalidRows.forEach((row) => next.delete(row.key));
        return next;
      });

      if (
        selectedDetailRecordIdsRef.current.some((id) => invalidIdSet.has(id))
      ) {
        setDetailOpen(false);
        setSelectedDetailKey(null);
        selectedDetailKeyRef.current = null;
        selectedDetailRecordIdsRef.current = [];
        setSelectedServer(null);
      } else {
        const selectedRecordId = selectedDetailRecordIdsRef.current[0];
        const updatedRecord = selectedRecordId
          ? updatedById.get(selectedRecordId)
          : undefined;
        if (updatedRecord?.lastSnapshot) {
          setSelectedServer(updatedRecord.lastSnapshot);
        }
      }
    } catch (refreshError) {
      if (refreshRunIdRef.current !== runId) {
        return;
      }

      const message = formatCommandError(
        refreshError,
        messages.serverDetail.snapshotUnavailable,
      );
      setHistoryRefreshErrors(new Map(targets.map((row) => [row.key, message])));
      toast.error(message);
    } finally {
      if (refreshRunIdRef.current === runId) {
        refreshingDetailsRef.current = false;
        setRefreshingDetails(false);
        setRefreshingHistoryKeys(new Set());
      }
    }
  };

  const handleRefreshHistory = async () => {
    const nextHistory = await loadHistory(false);
    if (!nextHistory) {
      return;
    }

    await refreshHistoryDetails(dedupeHistoryRows(nextHistory));
  };

  const handleConnectRow = async (row: HistoryServerRow) => {
    if (pendingConnectAddressRef.current === row.address) {
      return;
    }

    pendingConnectAddressRef.current = row.address;
    setPendingConnectAddress(row.address);
    try {
      const snapshot = await resolveHistoryRowSnapshot(row);
      await api.connectToServer(row.address, snapshot);
      if (snapshot) {
        const recordIds = row.records.map((record) => record.id);
        updateRecordsWithSnapshot(recordIds, snapshot);
        await persistRecordsWithSnapshot(recordIds, snapshot);
      }
      toast.success(messages.history.toasts.connectStarted(row.address));
    } catch (connectError) {
      const message = formatCommandError(
        connectError,
        messages.history.toasts.connectFailed,
      );
      toast.error(message);
    } finally {
      pendingConnectAddressRef.current = null;
      setPendingConnectAddress(null);
    }
  };

  const handleConnectServer = async (server: ServerSnapshot) => {
    if (pendingConnectAddressRef.current === server.address) {
      return;
    }

    pendingConnectAddressRef.current = server.address;
    setPendingConnectAddress(server.address);
    try {
      await api.connectToServer(server.address, server);
      toast.success(messages.history.toasts.connectStarted(server.address));
    } catch (connectError) {
      const message = formatCommandError(
        connectError,
        messages.history.toasts.connectFailed,
      );
      toast.error(message);
    } finally {
      pendingConnectAddressRef.current = null;
      setPendingConnectAddress(null);
    }
  };

  const handleAddFavorite = async (row: HistoryServerRow) => {
    if (favoriteAddresses.has(row.address)) {
      toast.info(messages.history.toasts.alreadyFavorite);
      return;
    }

    if (pendingFavoriteAddressRef.current === row.address) {
      return;
    }

    pendingFavoriteAddressRef.current = row.address;
    setPendingFavoriteAddress(row.address);
    try {
      const favorite = await api.addFavorite(
        favoriteInputForHistoryRow(row, defaultGroupId),
      );
      setFavorites((current) => [...current, favorite]);
      toast.success(messages.history.toasts.favoriteAdded);
    } catch (favoriteError) {
      const message = formatCommandError(
        favoriteError,
        messages.history.toasts.favoriteAddFailed,
      );
      toast.error(message);
    } finally {
      pendingFavoriteAddressRef.current = null;
      setPendingFavoriteAddress(null);
    }
  };

  const handleToggleFavoriteFromDetails = async (server: ServerSnapshot) => {
    const existingFavorite = favorites.find(
      (favorite) => favorite.address === server.address,
    );

    if (pendingFavoriteAddressRef.current === server.address) {
      return;
    }

    pendingFavoriteAddressRef.current = server.address;
    setPendingFavoriteAddress(server.address);
    try {
      if (existingFavorite) {
        await api.deleteFavorite(existingFavorite.id);
        setFavorites((current) =>
          current.filter((favorite) => favorite.id !== existingFavorite.id),
        );
        toast.success(messages.serverList.toasts.favoriteRemoved);
      } else {
        const favorite = await api.addFavorite({
          address: server.address,
          serverId: server.serverId,
          groupId: defaultGroupId,
          customName: server.name,
          notes: "",
          tags: server.modeTags,
        });
        setFavorites((current) => [...current, favorite]);
        toast.success(messages.history.toasts.favoriteAdded);
      }
    } catch (favoriteError) {
      const message = formatCommandError(
        favoriteError,
        existingFavorite
          ? messages.serverList.toasts.favoriteRemoveFailed
          : messages.history.toasts.favoriteAddFailed,
      );
      toast.error(message);
    } finally {
      pendingFavoriteAddressRef.current = null;
      setPendingFavoriteAddress(null);
    }
  };

  const deleteHistoryIds = async (ids: string[]) => {
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length === 0) {
      return;
    }

    if (uniqueIds.some((id) => deletingIdsRef.current.has(id))) {
      return;
    }

    deletingIdsRef.current = new Set([...deletingIdsRef.current, ...uniqueIds]);
    setDeletingIds(new Set(deletingIdsRef.current));
    try {
      await Promise.all(uniqueIds.map((id) => api.deleteHistory(id)));
      setHistory((current) =>
        current.filter((record) => !uniqueIds.includes(record.id)),
      );
      setHistoryQueryResult(null);
      setSelectedHistoryKeys((current) => {
        const next = new Set(current);
        rows
          .filter((row) =>
            row.records.some((record) => uniqueIds.includes(record.id)),
          )
          .forEach((row) => next.delete(row.key));
        return next;
      });
      if (
        selectedDetailRecordIdsRef.current.some((id) => uniqueIds.includes(id))
      ) {
        setDetailOpen(false);
        setSelectedDetailKey(null);
        selectedDetailKeyRef.current = null;
        selectedDetailRecordIdsRef.current = [];
        setSelectedServer(null);
      }
      setDeleteSelectionOpen(false);
      toast.success(
        uniqueIds.length > 1
          ? messages.history.toasts.deletedMany(uniqueIds.length)
          : messages.history.toasts.deleted,
      );
    } catch (deleteError) {
      const message = formatCommandError(
        deleteError,
        messages.history.toasts.deleteFailed,
      );
      toast.error(message);
    } finally {
      uniqueIds.forEach((id) => deletingIdsRef.current.delete(id));
      setDeletingIds(new Set(deletingIdsRef.current));
    }
  };

  const handleClear = async () => {
    if (clearingRef.current) {
      return;
    }

    clearingRef.current = true;
    setClearing(true);
    try {
      await api.clearHistory();
      setHistory([]);
      setSelectedHistoryKeys(new Set());
      setHistoryPage(1);
      setHistoryQueryResult(null);
      setDetailOpen(false);
      setSelectedDetailKey(null);
      selectedDetailKeyRef.current = null;
      selectedDetailRecordIdsRef.current = [];
      setSelectedServer(null);
      setClearDialogOpen(false);
      toast.success(messages.history.toasts.cleared);
    } catch (clearError) {
      const message = formatCommandError(
        clearError,
        messages.history.toasts.clearFailed,
      );
      toast.error(message);
    } finally {
      clearingRef.current = false;
      setClearing(false);
    }
  };

  const openHistoryDetails = async (row: HistoryServerRow) => {
    if (!row.address.trim() && !row.snapshot) {
      toast.error(messages.serverDetail.snapshotUnavailable);
      return;
    }

    selectedDetailKeyRef.current = row.key;
    selectedDetailRecordIdsRef.current = row.records.map((record) => record.id);
    setSelectedDetailKey(row.key);
    setDetailOpen(true);

    if (row.snapshot) {
      setSelectedServer(row.snapshot);
      return;
    }

    if (!row.address.trim()) {
      setSelectedServer(null);
      return;
    }

    setSelectedServer(null);
    setLoadingDetailKey(row.key);
    try {
      const details = await api.getServerDetails({
        address: row.address,
        serverId: row.serverId,
        fallbackName: row.name,
      });
      if (selectedDetailKeyRef.current !== row.key) {
        return;
      }
      const recordIds = row.records.map((record) => record.id);
      updateRecordsWithSnapshot(recordIds, details.snapshot);
      await persistRecordsWithSnapshot(recordIds, details.snapshot);
      setSelectedServer(details.snapshot);
    } catch (detailError) {
      const message = formatCommandError(
        detailError,
        messages.serverDetail.snapshotUnavailable,
      );
      toast.error(message);
    } finally {
      setLoadingDetailKey((current) => (current === row.key ? null : current));
    }
  };

  const handleHistoryServerUpdate = (server: ServerSnapshot) => {
    setSelectedServer(server);
    const recordIds = selectedDetailRecordIdsRef.current;
    if (recordIds.length === 0) {
      return;
    }

    updateRecordsWithSnapshot(recordIds, server);
    void persistRecordsWithSnapshot(recordIds, server).catch(() => {
      toast.error(messages.history.toasts.snapshotSaveFailed);
    });
  };

  const toggleSelectAll = (checked: boolean | "indeterminate") => {
    setSelectedHistoryKeys((current) => {
      const next = new Set(current);
      if (checked === true) {
        displayedRows.forEach((row) => next.add(row.key));
      } else {
        displayedRows.forEach((row) => next.delete(row.key));
      }
      return next;
    });
  };

  const toggleSelectHistory = (
    historyKey: string,
    checked: boolean | "indeterminate",
  ) => {
    setSelectedHistoryKeys((current) => {
      const next = new Set(current);
      if (checked === true) {
        next.add(historyKey);
      } else {
        next.delete(historyKey);
      }
      return next;
    });
  };

  const handleDeleteSelection = async () => {
    await deleteHistoryIds(
      selectedCurrentRows.flatMap((row) =>
        row.records.map((record) => record.id),
      ),
    );
  };

  const startColumnResize = (
    event: ReactPointerEvent<HTMLDivElement>,
    columnId: HistoryResizableColumnId,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    activeColumnResizeRef.current = {
      columnId,
      startX: event.clientX,
      startWidth: columnWidths[columnId],
    };
    setResizingColumn(columnId);
  };

  const handleDetailOpenChange = (open: boolean) => {
    setDetailOpen(open);
    if (!open) {
      setSelectedDetailKey(null);
      selectedDetailKeyRef.current = null;
      selectedDetailRecordIdsRef.current = [];
      setSelectedServer(null);
      setLoadingDetailKey(null);
    }
  };

  return (
    <section className="page-layout">
      <div className="page-heading">
        <div>
          <p className="page-eyebrow">{messages.history.eyebrow}</p>
          <h2>{messages.history.title}</h2>
        </div>
        <div className="flex items-center gap-2">
          {selectedCurrentCount > 0 ? (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={deletingIds.size > 0}
              onClick={() => setDeleteSelectionOpen(true)}
            >
              <Trash2 data-icon="inline-start" />
              {messages.history.actions.deleteSelected}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loading || refreshingDetails}
            onClick={() => void handleRefreshHistory()}
          >
            <RefreshCw
              data-icon="inline-start"
              className={cn(refreshingDetails && "animate-spin")}
            />
            {refreshingDetails ? messages.common.refreshing : messages.common.refresh}
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={history.length === 0 || loading}
            onClick={() => setClearDialogOpen(true)}
          >
            <Trash2 data-icon="inline-start" />
            {messages.common.clear}
          </Button>
          <div className="page-meta">
            {selectedCurrentCount > 0
              ? messages.history.selectedLabel(selectedCurrentCount)
              : messages.history.rowsLabel(historyTotal)}
          </div>
        </div>
      </div>

      <div className="utility-panel flex min-h-0 flex-col overflow-hidden">
        {loading ? (
          <div className="grid min-h-72 place-items-center p-6 text-sm text-muted-foreground">
            {messages.history.loading}
          </div>
        ) : error ? (
          <div className="grid min-h-72 place-items-center p-6 text-center">
            <div className="flex max-w-md flex-col items-center gap-2">
              <p className="font-medium text-foreground">{messages.history.errorTitle}</p>
              <p className="text-sm text-muted-foreground">{error}</p>
            </div>
          </div>
        ) : rows.length === 0 ? (
          <div className="empty-panel min-h-72">
            <div className="empty-state">
              <div className="empty-state-icon">
                <History aria-hidden="true" />
              </div>
              <div>
                <h3>{messages.history.emptyTitle}</h3>
                <p>{messages.history.emptyDescription}</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto [scrollbar-gutter:stable]">
            <table
              data-slot="table"
              className="w-full table-fixed caption-bottom text-sm"
              style={{ minWidth: `${tableMinWidth}px` }}
            >
              <colgroup>
                <col style={{ width: `${SELECT_COLUMN_WIDTH}px` }} />
                <col style={{ width: `${columnWidths.server}px` }} />
                <col style={{ width: `${columnWidths.address}px` }} />
                <col style={{ width: `${columnWidths.map}px` }} />
                <col style={{ width: `${columnWidths.players}px` }} />
                <col style={{ width: `${columnWidths.ping}px` }} />
                <col style={{ width: `${columnWidths.tags}px` }} />
                <col style={{ width: `${columnWidths.status}px` }} />
                <col style={{ width: `${columnWidths.connected}px` }} />
                <col style={{ width: `${ACTIONS_COLUMN_WIDTH}px` }} />
              </colgroup>
              <TableHeader className="[&_th]:sticky [&_th]:top-0 [&_th]:z-20 [&_th]:bg-background [&_th]:shadow-[inset_0_-1px_0_var(--border)]">
                <TableRow>
                  <TableHead
                    className="w-11"
                    aria-label={messages.history.columns.select}
                  >
                    <Checkbox
                      checked={selectionChecked}
                      aria-label={messages.history.actions.selectAll}
                      onCheckedChange={toggleSelectAll}
                    />
                  </TableHead>
                  <TableHead className="relative select-none pr-3">
                    {messages.history.columns.server}
                    <ResizeHandle
                      onPointerDown={(event) => startColumnResize(event, "server")}
                    />
                  </TableHead>
                  <TableHead className="relative select-none pr-3">
                    {messages.history.columns.address}
                    <ResizeHandle
                      onPointerDown={(event) => startColumnResize(event, "address")}
                    />
                  </TableHead>
                  <TableHead className="relative select-none pr-3">
                    {messages.serverTable.columns.map}
                    <ResizeHandle
                      onPointerDown={(event) => startColumnResize(event, "map")}
                    />
                  </TableHead>
                  <TableHead className="relative select-none pr-3 text-right">
                    {messages.serverTable.columns.players}
                    <ResizeHandle
                      onPointerDown={(event) => startColumnResize(event, "players")}
                    />
                  </TableHead>
                  <TableHead className="relative select-none pr-3 text-right">
                    {messages.serverTable.columns.ping}
                    <ResizeHandle
                      onPointerDown={(event) => startColumnResize(event, "ping")}
                    />
                  </TableHead>
                  <TableHead className="relative select-none pr-3">
                    {messages.serverTable.columns.tags}
                    <ResizeHandle
                      onPointerDown={(event) => startColumnResize(event, "tags")}
                    />
                  </TableHead>
                  <TableHead className="relative select-none pr-3">
                    {messages.serverTable.columns.status}
                    <ResizeHandle
                      onPointerDown={(event) => startColumnResize(event, "status")}
                    />
                  </TableHead>
                  <TableHead className="relative select-none pr-3">
                    {messages.history.columns.connected}
                    <ResizeHandle
                      onPointerDown={(event) => startColumnResize(event, "connected")}
                    />
                  </TableHead>
                  <TableHead
                    className="w-28 text-right"
                    aria-label={messages.history.columns.actions}
                  />
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayedRows.map((row) => {
                  const isFavorite = favoriteAddresses.has(row.address);
                  const isDeleting = row.records.some((record) =>
                    deletingIds.has(record.id),
                  );
                  const isRefreshingRow =
                    refreshingHistoryKeys.has(row.key) ||
                    loadingDetailKey === row.key;
                  const refreshError = historyRefreshErrors.get(row.key);
                  const status = getHistoryStatus(
                    row.snapshot,
                    isRefreshingRow,
                    refreshError,
                    messages.serverTable.statuses,
                    messages.common.refreshing,
                  );
                  const isSelected = selectedDetailKey === row.key;

                  return (
                    <TableRow
                      key={row.key}
                      className={cn(
                        "h-11 cursor-pointer",
                        isSelected && "bg-muted/70",
                      )}
                      aria-selected={isSelected}
                      onClick={() => void openHistoryDetails(row)}
                    >
                      <TableCell
                        className="py-1.5"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <Checkbox
                          checked={selectedHistoryKeys.has(row.key)}
                          aria-label={messages.history.actions.select(row.name)}
                          disabled={isDeleting}
                          onCheckedChange={(checked) =>
                            toggleSelectHistory(row.key, checked)
                          }
                        />
                      </TableCell>
                      <TableCell className="min-w-0 py-1.5">
                        <div className="truncate font-medium">{row.name}</div>
                        {row.connectionCount > 1 ? (
                          <div className="truncate text-xs text-muted-foreground">
                            {messages.history.groupedRecordsLabel(row.connectionCount)}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell className="truncate py-1.5 font-mono text-xs">
                        {row.address}
                      </TableCell>
                      <TableCell className="truncate py-1.5">
                        {row.snapshot?.map || row.latest.map || "-"}
                      </TableCell>
                      <TableCell className="py-1.5 text-right tabular-nums">
                        {row.snapshot
                          ? `${row.snapshot.players}/${row.snapshot.maxPlayers}`
                          : `${row.latest.players}/${row.latest.maxPlayers}`}
                      </TableCell>
                      <TableCell className="py-1.5 text-right tabular-nums">
                        {row.snapshot
                          ? formatPing(
                              row.snapshot.pingMs,
                              messages.serverTable.pingUnknown,
                            )
                          : "-"}
                      </TableCell>
                      <TableCell className="min-w-0 py-1.5">
                        <HistoryModeTags
                          tags={row.snapshot?.modeTags ?? []}
                          modeLabels={messages.serverDetail.modeLabels}
                        />
                      </TableCell>
                      <TableCell className="truncate py-1.5">
                        {status ? (
                          <Badge variant={status.variant} title={refreshError}>
                            {status.label}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="truncate py-1.5 text-xs text-muted-foreground">
                        {formatConnectedAt(row.latest.connectedAt, formatDateTime)}
                      </TableCell>
                      <TableCell
                        className="py-1.5 text-right"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <div className="flex justify-end gap-1">
                          <Button
                            type="button"
                            size="icon-xs"
                            variant="outline"
                            aria-label={messages.history.actions.reconnect(row.name)}
                            disabled={pendingConnectAddress === row.address}
                            onClick={() => void handleConnectRow(row)}
                          >
                            {pendingConnectAddress === row.address ? (
                              <RefreshCw aria-hidden="true" />
                            ) : (
                              <ExternalLink aria-hidden="true" />
                            )}
                          </Button>
                          <Button
                            type="button"
                            size="icon-xs"
                            variant={isFavorite ? "secondary" : "ghost"}
                            aria-label={
                              isFavorite
                                ? messages.history.actions.favoriteExists
                                : messages.history.actions.addFavorite(row.name)
                            }
                            disabled={
                              isFavorite || pendingFavoriteAddress === row.address
                            }
                            onClick={() => void handleAddFavorite(row)}
                          >
                            {pendingFavoriteAddress === row.address ? (
                              <RefreshCw aria-hidden="true" />
                            ) : (
                              <Star
                                aria-hidden="true"
                                className={cn(isFavorite && "fill-current")}
                              />
                            )}
                          </Button>
                          <Button
                            type="button"
                            size="icon-xs"
                            variant="ghost"
                            aria-label={messages.history.actions.delete(row.name)}
                            disabled={isDeleting}
                            onClick={() =>
                              void deleteHistoryIds(
                                row.records.map((record) => record.id),
                              )
                            }
                          >
                            {isDeleting ? (
                              <RefreshCw aria-hidden="true" />
                            ) : (
                              <Trash2 aria-hidden="true" />
                            )}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </table>
          </div>
        )}
        {rows.length > 0 ? (
          <div className="flex min-h-11 items-center justify-between gap-3 border-t bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
            <span className="truncate">
              {messages.serverList.footerStatus(
                historyPage,
                historyTotalPages,
                refreshingDetails,
              )}
            </span>
            <div className="flex items-center gap-2">
              <Select
                value={String(historyPageSize)}
                disabled={refreshingDetails}
                onValueChange={(value) => {
                  const nextPageSize = Number(value);
                  setHistoryPageSize(nextPageSize);
                  setHistoryPage(1);
                  if (historyQueryResult) {
                    void refreshHistoryDetails(rows, 1, nextPageSize);
                  } else {
                    setHistoryQueryResult(null);
                  }
                }}
              >
                <SelectTrigger
                  aria-label={messages.filterToolbar.aria.rows}
                  className="h-8 min-w-20 rounded-lg"
                  size="default"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent
                  align="end"
                  className="w-max min-w-(--radix-select-trigger-width)"
                  position="popper"
                >
                  <SelectGroup>
                    {historyPageSizeChoices.map((option) => (
                      <SelectItem key={option} value={String(option)}>
                        {messages.filterToolbar.rowsLabel(option)}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={refreshingDetails || historyPage <= 1}
                onClick={() => {
                  const nextPage = Math.max(1, historyPage - 1);
                  setHistoryPage(nextPage);
                  if (historyQueryResult) {
                    void refreshHistoryDetails(rows, nextPage);
                  } else {
                    setHistoryQueryResult(null);
                  }
                }}
              >
                <ChevronLeft data-icon="inline-start" />
                {messages.common.previous}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={refreshingDetails || historyPage >= historyTotalPages}
                onClick={() => {
                  const nextPage = Math.min(historyTotalPages, historyPage + 1);
                  setHistoryPage(nextPage);
                  if (historyQueryResult) {
                    void refreshHistoryDetails(rows, nextPage);
                  } else {
                    setHistoryQueryResult(null);
                  }
                }}
              >
                {messages.common.next}
                <ChevronRight data-icon="inline-end" />
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      <ServerDetailPanel
        open={isActive && detailOpen}
        server={selectedServer}
        onOpenChange={handleDetailOpenChange}
        onConnect={(server) => void handleConnectServer(server)}
        onToggleFavorite={(server) => void handleToggleFavoriteFromDetails(server)}
        onUpdateServer={handleHistoryServerUpdate}
        connectPending={
          selectedServer !== null && pendingConnectAddress === selectedServer.address
        }
        favoritePending={detailFavoritePending}
        isFavorite={detailIsFavorite}
      />

      <Dialog open={isActive && clearDialogOpen} onOpenChange={setClearDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{messages.history.clearDialogTitle}</DialogTitle>
            <DialogDescription>{messages.history.clearDialogDescription}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={clearing}
              onClick={() => setClearDialogOpen(false)}
            >
              {messages.common.cancel}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={clearing}
              onClick={() => void handleClear()}
            >
              {clearing ? messages.common.clearing : messages.history.clearDialogTitle}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isActive && deleteSelectionOpen}
        onOpenChange={(open) => !open && setDeleteSelectionOpen(false)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{messages.history.deleteSelectedDialogTitle}</DialogTitle>
            <DialogDescription>
              {messages.history.deleteSelectedDialogDescription(selectedCurrentCount)}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={deletingIds.size > 0}
              onClick={() => setDeleteSelectionOpen(false)}
            >
              {messages.common.cancel}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deletingIds.size > 0 || selectedCurrentCount === 0}
              onClick={() => void handleDeleteSelection()}
            >
              {deletingIds.size > 0
                ? messages.common.deleting
                : messages.history.actions.deleteSelected}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
