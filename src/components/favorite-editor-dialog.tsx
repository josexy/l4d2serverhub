import { useEffect, useMemo, useState, type FormEvent } from "react";

import { useI18n } from "@/lib/app-preferences";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  DISPLAY_MODE_TAGS,
  normalizeDisplayModeTag,
  type DisplayModeTag,
} from "@/lib/mode-tags";
import type { Favorite, FavoriteGroup, FavoriteInput } from "@/lib/types";

type FavoriteEditorDialogProps = {
  open: boolean;
  mode: "create" | "edit";
  groups: FavoriteGroup[];
  favorite: Favorite | null;
  defaultAddress?: string;
  pending?: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: FavoriteInput) => void;
};

function getAddressError(
  address: string,
  messages: ReturnType<typeof useI18n>["messages"]["favoriteEditor"]["addressErrors"],
): string | null {
  const trimmedAddress = address.trim();
  const parts = trimmedAddress.split(":");

  if (parts.length !== 2) {
    return messages.invalidFormat;
  }

  const [host, portText] = parts;
  if (!host || host !== host.trim()) {
    return messages.hostRequired;
  }

  if (/[\s/?#\\]/.test(host) || host.includes("://")) {
    return messages.hostInvalidChars;
  }

  if (!/^[A-Za-z0-9.-]+$/.test(host)) {
    return messages.hostCharset;
  }

  const labels = host.split(".");
  if (
    labels.some(
      (label) => !label || label.startsWith("-") || label.endsWith("-"),
    )
  ) {
    return messages.hostLabels;
  }

  if (labels.length === 4 && labels.every((label) => /^\d+$/.test(label))) {
    const hasInvalidOctet = labels.some((label) => {
      const octet = Number(label);
      return !Number.isInteger(octet) || octet < 0 || octet > 255;
    });
    if (hasInvalidOctet) {
      return messages.ipv4Range;
    }
  }

  if (!/^\d+$/.test(portText)) {
    return messages.portDigits;
  }

  const port = Number(portText);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    return messages.portRange;
  }

  return null;
}

export function FavoriteEditorDialog({
  open,
  mode,
  groups,
  favorite,
  defaultAddress = "",
  pending = false,
  onOpenChange,
  onSubmit,
}: FavoriteEditorDialogProps) {
  const { messages } = useI18n();
  const fallbackGroupId =
    groups.find((group) => group.id === "default")?.id ?? groups[0]?.id ?? "default";
  const [address, setAddress] = useState("");
  const [groupId, setGroupId] = useState(fallbackGroupId);
  const [customName, setCustomName] = useState("");
  const [notes, setNotes] = useState("");
  const [selectedTag, setSelectedTag] = useState<DisplayModeTag>("unknown");
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    setAddress(favorite?.address ?? defaultAddress);
    setGroupId(favorite?.groupId ?? fallbackGroupId);
    setCustomName(favorite?.customName ?? "");
    setNotes(favorite?.notes ?? "");
    setSelectedTag(
      favorite?.tags
        .map((tag) => normalizeDisplayModeTag(tag))
        .find((tag): tag is DisplayModeTag => tag !== null) ?? "unknown",
    );
    setFormError(null);
  }, [defaultAddress, fallbackGroupId, favorite, open]);

  const title =
    mode === "edit"
      ? messages.favoriteEditor.editTitle
      : messages.favoriteEditor.addTitle;
  const addressReadOnly = mode === "edit";
  const addressError = useMemo(
    () => getAddressError(address, messages.favoriteEditor.addressErrors),
    [address, messages.favoriteEditor.addressErrors],
  );
  const addressVisibleError =
    addressError && (address.trim() || formError === addressError)
      ? addressError
      : null;
  const formLevelError =
    formError && formError !== addressError ? formError : null;
  const canSubmit = !pending && groups.length > 0 && addressError === null;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedAddress = address.trim();
    const nextAddressError = getAddressError(
      trimmedAddress,
      messages.favoriteEditor.addressErrors,
    );
    if (nextAddressError) {
      setFormError(nextAddressError);
      return;
    }

    if (!groupId) {
      setFormError(messages.favoriteEditor.chooseGroupError);
      return;
    }

    onSubmit({
      address: trimmedAddress,
      serverId: favorite?.serverId ?? favorite?.lastSnapshot?.serverId ?? null,
      groupId,
      customName: customName.trim() || null,
      notes: notes.trim(),
      tags: [selectedTag],
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              {messages.favoriteEditor.description}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              {messages.favoriteEditor.address}
              <Input
                value={address}
                readOnly={addressReadOnly}
                aria-describedby={
                  addressVisibleError ? "favorite-address-error" : undefined
                }
                aria-invalid={addressVisibleError !== null}
                placeholder={messages.favoriteEditor.placeholders.address}
                onChange={(event) => {
                  setAddress(event.target.value);
                  setFormError(null);
                }}
              />
            </label>

            <label className="flex flex-col gap-1.5 text-sm font-medium">
              {messages.favoriteEditor.group}
              <Select
                value={groupId}
                disabled={pending || groups.length === 0}
                onValueChange={setGroupId}
              >
                <SelectTrigger className="w-full">
                  <SelectValue
                    placeholder={messages.favoriteEditor.placeholders.group}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {groups.map((group) => (
                      <SelectItem key={group.id} value={group.id}>
                        {group.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </label>

            <label className="flex flex-col gap-1.5 text-sm font-medium">
              {messages.favoriteEditor.customName}
              <Input
                value={customName}
                placeholder={messages.favoriteEditor.placeholders.customName}
                onChange={(event) => setCustomName(event.target.value)}
              />
            </label>

            <label className="flex flex-col gap-1.5 text-sm font-medium">
              {messages.favoriteEditor.notes}
              <Textarea
                value={notes}
                placeholder={messages.favoriteEditor.placeholders.notes}
                rows={4}
                onChange={(event) => setNotes(event.target.value)}
              />
            </label>

            <label className="flex flex-col gap-1.5 text-sm font-medium">
              {messages.favoriteEditor.tags}
              <Select
                value={selectedTag}
                disabled={pending}
                onValueChange={(value) =>
                  setSelectedTag(value as DisplayModeTag)
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue
                    placeholder={messages.favoriteEditor.placeholders.tags}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {DISPLAY_MODE_TAGS.map((tag) => (
                      <SelectItem key={tag} value={tag}>
                        {messages.serverDetail.modeLabels[tag]}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </label>

            {addressVisibleError ? (
              <p
                id="favorite-address-error"
                className="text-sm text-destructive"
                role="alert"
              >
                {addressVisibleError}
              </p>
            ) : null}
            {formLevelError ? (
              <p className="text-sm text-destructive" role="alert">
                {formLevelError}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => onOpenChange(false)}
            >
              {messages.common.cancel}
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {pending ? messages.common.saving : messages.favoriteEditor.saveAction}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
