import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { TableHead } from "@/components/ui/table";
import type { SortDirection } from "@/lib/table-sorting";
import { cn } from "@/lib/utils";

type SortableTableHeadProps = {
  label: string;
  activeDirection: SortDirection;
  align?: "left" | "right";
  className?: string;
  children?: ReactNode;
  onSort: () => void;
  getSortLabel: (column: string, nextDirection: SortDirection) => string;
};

export function SortableTableHead({
  label,
  activeDirection,
  align = "left",
  className,
  children,
  onSort,
  getSortLabel,
}: SortableTableHeadProps) {
  const nextDirection = getNextDirection(activeDirection);
  const Icon = activeDirection === "asc"
    ? ArrowUp
    : activeDirection === "desc"
      ? ArrowDown
      : ArrowUpDown;

  return (
    <TableHead
      className={cn(
        "relative select-none pr-3",
        align === "right" && "text-right",
        className,
      )}
      aria-sort={getAriaSort(activeDirection)}
    >
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className={cn(
          "max-w-full px-1",
          align === "right" ? "ml-auto" : "-ml-1",
        )}
        aria-label={getSortLabel(label, nextDirection)}
        onClick={onSort}
      >
        <span className="min-w-0 truncate">{label}</span>
        <Icon aria-hidden="true" data-icon="inline-end" />
      </Button>
      {children}
    </TableHead>
  );
}

function getNextDirection(direction: SortDirection): SortDirection {
  return direction === "none" ? "asc" : direction === "asc" ? "desc" : "none";
}

function getAriaSort(direction: SortDirection) {
  if (direction === "asc") {
    return "ascending";
  }

  if (direction === "desc") {
    return "descending";
  }

  return "none";
}
