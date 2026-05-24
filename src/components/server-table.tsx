import {
  AlertCircle,
  Eye,
  LogIn,
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { getDisplayModeTags, MODE_TAG_CLASS_NAMES } from "@/lib/mode-tags";
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
  | "tags"
  | "status";

type ColumnWidths = Record<ResizableColumnId, number>;

const FAVORITE_COLUMN_WIDTH = 44;
const CONNECT_COLUMN_WIDTH = 52;

const DEFAULT_COLUMN_WIDTHS: ColumnWidths = {
  name: 260,
  address: 176,
  map: 160,
  players: 96,
  ping: 96,
  tags: 160,
  status: 96,
};

const MIN_COLUMN_WIDTHS: ColumnWidths = {
  name: 180,
  address: 140,
  map: 120,
  players: 84,
  ping: 84,
  tags: 112,
  status: 88,
};

function clampColumnWidth(columnId: ResizableColumnId, width: number): number {
  return Math.max(MIN_COLUMN_WIDTHS[columnId], Math.round(width));
}

function getStatus(
  server: ServerSnapshot,
  labels: ReturnType<typeof useI18n>["messages"]["serverTable"]["statuses"],
) {
  if (server.lastQueryError) {
    return { label: labels.error, variant: "destructive" as const };
  }

  if (server.maxPlayers > 0 && server.players >= server.maxPlayers) {
    return { label: labels.full, variant: "secondary" as const };
  }

  if (server.players === 0) {
    return { label: labels.empty, variant: "outline" as const };
  }

  return { label: labels.open, variant: "default" as const };
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
          className={cn("max-w-28 truncate", MODE_TAG_CLASS_NAMES[tag])}
        >
          {modeLabels[tag] ?? tag}
        </Badge>
      ))}
    </div>
  );
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
  const [resizingColumn, setResizingColumn] = useState<ResizableColumnId | null>(
    null,
  );
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
    <ScrollArea className="h-full [&_[data-slot=table-container]]:overflow-visible">
      <Table className="table-fixed" style={{ minWidth: `${tableMinWidth}px` }}>
        <colgroup>
          <col style={{ width: `${FAVORITE_COLUMN_WIDTH}px` }} />
          <col style={{ width: `${columnWidths.name}px` }} />
          <col style={{ width: `${columnWidths.address}px` }} />
          <col style={{ width: `${columnWidths.map}px` }} />
          <col style={{ width: `${columnWidths.players}px` }} />
          <col style={{ width: `${columnWidths.ping}px` }} />
          <col style={{ width: `${columnWidths.tags}px` }} />
          <col style={{ width: `${columnWidths.status}px` }} />
          <col style={{ width: `${CONNECT_COLUMN_WIDTH}px` }} />
        </colgroup>
        <TableHeader className="[&_th]:sticky [&_th]:top-0 [&_th]:z-20 [&_th]:bg-background [&_th]:shadow-[inset_0_-1px_0_var(--border)]">
          <TableRow>
            <TableHead
              className="w-11"
              aria-label={messages.serverTable.columns.favorite}
            />
            <TableHead className="relative select-none pr-3">
              {messages.serverTable.columns.name}
              <ResizeHandle
                onPointerDown={(event) => startColumnResize(event, "name")}
              />
            </TableHead>
            <TableHead className="relative select-none pr-3">
              {messages.serverTable.columns.address}
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
            <TableHead
              className="w-[52px] text-center"
              aria-label={messages.serverTable.columns.connect}
            />
          </TableRow>
        </TableHeader>
        <TableBody>
          {servers.map((server) => {
            const status = getStatus(server, messages.serverTable.statuses);
            const isFavorite = favoriteAddresses.has(server.address);
            const isFavoritePending = pendingFavoriteAddresses.has(server.address);
            const isConnectPending = pendingConnectAddresses.has(server.address);
            const isSelected = selectedAddress === server.address;

            return (
              <TableRow
                key={server.address}
                className={cn(
                  "h-11 cursor-pointer",
                  isSelected && "bg-muted/70",
                )}
                aria-selected={isSelected}
                onClick={() => onSelect(server)}
              >
                <TableCell>
                  <Button
                    type="button"
                    size="icon-xs"
                    variant={isFavorite ? "secondary" : "ghost"}
                    aria-label={
                      isFavoritePending
                        ? messages.serverTable.aria.favoritePending
                        : isFavorite
                          ? messages.serverTable.aria.removeFavorite(server.name)
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
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-auto w-full max-w-full justify-start gap-2 overflow-hidden px-1 py-0.5 text-left"
                    aria-label={messages.serverTable.aria.openDetails(server.name)}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelect(server);
                    }}
                  >
                    <Eye
                      aria-hidden="true"
                      className="shrink-0 text-muted-foreground"
                    />
                    {server.vacSecured ? (
                      <ShieldCheck
                        aria-hidden="true"
                        className="shrink-0 text-muted-foreground"
                      />
                    ) : null}
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {server.name}
                    </span>
                  </Button>
                </TableCell>
                <TableCell>
                  <div className="truncate font-mono text-xs">{server.address}</div>
                </TableCell>
                <TableCell>
                  <div className="truncate">{server.map || "-"}</div>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {server.players}/{server.maxPlayers}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {server.pingMs === null
                    ? messages.serverTable.pingUnknown
                    : `${server.pingMs} ms`}
                </TableCell>
                <TableCell className="min-w-0">
                  <ServerTags
                    server={server}
                    modeLabels={messages.filterToolbar.modeLabels}
                  />
                </TableCell>
                <TableCell>
                  <Badge variant={status.variant}>{status.label}</Badge>
                </TableCell>
                <TableCell className="text-center">
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="outline"
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
                      <RefreshCw aria-hidden="true" />
                    ) : (
                      <LogIn aria-hidden="true" />
                    )}
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </ScrollArea>
  );
}
