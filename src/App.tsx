import { useEffect, useState } from "react";
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

function renderPage(page: Page, isActive: boolean): ReactNode {
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
}

function App() {
  const isDetailWindow = isServerDetailWindowRoute();
  const [page, setPage] = useState<Page>("servers");
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
    setVisitedPages((current) => {
      if (current.has(nextPage)) {
        return current;
      }

      return new Set(current).add(nextPage);
    });
    setPage(nextPage);
  };

  return (
    <AppShell currentPage={page} onPageChange={handlePageChange}>
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
            {renderPage(item, isActive)}
          </div>
        );
      })}
    </AppShell>
  );
}

export default App;
