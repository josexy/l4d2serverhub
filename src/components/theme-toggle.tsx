import { useRef, useState } from "react";
import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "@/components/ui/toast";
import { formatCommandError } from "@/lib/api";
import { useAppPreferences, useI18n } from "@/lib/app-preferences";
import type { ThemePreference } from "@/lib/types";

const themeCycle: Record<ThemePreference, { next: ThemePreference; icon: LucideIcon }> = {
  system: { next: "light", icon: Monitor },
  light: { next: "dark", icon: Sun },
  dark: { next: "system", icon: Moon },
};

export function ThemeToggle() {
  const { settings, settingsLoaded, settingsLoadFailed, saveSettings } = useAppPreferences();
  const { messages } = useI18n();
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const { next, icon: Icon } = themeCycle[settings.theme];
  const themeLabels = {
    system: messages.settings.options.themeSystem,
    light: messages.settings.options.themeLight,
    dark: messages.settings.options.themeDark,
  };
  const label = messages.appShell.switchTheme(themeLabels[settings.theme], themeLabels[next]);

  const cycleTheme = async () => {
    if (savingRef.current || !settingsLoaded || settingsLoadFailed) {
      return;
    }

    savingRef.current = true;
    setSaving(true);
    try {
      await saveSettings({ ...settings, theme: next });
    } catch (error) {
      toast.error(formatCommandError(error, messages.settings.saveFailed));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-lg"
          className="mx-auto text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          aria-label={label}
          aria-busy={saving}
          disabled={!settingsLoaded || settingsLoadFailed || saving}
          onClick={() => void cycleTheme()}
        >
          <Icon className="size-5" strokeWidth={1.8} aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>{label}</TooltipContent>
    </Tooltip>
  );
}
