import { useEffect, useRef, useState } from "react";
import { Copy, ExternalLink, RefreshCw, Star, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import { useI18n } from "@/lib/app-preferences";
import { api, formatCommandError } from "@/lib/api";
import { getDisplayModeTags, MODE_TAG_CLASS_NAMES } from "@/lib/mode-tags";
import { cn } from "@/lib/utils";
import type { ServerDetails, ServerPlayer, ServerSnapshot } from "@/lib/types";

type ServerDetailPanelProps = {
  open: boolean;
  server: ServerSnapshot | null;
  onOpenChange: (open: boolean) => void;
  onConnect: (server: ServerSnapshot) => Promise<void> | void;
  onToggleFavorite: (server: ServerSnapshot) => Promise<void> | void;
  onUpdateServer: (server: ServerSnapshot) => void;
  connectPending: boolean;
  favoritePending: boolean;
  isFavorite: boolean;
};

function formatPing(pingMs: number | null, unknownLabel: string): string {
  return pingMs === null ? unknownLabel : `${pingMs} ms`;
}

function formatDuration(seconds: number): string {
  const totalSeconds =
    Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainder = totalSeconds % 60;
  const parts = [];

  if (hours > 0) {
    parts.push(`${hours}h`);
  }
  if (minutes > 0) {
    parts.push(`${minutes}m`);
  }
  if (remainder > 0 || parts.length === 0) {
    parts.push(`${remainder}s`);
  }

  return parts.join("");
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate font-medium">{value}</dd>
    </div>
  );
}

