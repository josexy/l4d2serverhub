import { useLayoutEffect, useRef, type ReactNode } from "react";
import { ScrollArea as ScrollAreaPrimitive } from "radix-ui";

import { ScrollBar } from "@/components/ui/scroll-area";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function ServerTableScrollArea({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const header = root?.querySelector("thead");
    if (!root || !header) {
      return;
    }

    const updateHeaderHeight = () => {
      const height = header.getBoundingClientRect().height;
      // Hidden, retained pages measure zero; keep their last visible offset.
      if (height > 0) {
        root.style.setProperty("--table-header-height", `${height}px`);
      }
    };
    updateHeaderHeight();
    const observer = new ResizeObserver(updateHeaderHeight);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);

  return (
    <TooltipProvider delayDuration={250}>
      <ScrollAreaPrimitive.Root
        ref={rootRef}
        type="auto"
        className={cn("server-table-scroll-area relative isolate min-h-0 min-w-0 flex-1", className)}
      >
        <ScrollAreaPrimitive.Viewport
          data-slot="scroll-area-viewport"
          className="size-full outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
        >
          {children}
        </ScrollAreaPrimitive.Viewport>
        <ScrollBar
          className="z-40 [&_[data-slot=scroll-area-thumb]]:bg-muted-foreground/50"
          style={{ top: "var(--table-header-height)", height: "auto" }}
        />
        <ScrollBar
          className="z-40 [&_[data-slot=scroll-area-thumb]]:bg-muted-foreground/50"
          orientation="horizontal"
        />
        <ScrollAreaPrimitive.Corner className="bg-card" />
      </ScrollAreaPrimitive.Root>
    </TooltipProvider>
  );
}
