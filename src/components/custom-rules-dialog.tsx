import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { createDefaultCustomRules } from "@/lib/filters";
import { useI18n } from "@/lib/app-preferences";
import type { CustomRulePriority, ServerCustomRules } from "@/lib/types";

type CustomRulesDialogProps = {
  open: boolean;
  value: ServerCustomRules;
  onOpenChange: (open: boolean) => void;
  onApply: (rules: ServerCustomRules) => void;
};

type RuleBucketKey = "whitelist" | "blacklist";

export function CustomRulesDialog({
  open,
  value,
  onOpenChange,
  onApply,
}: CustomRulesDialogProps) {
  const { messages } = useI18n();
  const [draft, setDraft] = useState<ServerCustomRules>(value);
  const [activeTab, setActiveTab] = useState<RuleBucketKey>("whitelist");

  useEffect(() => {
    if (!open) {
      return;
    }

    setDraft(value);
  }, [open, value]);

  const updatePriority = (priority: CustomRulePriority) => {
    setDraft((current) => ({
      ...current,
      priority,
    }));
  };

  const updateBucket = (
    bucket: RuleBucketKey,
    field: "ip" | "text",
    nextValue: string,
  ) => {
    setDraft((current) => ({
      ...current,
      [bucket]: {
        ...current[bucket],
        [field]: nextValue,
      },
    }));
  };

  const handleApply = () => {
    onApply(draft);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] gap-0 overflow-hidden p-0 sm:max-w-4xl" showCloseButton={false}>
        <DialogHeader className="gap-2 border-b px-7 py-6">
          <DialogTitle className="text-2xl font-semibold tracking-tight">
            {messages.filterToolbar.customRulesDialogTitle}
          </DialogTitle>
          <DialogDescription>
            {messages.filterToolbar.customRulesDialogDescription}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[calc(88vh-12rem)]">
          <div className="flex flex-col gap-6 px-7 py-6">
            <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as RuleBucketKey)}>
              <div className="flex flex-col gap-4 rounded-xl border bg-muted/10 p-5 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-wrap items-center gap-4">
                  <span className="text-sm font-semibold text-foreground">
                    {messages.filterToolbar.priorityLabel}
                  </span>
                  <label className="inline-flex items-center gap-2 text-sm text-foreground">
                    <input
                      checked={draft.priority === "whitelist"}
                      className="size-4 accent-primary"
                      name="custom-rule-priority"
                      type="radio"
                      onChange={() => updatePriority("whitelist")}
                    />
                    {messages.filterToolbar.whitelistPriority}
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm text-foreground">
                    <input
                      checked={draft.priority === "blacklist"}
                      className="size-4 accent-primary"
                      name="custom-rule-priority"
                      type="radio"
                      onChange={() => updatePriority("blacklist")}
                    />
                    {messages.filterToolbar.blacklistPriority}
                  </label>
                </div>

                <TabsList className="bg-muted/30 p-1">
                  <TabsTrigger className="min-w-24" value="whitelist">
                    {messages.filterToolbar.whitelistTab}
                  </TabsTrigger>
                  <TabsTrigger className="min-w-24" value="blacklist">
                    {messages.filterToolbar.blacklistTab}
                  </TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="whitelist">
                <RuleEditor
                  ipLabel={messages.filterToolbar.ipRulesLabel}
                  ipPlaceholder={messages.filterToolbar.ipRulesPlaceholder}
                  textLabel={messages.filterToolbar.textRulesLabel}
                  textPlaceholder={messages.filterToolbar.textRulesPlaceholder}
                  value={draft.whitelist}
                  onChange={(field, nextValue) => updateBucket("whitelist", field, nextValue)}
                />
              </TabsContent>
              <TabsContent value="blacklist">
                <RuleEditor
                  ipLabel={messages.filterToolbar.ipRulesLabel}
                  ipPlaceholder={messages.filterToolbar.ipRulesPlaceholder}
                  textLabel={messages.filterToolbar.textRulesLabel}
                  textPlaceholder={messages.filterToolbar.textRulesPlaceholder}
                  value={draft.blacklist}
                  onChange={(field, nextValue) => updateBucket("blacklist", field, nextValue)}
                />
              </TabsContent>
            </Tabs>
          </div>
        </ScrollArea>

        <DialogFooter className="mx-0 mb-0 rounded-b-xl border-t bg-background/95 px-7 py-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => setDraft(createDefaultCustomRules())}
          >
            {messages.filterToolbar.clearRules}
          </Button>
          <Button type="button" onClick={handleApply}>
            {messages.filterToolbar.applyRules}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RuleEditor({
  ipLabel,
  ipPlaceholder,
  textLabel,
  textPlaceholder,
  value,
  onChange,
}: {
  ipLabel: string;
  ipPlaceholder: string;
  textLabel: string;
  textPlaceholder: string;
  value: ServerCustomRules["whitelist"];
  onChange: (field: "ip" | "text", nextValue: string) => void;
}) {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <label className="text-sm font-semibold text-foreground">{ipLabel}</label>
        <Textarea
          className="min-h-44 resize-y rounded-2xl px-4 py-3 text-base leading-7"
          placeholder={ipPlaceholder}
          value={value.ip}
          onChange={(event) => onChange("ip", event.target.value)}
        />
      </div>

      <div className="flex flex-col gap-3">
        <label className="text-sm font-semibold text-foreground">{textLabel}</label>
        <Textarea
          className="min-h-44 resize-y rounded-2xl px-4 py-3 text-base leading-7"
          placeholder={textPlaceholder}
          value={value.text}
          onChange={(event) => onChange("text", event.target.value)}
        />
      </div>
    </div>
  );
}
