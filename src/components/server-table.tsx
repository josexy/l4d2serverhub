import {
  AlertCircle,
  ExternalLink,
  RefreshCw,
  ShieldCheck,
  Star,
} from "lucide-react";
import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useI18n } from "@/lib/app-preferences";
import { SortableTableHead } from "@/components/sortable-table-head";
import {
  ServerLatency,
  ServerPopulation,
  ServerStatusIcon,
} from "@/components/server-metrics";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ServerTableScrollArea } from "@/components/server-table-scroll-area";
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { getDisplayModeTags, MODE_TAG_CLASS_NAMES } from "@/lib/mode-tags";
import {
  createDefaultSortState,
  nextSortState,
  sortCurrentPage,
  type SortValue,
  type TableSortState,
} from "@/lib/table-sorting";
import type { ServerSnapshot } from "@/lib/types";

type ServerTableProps = {
  servers: ServerSnapshot[];
  selectedAddress: string | null;
  favoriteAddresses: Set<string>;
  pendingFavoriteAddresses: Set<string>;
  pendingConnectAddresses: Set<string>;
  isRefreshing: boolean;
  hasLoadedOnce: boolean;
  error: string | null;
  onSelect: (server: ServerSnapshot) => void;
  onToggleFavorite: (server: ServerSnapshot) => void;
  onConnect: (server: ServerSnapshot) => void;
};

type ResizableColumnId =
  | "name"
  | "address"
  | "map"
  | "players"
  | "ping"
  | "tags";

type ColumnWidths = Record<ResizableColumnId, number>;
type ServerSortColumnId = ResizableColumnId;

const FAVORITE_COLUMN_WIDTH = 44;
const CONNECT_COLUMN_WIDTH = 100;

const DEFAULT_COLUMN_WIDTHS: ColumnWidths = {
  name: 270,
  address: 172,
  map: 160,
  players: 86,
  ping: 90,
  tags: 112,
};

const MIN_COLUMN_WIDTHS: ColumnWidths = {
  name: 180,
  address: 140,
  map: 120,
  players: 84,
  ping: 84,
  tags: 112,
};

function clampColumnWidth(columnId: ResizableColumnId, width: number): number {
  return Math.max(MIN_COLUMN_WIDTHS[columnId], Math.round(width));
}

function ServerTags({
  server,
  modeLabels,
}: {
  server: ServerSnapshot;
  modeLabels: Record<string, string>;
}) {
  const displayTags = getDisplayModeTags(server.modeTags);

  return (
    <div className="flex w-full min-w-0 flex-wrap items-center gap-1 py-1">
      {displayTags.map((tag) => (
        <Badge
          key={tag}
          variant="outline"
          className={cn(
            "max-w-28 truncate rounded-md text-[11px]",
            MODE_TAG_CLASS_NAMES[tag],
          )}
        >
          {modeLabels[tag] ?? tag}
        </Badge>
      ))}
    </div>
  );
}

function activeSortDirection(
  sortState: TableSortState<ServerSortColumnId>,
  columnId: ServerSortColumnId,
) {
  return sortState.column === columnId ? sortState.direction : "none";
}

function ResizeHandle({
  onPointerDown,
}: {
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      className="column-resize-handle absolute right-0 top-0 h-full w-3 cursor-col-resize touch-none"
      onPointerDown={onPointerDown}
    >
      <div className="mx-auto h-full w-px" />
    </div>
  );
}

