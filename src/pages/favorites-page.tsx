import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  Edit,
  ExternalLink,
  Folder,
  FolderOpen,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  Star,
  Trash2,
} from "lucide-react";

import { FavoriteEditorDialog } from "@/components/favorite-editor-dialog";
import { ServerDetailPanel } from "@/components/server-detail-panel";
import { SortableTableHead } from "@/components/sortable-table-head";
import { TablePagination } from "@/components/table-pagination";
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
import { Input } from "@/components/ui/input";
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
import { api, formatCommandError } from "@/lib/api";
import { useAppPreferences, useI18n } from "@/lib/app-preferences";
import { createDefaultFilters } from "@/lib/filters";
import { getDisplayModeTags, MODE_TAG_CLASS_NAMES } from "@/lib/mode-tags";
import { openServerDetailWindow } from "@/lib/server-detail-windows";
import {
  createDefaultSortState,
  nextSortState,
  sortCurrentPage,
  type SortValue,
  type TableSortState,
} from "@/lib/table-sorting";
import { cn } from "@/lib/utils";
import type {
  Favorite,
  FavoriteGroup,
  FavoriteInput,
  SavedServerSnapshotProgressEvent,
  SavedServerSnapshotQueryTarget,
  ServerQueryResult,
  ServerSnapshot,
} from "@/lib/types";

const DEFAULT_GROUP_ID = "default";
const DEFAULT_ADDRESS_PAGE_SIZE = 50;
const ADDRESS_PAGE_SIZE_OPTIONS = [25, 50, 100];
const SIDEBAR_MIN_WIDTH = 220;
const SIDEBAR_MAX_WIDTH = 520;
const SELECT_COLUMN_WIDTH = 44;
const ACTIONS_COLUMN_WIDTH = 132;

type FavoriteResizableColumnId =
  | "server"
  | "address"
  | "map"
  | "players"
  | "ping"
  | "tags"
  | "status";

type FavoriteColumnWidths = Record<FavoriteResizableColumnId, number>;
type FavoriteSortColumnId = FavoriteResizableColumnId;

const DEFAULT_COLUMN_WIDTHS: FavoriteColumnWidths = {
  server: 280,
  address: 190,
  map: 150,
  players: 88,
  ping: 88,
  tags: 160,
  status: 96,
};

const MIN_COLUMN_WIDTHS: FavoriteColumnWidths = {
  server: 220,
  address: 170,
  map: 120,
  players: 84,
  ping: 84,
  tags: 112,
  status: 88,
};

function displayFavoriteName(favorite: Favorite): string {
  return favorite.customName || favorite.lastSnapshot?.name || favorite.address;
}

function displayFavoriteAddress(favorite: Favorite): string {
  return favorite.lastSnapshot?.address || favorite.address;
}

function favoriteServerId(favorite: Favorite): string | null {
  const serverId = favorite.serverId ?? favorite.lastSnapshot?.serverId ?? "";
  return serverId.trim() || null;
}

function favoriteAddressKey(address: string): string {
  const trimmedAddress = address.trim();
  const portSeparatorIndex = trimmedAddress.lastIndexOf(":");

  if (portSeparatorIndex === -1) {
    return trimmedAddress.toLowerCase();
  }

  const host = trimmedAddress.slice(0, portSeparatorIndex).toLowerCase();
  const portText = trimmedAddress.slice(portSeparatorIndex + 1);
  const port = Number(portText);
  return Number.isInteger(port) ? `${host}:${port}` : `${host}:${portText}`;
}

async function resolveFavoriteSnapshot(
  favorite: Favorite,
): Promise<ServerSnapshot | null> {
  if (favorite.lastSnapshot) {
    return favorite.lastSnapshot;
  }

  if (!favorite.address.trim()) {
    return null;
  }

  const details = await api.getServerDetails({
    address: favorite.address,
    serverId: favoriteServerId(favorite),
    fallbackName: favorite.customName,
  });
  return details.snapshot;
}

function favoriteTags(favorite: Favorite): string[] {
  return favorite.lastSnapshot?.modeTags.length
    ? favorite.lastSnapshot.modeTags
    : favorite.tags;
}

function formatPing(pingMs: number | null | undefined, unknownLabel: string) {
  return pingMs === null || pingMs === undefined ? unknownLabel : `${pingMs} ms`;
}

function favoriteSnapshotTarget(
  favorite: Favorite,
): SavedServerSnapshotQueryTarget {
  return {
    address: favorite.address,
    serverId: favoriteServerId(favorite),
    fallbackName: favorite.customName ?? favorite.lastSnapshot?.name ?? null,
    fallbackSnapshot: favorite.lastSnapshot,
  };
}