function ServerModeTags({
  tags,
  modeLabels,
}: {
  tags: string[];
  modeLabels: Record<string, string>;
}) {
  const displayTags = getDisplayModeTags(tags);

  return (
    <div className="flex flex-wrap gap-1">
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

function fallbackCopyText(value: string): boolean {
  if (typeof document === "undefined" || !document.body) {
    return false;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    return document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
  }
}

function PlayerList({
  players,
  emptyLabel,
  nameLabel,
  scoreLabel,
  durationLabel,
}: {
  players: ServerPlayer[];
  emptyLabel: string;
  nameLabel: string;
  scoreLabel: string;
  durationLabel: string;
}) {
  if (players.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>;
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="grid grid-cols-[minmax(0,1fr)_64px_72px] gap-2 px-2 text-xs font-medium text-muted-foreground">
        <span>{nameLabel}</span>
        <span className="text-right">{scoreLabel}</span>
        <span className="text-right">{durationLabel}</span>
      </div>
      {players.map((player) => (
        <div
          key={`${player.name}-${player.durationSec}`}
          className="grid grid-cols-[minmax(0,1fr)_64px_72px] gap-2 rounded-md border px-2 py-1.5 text-sm"
        >
          <span className="truncate font-medium">{player.name}</span>
          <span className="text-right tabular-nums text-muted-foreground">
            {player.score}
          </span>
          <span className="text-right tabular-nums text-muted-foreground">
            {player.durationFormatted || formatDuration(player.durationSec)}
          </span>
        </div>
      ))}
    </div>
  );
}

function createPlaceholderPlayers(
  count: number,
  getName: (index: number) => string,
): ServerPlayer[] {
  return Array.from({ length: count }, (_, index) => ({
    name: getName(index + 1),
    score: 0,
    durationSec: 0,
    durationFormatted: "0s",
  }));
}

export function ServerDetailPanel({
  open,
  server,
  onOpenChange,
  onConnect,
  onToggleFavorite,
  onUpdateServer,
  connectPending,
  favoritePending,
  isFavorite,
}: ServerDetailPanelProps) {
  const { messages } = useI18n();
  const activeAddressRef = useRef<string | null>(null);
  const requestIdRef = useRef(0);
  const [details, setDetails] = useState<ServerDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    activeAddressRef.current = open ? server?.address ?? null : null;
    requestIdRef.current += 1;
    setDetails(null);
    setLoading(false);
    setError(null);
  }, [open, server?.address]);

  const snapshot = details?.snapshot ?? server;
  const { metadataLabels, playerColumns } = messages.serverDetail;
  const players =
    details && details.players.length === 0 && details.snapshot.players > 0
      ? createPlaceholderPlayers(
          details.snapshot.players,
          messages.serverDetail.placeholderPlayerName,
        )
      : details?.players ?? [];

  const loadDetails = async (showToast: boolean) => {
    if (!open || !server?.address) {
      setError(messages.serverDetail.snapshotUnavailable);
      return;
    }

    const requestAddress = server.address;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    activeAddressRef.current = requestAddress;
    setLoading(true);
    setError(null);

    try {
      const nextDetails = await api.getServerDetails({
        address: requestAddress,
        serverId: server.serverId,
        fallbackName: server.name,
      });

      if (
        activeAddressRef.current !== requestAddress ||
        requestIdRef.current !== requestId
      ) {
        return;
      }

      setDetails(nextDetails);
      onUpdateServer(nextDetails.snapshot);
    } catch (loadError) {
      if (
        activeAddressRef.current !== requestAddress ||
        requestIdRef.current !== requestId
      ) {
        return;
      }

      const message = formatCommandError(
        loadError,
        messages.serverDetail.snapshotUnavailable,
      );
      setError(message);
      onUpdateServer({
        ...server,
        lastQueryError: message,
      });
      if (showToast) {
        toast.error(message);
      }
    } finally {
      if (
        activeAddressRef.current === requestAddress &&
        requestIdRef.current === requestId
      ) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    if (!open || !server?.address) {
      return;
    }

    void loadDetails(false);
  }, [open, server?.address]);

  const copyAddress = async () => {
    if (!snapshot) {
      return;
    }

    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(snapshot.address);
      } else if (!fallbackCopyText(snapshot.address)) {
        throw new Error(messages.serverDetail.copyFailed);
      }
      toast.success(messages.serverDetail.copySuccess);
    } catch (copyError) {
      if (fallbackCopyText(snapshot.address)) {
        toast.success(messages.serverDetail.copySuccess);
        return;
      }

      const message = formatCommandError(copyError, messages.serverDetail.copyFailed);
      toast.error(message);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[560px] gap-0 overflow-hidden sm:max-w-[560px]">
        <SheetHeader className="shrink-0 pr-12">
          <SheetTitle className="truncate">
            {snapshot?.name ?? messages.serverDetail.titleFallback}
          </SheetTitle>
          <SheetDescription className="truncate">
            {snapshot ? snapshot.address : messages.serverDetail.descriptionFallback}
          </SheetDescription>
        </SheetHeader>

        {snapshot ? (
          <>
            <div className="flex shrink-0 flex-wrap gap-2 border-b px-4 pb-4">
              <Button
                type="button"
                size="sm"
                disabled={connectPending}
                onClick={() => onConnect(snapshot)}
              >
                {connectPending ? (
                  <RefreshCw data-icon="inline-start" />
                ) : (
                  <ExternalLink data-icon="inline-start" />
                )}
                {messages.serverDetail.connect}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={favoritePending}
                onClick={() => onToggleFavorite(snapshot)}
              >
                {favoritePending ? (
                  <RefreshCw data-icon="inline-start" />
                ) : (
                  <Star
                    data-icon="inline-start"
                    className={cn(isFavorite && "fill-current")}
                  />
                )}
                {isFavorite
                  ? messages.serverDetail.removeFavorite
                  : messages.serverDetail.addFavorite}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={copyAddress}
              >
                <Copy data-icon="inline-start" />
                {messages.serverDetail.copyAddress}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={loading || !server?.address}
                onClick={() => void loadDetails(true)}
              >
                <RefreshCw data-icon="inline-start" />
                {messages.common.refresh}
              </Button>
            </div>

            <ScrollArea className="h-0 min-h-0 flex-1 px-4 py-4">
              <div className="flex flex-col gap-5 pb-2">
                <section className="flex flex-col gap-2">
                  <h3 className="text-sm font-semibold">{messages.serverDetail.snapshotSection}</h3>
                  <dl className="flex flex-col gap-1.5 rounded-lg border p-3">
                    <DetailRow label={messages.serverDetail.labels.map} value={snapshot.map || "-"} />
                    <DetailRow
                      label={messages.serverDetail.labels.players}
                      value={`${snapshot.players}/${snapshot.maxPlayers} (${messages.serverDetail.values.bots(snapshot.bots)})`}
                    />
                    <DetailRow
                      label={messages.serverDetail.labels.ping}
                      value={formatPing(snapshot.pingMs, messages.serverDetail.pingUnknown)}
                    />
                    <DetailRow
                      label={messages.serverDetail.labels.vac}
                      value={
                        snapshot.vacSecured
                          ? messages.serverDetail.values.vacSecured
                          : messages.serverDetail.values.vacUnsecured
                      }
                    />
                    {snapshot.gameDescription ? (
                      <DetailRow
                        label={metadataLabels.game}
                        value={snapshot.gameDescription}
                      />
                    ) : null}
                    {snapshot.serverType ? (
                      <DetailRow
                        label={metadataLabels.serverType}
                        value={snapshot.serverType}
                      />
                    ) : null}
                    {snapshot.environment ? (
                      <DetailRow
                        label={metadataLabels.environment}
                        value={snapshot.environment}
                      />
                    ) : null}
                    {snapshot.version ? (
                      <DetailRow
                        label={metadataLabels.version}
                        value={snapshot.version}
                      />
                    ) : null}
                  </dl>

                  <ServerModeTags
                    tags={snapshot.modeTags}
                    modeLabels={messages.serverDetail.modeLabels}
                  />

                  {snapshot.lastQueryError ? (
                    <p className="rounded-lg border border-destructive/40 p-2 text-sm text-destructive">
                      {snapshot.lastQueryError}
                    </p>
                  ) : null}
                </section>

                <section className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold">
                      {messages.serverDetail.playersSection} ({players.length})
                    </h3>
                    {loading ? (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <RefreshCw className="size-3.5 animate-spin" />
                        {messages.common.refreshing}
                      </span>
                    ) : (
                      <Users className="size-4 text-muted-foreground" />
                    )}
                  </div>
                  {error ? (
                    <p className="text-sm text-destructive">{error}</p>
                  ) : (
                    <PlayerList
                      players={players}
                      emptyLabel={messages.serverDetail.noPlayers}
                      nameLabel={playerColumns.name}
                      scoreLabel={playerColumns.score}
                      durationLabel={playerColumns.duration}
                    />
                  )}
                </section>
              </div>
            </ScrollArea>
          </>
        ) : (
          <div className="px-4 text-sm text-muted-foreground">
            {messages.serverDetail.empty}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
