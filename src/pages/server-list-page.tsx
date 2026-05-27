import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";

import { FilterToolbar } from "@/components/filter-toolbar";
import { ServerDetailPanel } from "@/components/server-detail-panel";
import { ServerTable } from "@/components/server-table";
import { TablePagination } from "@/components/table-pagination";
import { useAppPreferences, useI18n } from "@/lib/app-preferences";
import { toast } from "@/components/ui/toast";
import { api, formatCommandError } from "@/lib/api";
import { createDefaultFilters } from "@/lib/filters";
import type {
  Favorite,
  FavoriteInput,
  SearchHistoryRecord,
  ServerFilters,
  ServerQueryParams,
  ServerQueryResult,
  ServerSnapshot,
  ServerSort,
} from "@/lib/types";

const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_SORT: ServerSort = "none";
const DEFAULT_GROUP_ID = "default";
const FILTER_DEBOUNCE_MS = 250;
const SEARCH_HISTORY_DEBOUNCE_MS = 900;
const SERVER_BROWSER_SAVE_DEBOUNCE_MS = 500;

function favoriteInputFor(server: ServerSnapshot, groupId: string): FavoriteInput {
  return {
    address: server.address,
    serverId: server.serverId,
    groupId,
    customName: server.name.trim() || null,
    notes: "",
    tags: server.modeTags,
  };
}

function favoritesByAddress(favorites: Favorite[]): Map<string, Favorite> {
  const byAddress = new Map<string, Favorite>();

  for (const favorite of favorites) {
    const existing = byAddress.get(favorite.address);
    if (!existing || favorite.groupId === DEFAULT_GROUP_ID) {
      byAddress.set(favorite.address, favorite);
    }
  }

  return byAddress;
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedValue(value);
    }, delayMs);

    return () => window.clearTimeout(timeoutId);
  }, [delayMs, value]);

  return debouncedValue;
}

function addPendingAddress(
  ref: MutableRefObject<Set<string>>,
  setState: Dispatch<SetStateAction<Set<string>>>,
  address: string,
): boolean {
  if (ref.current.has(address)) {
    return false;
  }

  ref.current = new Set(ref.current).add(address);
  setState(new Set(ref.current));
  return true;
}

function removePendingAddress(
  ref: MutableRefObject<Set<string>>,
  setState: Dispatch<SetStateAction<Set<string>>>,
  address: string,
) {
  if (!ref.current.has(address)) {
    return;
  }

  const next = new Set(ref.current);
  next.delete(address);
  ref.current = next;
  setState(next);
}

type ServerListPageProps = {
  isActive?: boolean;
};

