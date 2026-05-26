import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/lib/app-preferences";
import { cn } from "@/lib/utils";

type PageItem = number | "ellipsis";

type PageSizeControl = {
  value: number;
  options: number[];
  disabled?: boolean;
  ariaLabel: string;
  formatLabel: (rows: number) => string;
  onChange: (pageSize: number) => void;
};

type TablePaginationProps = {
  page: number;
  totalPages: number;
  disabled?: boolean;
  status: ReactNode;
  onPageChange: (page: number) => void;
  pageSizeControl?: PageSizeControl;
};

function getPageItems(page: number, totalPages: number): PageItem[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  if (page <= 4) {
    return [1, 2, 3, 4, 5, "ellipsis", totalPages];
  }

  if (page >= totalPages - 3) {
    return [
      1,
      "ellipsis",
      totalPages - 4,
      totalPages - 3,
      totalPages - 2,
      totalPages - 1,
      totalPages,
    ];
  }

  return [1, "ellipsis", page - 1, page, page + 1, "ellipsis", totalPages];
}

export function TablePagination({
  page,
  totalPages,
  disabled = false,
  status,
  onPageChange,
  pageSizeControl,
}: TablePaginationProps) {
  const { messages } = useI18n();
  const safeTotalPages = Math.max(1, totalPages);
  const currentPage = Math.min(Math.max(page, 1), safeTotalPages);
  const pageItems = getPageItems(currentPage, safeTotalPages);
  const canGoPrevious = currentPage > 1;
  const canGoNext = currentPage < safeTotalPages;

  const goToPage = (nextPage: number) => {
    const boundedPage = Math.min(Math.max(nextPage, 1), safeTotalPages);
    if (boundedPage !== currentPage) {
      onPageChange(boundedPage);
    }
  };

  return (
    <div className="grid min-h-12 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 border-t bg-muted/20 px-3 py-2 text-sm text-muted-foreground max-lg:grid-cols-1 max-lg:justify-items-center">
      <span className="min-w-0 truncate justify-self-start max-lg:justify-self-center">
        {status}
      </span>

      <nav
        aria-label={messages.pagination.aria.navigation}
        className="flex min-w-0 items-center justify-center gap-1"
      >
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={messages.pagination.aria.first}
          disabled={disabled || !canGoPrevious}
          onClick={() => goToPage(1)}
        >
          <ChevronsLeft aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={messages.common.previous}
          disabled={disabled || !canGoPrevious}
          onClick={() => goToPage(currentPage - 1)}
        >
          <ChevronLeft aria-hidden="true" />
        </Button>

        <div className="flex min-w-0 items-center justify-center gap-1">
          {pageItems.map((item, index) => {
            if (item === "ellipsis") {
              return (
                <span
                  key={`ellipsis-${index}`}
                  aria-hidden="true"
                  className="flex size-8 items-center justify-center text-sm font-semibold text-muted-foreground/75"
                >
                  ...
                </span>
              );
            }

            const isCurrent = item === currentPage;
            return (
              <Button
                key={item}
                type="button"
                variant={isCurrent ? "default" : "ghost"}
                size="icon-sm"
                aria-label={
                  isCurrent
                    ? messages.pagination.aria.current(item)
                    : messages.pagination.aria.page(item)
                }
                aria-current={isCurrent ? "page" : undefined}
                disabled={disabled || isCurrent}
                className={cn(
                  "min-w-8 px-2 font-semibold tabular-nums",
                  isCurrent
                    ? "shadow-sm disabled:opacity-100"
                    : "text-foreground hover:bg-muted",
                )}
                onClick={() => goToPage(item)}
              >
                {item}
              </Button>
            );
          })}
        </div>

        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={messages.common.next}
          disabled={disabled || !canGoNext}
          onClick={() => goToPage(currentPage + 1)}
        >
          <ChevronRight aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={messages.pagination.aria.last}
          disabled={disabled || !canGoNext}
          onClick={() => goToPage(safeTotalPages)}
        >
          <ChevronsRight aria-hidden="true" />
        </Button>
      </nav>

      <div
        className={cn(
          "flex min-w-0 justify-self-end max-lg:justify-self-center",
          !pageSizeControl && "max-lg:hidden",
        )}
      >
        {pageSizeControl ? (
          <Select
            value={String(pageSizeControl.value)}
            disabled={disabled || pageSizeControl.disabled}
            onValueChange={(value) => pageSizeControl.onChange(Number(value))}
          >
            <SelectTrigger
              aria-label={pageSizeControl.ariaLabel}
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
                {pageSizeControl.options.map((option) => (
                  <SelectItem key={option} value={String(option)}>
                    {pageSizeControl.formatLabel(option)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        ) : null}
      </div>
    </div>
  );
}
