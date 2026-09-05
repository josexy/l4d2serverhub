import { memo, useEffect, useState, useTransition } from "react";
import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell";
import { AboutPage } from "@/pages/about-page";
import { FavoritesPage } from "@/pages/favorites-page";
import { HistoryPage } from "@/pages/history-page";
import { ServerDetailWindowPage } from "@/pages/server-detail-window-page";
import { ServerListPage } from "@/pages/server-list-page";
import { SettingsPage } from "@/pages/settings-page";
import { Toaster } from "@/components/ui/sonner";
import { isServerDetailWindowRoute } from "@/lib/server-detail-windows";
import { announceStartupReady } from "@/lib/startup-ready";
import { cn } from "@/lib/utils";

type Page = "servers" | "favorites" | "history" | "settings" | "about";

const pages: Page[] = ["servers", "favorites", "history", "settings", "about"];

// Navigation only needs to update the page being entered and the one being left.
const PageContent = memo(function PageContent({
  page,
  isActive,
}: {
  page: Page;
  isActive: boolean;
}): ReactNode {
  switch (page) {
    case "servers":
      return <ServerListPage isActive={isActive} />;
    case "favorites":
      return <FavoritesPage isActive={isActive} />;
    case "history":
      return <HistoryPage isActive={isActive} />;
    case "settings":
      return <SettingsPage isActive={isActive} />;
    case "about":
      return <AboutPage />;
  }
});

function App() {
  const isDetailWindow = isServerDetailWindowRoute();
  const [page, setPage] = useState<Page>("servers");
  const [requestedPage, setRequestedPage] = useState<Page>("servers");
  const [isPagePending, startPageTransition] = useTransition();
  const [visitedPages, setVisitedPages] = useState<Set<Page>>(
    () => new Set(["servers"]),
  );

  useEffect(() => {
    if (isDetailWindow) {
      return;
    }

    announceStartupReady();
  }, [isDetailWindow]);

  if (isDetailWindow) {
    return (
      <>
        <Toaster position="bottom-right" />
        <ServerDetailWindowPage />
      </>
    );
  }

  const handlePageChange = (nextPage: Page) => {
    if (nextPage === requestedPage) {
      return;
    }

    setRequestedPage(nextPage);
    // Keep sidebar feedback urgent while React can yield during table rendering.
    startPageTransition(() => {
      setVisitedPages((current) => {
        if (current.has(nextPage)) {
          return current;
        }

        return new Set(current).add(nextPage);
      });
      setPage(nextPage);
    });
  };

  return (
    <AppShell
      currentPage={requestedPage}
      isPagePending={isPagePending}
      onPageChange={handlePageChange}
    >
      <Toaster position="bottom-right" />
      {pages.map((item) => {
        if (!visitedPages.has(item)) {
          return null;
        }

        const isActive = page === item;

        return (
          <div
            key={item}
            aria-hidden={!isActive}
            className={cn(isActive ? "contents" : "hidden")}
          >
            <PageContent page={item} isActive={isActive} />
          </div>
        );
      })}
    </AppShell>
  );
}

export default App;