export function ServerTable({
  servers,
  selectedAddress,
  favoriteAddresses,
  pendingFavoriteAddresses,
  pendingConnectAddresses,
  isRefreshing,
  hasLoadedOnce,
  error,
  onSelect,
  onToggleFavorite,
  onConnect,
}: ServerTableProps) {
  const { messages } = useI18n();
  const [columnWidths, setColumnWidths] = useState<ColumnWidths>(
    DEFAULT_COLUMN_WIDTHS,
  );
  const [sortState, setSortState] = useState<
    TableSortState<ServerSortColumnId>
  >(() => createDefaultSortState());
  const [resizingColumn, setResizingColumn] =
    useState<ResizableColumnId | null>(null);
  const activeResizeRef = useRef<{
    columnId: ResizableColumnId;
    startX: number;
    startWidth: number;
  } | null>(null);

  useEffect(() => {
    if (!resizingColumn) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const activeResize = activeResizeRef.current;
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
      activeResizeRef.current = null;
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

  const tableMinWidth = useMemo(
    () =>
      FAVORITE_COLUMN_WIDTH +
      CONNECT_COLUMN_WIDTH +
      Object.values(columnWidths).reduce((total, width) => total + width, 0),
    [columnWidths],
  );

  const sortedServers = useMemo(
    () =>
      sortCurrentPage(servers, sortState, (server, column): SortValue => {
        switch (column) {
          case "name":
            return server.name;
          case "address":
            return server.address;
          case "map":
            return server.map;
          case "players":
            return server.players;
          case "ping":
            return server.pingMs;
          case "tags":
            return getDisplayModeTags(server.modeTags)
              .map((tag) => messages.filterToolbar.modeLabels[tag] ?? tag)
              .join(", ");
        }
      }),
    [
      messages.filterToolbar.modeLabels,
      servers,
      sortState,
    ],
  );

  const startColumnResize = (
    event: ReactPointerEvent<HTMLDivElement>,
    columnId: ResizableColumnId,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    activeResizeRef.current = {
      columnId,
      startX: event.clientX,
      startWidth: columnWidths[columnId],
    };
    setResizingColumn(columnId);
  };

  const handleSort = (columnId: ServerSortColumnId) => {
    setSortState((current) => nextSortState(current, columnId));
  };

  if (error && servers.length === 0) {
    return (
      <div className="grid min-h-72 place-items-center p-6 text-center">
        <div className="flex max-w-md flex-col items-center gap-2">
          <AlertCircle aria-hidden="true" className="text-destructive" />
          <p className="font-medium text-foreground">
            {messages.serverTable.errorTitle}
          </p>
          <p className="text-sm text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  if (servers.length === 0) {
    const title = isRefreshing && !hasLoadedOnce
      ? messages.serverList.firstRefreshTitle
      : messages.serverList.emptyTitle;
    const description = isRefreshing && !hasLoadedOnce
      ? messages.serverList.firstRefreshDescription
      : messages.serverList.emptyDescription;

    return (
      <div className="grid min-h-72 place-items-center p-6 text-center">
        <div className="flex max-w-md flex-col items-center gap-2">
          <p className="font-medium text-foreground">{title}</p>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
    );
  }

  return (
    <ServerTableScrollArea className="h-full">
      <table
        data-slot="table"
        className="server-data-table w-full table-fixed caption-bottom text-[13px]"
        style={{ minWidth: `${tableMinWidth}px` }}
      >
        <colgroup>
          <col style={{ width: `${FAVORITE_COLUMN_WIDTH}px` }} />
          <col style={{ width: `${columnWidths.name}px` }} />
          <col style={{ width: `${columnWidths.address}px` }} />
          <col style={{ width: `${columnWidths.map}px` }} />
          <col style={{ width: `${columnWidths.players}px` }} />
          <col style={{ width: `${columnWidths.ping}px` }} />
          <col style={{ width: `${columnWidths.tags}px` }} />
          <col style={{ width: `${CONNECT_COLUMN_WIDTH}px` }} />
        </colgroup>
        <TableHeader className="server-table-header">
          <TableRow>
            <TableHead
              className="w-11"
              aria-label={messages.serverTable.columns.favorite}
            />
            <SortableTableHead
              label={messages.serverTable.columns.name}
              activeDirection={activeSortDirection(sortState, "name")}
              getSortLabel={messages.tableSorting.aria.sortColumn}
              onSort={() => handleSort("name")}
            >
              <ResizeHandle
                onPointerDown={(event) => startColumnResize(event, "name")}
              />
            </SortableTableHead>
            <SortableTableHead
              label={messages.serverTable.columns.address}
              activeDirection={activeSortDirection(sortState, "address")}
              getSortLabel={messages.tableSorting.aria.sortColumn}
              onSort={() => handleSort("address")}
            >
              <ResizeHandle
                onPointerDown={(event) => startColumnResize(event, "address")}
              />
            </SortableTableHead>
            <SortableTableHead
              label={messages.serverTable.columns.map}
              activeDirection={activeSortDirection(sortState, "map")}
              getSortLabel={messages.tableSorting.aria.sortColumn}
              onSort={() => handleSort("map")}
            >
              <ResizeHandle
                onPointerDown={(event) => startColumnResize(event, "map")}
              />
            </SortableTableHead>
            <SortableTableHead
              label={messages.serverTable.columns.players}
              activeDirection={activeSortDirection(sortState, "players")}
              align="right"
              getSortLabel={messages.tableSorting.aria.sortColumn}
              onSort={() => handleSort("players")}
            >
              <ResizeHandle
                onPointerDown={(event) => startColumnResize(event, "players")}
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
                onPointerDown={(event) => startColumnResize(event, "ping")}
              />
            </SortableTableHead>
            <SortableTableHead
              label={messages.serverTable.columns.tags}
              activeDirection={activeSortDirection(sortState, "tags")}
              getSortLabel={messages.tableSorting.aria.sortColumn}
              onSort={() => handleSort("tags")}
            >
              <ResizeHandle
                onPointerDown={(event) => startColumnResize(event, "tags")}
              />
            </SortableTableHead>
            <TableHead
              className="server-actions w-[100px] text-center"
              aria-label={messages.serverTable.columns.connect}
            >
              {messages.serverTable.columns.connect}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedServers.map((server) => {
            const isFavorite = favoriteAddresses.has(server.address);
            const isFavoritePending = pendingFavoriteAddresses.has(
              server.address,
            );
            const isConnectPending = pendingConnectAddresses.has(
              server.address,
            );
            const isSelected = selectedAddress === server.address;

            return (
              <TableRow
                key={server.address}
                className={cn(
                  "h-12 cursor-pointer",
                  isSelected && "bg-primary/5",
                )}
                aria-selected={isSelected}
                onClick={() => onSelect(server)}
              >
                <TableCell>
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    className={cn(
                      "server-favorite-button",
                      isFavorite && "is-favorite",
                    )}
                    aria-label={
                      isFavoritePending
                        ? messages.serverTable.aria.favoritePending
                        : isFavorite
                          ? messages.serverTable.aria.removeFavorite(
                              server.name,
                            )
                          : messages.serverTable.aria.addFavorite(server.name)
                    }
                    disabled={isFavoritePending}
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggleFavorite(server);
                    }}
                  >
                    {isFavoritePending ? (
                      <RefreshCw aria-hidden="true" />
                    ) : (
                      <Star
                        aria-hidden="true"
                        className={cn(isFavorite && "fill-current")}
                      />
                    )}
                  </Button>
                </TableCell>
                <TableCell className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <ServerStatusIcon snapshot={server} />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-auto min-w-0 flex-1 justify-start gap-2 overflow-hidden px-1 py-0.5 text-left"
                      aria-label={messages.serverTable.aria.openDetails(
                        server.name,
                      )}
                      onClick={(event) => {
                        event.stopPropagation();
                        onSelect(server);
                      }}
                    >
                      <span
                        className="min-w-0 flex-1 truncate font-medium"
                        title={server.name}
                      >
                        {server.name}
                      </span>
                      {server.vacSecured ? (
                        <ShieldCheck
                          aria-hidden="true"
                          className="size-3.5 shrink-0 text-muted-foreground/65"
                        />
                      ) : null}
                    </Button>
                  </div>
                </TableCell>
                <TableCell>
                  <div
                    className="truncate font-mono text-xs text-muted-foreground"
                    title={server.address}
                  >
                    {server.address}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="truncate" title={server.map}>
                    {server.map || "-"}
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  <ServerPopulation
                    players={server.players}
                    maxPlayers={server.maxPlayers}
                  />
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  <ServerLatency
                    pingMs={server.pingMs}
                    unknownLabel={messages.serverTable.pingUnknown}
                  />
                </TableCell>
                <TableCell className="min-w-0">
                  <ServerTags
                    server={server}
                    modeLabels={messages.filterToolbar.modeLabels}
                  />
                </TableCell>
                <TableCell className="server-actions text-center">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="w-20 justify-center border-primary/20 text-primary hover:border-primary/40 hover:text-primary"
                    aria-label={
                      isConnectPending
                        ? messages.serverTable.aria.connectPending(server.name)
                        : messages.serverTable.aria.connect(server.name)
                    }
                    disabled={isConnectPending}
                    onClick={(event) => {
                      event.stopPropagation();
                      onConnect(server);
                    }}
                  >
                    {isConnectPending ? (
                      <RefreshCw aria-hidden="true" className="animate-spin" />
                    ) : (
                      <ExternalLink aria-hidden="true" />
                    )}
                    <span>{messages.serverTable.columns.connect}</span>
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </table>
    </ServerTableScrollArea>
  );
}