async function queryAddressSnapshots(
  targets: SavedServerSnapshotQueryTarget[],
  page: number,
  pageSize: number,
  useA2s: boolean,
  onProgress?: (event: SavedServerSnapshotProgressEvent) => void,
): Promise<{
  pageResult: ServerQueryResult;
  snapshotsByAddress: Map<string, ServerSnapshot>;
}> {
  if (useA2s) {
    const params = {
      targets,
      page,
      pageSize,
    };
    const result = onProgress
      ? await api.querySavedServerSnapshotsWithProgress(params, onProgress)
      : await api.querySavedServerSnapshots(params);

    return {
      pageResult: result.pageResult,
      snapshotsByAddress: new Map(
        result.snapshots.map((server) => [server.address, server]),
      ),
    };
  }

  const addresses = targets.map((target) => target.address);
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

function pageResultWithSnapshot(
  current: ServerQueryResult | null,
  snapshot: ServerSnapshot,
): ServerQueryResult | null {
  if (!current) {
    return current;
  }

  let changed = false;
  const items = current.items.map((item) => {
    if (item.address !== snapshot.address) {
      return item;
    }

    changed = true;
    return snapshot;
  });

  return changed ? { ...current, items } : current;
}

function getFavoriteStatus(
  favorite: Favorite,
  isRefreshing: boolean,
  refreshError: string | undefined,
  labels: ReturnType<typeof useI18n>["messages"]["serverTable"]["statuses"],
  refreshingLabel: string,
) {
  if (isRefreshing) {
    return { label: refreshingLabel, variant: "outline" as const };
  }

  const snapshot = favorite.lastSnapshot;
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

function normalizeGroups(
  groups: FavoriteGroup[],
  fallbackDefaultGroup: FavoriteGroup,
): FavoriteGroup[] {
  const byId = new Map(groups.map((group) => [group.id, group]));
  if (!byId.has(DEFAULT_GROUP_ID)) {
    byId.set(DEFAULT_GROUP_ID, fallbackDefaultGroup);
  }

  return [...byId.values()].sort((left, right) => {
    if (left.id === DEFAULT_GROUP_ID) {
      return -1;
    }
    if (right.id === DEFAULT_GROUP_ID) {
      return 1;
    }
    return left.name.localeCompare(right.name);
  });
}

function clampColumnWidth(
  columnId: FavoriteResizableColumnId,
  width: number,
): number {
  return Math.max(MIN_COLUMN_WIDTHS[columnId], Math.round(width));
}

function clampSidebarWidth(width: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width));
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

function FavoriteModeTags({
  tags,
  modeLabels,
}: {
  tags: string[];
  modeLabels: Record<string, string>;
}) {
  const displayTags = getDisplayModeTags(tags);

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

function activeSortDirection(
  sortState: TableSortState<FavoriteSortColumnId>,
  columnId: FavoriteSortColumnId,
) {
  return sortState.column === columnId ? sortState.direction : "none";
}

type FavoritesPageProps = {
  isActive?: boolean;
};

export function FavoritesPage({ isActive = true }: FavoritesPageProps) {
  const { messages } = useI18n();
  const { settings } = useAppPreferences();
  const fallbackDefaultGroup = useMemo<FavoriteGroup>(
    () => ({
      id: DEFAULT_GROUP_ID,
      name: messages.favorites.defaultGroup,
      createdAt: "",
      updatedAt: "",
    }),
    [messages.favorites.defaultGroup],
  );
  const [groups, setGroups] = useState<FavoriteGroup[]>([]);
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState(DEFAULT_GROUP_ID);
  const [selectedFavoriteIds, setSelectedFavoriteIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingFavorite, setEditingFavorite] = useState<Favorite | null>(null);
  const [savingFavorite, setSavingFavorite] = useState(false);
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [renameGroup, setRenameGroup] = useState<FavoriteGroup | null>(null);
  const [renameGroupName, setRenameGroupName] = useState("");
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null);
  const [deleteFavorite, setDeleteFavorite] = useState<Favorite | null>(null);
  const [deleteSelectionOpen, setDeleteSelectionOpen] = useState(false);
  const [moveSelectionOpen, setMoveSelectionOpen] = useState(false);
  const [moveTargetGroupId, setMoveTargetGroupId] = useState("");
  const [movingFavoriteIds, setMovingFavoriteIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [deleteGroup, setDeleteGroup] = useState<FavoriteGroup | null>(null);
  const [deletingFavoriteIds, setDeletingFavoriteIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [deletingGroupId, setDeletingGroupId] = useState<string | null>(null);
  const [pendingConnectAddress, setPendingConnectAddress] = useState<
    string | null
  >(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedDetailFavoriteId, setSelectedDetailFavoriteId] = useState<
    string | null
  >(null);
  const [selectedServer, setSelectedServer] = useState<ServerSnapshot | null>(
    null,
  );
  const [loadingDetailFavoriteId, setLoadingDetailFavoriteId] = useState<
    string | null
  >(null);
  const [refreshingDetails, setRefreshingDetails] = useState(false);
  const [refreshingFavoriteIds, setRefreshingFavoriteIds] = useState<
    Set<string>
  >(() => new Set());
  const [favoriteRefreshErrors, setFavoriteRefreshErrors] = useState<
    Map<string, string>
  >(() => new Map());
  const [favoritePage, setFavoritePage] = useState(1);
  const [favoritePageSize, setFavoritePageSize] = useState(
    DEFAULT_ADDRESS_PAGE_SIZE,
  );
  const [favoriteQueryResult, setFavoriteQueryResult] =
    useState<ServerQueryResult | null>(null);
  const [showGroupSidebar, setShowGroupSidebar] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [resizingSidebar, setResizingSidebar] = useState(false);
  const [columnWidths, setColumnWidths] = useState<FavoriteColumnWidths>(
    DEFAULT_COLUMN_WIDTHS,
  );
  const [sortState, setSortState] = useState<
    TableSortState<FavoriteSortColumnId>
  >(() => createDefaultSortState());
  const [resizingColumn, setResizingColumn] =
    useState<FavoriteResizableColumnId | null>(null);
  const savingFavoriteRef = useRef(false);
  const creatingGroupRef = useRef(false);
  const renamingGroupIdRef = useRef<string | null>(null);
  const movingFavoriteIdsRef = useRef<Set<string>>(new Set());
  const deletingFavoriteIdsRef = useRef<Set<string>>(new Set());
  const deletingGroupIdRef = useRef<string | null>(null);
  const pendingConnectAddressRef = useRef<string | null>(null);
  const selectedDetailFavoriteIdRef = useRef<string | null>(null);
  const refreshRunIdRef = useRef(0);
  const refreshingDetailsRef = useRef(false);
  const activeSidebarResizeRef = useRef<{
    startX: number;
    startWidth: number;
  } | null>(null);
  const activeColumnResizeRef = useRef<{
    columnId: FavoriteResizableColumnId;
    startX: number;
    startWidth: number;
  } | null>(null);

  const visibleGroups = useMemo(
    () => normalizeGroups(groups, fallbackDefaultGroup),
    [fallbackDefaultGroup, groups],
  );

  const displayGroupName = useCallback(
    (group: FavoriteGroup) =>
      group.id === DEFAULT_GROUP_ID && group.name === "Default"
        ? messages.favorites.defaultGroup
        : group.name,
    [messages.favorites.defaultGroup],
  );

  const favoritesByGroup = useMemo(() => {
    const grouped = new Map<string, Favorite[]>();
    for (const group of visibleGroups) {
      grouped.set(group.id, []);
    }

    for (const favorite of favorites) {
      const groupId = grouped.has(favorite.groupId)
        ? favorite.groupId
        : DEFAULT_GROUP_ID;
      grouped.get(groupId)?.push(favorite);
    }

    return grouped;
  }, [favorites, visibleGroups]);

  const selectedGroup =
    visibleGroups.find((group) => group.id === selectedGroupId) ??
    visibleGroups[0] ??
    fallbackDefaultGroup;
  const currentFavorites = favoritesByGroup.get(selectedGroup.id) ?? [];
  const favoriteAddressKeys = useMemo(
    () =>
      new Set(
        favorites.map(
          (favorite) =>
            `${favorite.groupId}\u0000${favoriteAddressKey(favorite.address)}`,
        ),
      ),
    [favorites],
  );
  const sortedCurrentFavorites = useMemo(
    () =>
      sortCurrentPage(
        currentFavorites,
        sortState,
        (favorite, column): SortValue => {
          const snapshot = favorite.lastSnapshot;

          switch (column) {
            case "server":
              return displayFavoriteName(favorite);
            case "address":
              return displayFavoriteAddress(favorite);
            case "map":
              return snapshot?.map;
            case "players":
              return snapshot?.players;
            case "ping":
              return snapshot?.pingMs;
            case "tags":
              return favoriteTags(favorite)
                .map(
                  (tag) =>
                    (messages.serverDetail.modeLabels as Record<string, string>)[
                      tag
                    ] ?? tag,
                )
                .join(", ");
            case "status": {
              const status = getFavoriteStatus(
                favorite,
                refreshingFavoriteIds.has(favorite.id) ||
                  loadingDetailFavoriteId === favorite.id,
                favoriteRefreshErrors.get(favorite.id),
                messages.serverTable.statuses,
                messages.common.refreshing,
              );
              return status?.label;
            }
          }
        },
      ),
    [
      currentFavorites,
      favoriteRefreshErrors,
      loadingDetailFavoriteId,
      messages.common.refreshing,
      messages.serverDetail.modeLabels,
      messages.serverTable.statuses,
      refreshingFavoriteIds,
      sortState,
    ],
  );
  const sortedDisplayedFavorites = useMemo(() => {
    const start = (favoritePage - 1) * favoritePageSize;
    return sortedCurrentFavorites.slice(start, start + favoritePageSize);
  }, [favoritePage, favoritePageSize, sortedCurrentFavorites]);
  const currentFavoriteIds = useMemo(
    () => new Set(sortedDisplayedFavorites.map((favorite) => favorite.id)),
    [sortedDisplayedFavorites],
  );
  const selectedCurrentCount = [...selectedFavoriteIds].filter((id) =>
    currentFavoriteIds.has(id),
  ).length;
  const allCurrentSelected =
    sortedDisplayedFavorites.length > 0 &&
    sortedDisplayedFavorites.every((favorite) =>
      selectedFavoriteIds.has(favorite.id),
    );
  const selectionChecked = allCurrentSelected
    ? true
    : selectedCurrentCount > 0
      ? "indeterminate"
      : false;
  const favoriteTotal = currentFavorites.length;
  const favoriteTotalPages = Math.max(
    1,
    Math.ceil(favoriteTotal / Math.max(favoritePageSize, 1)),
  );
  const favoritePageSizeChoices = useMemo(
    () =>
      [...new Set([...ADDRESS_PAGE_SIZE_OPTIONS, favoritePageSize])].sort(
        (left, right) => left - right,
      ),
    [favoritePageSize],
  );
  const moveTargetGroups = useMemo(
    () => visibleGroups.filter((group) => group.id !== selectedGroup.id),
    [selectedGroup.id, visibleGroups],
  );
  const tableMinWidth = useMemo(
    () =>
      SELECT_COLUMN_WIDTH +
      ACTIONS_COLUMN_WIDTH +
      Object.values(columnWidths).reduce((total, width) => total + width, 0),
    [columnWidths],
  );

  const loadFavorites = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [groupsResult, favoritesResult] = await Promise.all([
        api.listGroups(),
        api.listFavorites(),
      ]);
      setGroups(normalizeGroups(groupsResult, fallbackDefaultGroup));
      setFavorites(favoritesResult);
      setFavoriteQueryResult(null);
    } catch (loadError) {
      const message = formatCommandError(
        loadError,
        messages.favorites.toasts.loadFailed,
      );
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [fallbackDefaultGroup, messages.favorites.toasts.loadFailed]);

  useEffect(() => {
    if (!isActive) {
      return;
    }

    void loadFavorites();
  }, [isActive, loadFavorites]);

  useEffect(() => {
    if (!visibleGroups.some((group) => group.id === selectedGroupId)) {
      setSelectedGroupId(DEFAULT_GROUP_ID);
    }
  }, [selectedGroupId, visibleGroups]);

  useEffect(() => {
    setSelectedFavoriteIds((current) => {
      const next = new Set(
        [...current].filter((id) => currentFavoriteIds.has(id)),
      );
      return next.size === current.size ? current : next;
    });
  }, [currentFavoriteIds]);

  useEffect(() => {
    setFavoritePage(1);
    setFavoriteQueryResult(null);
  }, [selectedGroup.id]);

  useEffect(() => {
    setMoveTargetGroupId((current) => {
      if (moveTargetGroups.some((group) => group.id === current)) {
        return current;
      }
      return moveTargetGroups[0]?.id ?? "";
    });
  }, [moveTargetGroups]);

  useEffect(() => {
    setFavoritePage((current) => Math.min(current, favoriteTotalPages));
  }, [favoriteTotalPages]);

  useEffect(() => {
    refreshRunIdRef.current += 1;
    refreshingDetailsRef.current = false;
    setRefreshingDetails(false);
    setRefreshingFavoriteIds(new Set());
    setFavoriteRefreshErrors(new Map());
    setDetailOpen(false);
    setSelectedDetailFavoriteId(null);
    selectedDetailFavoriteIdRef.current = null;
    setSelectedServer(null);
    setLoadingDetailFavoriteId(null);
  }, [selectedGroup.id]);

  useEffect(() => {
    if (!resizingSidebar) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const activeResize = activeSidebarResizeRef.current;
      if (!activeResize) {
        return;
      }

      setSidebarWidth(
        clampSidebarWidth(
          activeResize.startWidth + (event.clientX - activeResize.startX),
        ),
      );
    };

    const handlePointerUp = () => {
      activeSidebarResizeRef.current = null;
      setResizingSidebar(false);
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
  }, [resizingSidebar]);

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

  const openCreateDialog = () => {
    setEditingFavorite(null);
    setEditorOpen(true);
  };

  const openEditDialog = (favorite: Favorite) => {
    setEditingFavorite(favorite);
    setEditorOpen(true);
  };

  const refreshCreatedFavoriteSnapshot = async (favorite: Favorite) => {
    setRefreshingFavoriteIds((current) => new Set(current).add(favorite.id));
    setFavoriteRefreshErrors((current) => {
      const next = new Map(current);
      next.delete(favorite.id);
      return next;
    });

    try {
      const snapshot =
        settings.serverDetailsQueryMode === "a2sUdp"
          ? (
              await api.querySavedServerSnapshots({
                targets: [favoriteSnapshotTarget(favorite)],
                page: 1,
                pageSize: 1,
              })
            ).snapshots.find((server) => server.address === favorite.address)
          : (
              await api.getServerDetails({
                address: favorite.address,
                serverId: favoriteServerId(favorite),
                fallbackName: favorite.customName,
              })
            ).snapshot;

      if (!snapshot) {
        throw new Error(messages.serverDetail.snapshotUnavailable);
      }

      if (snapshot.lastQueryError) {
        throw new Error(snapshot.lastQueryError);
      }

      const updatedFavorite = await api.updateFavoriteSnapshot(
        favorite.id,
        snapshot,
      );
      setFavorites((current) =>
        current.map((item) =>
          item.id === updatedFavorite.id ? updatedFavorite : item,
        ),
      );
      setFavoriteQueryResult((current) =>
        pageResultWithSnapshot(current, snapshot),
      );
    } catch (refreshError) {
      const message = formatCommandError(
        refreshError,
        messages.serverDetail.snapshotUnavailable,
      );
      setFavoriteRefreshErrors((current) => {
        const next = new Map(current);
        next.set(favorite.id, message);
        return next;
      });
      toast.error(message);
    } finally {
      setRefreshingFavoriteIds((current) => {
        const next = new Set(current);
        next.delete(favorite.id);
        return next;
      });
    }
  };

  const handleFavoriteSubmit = async (input: FavoriteInput) => {
    if (savingFavoriteRef.current) {
      return;
    }

    savingFavoriteRef.current = true;
    setSavingFavorite(true);

    try {
      const normalizedInput: FavoriteInput = {
        ...input,
        groupId: input.groupId || DEFAULT_GROUP_ID,
      };
      const normalizedGroupId = normalizedInput.groupId || DEFAULT_GROUP_ID;
      if (
        !editingFavorite &&
        favoriteAddressKeys.has(
          `${normalizedGroupId}\u0000${favoriteAddressKey(normalizedInput.address)}`,
        )
      ) {
        toast.info(messages.favorites.toasts.alreadyFavorite);
        return;
      }

      const saved = editingFavorite
        ? await api.updateFavorite(editingFavorite.id, normalizedInput)
        : await api.addFavorite(normalizedInput);
      const wasEditingFavorite = editingFavorite !== null;

      setFavorites((current) =>
        wasEditingFavorite
          ? current.map((favorite) =>
              favorite.id === saved.id ? saved : favorite,
            )
          : [...current, saved],
      );
      setFavoriteQueryResult(null);
      setSelectedGroupId(saved.groupId || DEFAULT_GROUP_ID);
      setEditorOpen(false);
      setEditingFavorite(null);
      toast.success(messages.favorites.toasts.saved(wasEditingFavorite));
      if (!wasEditingFavorite) {
        void refreshCreatedFavoriteSnapshot(saved);
      }
    } catch (saveError) {
      const message = formatCommandError(
        saveError,
        messages.favorites.toasts.saveFailed,
      );
      toast.error(message);
    } finally {
      savingFavoriteRef.current = false;
      setSavingFavorite(false);
    }
  };

  const handleCreateGroup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (creatingGroupRef.current) {
      return;
    }

    const trimmedName = groupName.trim();
    if (!trimmedName) {
      toast.error(messages.favorites.toasts.enterGroupName);
      return;
    }

    creatingGroupRef.current = true;
    setCreatingGroup(true);
    try {
      const group = await api.createGroup(trimmedName);
      setGroups((current) =>
        normalizeGroups([...current, group], fallbackDefaultGroup),
      );
      setSelectedGroupId(group.id);
      setGroupName("");
      setGroupDialogOpen(false);
      toast.success(messages.favorites.toasts.groupCreated);
    } catch (groupError) {
      const message = formatCommandError(
        groupError,
        messages.favorites.toasts.groupCreateFailed,
      );
      toast.error(message);
    } finally {
      creatingGroupRef.current = false;
      setCreatingGroup(false);
    }
  };

  const openRenameGroupDialog = (group: FavoriteGroup) => {
    setRenameGroup(group);
    setRenameGroupName(displayGroupName(group));
  };

  const closeRenameGroupDialog = () => {
    if (renamingGroupIdRef.current !== null) {
      return;
    }

    setRenameGroup(null);
    setRenameGroupName("");
  };

  const handleRenameGroup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (
      !renameGroup ||
      renameGroup.id === DEFAULT_GROUP_ID ||
      renamingGroupIdRef.current !== null
    ) {
      return;
    }

    const trimmedName = renameGroupName.trim();
    if (!trimmedName) {
      toast.error(messages.favorites.toasts.enterGroupName);
      return;
    }

    if (trimmedName === renameGroup.name) {
      closeRenameGroupDialog();
      return;
    }

    renamingGroupIdRef.current = renameGroup.id;
    setRenamingGroupId(renameGroup.id);
    try {
      const updatedGroup = await api.updateGroup(renameGroup.id, trimmedName);
      setGroups((current) =>
        normalizeGroups(
          current.map((group) =>
            group.id === updatedGroup.id ? updatedGroup : group,
          ),
          fallbackDefaultGroup,
        ),
      );
      setRenameGroup(null);
      setRenameGroupName("");
      toast.success(messages.favorites.toasts.groupRenamed);
    } catch (renameError) {
      const message = formatCommandError(
        renameError,
        messages.favorites.toasts.groupRenameFailed,
      );
      toast.error(message);
    } finally {
      renamingGroupIdRef.current = null;
      setRenamingGroupId(null);
    }
  };

  const deleteFavoriteIds = async (ids: string[]) => {
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length === 0) {
      return;
    }

    if (uniqueIds.some((id) => deletingFavoriteIdsRef.current.has(id))) {
      return;
    }

    deletingFavoriteIdsRef.current = new Set([
      ...deletingFavoriteIdsRef.current,
      ...uniqueIds,
    ]);
    setDeletingFavoriteIds(new Set(deletingFavoriteIdsRef.current));
    try {
      await Promise.all(uniqueIds.map((id) => api.deleteFavorite(id)));
      setFavorites((current) =>
        current.filter((favorite) => !uniqueIds.includes(favorite.id)),
      );
      setFavoriteQueryResult(null);
      setSelectedFavoriteIds((current) => {
        const next = new Set(current);
        uniqueIds.forEach((id) => next.delete(id));
        return next;
      });
      if (
        selectedDetailFavoriteIdRef.current &&
        uniqueIds.includes(selectedDetailFavoriteIdRef.current)
      ) {
        setDetailOpen(false);
        setSelectedDetailFavoriteId(null);
        selectedDetailFavoriteIdRef.current = null;
        setSelectedServer(null);
      }
      setDeleteFavorite(null);
      setDeleteSelectionOpen(false);
      toast.success(
        uniqueIds.length > 1
          ? messages.favorites.toasts.deletedMany(uniqueIds.length)
          : messages.favorites.toasts.deleted,
      );
    } catch (deleteError) {
      const message = formatCommandError(
        deleteError,
        messages.favorites.toasts.deleteFailed,
      );
      toast.error(message);
    } finally {
      for (const id of uniqueIds) {
        deletingFavoriteIdsRef.current.delete(id);
      }
      setDeletingFavoriteIds(new Set(deletingFavoriteIdsRef.current));
    }
  };

  const handleDeleteFavorite = async () => {
    if (!deleteFavorite) {
      return;
    }

    await deleteFavoriteIds([deleteFavorite.id]);
  };

  const handleDeleteSelection = async () => {
    const ids = [...selectedFavoriteIds].filter((id) =>
      currentFavoriteIds.has(id),
    );
    await deleteFavoriteIds(ids);
  };

  const handleMoveSelection = async () => {
    const ids = [...selectedFavoriteIds].filter((id) =>
      currentFavoriteIds.has(id),
    );
    const targetGroupId = moveTargetGroupId || moveTargetGroups[0]?.id || "";

    if (
      ids.length === 0 ||
      !targetGroupId ||
      ids.some((id) => movingFavoriteIdsRef.current.has(id))
    ) {
      return;
    }

    const selectedIds = new Set(ids);
    const selectedAddressKeys = new Set(
      favorites
        .filter((favorite) => selectedIds.has(favorite.id))
        .map((favorite) => favoriteAddressKey(favorite.address)),
    );
    const targetGroupAlreadyHasSelectedAddress = favorites.some(
      (favorite) =>
        favorite.groupId === targetGroupId &&
        !selectedIds.has(favorite.id) &&
        selectedAddressKeys.has(favoriteAddressKey(favorite.address)),
    );

    if (targetGroupAlreadyHasSelectedAddress) {
      toast.info(messages.favorites.toasts.moveDuplicateAddress);
      return;
    }

    movingFavoriteIdsRef.current = new Set([
      ...movingFavoriteIdsRef.current,
      ...ids,
    ]);
    setMovingFavoriteIds(new Set(movingFavoriteIdsRef.current));

    try {
      const movedFavorites = await api.moveFavoritesToGroup(ids, targetGroupId);
      const movedById = new Map(
        movedFavorites.map((favorite) => [favorite.id, favorite]),
      );
      setFavorites((current) =>
        current.map((favorite) => movedById.get(favorite.id) ?? favorite),
      );
      setFavoriteQueryResult(null);
      setSelectedFavoriteIds(new Set());
      setMoveSelectionOpen(false);
      toast.success(messages.favorites.toasts.movedMany(movedFavorites.length));
    } catch (moveError) {
      const message = formatCommandError(
        moveError,
        messages.favorites.toasts.moveFailed,
      );
      toast.error(message);
    } finally {
      for (const id of ids) {
        movingFavoriteIdsRef.current.delete(id);
      }
      setMovingFavoriteIds(new Set(movingFavoriteIdsRef.current));
    }
  };

  const handleDeleteGroup = async () => {
    if (!deleteGroup || deleteGroup.id === DEFAULT_GROUP_ID) {
      return;
    }

    if (deletingGroupIdRef.current === deleteGroup.id) {
      return;
    }

    deletingGroupIdRef.current = deleteGroup.id;
    setDeletingGroupId(deleteGroup.id);
    try {
      await api.deleteGroup(deleteGroup.id);
      setGroups((current) =>
        normalizeGroups(
          current.filter((group) => group.id !== deleteGroup.id),
          fallbackDefaultGroup,
        ),
      );
      setFavorites((current) =>
        current.filter((favorite) => favorite.groupId !== deleteGroup.id),
      );
      setFavoritePage(1);
      setFavoriteQueryResult(null);
      setSelectedFavoriteIds(new Set());
      setSelectedGroupId(DEFAULT_GROUP_ID);
      setDeleteGroup(null);
      toast.success(messages.favorites.toasts.groupDeleted);
    } catch (deleteError) {
      const message = formatCommandError(
        deleteError,
        messages.favorites.toasts.groupDeleteFailed,
      );
      toast.error(message);
    } finally {
      deletingGroupIdRef.current = null;
      setDeletingGroupId(null);
    }
  };

  const refreshCurrentGroupDetails = async (
    requestedPage = favoritePage,
    requestedPageSize = favoritePageSize,
  ) => {
    if (refreshingDetailsRef.current) {
      return;
    }

    const targets = currentFavorites;
    const snapshotTargets = [
      ...new Map(
        targets.map((favorite) => [
          favorite.address,
          favoriteSnapshotTarget(favorite),
        ]),
      ).values(),
    ];

    if (targets.length === 0) {
      return;
    }

    const runId = refreshRunIdRef.current + 1;
    refreshRunIdRef.current = runId;
    refreshingDetailsRef.current = true;
    setRefreshingDetails(true);
    setRefreshingFavoriteIds(new Set(targets.map((favorite) => favorite.id)));
    setFavoriteRefreshErrors((current) => {
      const next = new Map(current);
      targets.forEach((favorite) => next.delete(favorite.id));
      return next;
    });

    const targetIdsByAddress = new Map<string, string[]>();
    for (const favorite of targets) {
      const ids = targetIdsByAddress.get(favorite.address) ?? [];
      ids.push(favorite.id);
      targetIdsByAddress.set(favorite.address, ids);
    }
    const streamedAddresses = new Set<string>();
    const persistTasks: Promise<void>[] = [];
    const persistSnapshot = (favoriteId: string, snapshot: ServerSnapshot) =>
      api
        .updateFavoriteSnapshot(favoriteId, snapshot)
        .then((updatedFavorite) => {
          if (refreshRunIdRef.current !== runId) {
            return;
          }
          setFavorites((current) =>
            current.map((favorite) =>
              favorite.id === updatedFavorite.id ? updatedFavorite : favorite,
            ),
          );
        })
        .catch((saveError) => {
          if (refreshRunIdRef.current !== runId) {
            return;
          }
          const message = formatCommandError(
            saveError,
            messages.favorites.toasts.saveFailed,
          );
          setFavoriteRefreshErrors((current) => {
            const next = new Map(current);
            next.set(favoriteId, message);
            return next;
          });
        });
    const applySnapshotProgress = (
      snapshot: ServerSnapshot,
      options: { persist: boolean } = { persist: true },
    ) => {
      const favoriteIds = targetIdsByAddress.get(snapshot.address);
      if (!favoriteIds?.length) {
        return;
      }

      streamedAddresses.add(snapshot.address);
      const favoriteIdSet = new Set(favoriteIds);
      setFavorites((current) =>
        current.map((favorite) =>
          favoriteIdSet.has(favorite.id)
            ? {
                ...favorite,
                serverId: snapshot.serverId ?? favorite.serverId,
                lastSnapshot: snapshot,
              }
            : favorite,
        ),
      );
      setFavoriteQueryResult((current) =>
        pageResultWithSnapshot(current, snapshot),
      );
      setFavoriteRefreshErrors((current) => {
        const next = new Map(current);
        for (const favoriteId of favoriteIds) {
          if (snapshot.lastQueryError) {
            next.set(favoriteId, snapshot.lastQueryError);
          } else {
            next.delete(favoriteId);
          }
        }
        return next;
      });
      setRefreshingFavoriteIds((current) => {
        const next = new Set(current);
        favoriteIds.forEach((favoriteId) => next.delete(favoriteId));
        return next;
      });

      const selectedId = selectedDetailFavoriteIdRef.current;
      if (selectedId && favoriteIdSet.has(selectedId)) {
        setSelectedServer(snapshot);
      }

      if (options.persist) {
        favoriteIds.forEach((favoriteId) => {
          persistTasks.push(persistSnapshot(favoriteId, snapshot));
        });
      }
    };

    try {
      const { pageResult, snapshotsByAddress } = await queryAddressSnapshots(
        snapshotTargets,
        requestedPage,
        requestedPageSize,
        settings.serverDetailsQueryMode === "a2sUdp",
        (event) => {
          if (refreshRunIdRef.current === runId) {
            applySnapshotProgress(event.snapshot);
          }
        },
      );

      if (refreshRunIdRef.current !== runId) {
        return;
      }

      for (const snapshot of snapshotsByAddress.values()) {
        if (!streamedAddresses.has(snapshot.address)) {
          applySnapshotProgress(snapshot);
        }
      }
      await Promise.allSettled(persistTasks);

      if (refreshRunIdRef.current !== runId) {
        return;
      }

      const invalidIds = targets
        .filter((favorite) => !snapshotsByAddress.has(favorite.address))
        .map((favorite) => favorite.id);
      await Promise.all(invalidIds.map((id) => api.deleteFavorite(id)));

      if (refreshRunIdRef.current !== runId) {
        return;
      }

      const invalidIdSet = new Set(invalidIds);
      setFavorites((current) =>
        current.filter((favorite) => !invalidIdSet.has(favorite.id)),
      );
      setFavoriteQueryResult(pageResult);
      setFavoritePage(pageResult.page);
      setSelectedFavoriteIds((current) => {
        const next = new Set(current);
        invalidIds.forEach((id) => next.delete(id));
        return next;
      });

      const selectedId = selectedDetailFavoriteIdRef.current;
      if (selectedId && invalidIdSet.has(selectedId)) {
        setDetailOpen(false);
        setSelectedDetailFavoriteId(null);
        selectedDetailFavoriteIdRef.current = null;
        setSelectedServer(null);
      } else if (selectedId) {
        const selectedFavorite = targets.find(
          (favorite) => favorite.id === selectedId,
        );
        const snapshot = selectedFavorite
          ? snapshotsByAddress.get(selectedFavorite.address)
          : undefined;
        if (snapshot) {
          setSelectedServer(snapshot);
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
      setFavoriteRefreshErrors(
        new Map(targets.map((favorite) => [favorite.id, message])),
      );
      toast.error(message);
    } finally {
      if (refreshRunIdRef.current === runId) {
        refreshingDetailsRef.current = false;
        setRefreshingDetails(false);
        setRefreshingFavoriteIds(new Set());
      }
    }
  };

  const handleFavoriteServerUpdate = (server: ServerSnapshot) => {
    setSelectedServer(server);
    const favoriteId = selectedDetailFavoriteIdRef.current;
    const updatedIds = new Set<string>();
    setFavorites((current) =>
      current.map((favorite) => {
        if (favorite.id === favoriteId || favorite.address === server.address) {
          updatedIds.add(favorite.id);
          return {
            ...favorite,
            serverId: server.serverId ?? favorite.serverId,
            lastSnapshot: server,
          };
        }

        return favorite;
      }),
    );
    setFavoriteQueryResult((current) => pageResultWithSnapshot(current, server));
    setFavoriteRefreshErrors((current) => {
      const next = new Map(current);
      updatedIds.forEach((id) => next.delete(id));
      return next;
    });
    setRefreshingFavoriteIds((current) => {
      const next = new Set(current);
      updatedIds.forEach((id) => next.delete(id));
      return next;
    });

    if (favoriteId) {
      void api
        .updateFavoriteSnapshot(favoriteId, server)
        .then((updatedFavorite) => {
          setFavorites((current) =>
            current.map((favorite) =>
              favorite.id === updatedFavorite.id ? updatedFavorite : favorite,
            ),
          );
        })
        .catch(() => {
          toast.error(messages.favorites.toasts.saveFailed);
        });
    }
  };

  const openFavoriteDetails = async (favorite: Favorite) => {
    if (!favorite.address.trim()) {
      toast.error(messages.serverDetail.snapshotUnavailable);
      return;
    }

    if (settings.serverDetailsDisplayMode === "window") {
      await openServerDetailWindow({
        address: favorite.address,
        serverId: favoriteServerId(favorite),
        fallbackName: favorite.customName,
        snapshot: favorite.lastSnapshot,
        favoriteId: favorite.id,
      }).catch((windowError) => {
        const message = formatCommandError(
          windowError,
          messages.serverDetail.snapshotUnavailable,
        );
        toast.error(message);
      });
      return;
    }

    selectedDetailFavoriteIdRef.current = favorite.id;
    setSelectedDetailFavoriteId(favorite.id);
    setDetailOpen(true);

    if (favorite.lastSnapshot) {
      setSelectedServer(favorite.lastSnapshot);
      return;
    }

    setSelectedServer(null);
    setLoadingDetailFavoriteId(favorite.id);
    try {
      const details = await api.getServerDetails({
        address: favorite.address,
        serverId: favoriteServerId(favorite),
        fallbackName: favorite.customName,
      });
      const updatedFavorite = await api.updateFavoriteSnapshot(
        favorite.id,
        details.snapshot,
      );
      if (selectedDetailFavoriteIdRef.current !== favorite.id) {
        return;
      }
      setFavorites((current) =>
        current.map((item) =>
          item.id === updatedFavorite.id ? updatedFavorite : item,
        ),
      );
      setSelectedServer(updatedFavorite.lastSnapshot ?? details.snapshot);
    } catch (detailError) {
      const message = formatCommandError(
        detailError,
        messages.serverDetail.snapshotUnavailable,
      );
      toast.error(message);
    } finally {
      setLoadingDetailFavoriteId((current) =>
        current === favorite.id ? null : current,
      );
    }
  };

  const handleConnect = async (favorite: Favorite) => {
    if (pendingConnectAddressRef.current === favorite.address) {
      return;
    }

    pendingConnectAddressRef.current = favorite.address;
    setPendingConnectAddress(favorite.address);
    try {
      const snapshot = await resolveFavoriteSnapshot(favorite);
      await api.connectToServer(favorite.address, snapshot);
      if (snapshot) {
        const updatedFavorite = await api.updateFavoriteSnapshot(
          favorite.id,
          snapshot,
        );
        setFavorites((current) =>
          current.map((item) =>
            item.id === updatedFavorite.id ? updatedFavorite : item,
          ),
        );
      }
      toast.success(messages.favorites.toasts.connectStarted(favorite.address));
    } catch (connectError) {
      const message = formatCommandError(
        connectError,
        messages.favorites.toasts.connectFailed,
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
      toast.success(messages.favorites.toasts.connectStarted(server.address));
    } catch (connectError) {
      const message = formatCommandError(
        connectError,
        messages.favorites.toasts.connectFailed,
      );
      toast.error(message);
    } finally {
      pendingConnectAddressRef.current = null;
      setPendingConnectAddress(null);
    }
  };

  const handleToggleFavoriteFromDetails = async (server: ServerSnapshot) => {
    const favorite =
      favorites.find((item) => item.id === selectedDetailFavoriteId) ??
      favorites.find((item) => item.address === server.address);

    if (!favorite) {
      return;
    }

    await deleteFavoriteIds([favorite.id]);
    setDetailOpen(false);
    setSelectedDetailFavoriteId(null);
    selectedDetailFavoriteIdRef.current = null;
    setSelectedServer(null);
  };

  const toggleSelectAll = (checked: boolean | "indeterminate") => {
    setSelectedFavoriteIds((current) => {
      const next = new Set(current);
      if (checked === true) {
        sortedDisplayedFavorites.forEach((favorite) => next.add(favorite.id));
      } else {
        sortedDisplayedFavorites.forEach((favorite) => next.delete(favorite.id));
      }
      return next;
    });
  };

  const toggleSelectFavorite = (
    favoriteId: string,
    checked: boolean | "indeterminate",
  ) => {
    setSelectedFavoriteIds((current) => {
      const next = new Set(current);
      if (checked === true) {
        next.add(favoriteId);
      } else {
        next.delete(favoriteId);
      }
      return next;
    });
  };

  const startSidebarResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    activeSidebarResizeRef.current = {
      startX: event.clientX,
      startWidth: sidebarWidth,
    };
    setResizingSidebar(true);
  };

  const startColumnResize = (
    event: ReactPointerEvent<HTMLDivElement>,
    columnId: FavoriteResizableColumnId,
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

  const handleSort = (columnId: FavoriteSortColumnId) => {
    setSortState((current) => nextSortState(current, columnId));
  };

  const handleDetailOpenChange = (open: boolean) => {
    setDetailOpen(open);
    if (!open) {
      setSelectedDetailFavoriteId(null);
      selectedDetailFavoriteIdRef.current = null;
      setSelectedServer(null);
      setLoadingDetailFavoriteId(null);
    }
  };

  const selectedGroupFavoriteCount = currentFavorites.length;
  const deleteGroupFavoriteCount =
    deleteGroup ? (favoritesByGroup.get(deleteGroup.id) ?? []).length : 0;
  const movingSelection = movingFavoriteIds.size > 0;
  const detailFavoritePending =
    selectedDetailFavoriteId !== null &&
    (deletingFavoriteIds.has(selectedDetailFavoriteId) ||
      loadingDetailFavoriteId === selectedDetailFavoriteId);
  const detailIsFavorite =
    selectedServer !== null &&
    favorites.some((favorite) => favorite.address === selectedServer.address);

  return (
    <section className="page-layout">
      <div className="page-heading">
        <div>
          <p className="page-eyebrow">{messages.favorites.eyebrow}</p>
          <h2>{messages.favorites.title}</h2>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-pressed={showGroupSidebar}
            title={
              showGroupSidebar
                ? messages.favorites.actions.hideGroups
                : messages.favorites.actions.showGroups
            }
            onClick={() => setShowGroupSidebar((current) => !current)}
          >
            {showGroupSidebar ? (
              <PanelLeftClose data-icon="inline-start" />
            ) : (
              <PanelLeftOpen data-icon="inline-start" />
            )}
            {showGroupSidebar
              ? messages.favorites.actions.hideGroups
              : messages.favorites.actions.showGroups}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loading || refreshingDetails}
            onClick={() => void refreshCurrentGroupDetails()}
          >
            <RefreshCw
              data-icon="inline-start"
              className={cn(refreshingDetails && "animate-spin")}
            />
            {refreshingDetails ? messages.common.refreshing : messages.common.refresh}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setGroupDialogOpen(true)}
          >
            <Plus data-icon="inline-start" />
            {messages.favoriteEditor.group}
          </Button>
          <Button type="button" size="sm" onClick={openCreateDialog}>
            <Plus data-icon="inline-start" />
            {messages.favorites.actions.addCustomServer}
          </Button>
          <div className="page-meta">
            {messages.favorites.savedLabel(favorites.length)}
          </div>
        </div>
      </div>

      <div className="utility-panel flex min-h-0 overflow-hidden">
        {loading ? (
          <div className="grid min-h-72 flex-1 place-items-center p-6 text-sm text-muted-foreground">
            {messages.common.refreshing}...
          </div>
        ) : error ? (
          <div className="grid min-h-72 flex-1 place-items-center p-6 text-center">
            <div className="flex max-w-md flex-col items-center gap-2">
              <p className="font-medium text-foreground">
                {messages.favorites.toasts.loadFailed}
              </p>
              <p className="text-sm text-muted-foreground">{error}</p>
            </div>
          </div>
        ) : (
          <>
            {showGroupSidebar ? (
              <aside
                className="relative flex shrink-0 flex-col border-r bg-muted/10"
                style={{ width: `${sidebarWidth}px` }}
              >
                <div className="border-b px-3 py-3">
                  <h3 className="text-sm font-semibold">
                    {messages.favorites.groupListTitle}
                  </h3>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-2 [scrollbar-gutter:stable]">
                  <div className="flex min-w-0 flex-col gap-1">
                    {visibleGroups.map((group) => {
                      const groupFavorites = favoritesByGroup.get(group.id) ?? [];
                      const isSelected = selectedGroup.id === group.id;
                      const isDefault = group.id === DEFAULT_GROUP_ID;
                      const groupName = displayGroupName(group);

                      return (
                        <div
                          key={group.id}
                          className={cn(
                            "group flex w-full min-w-0 items-center gap-1 rounded-lg",
                            isSelected && "bg-muted",
                          )}
                        >
                          <button
                            type="button"
                            className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden rounded-lg px-2 py-2 text-left text-sm transition-colors hover:bg-muted"
                            title={groupName}
                            onClick={() => setSelectedGroupId(group.id)}
                          >
                            {isSelected ? (
                              <FolderOpen className="shrink-0 text-muted-foreground" />
                            ) : (
                              <Folder className="shrink-0 text-muted-foreground" />
                            )}
                            <span className="min-w-0 flex-1 truncate font-medium">
                              {groupName}
                            </span>
                            <Badge variant="secondary" className="shrink-0">
                              {groupFavorites.length}
                            </Badge>
                          </button>
                          {!isDefault ? (
                            <Button
                              type="button"
                              size="icon-xs"
                              variant="ghost"
                              className="mr-1 shrink-0 opacity-70 hover:opacity-100"
                              aria-label={messages.favorites.actions.deleteGroup(
                                groupName,
                              )}
                              disabled={deletingGroupId !== null}
                              onClick={() => setDeleteGroup(group)}
                            >
                              <Trash2 aria-hidden="true" />
                            </Button>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div
                  className="absolute right-0 top-0 h-full w-3 cursor-col-resize touch-none"
                  onPointerDown={startSidebarResize}
                >
                  <div className="ml-auto h-full w-px bg-border transition-colors hover:bg-primary" />
                </div>
              </aside>
            ) : null}

            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex shrink-0 items-center justify-between gap-3 border-b px-3 py-3">
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-semibold">
                    {displayGroupName(selectedGroup)}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {messages.favorites.savedLabel(selectedGroupFavoriteCount)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {selectedCurrentCount > 0 ? (
                    <>
                      <span className="text-xs font-medium text-muted-foreground">
                        {messages.favorites.selectedLabel(selectedCurrentCount)}
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={movingSelection}
                        onClick={() => setMoveSelectionOpen(true)}
                      >
                        <FolderOpen data-icon="inline-start" />
                        {messages.favorites.actions.moveToGroup}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        disabled={deletingFavoriteIds.size > 0 || movingSelection}
                        onClick={() => setDeleteSelectionOpen(true)}
                      >
                        <Trash2 data-icon="inline-start" />
                        {messages.favorites.actions.deleteSelected}
                      </Button>
                    </>
                  ) : null}
                  {selectedGroup.id !== DEFAULT_GROUP_ID ? (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={
                          renamingGroupId !== null || deletingGroupId !== null
                        }
                        onClick={() => openRenameGroupDialog(selectedGroup)}
                      >
                        <Edit data-icon="inline-start" />
                        {messages.favorites.actions.renameCurrentGroup}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={
                          renamingGroupId !== null || deletingGroupId !== null
                        }
                        onClick={() => setDeleteGroup(selectedGroup)}
                      >
                        <Trash2 data-icon="inline-start" />
                        {messages.favorites.actions.deleteCurrentGroup}
                      </Button>
                    </>
                  ) : null}
                </div>
              </div>

              {currentFavorites.length === 0 ? (
                <div className="empty-panel min-h-72 flex-1">
                  <div className="empty-state">
                    <div className="empty-state-icon">
                      <Star aria-hidden="true" />
                    </div>
                    <div>
                      <h3>{messages.favorites.emptyGroupTitle}</h3>
                      <p>{messages.favorites.emptyGroupDescription}</p>
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
                      <col style={{ width: `${ACTIONS_COLUMN_WIDTH}px` }} />
                    </colgroup>
                    <TableHeader className="[&_th]:sticky [&_th]:top-0 [&_th]:z-20 [&_th]:bg-background [&_th]:shadow-[inset_0_-1px_0_var(--border)]">
                      <TableRow>
                        <TableHead
                          className="w-11"
                          aria-label={messages.favorites.columns.select}
                        >
                          <Checkbox
                            checked={selectionChecked}
                            aria-label={messages.favorites.actions.selectAll}
                            onCheckedChange={toggleSelectAll}
                          />
                        </TableHead>
                        <SortableTableHead
                          label={messages.favorites.columns.server}
                          activeDirection={activeSortDirection(
                            sortState,
                            "server",
                          )}
                          getSortLabel={messages.tableSorting.aria.sortColumn}
                          onSort={() => handleSort("server")}
                        >
                          <ResizeHandle
                            onPointerDown={(event) =>
                              startColumnResize(event, "server")
                            }
                          />
                        </SortableTableHead>
                        <SortableTableHead
                          label={messages.favorites.columns.address}
                          activeDirection={activeSortDirection(
                            sortState,
                            "address",
                          )}
                          getSortLabel={messages.tableSorting.aria.sortColumn}
                          onSort={() => handleSort("address")}
                        >
                          <ResizeHandle
                            onPointerDown={(event) =>
                              startColumnResize(event, "address")
                            }
                          />
                        </SortableTableHead>
                        <SortableTableHead
                          label={messages.serverTable.columns.map}
                          activeDirection={activeSortDirection(sortState, "map")}
                          getSortLabel={messages.tableSorting.aria.sortColumn}
                          onSort={() => handleSort("map")}
                        >
                          <ResizeHandle
                            onPointerDown={(event) =>
                              startColumnResize(event, "map")
                            }
                          />
                        </SortableTableHead>
                        <SortableTableHead
                          label={messages.serverTable.columns.players}
                          activeDirection={activeSortDirection(
                            sortState,
                            "players",
                          )}
                          align="right"
                          getSortLabel={messages.tableSorting.aria.sortColumn}
                          onSort={() => handleSort("players")}
                        >
                          <ResizeHandle
                            onPointerDown={(event) =>
                              startColumnResize(event, "players")
                            }
                          />
                        </SortableTableHead>
                        <SortableTableHead
                          label={messages.serverTable.columns.ping}
                          activeDirection={activeSortDirection(sortState, "ping")}
                          align="right"
                          getSortLabel={messages.tableSorting.aria.sortColumn}
                          onSort={() => handleSort("ping")}
                        >
                          <ResizeHandle
                            onPointerDown={(event) =>
                              startColumnResize(event, "ping")
                            }
                          />
                        </SortableTableHead>
                        <SortableTableHead
                          label={messages.favorites.columns.tags}
                          activeDirection={activeSortDirection(sortState, "tags")}
                          getSortLabel={messages.tableSorting.aria.sortColumn}
                          onSort={() => handleSort("tags")}
                        >
                          <ResizeHandle
                            onPointerDown={(event) =>
                              startColumnResize(event, "tags")
                            }
                          />
                        </SortableTableHead>
                        <SortableTableHead
                          label={messages.serverTable.columns.status}
                          activeDirection={activeSortDirection(
                            sortState,
                            "status",
                          )}
                          getSortLabel={messages.tableSorting.aria.sortColumn}
                          onSort={() => handleSort("status")}
                        >
                          <ResizeHandle
                            onPointerDown={(event) =>
                              startColumnResize(event, "status")
                            }
                          />
                        </SortableTableHead>
                        <TableHead
                          className="w-28 text-right"
                          aria-label={messages.favorites.columns.actions}
                        />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sortedDisplayedFavorites.map((favorite) => {
                        const favoriteName = displayFavoriteName(favorite);
                        const favoriteAddress = displayFavoriteAddress(favorite);
                        const isDeleting = deletingFavoriteIds.has(favorite.id);
                        const snapshot = favorite.lastSnapshot;
                        const isRefreshingFavorite = refreshingFavoriteIds.has(
                          favorite.id,
                        ) || loadingDetailFavoriteId === favorite.id;
                        const refreshError = favoriteRefreshErrors.get(
                          favorite.id,
                        );
                        const status = getFavoriteStatus(
                          favorite,
                          isRefreshingFavorite,
                          refreshError,
                          messages.serverTable.statuses,
                          messages.common.refreshing,
                        );

                        return (
                          <TableRow
                            key={favorite.id}
                            className="h-11 cursor-pointer"
                            onClick={() => void openFavoriteDetails(favorite)}
                          >
                            <TableCell
                              className="py-1.5"
                              onClick={(event) => event.stopPropagation()}
                            >
                              <Checkbox
                                checked={selectedFavoriteIds.has(favorite.id)}
                                aria-label={messages.favorites.actions.select(
                                  favoriteName,
                                )}
                                disabled={isDeleting}
                                onCheckedChange={(checked) =>
                                  toggleSelectFavorite(favorite.id, checked)
                                }
                              />
                            </TableCell>
                            <TableCell className="min-w-0 py-1.5">
                              <div className="truncate font-medium">
                                {favoriteName}
                              </div>
                              {favorite.notes ? (
                                <div className="truncate text-xs text-muted-foreground">
                                  {favorite.notes}
                                </div>
                              ) : null}
                            </TableCell>
                            <TableCell className="truncate py-1.5 font-mono text-xs">
                              {favoriteAddress}
                            </TableCell>
                            <TableCell className="truncate py-1.5">
                              {snapshot?.map || "-"}
                            </TableCell>
                            <TableCell className="py-1.5 text-right tabular-nums">
                              {snapshot
                                ? `${snapshot.players}/${snapshot.maxPlayers}`
                                : "-"}
                            </TableCell>
                            <TableCell className="py-1.5 text-right tabular-nums">
                              {snapshot
                                ? formatPing(
                                    snapshot.pingMs,
                                    messages.serverTable.pingUnknown,
                                  )
                                : "-"}
                            </TableCell>
                            <TableCell className="min-w-0 py-1.5">
                              <FavoriteModeTags
                                tags={favoriteTags(favorite)}
                                modeLabels={messages.serverDetail.modeLabels}
                              />
                            </TableCell>
                            <TableCell className="truncate py-1.5">
                              {status ? (
                                <Badge
                                  variant={status.variant}
                                  title={refreshError}
                                >
                                  {status.label}
                                </Badge>
                              ) : (
                                <span className="text-xs text-muted-foreground">
                                  -
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="py-1.5 text-right">
                              <div className="flex justify-end gap-1">
                                <Button
                                  type="button"
                                  size="icon-xs"
                                  variant="outline"
                                  aria-label={messages.favorites.actions.connect(
                                    favoriteName,
                                  )}
                                  disabled={
                                    pendingConnectAddress === favorite.address
                                  }
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void handleConnect(favorite);
                                  }}
                                >
                                  {pendingConnectAddress ===
                                  favorite.address ? (
                                    <RefreshCw aria-hidden="true" />
                                  ) : (
                                    <ExternalLink aria-hidden="true" />
                                  )}
                                </Button>
                                <Button
                                  type="button"
                                  size="icon-xs"
                                  variant="ghost"
                                  aria-label={messages.favorites.actions.edit(
                                    favoriteName,
                                  )}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    openEditDialog(favorite);
                                  }}
                                >
                                  <Edit aria-hidden="true" />
                                </Button>
                                <Button
                                  type="button"
                                  size="icon-xs"
                                  variant="ghost"
                                  aria-label={messages.favorites.actions.delete(
                                    favoriteName,
                                  )}
                                  disabled={isDeleting}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setDeleteFavorite(favorite);
                                  }}
                                >
                                  <Trash2 aria-hidden="true" />
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
              {currentFavorites.length > 0 ? (
                <TablePagination
                  page={favoritePage}
                  totalPages={favoriteTotalPages}
                  disabled={refreshingDetails}
                  status={messages.serverList.footerStatus(
                    favoritePage,
                    favoriteTotalPages,
                    refreshingDetails,
                  )}
                  onPageChange={(nextPage) => {
                    setFavoritePage(nextPage);
                    if (favoriteQueryResult) {
                      void refreshCurrentGroupDetails(nextPage);
                    } else {
                      setFavoriteQueryResult(null);
                    }
                  }}
                  pageSizeControl={{
                    value: favoritePageSize,
                    options: favoritePageSizeChoices,
                    ariaLabel: messages.filterToolbar.aria.rows,
                    formatLabel: messages.filterToolbar.rowsLabel,
                    onChange: (nextPageSize) => {
                      setFavoritePageSize(nextPageSize);
                      setFavoritePage(1);
                      if (favoriteQueryResult) {
                        void refreshCurrentGroupDetails(1, nextPageSize);
                      } else {
                        setFavoriteQueryResult(null);
                      }
                    },
                  }}
                />
              ) : null}
            </div>
          </>
        )}
      </div>

      <FavoriteEditorDialog
        open={isActive && editorOpen}
        mode={editingFavorite ? "edit" : "create"}
        groups={visibleGroups}
        favorite={editingFavorite}
        pending={savingFavorite}
        onOpenChange={setEditorOpen}
        onSubmit={(input) => void handleFavoriteSubmit(input)}
      />

      <ServerDetailPanel
        open={isActive && detailOpen}
        server={selectedServer}
        onOpenChange={handleDetailOpenChange}
        onConnect={(server) => void handleConnectServer(server)}
        onToggleFavorite={(server) => void handleToggleFavoriteFromDetails(server)}
        onUpdateServer={handleFavoriteServerUpdate}
        connectPending={
          selectedServer !== null && pendingConnectAddress === selectedServer.address
        }
        favoritePending={detailFavoritePending}
        isFavorite={detailIsFavorite}
      />

      <Dialog open={isActive && groupDialogOpen} onOpenChange={setGroupDialogOpen}>
        <DialogContent>
          <form className="flex flex-col gap-4" onSubmit={handleCreateGroup}>
            <DialogHeader>
              <DialogTitle>{messages.favorites.createGroupTitle}</DialogTitle>
              <DialogDescription>
                {messages.favorites.createGroupDescription}
              </DialogDescription>
            </DialogHeader>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              {messages.favorites.groupNameLabel}
              <Input
                value={groupName}
                placeholder={messages.favorites.groupNamePlaceholder}
                onChange={(event) => setGroupName(event.target.value)}
              />
            </label>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={creatingGroup}
                onClick={() => setGroupDialogOpen(false)}
              >
                {messages.common.cancel}
              </Button>
              <Button type="submit" disabled={creatingGroup}>
                {creatingGroup ? messages.common.creating : messages.common.create}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isActive && deleteFavorite !== null}
        onOpenChange={(open) => !open && setDeleteFavorite(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{messages.favorites.deleteDialogTitle}</DialogTitle>
            <DialogDescription>
              {messages.favorites.deleteDialogDescription(
                deleteFavorite
                  ? displayFavoriteName(deleteFavorite)
                  : messages.favorites.deleteDialogFallbackName,
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={deletingFavoriteIds.size > 0}
              onClick={() => setDeleteFavorite(null)}
            >
              {messages.common.cancel}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deletingFavoriteIds.size > 0}
              onClick={() => void handleDeleteFavorite()}
            >
              {deletingFavoriteIds.size > 0
                ? messages.common.deleting
                : messages.common.delete}
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
            <DialogTitle>
              {messages.favorites.deleteSelectedDialogTitle}
            </DialogTitle>
            <DialogDescription>
              {messages.favorites.deleteSelectedDialogDescription(
                selectedCurrentCount,
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={deletingFavoriteIds.size > 0}
              onClick={() => setDeleteSelectionOpen(false)}
            >
              {messages.common.cancel}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deletingFavoriteIds.size > 0 || selectedCurrentCount === 0}
              onClick={() => void handleDeleteSelection()}
            >
              {deletingFavoriteIds.size > 0
                ? messages.common.deleting
                : messages.favorites.actions.deleteSelected}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isActive && moveSelectionOpen}
        onOpenChange={(open) => !open && setMoveSelectionOpen(false)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{messages.favorites.moveDialogTitle}</DialogTitle>
            <DialogDescription>
              {messages.favorites.moveDialogDescription(selectedCurrentCount)}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              {messages.favorites.moveDialogGroupLabel}
              <Select
                value={moveTargetGroupId}
                disabled={movingSelection || moveTargetGroups.length === 0}
                onValueChange={setMoveTargetGroupId}
              >
                <SelectTrigger className="w-full">
                  <SelectValue
                    placeholder={messages.favoriteEditor.placeholders.group}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {moveTargetGroups.map((group) => (
                      <SelectItem key={group.id} value={group.id}>
                        {displayGroupName(group)}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </label>
            {moveTargetGroups.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {messages.favorites.moveDialogNoTargets}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={movingSelection}
              onClick={() => setMoveSelectionOpen(false)}
            >
              {messages.common.cancel}
            </Button>
            <Button
              type="button"
              disabled={
                movingSelection ||
                selectedCurrentCount === 0 ||
                moveTargetGroups.length === 0 ||
                !moveTargetGroupId
              }
              onClick={() => void handleMoveSelection()}
            >
              {movingSelection
                ? messages.common.saving
                : messages.favorites.actions.moveToGroup}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isActive && renameGroup !== null}
        onOpenChange={(open) => !open && closeRenameGroupDialog()}
      >
        <DialogContent>
          <form className="flex flex-col gap-4" onSubmit={handleRenameGroup}>
            <DialogHeader>
              <DialogTitle>{messages.favorites.renameGroupDialogTitle}</DialogTitle>
              <DialogDescription>
                {renameGroup
                  ? messages.favorites.renameGroupDialogDescription(
                      displayGroupName(renameGroup),
                    )
                  : messages.favorites.renameGroupDialogFallback}
              </DialogDescription>
            </DialogHeader>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              {messages.favorites.groupNameLabel}
              <Input
                value={renameGroupName}
                placeholder={messages.favorites.groupNamePlaceholder}
                disabled={renamingGroupId !== null}
                onChange={(event) => setRenameGroupName(event.target.value)}
              />
            </label>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={renamingGroupId !== null}
                onClick={closeRenameGroupDialog}
              >
                {messages.common.cancel}
              </Button>
              <Button
                type="submit"
                disabled={
                  renamingGroupId !== null ||
                  renameGroup === null ||
                  renameGroup.id === DEFAULT_GROUP_ID
                }
              >
                {renamingGroupId ? messages.common.saving : messages.common.save}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isActive && deleteGroup !== null}
        onOpenChange={(open) => !open && setDeleteGroup(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{messages.favorites.deleteGroupDialogTitle}</DialogTitle>
            <DialogDescription>
              {deleteGroup
                ? messages.favorites.deleteGroupDialogDescription(
                    displayGroupName(deleteGroup),
                    deleteGroupFavoriteCount,
                  )
                : messages.favorites.deleteGroupDialogFallback}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={deletingGroupId !== null}
              onClick={() => setDeleteGroup(null)}
            >
              {messages.common.cancel}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={
                deletingGroupId !== null ||
                deleteGroup === null ||
                deleteGroup.id === DEFAULT_GROUP_ID
              }
              onClick={() => void handleDeleteGroup()}
            >
              {deletingGroupId
                ? messages.common.deleting
                : messages.favorites.actions.deleteCurrentGroup}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
