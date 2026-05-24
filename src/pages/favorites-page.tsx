import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  type UIEvent,
} from "react";
import {
  ChevronLeft,
  ChevronRight,
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
import { useI18n } from "@/lib/app-preferences";
import { createDefaultFilters } from "@/lib/filters";
import { getDisplayModeTags, MODE_TAG_CLASS_NAMES } from "@/lib/mode-tags";
import { cn } from "@/lib/utils";
import type {
  Favorite,
  FavoriteGroup,
  FavoriteInput,
  ServerQueryResult,
  ServerSnapshot,
} from "@/lib/types";

const DEFAULT_GROUP_ID = "default";
const DEFAULT_ADDRESS_PAGE_SIZE = 50;
const ADDRESS_PAGE_SIZE_OPTIONS = [25, 50, 100];
const FAVORITE_ROW_HEIGHT = 46;
const FAVORITE_ROW_OVERSCAN = 8;
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
  return favorite.lastSnapshot?.name || favorite.customName || favorite.address;
}

function displayFavoriteAddress(favorite: Favorite): string {
  return favorite.lastSnapshot?.address || favorite.address;
}

function favoriteServerId(favorite: Favorite): string | null {
  const serverId = favorite.serverId ?? favorite.lastSnapshot?.serverId ?? "";
  return serverId.trim() || null;
}

