import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { History, Info, Server, Settings, Star } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useI18n } from "@/lib/app-preferences";
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
          <span className="sr-only">{messages.appShell.brandTitle}</span>
        </div>

        <TooltipProvider delayDuration={250}>
          <nav className="app-nav" aria-label="Sections">
            {navigationItems.map((item) => {
              const Icon = item.icon;
              const isSelected = currentPage === item.id;
              const copy = messages.appShell.navigation[item.id];

              return (
                <Tooltip key={item.id}>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant={isSelected ? "secondary" : "ghost"}
                      className={cn(
                        "app-nav-button h-10 min-h-10",
                        isSelected && "is-selected",
                      )}
                      aria-label={copy.label}
                      aria-current={isSelected ? "page" : undefined}
                      onClick={() => onPageChange(item.id)}
                    >
                      <Icon data-icon="inline-start" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent
                    side="right"
                    sideOffset={8}
                    className="flex-col items-start gap-0.5"
                  >
                    <span className="font-medium">{copy.label}</span>
                    <span className="opacity-70">{copy.description}</span>
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </nav>
        </TooltipProvider>

        <div className="app-sidebar-footer">
          <div className="app-status-dot" aria-hidden="true" />
          <span className="sr-only">{messages.appShell.readyStatus}</span>
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
