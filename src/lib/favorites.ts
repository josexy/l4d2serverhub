import type { Favorite, FavoriteInput, ServerSnapshot } from "@/lib/types";

export const DEFAULT_FAVORITE_GROUP_ID = "default";

export type FavoriteDraft = Omit<FavoriteInput, "groupId">;

export function createFavoriteDraftFromSnapshot(
  snapshot: ServerSnapshot,
): FavoriteDraft {
  const customName = snapshot.name.trim();

  return {
    address: snapshot.address,
    serverId: snapshot.serverId,
    customName: customName || null,
    notes: "",
    tags: [...snapshot.modeTags],
  };
}

export function indexFavoritesByAddress(
  favorites: Favorite[],
): Map<string, Favorite> {
  const favoritesByAddress = new Map<string, Favorite>();

  for (const favorite of favorites) {
    const existing = favoritesByAddress.get(favorite.address);
    if (
      !existing ||
      (existing.groupId !== DEFAULT_FAVORITE_GROUP_ID &&
        favorite.groupId === DEFAULT_FAVORITE_GROUP_ID)
    ) {
      favoritesByAddress.set(favorite.address, favorite);
    }
  }

  return favoritesByAddress;
}
