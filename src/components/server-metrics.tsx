import type { ComponentProps } from "react";

import { Badge } from "@/components/ui/badge";
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

export function ServerStatusBadge({
  variant,
  className,
  children,
  ...props
}: ComponentProps<typeof Badge>) {
  return (
    <Badge
      {...props}
      variant={variant}
      className={cn(
        "gap-1.5 rounded-md px-2 text-[11px]",
        variant === "default" && "border-primary/10 bg-primary/10 text-primary",
        variant === "secondary" && "bg-secondary/70 text-muted-foreground",
        variant === "outline" && "border-border/80 text-muted-foreground",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="size-1.5 shrink-0 rounded-full bg-current opacity-70"
      />
      {children}
    </Badge>
  );
}
