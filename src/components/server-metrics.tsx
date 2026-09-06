import {
  CircleCheck,
  CircleHelp,
  CircleMinus,
  CirclePause,
  CircleX,
  LoaderCircle,
} from "lucide-react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useI18n } from "@/lib/app-preferences";
import type { ServerSnapshot } from "@/lib/types";
import { cn } from "@/lib/utils";

export function ServerPopulation({
  players,
  maxPlayers,
}: {
  players: number;
  maxPlayers: number;
}) {
  const occupancy =
    maxPlayers > 0
      ? Math.min(100, Math.max(0, (players / maxPlayers) * 100))
      : 0;

  return (
    <div className="server-population">
      <span>
        <span className="font-semibold">{players}</span>
        <span className="text-muted-foreground"> / {maxPlayers}</span>
      </span>
      <span className="server-population-track" aria-hidden="true">
        <span style={{ width: `${occupancy}%` }} />
      </span>
    </div>
  );
}

export function ServerLatency({
  pingMs,
  unknownLabel,
}: {
  pingMs: number | null | undefined;
  unknownLabel: string;
}) {
  const known =
    pingMs !== null &&
    pingMs !== undefined &&
    Number.isFinite(pingMs) &&
    pingMs >= 0;
  const quality = !known
    ? "unknown"
    : pingMs < 100
      ? "good"
      : pingMs < 200
        ? "fair"
        : "poor";
  const activeBars =
    quality === "good"
      ? 3
      : quality === "fair"
        ? 2
        : quality === "poor"
          ? 1
          : 0;

  return (
    <span className="server-latency" data-quality={quality}>
      <span className="server-signal" aria-hidden="true">
        {[1, 2, 3].map((bar) => (
          <span key={bar} data-active={bar <= activeBars} />
        ))}
      </span>
      <span>
        {known ? (
          <>
            {pingMs}
            <span className="ml-1 text-[11px] text-muted-foreground">ms</span>
          </>
        ) : (
          unknownLabel
        )}
      </span>
    </span>
  );
}

const STATUS_ICONS = {
  open: CircleCheck,
  full: CirclePause,
  empty: CircleMinus,
  error: CircleX,
  unknown: CircleHelp,
  refreshing: LoaderCircle,
};

function getServerStatus(
  snapshot: ServerSnapshot | null,
  isRefreshing: boolean,
  queryError: string | null | undefined,
): keyof typeof STATUS_ICONS {
  if (isRefreshing) return "refreshing";
  if (queryError) return "error";
  if (!snapshot) return "unknown";
  if (snapshot.maxPlayers > 0 && snapshot.players >= snapshot.maxPlayers) {
    return "full";
  }
  return snapshot.players === 0 ? "empty" : "open";
}

export function ServerStatusIcon({
  snapshot,
  isRefreshing = false,
  error,
}: {
  snapshot: ServerSnapshot | null;
  isRefreshing?: boolean;
  error?: string;
}) {
  const { messages } = useI18n();
  const queryError = error || snapshot?.lastQueryError;
  const status = getServerStatus(snapshot, isRefreshing, queryError);
  const Icon = STATUS_ICONS[status];
  const label =
    status === "refreshing"
      ? messages.common.refreshing
      : messages.serverTable.statuses[status];
  const description =
    status === "error" && queryError ? `${label}: ${queryError}` : label;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="img"
          aria-label={description}
          tabIndex={0}
          className={cn(
            "inline-flex size-4 shrink-0 items-center justify-center rounded-sm outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring",
            (status === "open" || status === "refreshing") && "text-primary",
            status === "full" && "text-amber-700 dark:text-amber-400",
            status === "error" && "text-destructive",
            (status === "empty" || status === "unknown") && "text-muted-foreground",
          )}
        >
          <Icon
            aria-hidden="true"
            className={cn(
              "size-4",
              status === "refreshing" && "animate-spin motion-reduce:animate-none",
            )}
          />
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs break-words">
        {description}
      </TooltipContent>
    </Tooltip>
  );
}
