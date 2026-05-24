import { Bookmark, ChevronDown, RefreshCw, Search, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CustomRulesDialog } from "@/components/custom-rules-dialog";
import { countCustomRuleLines } from "@/lib/filters";
import { useI18n } from "@/lib/app-preferences";
import { DISPLAY_MODE_TAGS } from "@/lib/mode-tags";
import type { SearchHistoryRecord, ServerFilters, ServerSort } from "@/lib/types";

type FilterToolbarProps = {
  filters: ServerFilters;
  sort: ServerSort;
  pageSize: number;
  loading: boolean;
  searchHistory: SearchHistoryRecord[];
  onFiltersChange: (filters: ServerFilters) => void;
  onSortChange: (sort: ServerSort) => void;
  onPageSizeChange: (pageSize: number) => void;
  onSearchCommit: (query: string) => void;
  onSearchHistorySelect: (query: string) => void;
  onSearchHistoryDelete: (id: string) => void;
  onRefresh: () => void;
};

const sortOptionValues: ServerSort[] = ["none", "playersDesc", "playersAsc"];
const pageSizeOptions = [25, 50, 100];

export function FilterToolbar({
  filters,
  sort,
  pageSize,
  loading,
  searchHistory,
  onFiltersChange,
  onSortChange,
  onPageSizeChange,
  onSearchCommit,
  onSearchHistorySelect,
  onSearchHistoryDelete,
  onRefresh,
}: FilterToolbarProps) {
  const { messages } = useI18n();
  const [customRulesOpen, setCustomRulesOpen] = useState(false);
  const [searchHistoryOpen, setSearchHistoryOpen] = useState(false);
  const searchHistoryContainerRef = useRef<HTMLDivElement | null>(null);
  const pageSizeChoices = [...new Set([...pageSizeOptions, pageSize])].sort(
    (left, right) => left - right,
  );
  const sortOptions = sortOptionValues.map((value) => ({
    value,
    label: messages.filterToolbar.sortOptions[value],
  }));
  const activeCustomRuleCount = countCustomRuleLines(filters.customRules);
  const modeLabelMap = messages.filterToolbar.modeLabels as Record<string, string>;

  const updateFilter = <Key extends keyof ServerFilters>(
    key: Key,
    value: ServerFilters[Key],
  ) => {
    onFiltersChange({
      ...filters,
      [key]: value,
    });
  };

  const toggleMode = (mode: string, checked: boolean) => {
    const current = new Set(filters.modeSelections);
    if (checked) {
      current.add(mode);
    } else {
      current.delete(mode);
    }

    updateFilter("modeSelections", [...current]);
  };

  useEffect(() => {
    if (!searchHistoryOpen) {
      return;
    }

    const closeOnOutsidePointer = (event: PointerEvent) => {
      const container = searchHistoryContainerRef.current;
      if (!container || container.contains(event.target as Node)) {
        return;
      }

      setSearchHistoryOpen(false);
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer);

    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
    };
  }, [searchHistoryOpen]);

  return (
    <TooltipProvider>
      <div className="flex flex-col gap-3 border-b bg-muted/15 px-3 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <div
            ref={searchHistoryContainerRef}
            className="relative min-w-64 flex-[1_1_360px]"
          >
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              aria-label={messages.filterToolbar.aria.query}
              className="h-9 rounded-xl pl-10"
              placeholder={messages.filterToolbar.queryPlaceholder}
              value={filters.query}
              onChange={(event) => updateFilter("query", event.target.value)}
              onFocus={() => setSearchHistoryOpen(true)}
              onMouseDown={() => setSearchHistoryOpen(true)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  onSearchCommit(filters.query);
                  setSearchHistoryOpen(false);
                  return;
                }

                if (event.key === "Escape") {
                  setSearchHistoryOpen(false);
                }
              }}
            />
            {searchHistoryOpen ? (
              <div className="absolute left-0 top-[calc(100%+0.25rem)] z-50 max-h-72 w-full min-w-64 overflow-y-auto rounded-lg bg-popover p-1.5 text-popover-foreground shadow-md ring-1 ring-foreground/10">
                <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                  {messages.filterToolbar.searchHistory}
                </div>
                {searchHistory.length === 0 ? (
                  <div className="px-2 py-2 text-sm text-muted-foreground">
                    {messages.filterToolbar.searchHistoryEmpty}
                  </div>
                ) : (
                  <div className="flex flex-col gap-1">
                    {searchHistory.map((record) => (
                      <div
                        key={record.id}
                        className="group/history flex min-h-8 items-center gap-1 rounded-md px-1.5 py-1 text-sm hover:bg-accent hover:text-accent-foreground"
                      >
                        <button
                          type="button"
                          className="min-w-0 flex-1 truncate text-left outline-none"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => {
                            onSearchHistorySelect(record.query);
                            setSearchHistoryOpen(false);
                          }}
                        >
                          {record.query}
                        </button>
                        <Button
                          type="button"
                          size="icon-xs"
                          variant="ghost"
                          aria-label={messages.filterToolbar.deleteSearchHistory(
                            record.query,
                          )}
                          className="opacity-70 group-hover/history:opacity-100"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={(event) => {
                            event.stopPropagation();
                            onSearchHistoryDelete(record.id);
                          }}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </div>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="icon-sm"
                variant={activeCustomRuleCount > 0 ? "secondary" : "outline"}
                className="relative rounded-lg"
                onClick={() => setCustomRulesOpen(true)}
              >
                <Bookmark />
                {activeCustomRuleCount > 0 ? (
                  <span className="absolute -right-1 -top-1 rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
                    {activeCustomRuleCount}
                  </span>
                ) : null}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{messages.filterToolbar.customRules}</TooltipContent>
          </Tooltip>

          <Select
            value={sort}
            onValueChange={(value) => onSortChange(value as ServerSort)}
          >
            <SelectTrigger
              aria-label={messages.filterToolbar.aria.sort}
              className="h-8 min-w-28 rounded-lg"
              size="default"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent
              align="start"
              className="w-max min-w-(--radix-select-trigger-width)"
              position="popper"
            >
              <SelectGroup>
                {sortOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>

          <Select
            value={String(pageSize)}
            onValueChange={(value) => onPageSizeChange(Number(value))}
          >
            <SelectTrigger
              aria-label={messages.filterToolbar.aria.rows}
              className="h-8 min-w-20 rounded-lg"
              size="default"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent
              align="start"
              className="w-max min-w-(--radix-select-trigger-width)"
              position="popper"
            >
              <SelectGroup>
                {pageSizeChoices.map((option) => (
                  <SelectItem key={option} value={String(option)}>
                    {messages.filterToolbar.rowsLabel(option)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>

          <MultiSelectMenu
            label={messages.filterToolbar.populationLabel}
          >
            <DropdownMenuCheckboxItem
              checked={filters.showOnline}
              onCheckedChange={(checked) => updateFilter("showOnline", checked === true)}
              onSelect={(event) => event.preventDefault()}
            >
              {messages.filterToolbar.populationOptions.online}
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={filters.showEmpty}
              onCheckedChange={(checked) => updateFilter("showEmpty", checked === true)}
              onSelect={(event) => event.preventDefault()}
            >
              {messages.filterToolbar.populationOptions.empty}
            </DropdownMenuCheckboxItem>
          </MultiSelectMenu>

          <MultiSelectMenu
            label={messages.filterToolbar.mapCategoryLabel}
          >
            <DropdownMenuCheckboxItem
              checked={filters.showOfficial}
              onCheckedChange={(checked) => updateFilter("showOfficial", checked === true)}
              onSelect={(event) => event.preventDefault()}
            >
              {messages.filterToolbar.mapCategoryOptions.official}
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={filters.showThird}
              onCheckedChange={(checked) => updateFilter("showThird", checked === true)}
              onSelect={(event) => event.preventDefault()}
            >
              {messages.filterToolbar.mapCategoryOptions.thirdParty}
            </DropdownMenuCheckboxItem>
          </MultiSelectMenu>

          <MultiSelectMenu
            label={messages.filterToolbar.modeCategoryLabel}
          >
            {DISPLAY_MODE_TAGS.map((mode) => (
              <DropdownMenuCheckboxItem
                key={mode}
                checked={filters.modeSelections.includes(mode)}
                onCheckedChange={(checked) => toggleMode(mode, checked === true)}
                onSelect={(event) => event.preventDefault()}
              >
                {modeLabelMap[mode] ?? mode}
              </DropdownMenuCheckboxItem>
            ))}
          </MultiSelectMenu>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="default"
                className="h-8 rounded-lg"
                disabled={loading}
                onClick={onRefresh}
              >
                <RefreshCw data-icon="inline-start" />
                {messages.common.refresh}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{messages.filterToolbar.refreshTooltip}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <CustomRulesDialog
        open={customRulesOpen}
        value={filters.customRules}
        onOpenChange={setCustomRulesOpen}
        onApply={(customRules) => updateFilter("customRules", customRules)}
      />
    </TooltipProvider>
  );
}

function MultiSelectMenu({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-haspopup="menu"
          className="h-8 min-w-18 justify-between rounded-lg px-2.5"
          type="button"
          variant="outline"
        >
          {label}
          <ChevronDown className="ml-2 text-muted-foreground" data-icon="inline-end" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-max min-w-(--radix-dropdown-menu-trigger-width) max-w-80 rounded-lg p-1.5"
      >
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
