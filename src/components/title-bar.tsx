import { useEffect, useState } from "react";
import { Copy, Minus, Square, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { api, formatCommandError } from "@/lib/api";
import { useI18n } from "@/lib/app-preferences";
import type { DesktopWindowState } from "@/lib/types";

import appIconUrl from "../../src-tauri/icons/32x32.png";

export function TitleBar({ title }: { title: string }) {
  const { messages } = useI18n();
  const copy = messages.titleBar;
  const isDesktop = api.isDesktop();
  const [windowState, setWindowState] = useState<DesktopWindowState>({
    maximized: false,
    focused: true,
  });

  useEffect(() => {
    document.title = title;
    if (!isDesktop) {
      return;
    }

    let disposed = false;
    void api.setWindowTitle(title).catch((error: unknown) => {
      if (!disposed) {
        toast.error(copy.titleUpdateFailed, {
          description: formatCommandError(error),
        });
      }
    });
    return () => {
      disposed = true;
    };
  }, [title, isDesktop, copy.titleUpdateFailed]);

  useEffect(() => {
    if (!isDesktop) {
      return;
    }

    let disposed = false;
    let requestId = 0;
    let stateErrorReported = false;
    let unlisten: (() => void) | undefined;
    const reportError = (error: unknown) => {
      if (!disposed && !stateErrorReported) {
        stateErrorReported = true;
        toast.error(copy.stateReadFailed, {
          description: formatCommandError(error),
        });
      }
    };
    const syncWindowState = async () => {
      if (disposed) {
        return;
      }
      const currentRequestId = ++requestId;
      try {
        const nextState = await api.getWindowState();
        if (!disposed && currentRequestId === requestId) {
          stateErrorReported = false;
          setWindowState((current) =>
            current.maximized === nextState.maximized &&
            current.focused === nextState.focused
              ? current
              : nextState,
          );
        }
      } catch (error) {
        if (currentRequestId === requestId) {
          reportError(error);
        }
      }
    };

    void api
      .listenWindowStateChanged(syncWindowState)
      .then((stopListening) => {
        // Registration can finish after StrictMode has already cleaned up.
        if (disposed) {
          stopListening();
          return;
        }
        unlisten = stopListening;
        void syncWindowState();
      })
      .catch(reportError);

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [isDesktop, copy.stateReadFailed]);

  const handleWindowAction = (action: () => Promise<void>) => {
    void action().catch((error: unknown) => {
      toast.error(copy.actionFailed, {
        description: formatCommandError(error),
      });
    });
  };
  const controls = [
    { id: "minimize", label: copy.minimize, icon: Minus, action: api.minimizeWindow },
    {
      id: "maximize",
      label: windowState.maximized ? copy.restore : copy.maximize,
      icon: windowState.maximized ? Copy : Square,
      action: api.toggleMaximizeWindow,
    },
    { id: "close", label: copy.close, icon: X, action: api.closeWindow },
  ];

  return (
    <header className="app-titlebar" data-focused={windowState.focused}>
      <div
        className="app-titlebar-drag-region"
        data-tauri-drag-region
        title={title}
      >
        <img src={appIconUrl} alt="" aria-hidden="true" draggable={false} />
        <span className="truncate">{title}</span>
      </div>
      {isDesktop && (
        <TooltipProvider delayDuration={500}>
          <div className="flex h-full shrink-0">
            {controls.map(({ id, label, icon: Icon, action }) => (
              <Tooltip key={id}>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant={id === "close" ? "ghost-destructive" : "ghost"}
                    size="icon"
                    className="h-full w-[46px] rounded-none border-0 focus-visible:-outline-offset-2 focus-visible:ring-inset active:not-aria-[haspopup]:translate-y-0"
                    aria-label={label}
                    onClick={() => handleWindowAction(action)}
                  >
                    <Icon aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" sideOffset={6}>
                  {label}
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        </TooltipProvider>
      )}
    </header>
  );
}