async function resolveFavoriteSnapshot(
  favorite: Favorite,
): Promise<ServerSnapshot | null> {
  if (favorite.lastSnapshot) {
    return favorite.lastSnapshot;
  }

  const serverId = favoriteServerId(favorite);
  if (!serverId) {
    return null;
  }

  const details = await api.getServerDetails(
    serverId,
    favorite.address,
    favorite.customName,
  );
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

type FavoritesPageProps = {
  isActive?: boolean;
};

export function FavoritesPage({ isActive = true }: FavoritesPageProps) {
  const { messages } = useI18n();
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
  const [deleteFavorite, setDeleteFavorite] = useState<Favorite | null>(null);
  const [deleteSelectionOpen, setDeleteSelectionOpen] = useState(false);
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
  const [resizingColumn, setResizingColumn] =
    useState<FavoriteResizableColumnId | null>(null);
  const [tableScrollTop, setTableScrollTop] = useState(0);
  const [tableViewportHeight, setTableViewportHeight] = useState(0);
  const savingFavoriteRef = useRef(false);
  const creatingGroupRef = useRef(false);
  const deletingFavoriteIdsRef = useRef<Set<string>>(new Set());
  const deletingGroupIdRef = useRef<string | null>(null);
  const pendingConnectAddressRef = useRef<string | null>(null);
  const selectedDetailFavoriteIdRef = useRef<string | null>(null);
  const refreshRunIdRef = useRef(0);
  const refreshingDetailsRef = useRef(false);
  const tableViewportRef = useRef<HTMLDivElement | null>(null);
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
  const favoriteByAddress = useMemo(
    () =>
      new Map(
        currentFavorites.map((favorite) => [favorite.address, favorite] as const),
      ),
    [currentFavorites],
  );
  const displayedFavorites = useMemo(() => {
    if (favoriteQueryResult) {
      return favoriteQueryResult.items
        .map((server) => favoriteByAddress.get(server.address))
        .filter((favorite): favorite is Favorite => favorite !== undefined);
    }

    const start = (favoritePage - 1) * favoritePageSize;
    return currentFavorites.slice(start, start + favoritePageSize);
  }, [
    currentFavorites,
    favoriteByAddress,
    favoritePage,
    favoritePageSize,
    favoriteQueryResult,
  ]);
  const currentFavoriteIds = useMemo(
    () => new Set(displayedFavorites.map((favorite) => favorite.id)),
    [displayedFavorites],
  );
  const selectedCurrentCount = [...selectedFavoriteIds].filter((id) =>
    currentFavoriteIds.has(id),
  ).length;
  const allCurrentSelected =
    displayedFavorites.length > 0 &&
    displayedFavorites.every((favorite) => selectedFavoriteIds.has(favorite.id));
  const selectionChecked = allCurrentSelected
    ? true
    : selectedCurrentCount > 0
      ? "indeterminate"
      : false;
  const favoriteTotal = favoriteQueryResult?.total ?? currentFavorites.length;
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
  const tableMinWidth = useMemo(
    () =>
      SELECT_COLUMN_WIDTH +
      ACTIONS_COLUMN_WIDTH +
      Object.values(columnWidths).reduce((total, width) => total + width, 0),
    [columnWidths],
  );
  const visibleStartIndex = Math.max(
    0,
    Math.floor(tableScrollTop / FAVORITE_ROW_HEIGHT) - FAVORITE_ROW_OVERSCAN,
  );
  const visibleFavoriteCount =
    Math.ceil(tableViewportHeight / FAVORITE_ROW_HEIGHT) +
    FAVORITE_ROW_OVERSCAN * 2;
  const visibleEndIndex = Math.min(
    displayedFavorites.length,
    visibleStartIndex + visibleFavoriteCount,
  );
  const visibleFavorites = displayedFavorites.slice(
    visibleStartIndex,
    visibleEndIndex,
  );
  const topSpacerHeight = visibleStartIndex * FAVORITE_ROW_HEIGHT;
  const bottomSpacerHeight =
    (displayedFavorites.length - visibleEndIndex) * FAVORITE_ROW_HEIGHT;

  const resetTableScroll = useCallback(() => {
    const viewport = tableViewportRef.current;
    if (viewport) {
      viewport.scrollTop = 0;
    }
    setTableScrollTop(0);
  }, []);

  const loadFavorites = useCallback(async () => {
    resetTableScroll();
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
      resetTableScroll();
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
  }, [
    fallbackDefaultGroup,
    messages.favorites.toasts.loadFailed,
    resetTableScroll,
  ]);

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
    const viewport = tableViewportRef.current;
    if (!viewport) {
      return;
    }

    const updateViewportHeight = () => {
      setTableViewportHeight(viewport.clientHeight);
    };

    updateViewportHeight();
    const observer = new ResizeObserver(updateViewportHeight);
    observer.observe(viewport);

    return () => observer.disconnect();
  }, [displayedFavorites.length]);

  useEffect(() => {
    const viewport = tableViewportRef.current;
    if (!viewport) {
      resetTableScroll();
      return;
    }

    resetTableScroll();
    setFavoritePage(1);
    setFavoriteQueryResult(null);
  }, [resetTableScroll, selectedGroup.id]);

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
      const saved = editingFavorite
        ? await api.updateFavorite(editingFavorite.id, normalizedInput)
        : await api.addFavorite(normalizedInput);

      setFavorites((current) =>
        editingFavorite
          ? current.map((favorite) =>
              favorite.id === saved.id ? saved : favorite,
            )
          : [...current, saved],
      );
      setFavoriteQueryResult(null);
      setSelectedGroupId(saved.groupId || DEFAULT_GROUP_ID);
      setEditorOpen(false);
      setEditingFavorite(null);
      toast.success(messages.favorites.toasts.saved(editingFavorite !== null));
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
    const addresses = [...new Set(targets.map((favorite) => favorite.address))];

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

    try {
      const { pageResult, snapshotsByAddress } = await queryAddressSnapshots(
        addresses,
        requestedPage,
        requestedPageSize,
      );

      if (refreshRunIdRef.current !== runId) {
        return;
      }

      const invalidIds = targets
        .filter((favorite) => !snapshotsByAddress.has(favorite.address))
        .map((favorite) => favorite.id);
      const updatedFavorites = await Promise.all(
        targets.flatMap((favorite) => {
          const snapshot = snapshotsByAddress.get(favorite.address);
          return snapshot ? [api.updateFavoriteSnapshot(favorite.id, snapshot)] : [];
        }),
      );

      await Promise.all(invalidIds.map((id) => api.deleteFavorite(id)));

      if (refreshRunIdRef.current !== runId) {
        return;
      }

      const updatedById = new Map(
        updatedFavorites.map((favorite) => [favorite.id, favorite]),
      );
      const invalidIdSet = new Set(invalidIds);
      setFavorites((current) =>
        current
          .filter((favorite) => !invalidIdSet.has(favorite.id))
          .map((favorite) => updatedById.get(favorite.id) ?? favorite),
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
        const updatedFavorite = updatedById.get(selectedId);
        if (updatedFavorite?.lastSnapshot) {
          setSelectedServer(updatedFavorite.lastSnapshot);
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
    setFavorites((current) =>
      current.map((favorite) =>
        favorite.id === favoriteId || favorite.address === server.address
          ? {
              ...favorite,
              serverId: server.serverId ?? favorite.serverId,
              lastSnapshot: server,
            }
          : favorite,
      ),
    );

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
    const serverId = favoriteServerId(favorite);
    if (!serverId) {
      toast.error(messages.serverDetail.snapshotUnavailable);
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
      const details = await api.getServerDetails(
        serverId,
        favorite.address,
        favorite.customName,
      );
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
        displayedFavorites.forEach((favorite) => next.add(favorite.id));
      } else {
        displayedFavorites.forEach((favorite) => next.delete(favorite.id));
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

  const handleTableScroll = (event: UIEvent<HTMLDivElement>) => {
    setTableScrollTop(event.currentTarget.scrollTop);
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
            {messages.favorites.actions.addFavorite}
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
                        variant="destructive"
                        disabled={deletingFavoriteIds.size > 0}
                        onClick={() => setDeleteSelectionOpen(true)}
                      >
                        <Trash2 data-icon="inline-start" />
                        {messages.favorites.actions.deleteSelected}
                      </Button>
                    </>
                  ) : null}
                  {selectedGroup.id !== DEFAULT_GROUP_ID ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={deletingGroupId !== null}
                      onClick={() => setDeleteGroup(selectedGroup)}
                    >
                      <Trash2 data-icon="inline-start" />
                      {messages.favorites.actions.deleteCurrentGroup}
                    </Button>
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
                <div
                  ref={tableViewportRef}
                  className="min-h-0 flex-1 overflow-auto [scrollbar-gutter:stable]"
                  onScroll={handleTableScroll}
                >
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
                        <TableHead className="relative select-none pr-3">
                          {messages.favorites.columns.server}
                          <ResizeHandle
                            onPointerDown={(event) =>
                              startColumnResize(event, "server")
                            }
                          />
                        </TableHead>
                        <TableHead className="relative select-none pr-3">
                          {messages.favorites.columns.address}
                          <ResizeHandle
                            onPointerDown={(event) =>
                              startColumnResize(event, "address")
                            }
                          />
                        </TableHead>
                        <TableHead className="relative select-none pr-3">
                          {messages.serverTable.columns.map}
                          <ResizeHandle
                            onPointerDown={(event) =>
                              startColumnResize(event, "map")
                            }
                          />
                        </TableHead>
                        <TableHead className="relative select-none pr-3 text-right">
                          {messages.serverTable.columns.players}
                          <ResizeHandle
                            onPointerDown={(event) =>
                              startColumnResize(event, "players")
                            }
                          />
                        </TableHead>
                        <TableHead className="relative select-none pr-3 text-right">
                          {messages.serverTable.columns.ping}
                          <ResizeHandle
                            onPointerDown={(event) =>
                              startColumnResize(event, "ping")
                            }
                          />
                        </TableHead>
                        <TableHead className="relative select-none pr-3">
                          {messages.favorites.columns.tags}
                          <ResizeHandle
                            onPointerDown={(event) =>
                              startColumnResize(event, "tags")
                            }
                          />
                        </TableHead>
                        <TableHead className="relative select-none pr-3">
                          {messages.serverTable.columns.status}
                          <ResizeHandle
                            onPointerDown={(event) =>
                              startColumnResize(event, "status")
                            }
                          />
                        </TableHead>
                        <TableHead
                          className="w-28 text-right"
                          aria-label={messages.favorites.columns.actions}
                        />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {topSpacerHeight > 0 ? (
                        <TableRow aria-hidden="true">
                          <TableCell
                            colSpan={9}
                            className="border-0 p-0"
                            style={{ height: `${topSpacerHeight}px` }}
                          />
                        </TableRow>
                      ) : null}
                      {visibleFavorites.map((favorite) => {
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
                            className="cursor-pointer"
                            style={{ height: `${FAVORITE_ROW_HEIGHT}px` }}
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
                      {bottomSpacerHeight > 0 ? (
                        <TableRow aria-hidden="true">
                          <TableCell
                            colSpan={9}
                            className="border-0 p-0"
                            style={{ height: `${bottomSpacerHeight}px` }}
                          />
                        </TableRow>
                      ) : null}
                    </TableBody>
                  </table>
                </div>
              )}
              {currentFavorites.length > 0 ? (
                <div className="flex min-h-11 items-center justify-between gap-3 border-t bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
                  <span className="truncate">
                    {messages.serverList.footerStatus(
                      favoritePage,
                      favoriteTotalPages,
                      refreshingDetails,
                    )}
                  </span>
                  <div className="flex items-center gap-2">
                    <Select
                      value={String(favoritePageSize)}
                      disabled={refreshingDetails}
                      onValueChange={(value) => {
                        const nextPageSize = Number(value);
                        setFavoritePageSize(nextPageSize);
                        setFavoritePage(1);
                        if (favoriteQueryResult) {
                          void refreshCurrentGroupDetails(1, nextPageSize);
                        } else {
                          setFavoriteQueryResult(null);
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
                          {favoritePageSizeChoices.map((option) => (
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
                      disabled={refreshingDetails || favoritePage <= 1}
                      onClick={() => {
                        const nextPage = Math.max(1, favoritePage - 1);
                        setFavoritePage(nextPage);
                        if (favoriteQueryResult) {
                          void refreshCurrentGroupDetails(nextPage);
                        } else {
                          setFavoriteQueryResult(null);
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
                      disabled={
                        refreshingDetails || favoritePage >= favoriteTotalPages
                      }
                      onClick={() => {
                        const nextPage = Math.min(
                          favoriteTotalPages,
                          favoritePage + 1,
                        );
                        setFavoritePage(nextPage);
                        if (favoriteQueryResult) {
                          void refreshCurrentGroupDetails(nextPage);
                        } else {
                          setFavoriteQueryResult(null);
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
