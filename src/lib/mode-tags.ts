export const DISPLAY_MODE_TAGS = [
  "versus",
  "realism",
  "coop",
  "survival",
  "scavenge",
  "unknown",
] as const;

export type DisplayModeTag = (typeof DISPLAY_MODE_TAGS)[number];

export const MODE_TAG_CLASS_NAMES: Record<DisplayModeTag, string> = {
  versus:
    "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
  realism:
    "border-amber-500/35 bg-amber-500/10 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  coop:
    "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  survival:
    "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  scavenge:
    "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
  unknown: "border-border bg-muted text-muted-foreground",
};

const DISPLAY_MODE_TAG_SET = new Set<string>(DISPLAY_MODE_TAGS);

export function normalizeDisplayModeTag(value: string): DisplayModeTag | null {
  const normalized = value.toLowerCase();
  return DISPLAY_MODE_TAG_SET.has(normalized)
    ? (normalized as DisplayModeTag)
    : null;
}

export function getDisplayModeTags(tags: string[]): DisplayModeTag[] {
  const normalizedTags = new Set(
    tags
      .map((tag) => normalizeDisplayModeTag(tag))
      .filter((tag): tag is DisplayModeTag => tag !== null),
  );
  const visibleTags = DISPLAY_MODE_TAGS.filter((tag) =>
    normalizedTags.has(tag),
  );

  return visibleTags.length > 0 ? visibleTags : ["unknown"];
}
