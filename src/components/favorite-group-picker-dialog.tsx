import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ChevronDown, FolderPlus, LoaderCircle, Plus } from "lucide-react";

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
import { toast } from "@/components/ui/toast";
import { api, formatCommandError } from "@/lib/api";
import { useI18n } from "@/lib/app-preferences";
import {
  DEFAULT_FAVORITE_GROUP_ID,
  type FavoriteDraft,
} from "@/lib/favorites";
import { cn } from "@/lib/utils";
import type { Favorite, FavoriteGroup } from "@/lib/types";

type FavoriteGroupPickerDialogProps = {
  open: boolean;
  draft: FavoriteDraft | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (favorite: Favorite) => void;
};

export function FavoriteGroupPickerDialog({
  open,
  draft,
  onOpenChange,
  onSaved,
}: FavoriteGroupPickerDialogProps) {
  const { messages } = useI18n();
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const newGroupRegionId = useId();
  const [groups, setGroups] = useState<FavoriteGroup[]>([]);
  const [groupId, setGroupId] = useState("");
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [groupsLoadError, setGroupsLoadError] = useState<string | null>(null);
  const [newGroupExpanded, setNewGroupExpanded] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupNameError, setNewGroupNameError] = useState<string | null>(null);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [savingFavorite, setSavingFavorite] = useState(false);
  const sessionIdRef = useRef(0);
  const createOperationIdRef = useRef(0);
  const saveOperationIdRef = useRef(0);
  const creatingGroupRef = useRef(false);
  const savingFavoriteRef = useRef(false);

  const isBusy = creatingGroup || savingFavorite;
  const groupsReady = !loadingGroups && groupsLoadError === null;
  const canCreateGroup = groupsReady && !isBusy;
  const canSave =
    draft !== null && groupsReady && Boolean(groupId) && !isBusy;

  useEffect(() => {
    if (!open) {
      sessionIdRef.current += 1;
      return;
    }

    const sessionId = sessionIdRef.current + 1;
    sessionIdRef.current = sessionId;
    setGroups([]);
    setGroupId("");
    setLoadingGroups(true);
    setGroupsLoadError(null);
    setNewGroupExpanded(false);
    setNewGroupName("");
    setNewGroupNameError(null);
    setCreatingGroup(false);
    setSavingFavorite(false);
    creatingGroupRef.current = false;
    savingFavoriteRef.current = false;

    void api
      .listGroups()
      .then((loadedGroups) => {
        if (sessionIdRef.current !== sessionId) {
          return;
        }

        setGroups(loadedGroups);
      })
      .catch((error: unknown) => {
        if (sessionIdRef.current === sessionId) {
          setGroupsLoadError(
            formatCommandError(
              error,
              messagesRef.current.favoriteGroupPicker.loadFailed,
            ),
          );
        }
      })
      .finally(() => {
        if (sessionIdRef.current === sessionId) {
          setLoadingGroups(false);
        }
      });
  }, [open]);

  useEffect(() => {
    if (
      !open ||
      loadingGroups ||
      groupsLoadError !== null ||
      groupId ||
      groups.length === 0
    ) {
      return;
    }

    setGroupId(
      groups.find((group) => group.id === DEFAULT_FAVORITE_GROUP_ID)?.id ??
        groups[0].id,
    );
  }, [groupId, groups, groupsLoadError, loadingGroups, open]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && isBusy) {
      return;
    }

    onOpenChange(nextOpen);
  };

  const handleRetryLoad = () => {
    if (loadingGroups || isBusy) {
      return;
    }

    const sessionId = sessionIdRef.current + 1;
    sessionIdRef.current = sessionId;
    setGroups([]);
    setGroupId("");
    setLoadingGroups(true);
    setGroupsLoadError(null);

    void api
      .listGroups()
      .then((loadedGroups) => {
        if (sessionIdRef.current !== sessionId) {
          return;
        }

        setGroups(loadedGroups);
      })
      .catch((error: unknown) => {
        if (sessionIdRef.current === sessionId) {
          setGroupsLoadError(
            formatCommandError(
              error,
              messages.favoriteGroupPicker.loadFailed,
            ),
          );
        }
      })
      .finally(() => {
        if (sessionIdRef.current === sessionId) {
          setLoadingGroups(false);
        }
      });
  };

  const handleCreateGroup = async () => {
    if (!canCreateGroup || creatingGroupRef.current) {
      return;
    }

    const trimmedName = newGroupName.trim();
    if (!trimmedName) {
      setNewGroupNameError(messages.favoriteGroupPicker.groupNameRequired);
      return;
    }

    const sessionId = sessionIdRef.current;
    const operationId = createOperationIdRef.current + 1;
    createOperationIdRef.current = operationId;
    creatingGroupRef.current = true;
    setCreatingGroup(true);

    try {
      const group = await api.createGroup(trimmedName);
      if (sessionIdRef.current !== sessionId) {
        return;
      }

      setGroups((current) => [...current, group]);
      setGroupId(group.id);
      setNewGroupName("");
      setNewGroupNameError(null);
      setNewGroupExpanded(false);
      toast.success(messages.favoriteGroupPicker.groupCreateSuccess);
    } catch (error) {
      if (sessionIdRef.current === sessionId) {
        toast.error(
          formatCommandError(
            error,
            messages.favoriteGroupPicker.groupCreateFailed,
          ),
        );
      }
    } finally {
      if (createOperationIdRef.current === operationId) {
        creatingGroupRef.current = false;
        if (sessionIdRef.current === sessionId) {
          setCreatingGroup(false);
        }
      }
    }
  };

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!draft || !canSave || savingFavoriteRef.current) {
      return;
    }

    const sessionId = sessionIdRef.current;
    const operationId = saveOperationIdRef.current + 1;
    saveOperationIdRef.current = operationId;
    savingFavoriteRef.current = true;
    setSavingFavorite(true);

    try {
      const saved = await api.addFavorite({ ...draft, groupId });
      if (sessionIdRef.current !== sessionId) {
        return;
      }

      onSaved(saved);
      onOpenChange(false);
      toast.success(messages.favoriteGroupPicker.saveSuccess);
    } catch (error) {
      if (sessionIdRef.current === sessionId) {
        toast.error(
          formatCommandError(error, messages.favoriteGroupPicker.saveFailed),
        );
      }
    } finally {
      if (saveOperationIdRef.current === operationId) {
        savingFavoriteRef.current = false;
        if (sessionIdRef.current === sessionId) {
          setSavingFavorite(false);
        }
      }
    }
  };

  const displayGroupName = (group: FavoriteGroup) =>
    group.id === DEFAULT_FAVORITE_GROUP_ID
      ? messages.favoriteGroupPicker.defaultGroup
      : group.name;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        showCloseButton={false}
        onEscapeKeyDown={(event) => {
          if (isBusy) {
            event.preventDefault();
          }
        }}
        onInteractOutside={(event) => {
          if (isBusy) {
            event.preventDefault();
          }
        }}
      >
        <form className="flex flex-col gap-4" onSubmit={handleSave}>
          <DialogHeader>
            <DialogTitle>{messages.favoriteGroupPicker.title}</DialogTitle>
            <DialogDescription>
              {messages.favoriteGroupPicker.description}
            </DialogDescription>
          </DialogHeader>

          {loadingGroups ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
              {messages.favoriteGroupPicker.loading}
            </p>
          ) : null}

          {groupsLoadError ? (
            <div className="flex flex-col gap-2" role="alert">
              <p className="text-sm text-destructive">{groupsLoadError}</p>
              <Button
                type="button"
                className="w-fit"
                variant="outline"
                size="sm"
                onClick={handleRetryLoad}
              >
                {messages.favoriteGroupPicker.retry}
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                {messages.favoriteGroupPicker.chooseGroup}
                <Select
                  value={groupId}
                  disabled={!groupsReady || isBusy || groups.length === 0}
                  onValueChange={setGroupId}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue
                      placeholder={messages.favoriteGroupPicker.chooseGroupPlaceholder}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {groups.map((group) => (
                        <SelectItem key={group.id} value={group.id}>
                          {displayGroupName(group)}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </label>

              <div className="flex flex-col gap-2">
                <Button
                  type="button"
                  className="w-fit"
                  variant="ghost"
                  size="sm"
                  disabled={!canCreateGroup}
                  aria-expanded={newGroupExpanded}
                  aria-controls={newGroupRegionId}
                  onClick={() => setNewGroupExpanded((current) => !current)}
                >
                  <FolderPlus aria-hidden="true" />
                  {messages.favoriteGroupPicker.newGroup}
                  <ChevronDown
                    aria-hidden="true"
                    className={cn("transition-transform", {
                      "rotate-180": newGroupExpanded,
                    })}
                  />
                </Button>

                {newGroupExpanded ? (
                  <div
                    id={newGroupRegionId}
                    className="flex flex-col gap-2 rounded-lg border p-3"
                  >
                    <label className="flex flex-col gap-1.5 text-sm font-medium">
                      {messages.favoriteGroupPicker.newGroupName}
                      <Input
                        value={newGroupName}
                        disabled={!canCreateGroup}
                        aria-invalid={newGroupNameError !== null}
                        aria-describedby={
                          newGroupNameError
                            ? "favorite-group-name-error"
                            : undefined
                        }
                        placeholder={messages.favoriteGroupPicker.newGroupPlaceholder}
                        onChange={(event) => {
                          setNewGroupName(event.target.value);
                          setNewGroupNameError(null);
                        }}
                        onKeyDown={(event) => {
                          if (
                            event.key !== "Enter" ||
                            event.nativeEvent.isComposing
                          ) {
                            return;
                          }

                          event.preventDefault();
                          void handleCreateGroup();
                        }}
                      />
                    </label>
                    {newGroupNameError ? (
                      <p
                        id="favorite-group-name-error"
                        className="text-sm text-destructive"
                        role="alert"
                      >
                        {newGroupNameError}
                      </p>
                    ) : null}
                    <Button
                      type="button"
                      className="w-fit"
                      size="sm"
                      disabled={!canCreateGroup}
                      onClick={() => void handleCreateGroup()}
                    >
                      {creatingGroup ? (
                        <LoaderCircle className="animate-spin" aria-hidden="true" />
                      ) : (
                        <Plus aria-hidden="true" />
                      )}
                      {creatingGroup
                        ? messages.common.creating
                        : messages.favoriteGroupPicker.createGroup}
                    </Button>
                  </div>
                ) : null}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={isBusy}
              onClick={() => handleOpenChange(false)}
            >
              {messages.common.cancel}
            </Button>
            <Button type="submit" disabled={!canSave}>
              {savingFavorite ? (
                <LoaderCircle className="animate-spin" aria-hidden="true" />
              ) : null}
              {savingFavorite
                ? messages.common.saving
                : messages.favoriteGroupPicker.saveFavorite}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
