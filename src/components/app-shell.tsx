import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { History, Info, Server, Settings, Star } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/app-preferences";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

import appIconUrl from "../../src-tauri/icons/128x128.png";

type ShellPage = "servers" | "favorites" | "history" | "settings" | "about";

type NavigationItem = {
  id: ShellPage;
  icon: LucideIcon;
};

type AppShellProps = {
  children: ReactNode;
  currentPage: ShellPage;
  onPageChange: (page: ShellPage) => void;
};

const navigationItems: NavigationItem[] = [
  {
    id: "servers",
    icon: Server,
  },
  {
    id: "favorites",
    icon: Star,
  },
  {
    id: "history",
    icon: History,
  },
  {
    id: "settings",
    icon: Settings,
  },
  {
    id: "about",
    icon: Info,
  },
];

export function AppShell({
  children,
  currentPage,
  onPageChange,
}: AppShellProps) {
  const { messages } = useI18n();

  return (
    <div className="app-shell">
      <aside className="app-sidebar" aria-label="Primary navigation">
        <div className="app-brand">
          <div className="app-brand-mark">
            <img src={appIconUrl} alt="" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="app-brand-title">{messages.appShell.brandTitle}</p>
          </div>
        </div>

        <Separator />

        <nav className="app-nav" aria-label="Sections">
          {navigationItems.map((item) => {
            const Icon = item.icon;
            const isSelected = currentPage === item.id;
            const copy = messages.appShell.navigation[item.id];

            return (
              <Button
                key={item.id}
                type="button"
                variant={isSelected ? "secondary" : "ghost"}
                className={cn(
                  "app-nav-button h-12 min-h-12",
                  isSelected && "is-selected",
                )}
                aria-label={copy.label}
                aria-current={isSelected ? "page" : undefined}
                onClick={() => onPageChange(item.id)}
              >
                <Icon data-icon="inline-start" />
                <span className="min-w-0 flex-1 text-left">
                  <span className="block truncate">{copy.label}</span>
                  <span className="app-nav-description" aria-hidden="true">
                    {copy.description}
                  </span>
                </span>
              </Button>
            );
          })}
        </nav>

        <div className="app-sidebar-footer">
          <div className="app-status-dot" aria-hidden="true" />
          <span className="truncate">{messages.appShell.readyStatus}</span>
        </div>
      </aside>

      <section className="app-content">
        <main
          className="app-main"
          aria-label={messages.appShell.pageLabels[currentPage]}
        >
          {children}
        </main>
      </section>
    </div>
  );
}
