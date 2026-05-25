export type SortDirection = "none" | "asc" | "desc";

export type TableSortState<ColumnId extends string> = {
  column: ColumnId | null;
  direction: SortDirection;
};

export type SortValue = string | number | boolean | Date | null | undefined;

const textCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

export function createDefaultSortState<
  ColumnId extends string,
>(): TableSortState<ColumnId> {
  return {
    column: null,
    direction: "none",
  };
}

export function nextSortState<ColumnId extends string>(
  current: TableSortState<ColumnId>,
  column: ColumnId,
): TableSortState<ColumnId> {
  if (current.column !== column) {
    return {
      column,
      direction: "asc",
    };
  }

  if (current.direction === "asc") {
    return {
      column,
      direction: "desc",
    };
  }

  return createDefaultSortState<ColumnId>();
}

export function sortCurrentPage<Item, ColumnId extends string>(
  items: Item[],
  sortState: TableSortState<ColumnId>,
  getValue: (item: Item, column: ColumnId) => SortValue,
): Item[] {
  if (!sortState.column || sortState.direction === "none") {
    return items;
  }

  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const leftValue = getValue(left.item, sortState.column as ColumnId);
      const rightValue = getValue(right.item, sortState.column as ColumnId);
      const leftEmpty = isEmptySortValue(leftValue);
      const rightEmpty = isEmptySortValue(rightValue);

      if (leftEmpty || rightEmpty) {
        if (leftEmpty && rightEmpty) {
          return left.index - right.index;
        }
        return leftEmpty ? 1 : -1;
      }

      const compared = compareSortValues(leftValue, rightValue);
      if (compared === 0) {
        return left.index - right.index;
      }

      return sortState.direction === "asc" ? compared : -compared;
    })
    .map(({ item }) => item);
}

function isEmptySortValue(value: SortValue): boolean {
  if (value === null || value === undefined) {
    return true;
  }

  if (typeof value === "number") {
    return Number.isNaN(value);
  }

  if (typeof value === "string") {
    return value.trim().length === 0;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime());
  }

  return false;
}

function compareSortValues(left: SortValue, right: SortValue): number {
  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }

  if (left instanceof Date && right instanceof Date) {
    return left.getTime() - right.getTime();
  }

  if (typeof left === "boolean" && typeof right === "boolean") {
    return Number(left) - Number(right);
  }

  return textCollator.compare(String(left), String(right));
}