export function ServerListPage({ isActive = true }: ServerListPageProps) {
  const { settings, settingsLoaded, settingsLoadFailed, saveSettings } = useAppPreferences();
  const { messages, formatDateTime } = useI18n();
  const [filters, setFilters] = useState<ServerFilters>(createDefaultFilters);
  const debouncedFilters = useDebouncedValue(filters, FILTER_DEBOUNCE_MS);
  const debouncedSearchQuery = useDebouncedValue(
    filters.query,
    SEARCH_HISTORY_DEBOUNCE_MS,
  );
  const [sort, setSort] = useState<ServerSort>(DEFAULT_SORT);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [browserSettingsLoaded, setBrowserSettingsLoaded] = useState(false);
  const [queryResult, setQueryResult] = useState<ServerQueryResult | null>(null);
  const [searchHistory, setSearchHistory] = useState<SearchHistoryRecord[]>([]);
  const [favoriteByAddress, setFavoriteByAddress] = useState<Map<string, Favorite>>(
    () => new Map(),
  );
  const [selectedServer, setSelectedServer] = useState<ServerSnapshot | null>(
    null,
  );
  const [detailOpen, setDetailOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [pendingFavoriteAddresses, setPendingFavoriteAddresses] = useState<
    Set<string>
  >(() => new Set());
  const [pendingConnectAddresses, setPendingConnectAddresses] = useState<
    Set<string>
  >(() => new Set());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingFavoriteAddressesRef = useRef(new Set<string>());
  const pendingConnectAddressesRef = useRef(new Set<string>());
  const favoritesWarningShownRef = useRef(false);
  const settingsWarningShownRef = useRef(false);
  const searchHistoryWarningShownRef = useRef(false);
  const lastRecordedSearchRef = useRef("");

  const servers = queryResult?.items ?? [];
  const favoriteAddresses = useMemo(
    () => new Set(favoriteByAddress.keys()),
    [favoriteByAddress],
  );
  const total = queryResult?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / Math.max(pageSize, 1)));
  const filtersAreDebouncing = filters !== debouncedFilters;
  const pageSummary = useMemo(() => {
    if (total === 0) {
      return messages.serverList.pageSummaryZero;
    }

    const start = (page - 1) * pageSize + 1;
    const end = Math.min(total, page * pageSize);
    return messages.serverList.pageSummaryRange(start, end, total);
  }, [messages.serverList, page, pageSize, total]);

  const currentBrowserSettings = useMemo(
    () => ({
      filters,
      sort,
      pageSize,
    }),
    [filters, pageSize, sort],
  );

  useEffect(() => {
    if (!settingsLoaded || browserSettingsLoaded) {
      return;
    }

    const persisted = settings.serverBrowser;
    setFilters(persisted.filters);
    setSort(persisted.sort);
    setPageSize(persisted.pageSize || DEFAULT_PAGE_SIZE);
    setBrowserSettingsLoaded(true);
  }, [
    browserSettingsLoaded,
    settings.serverBrowser,
    settingsLoaded,
  ]);

  useEffect(() => {
    if (!browserSettingsLoaded) {
      return;
    }

    const currentSerialized = JSON.stringify(currentBrowserSettings);
    if (currentSerialized === JSON.stringify(settings.serverBrowser)) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void saveSettings({
        ...settings,
        serverBrowser: currentBrowserSettings,
      }).catch(() => {
        toast.error(messages.settings.saveFailed);
      });
    }, SERVER_BROWSER_SAVE_DEBOUNCE_MS);

    return () => window.clearTimeout(timeoutId);
  }, [
    browserSettingsLoaded,
    currentBrowserSettings,
    messages.settings.saveFailed,
    saveSettings,
    settings,
  ]);

  useEffect(() => {
    if (settingsLoadFailed && !settingsWarningShownRef.current) {
      toast.warning(messages.serverList.toasts.settingsFallback);
      settingsWarningShownRef.current = true;
      return;
    }

    if (!settingsLoadFailed) {
      settingsWarningShownRef.current = false;
    }
  }, [messages.serverList.toasts.settingsFallback, settingsLoadFailed]);

  useEffect(() => {
    if (!isActive) {
      return;
    }

    let isCurrent = true;
    const syncFavorites = async () => {
      try {
        const favorites = await api.listFavorites();
        if (!isCurrent) {
          return;
        }

        setFavoriteByAddress(favoritesByAddress(favorites));
        favoritesWarningShownRef.current = false;
      } catch {
        if (isCurrent && !favoritesWarningShownRef.current) {
          toast.warning(messages.serverList.toasts.favoritesMetadataUnavailable);
          favoritesWarningShownRef.current = true;
        }
      }
    };

    void syncFavorites();

    return () => {
      isCurrent = false;
    };
  }, [isActive, messages.serverList.toasts.favoritesMetadataUnavailable]);

  useEffect(() => {
    if (!settingsLoaded) {
      return;
    }

    let isCurrent = true;
    const loadSearchHistory = async () => {
      try {
        const records = await api.listSearchHistory();
        if (isCurrent) {
          setSearchHistory(records);
          searchHistoryWarningShownRef.current = false;
        }
      } catch {
        if (isCurrent && !searchHistoryWarningShownRef.current) {
          toast.warning(messages.serverList.toasts.searchHistoryLoadFailed);
          searchHistoryWarningShownRef.current = true;
        }
      }
    };

    void loadSearchHistory();

    return () => {
      isCurrent = false;
    };
  }, [messages.serverList.toasts.searchHistoryLoadFailed, settingsLoaded]);

  useEffect(() => {
    if (!settingsLoaded || !browserSettingsLoaded || filtersAreDebouncing) {
      return;
    }

    let isCurrent = true;
    const params: ServerQueryParams = {
      page,
      pageSize,
      filters: debouncedFilters,
      sort,
    };

    const query = async () => {
      setIsRefreshing(true);
      setError(null);

      try {
        const [result, favoritesResult] = await Promise.all([
          api.queryServers(params),
          api
            .listFavorites()
            .then((favorites) => ({ favorites, error: null }))
            .catch((favoriteError: unknown) => ({
              favorites: [],
              error: favoriteError,
            })),
        ]);

        if (!isCurrent) {
          return;
        }

        setQueryResult(result);
        setSelectedServer((current) => {
          if (!current) {
            return current;
          }

          return (
            result.items.find((item) => item.address === current.address) ??
            current
          );
        });
        if (favoritesResult.error) {
          if (!favoritesWarningShownRef.current) {
            toast.warning(messages.serverList.toasts.favoritesMetadataUnavailable);
            favoritesWarningShownRef.current = true;
          }
        } else {
          setFavoriteByAddress(favoritesByAddress(favoritesResult.favorites));
          favoritesWarningShownRef.current = false;
        }
      } catch (queryError) {
        if (!isCurrent) {
          return;
        }

        const message = formatCommandError(
          queryError,
          messages.serverList.toasts.queryFailed,
        );
        setError(message);
        toast.error(message);
      } finally {
        if (isCurrent) {
          setHasLoadedOnce(true);
          setIsRefreshing(false);
        }
      }
    };

    void query();

    return () => {
      isCurrent = false;
    };
  }, [
    debouncedFilters,
    filtersAreDebouncing,
    browserSettingsLoaded,
    messages.serverList.toasts.favoritesMetadataUnavailable,
    messages.serverList.toasts.queryFailed,
    page,
    pageSize,
    refreshKey,
    settingsLoaded,
    sort,
  ]);

  const handleFiltersChange = useCallback((nextFilters: ServerFilters) => {
    setFilters(nextFilters);
    setPage(1);
  }, []);

  const recordSearchHistory = useCallback(
    async (query: string) => {
      const trimmed = query.trim();
      if (!trimmed || trimmed === lastRecordedSearchRef.current) {
        return;
      }

      lastRecordedSearchRef.current = trimmed;
      try {
        const records = await api.addSearchHistory(trimmed);
        setSearchHistory(records);
      } catch {
        lastRecordedSearchRef.current = "";
      }
    },
    [],
  );

  useEffect(() => {
    if (!browserSettingsLoaded) {
      return;
    }

    void recordSearchHistory(debouncedSearchQuery);
  }, [browserSettingsLoaded, debouncedSearchQuery, recordSearchHistory]);

  const handleSearchCommit = useCallback(
    (query: string) => {
      void recordSearchHistory(query);
    },
    [recordSearchHistory],
  );

  const handleSearchHistorySelect = useCallback(
    (query: string) => {
      setFilters((current) => ({
        ...current,
        query,
      }));
      setPage(1);
      void recordSearchHistory(query);
    },
    [recordSearchHistory],
  );

  const handleSearchHistoryDelete = useCallback(
    async (id: string) => {
      try {
        await api.deleteSearchHistory(id);
        setSearchHistory((current) =>
          current.filter((record) => record.id !== id),
        );
      } catch {
        toast.error(messages.serverList.toasts.searchHistoryDeleteFailed);
      }
    },
    [messages.serverList.toasts.searchHistoryDeleteFailed],
  );

  const handleSortChange = useCallback((nextSort: ServerSort) => {
    setSort(nextSort);
    setPage(1);
  }, []);

  const handlePageSizeChange = useCallback((nextPageSize: number) => {
    setPageSize(nextPageSize);
    setPage(1);
  }, []);

  const handleRefresh = useCallback(() => {
    void recordSearchHistory(filters.query);
    setRefreshKey((current) => current + 1);
  }, [filters.query, recordSearchHistory]);

  const handleSelectServer = useCallback((server: ServerSnapshot) => {
    setSelectedServer(server);
    setDetailOpen(true);
  }, []);

  const handleServerUpdate = useCallback((server: ServerSnapshot) => {
    setSelectedServer(server);
    setQueryResult((current) =>
      current
        ? {
            ...current,
            items: current.items.map((item) =>
              item.address === server.address ? server : item,
            ),
          }
        : current,
    );
  }, []);

  const toggleFavorite = useCallback(
    async (server: ServerSnapshot) => {
      if (
        !addPendingAddress(
          pendingFavoriteAddressesRef,
          setPendingFavoriteAddresses,
          server.address,
        )
      ) {
        return;
      }

      const existingFavorite = favoriteByAddress.get(server.address);

      try {
        if (existingFavorite) {
          await api.deleteFavorite(existingFavorite.id);
          const favorites = await api.listFavorites();
          setFavoriteByAddress(favoritesByAddress(favorites));
          toast.success(messages.serverList.toasts.favoriteRemoved);
          return;
        }

        const groups = await api.listGroups();
        const groupId =
          groups.find((group) => group.id === DEFAULT_GROUP_ID)?.id ??
          DEFAULT_GROUP_ID;
        const favorite = await api.addFavorite(favoriteInputFor(server, groupId));
        setFavoriteByAddress((current) => {
          const next = new Map(current);
          next.set(favorite.address, favorite);
          return next;
        });
        toast.success(messages.serverList.toasts.favoriteAdded);
      } catch (favoriteError) {
        const message = formatCommandError(
          favoriteError,
          existingFavorite
            ? messages.serverList.toasts.favoriteRemoveFailed
            : messages.favorites.toasts.saveFailed,
        );
        toast.error(message);
      } finally {
        removePendingAddress(
          pendingFavoriteAddressesRef,
          setPendingFavoriteAddresses,
          server.address,
        );
      }
    },
    [
      favoriteByAddress,
      messages.favorites.toasts.saveFailed,
      messages.serverList.toasts.favoriteAdded,
      messages.serverList.toasts.favoriteRemoveFailed,
      messages.serverList.toasts.favoriteRemoved,
    ],
  );

  const connectToServer = useCallback(
    async (server: ServerSnapshot) => {
      if (
        !addPendingAddress(
          pendingConnectAddressesRef,
          setPendingConnectAddresses,
          server.address,
        )
      ) {
        return;
      }

      try {
        await api.connectToServer(server.address, server);
        toast.success(messages.serverList.toasts.connectStarted(server.address));
      } catch (connectError) {
        const message = formatCommandError(
          connectError,
          messages.serverList.toasts.connectFailed,
        );
        toast.error(message);
      } finally {
        removePendingAddress(
          pendingConnectAddressesRef,
          setPendingConnectAddresses,
          server.address,
        );
      }
    },
    [
      messages.serverList.toasts.connectFailed,
      messages.serverList.toasts.connectStarted,
    ],
  );

  const goToPage = useCallback(
    (nextPage: number) => {
      const boundedPage = Math.min(Math.max(nextPage, 1), totalPages);
      setPage(boundedPage);
    },
    [totalPages],
  );

  return (
    <section className="page-layout">
      <div className="page-heading">
        <div>
          <p className="page-eyebrow">{messages.serverList.eyebrow}</p>
          <h2>{messages.serverList.title}</h2>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="page-meta">{pageSummary}</div>
          </div>
          {queryResult?.refreshedAt ? (
            <p className="text-xs text-muted-foreground">
              {messages.serverList.refreshedAtLabel(
                formatDateTime(queryResult.refreshedAt, {
                  dateStyle: "medium",
                  timeStyle: "short",
                }),
              )}
            </p>
          ) : null}
        </div>
      </div>

      <div className="utility-panel flex flex-col overflow-hidden">
        <FilterToolbar
          filters={filters}
          sort={sort}
          pageSize={pageSize}
          loading={isRefreshing}
          searchHistory={searchHistory}
          onFiltersChange={handleFiltersChange}
          onSortChange={handleSortChange}
          onPageSizeChange={handlePageSizeChange}
          onSearchCommit={handleSearchCommit}
          onSearchHistorySelect={handleSearchHistorySelect}
          onSearchHistoryDelete={handleSearchHistoryDelete}
          onRefresh={handleRefresh}
        />

        <div className="min-h-0 flex-1">
          <ServerTable
            servers={servers}
            selectedAddress={selectedServer?.address ?? null}
            favoriteAddresses={favoriteAddresses}
            pendingFavoriteAddresses={pendingFavoriteAddresses}
            pendingConnectAddresses={pendingConnectAddresses}
            isRefreshing={isRefreshing}
            hasLoadedOnce={hasLoadedOnce}
            error={error}
            onSelect={handleSelectServer}
            onToggleFavorite={toggleFavorite}
            onConnect={connectToServer}
          />
        </div>

        <TablePagination
          page={page}
          totalPages={totalPages}
          disabled={isRefreshing}
          status={messages.serverList.footerStatus(page, totalPages, isRefreshing)}
          onPageChange={goToPage}
        />
      </div>

      <ServerDetailPanel
        open={isActive && detailOpen && selectedServer !== null}
        server={selectedServer}
        onOpenChange={setDetailOpen}
        onConnect={connectToServer}
        onToggleFavorite={toggleFavorite}
        onUpdateServer={handleServerUpdate}
        connectPending={
          selectedServer
            ? pendingConnectAddresses.has(selectedServer.address)
            : false
        }
        favoritePending={
          selectedServer
            ? pendingFavoriteAddresses.has(selectedServer.address)
            : false
        }
        isFavorite={
          selectedServer
            ? favoriteAddresses.has(selectedServer.address)
            : false
        }
      />
    </section>
  );
}
