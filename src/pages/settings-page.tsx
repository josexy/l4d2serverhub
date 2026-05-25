import { useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  FolderOpen,
  RefreshCw,
  Save,
  Settings,
  Trash2,
  Upload,
} from "lucide-react";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";

import { useAppPreferences, useI18n } from "@/lib/app-preferences";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { api, formatCommandError } from "@/lib/api";
import type {
  AppSettings,
  BackupPayload,
  HttpProxyMode,
  LanguagePreference,
  LogLevel,
  ThemePreference,
} from "@/lib/types";

type SettingsDraft = {
  queryTimeoutMs: string;
  proxyMode: HttpProxyMode;
  customProxyUrl: string;
  theme: ThemePreference;
  language: LanguagePreference;
  loggingEnabled: boolean;
  loggingLevel: LogLevel;
};

type NumericDraftKey = "queryTimeoutMs";
type SettingsDraftKey = keyof SettingsDraft;

type SettingsValidation = {
  settings: AppSettings | null;
  errors: Partial<Record<SettingsDraftKey, string>>;
};

const NUMERIC_RULES: Record<
  NumericDraftKey,
  { min: number; max: number }
> = {
  queryTimeoutMs: { min: 250, max: 30000 },
};

function draftFromSettings(settings: AppSettings): SettingsDraft {
  return {
    queryTimeoutMs: String(settings.queryTimeoutMs),
    proxyMode: settings.httpProxy.mode,
    customProxyUrl: settings.httpProxy.customUrl,
    theme: settings.theme,
    language: settings.language,
    loggingEnabled: settings.logging.enabled,
    loggingLevel: settings.logging.level,
  };
}

type SettingsPageProps = {
  isActive?: boolean;
};

export function SettingsPage({ isActive = true }: SettingsPageProps) {
  const { settings, settingsLoaded, replaceSettings, saveSettings } = useAppPreferences();
  const { locale, messages } = useI18n();
  const [draft, setDraft] = useState<SettingsDraft>(draftFromSettings(settings));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportJson, setExportJson] = useState("");
  const [exporting, setExporting] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importJson, setImportJson] = useState("");
  const [importing, setImporting] = useState(false);
  const [importReplaceConfirmed, setImportReplaceConfirmed] = useState(false);
  const [loadingSettings, setLoadingSettings] = useState(false);
  const [openingLogFolder, setOpeningLogFolder] = useState(false);
  const [clearingLogs, setClearingLogs] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const savingRef = useRef(false);
  const loadingSettingsRef = useRef(false);
  const exportingRef = useRef(false);
  const importingRef = useRef(false);
  const openingLogFolderRef = useRef(false);
  const clearingLogsRef = useRef(false);
  const copyingExportRef = useRef(false);
  const downloadingExportRef = useRef(false);

  useEffect(() => {
    setDraft(draftFromSettings(settings));
    setValidationError(null);
  }, [
    settings.language,
    settings.httpProxy.customUrl,
    settings.httpProxy.mode,
    settings.queryTimeoutMs,
    settings.theme,
    settings.logging.enabled,
    settings.logging.level,
  ]);

  const validation = useMemo(() => {
    const errors: SettingsValidation["errors"] = {};
    const parsedValues = {} as Record<NumericDraftKey, number>;
    const numberLabel = (key: NumericDraftKey) => {
      switch (key) {
        case "queryTimeoutMs":
          return messages.settings.labels.queryTimeout;
      }
    };

    const buildNumberError = (
      label: string,
      reason: "integer" | "range",
      min: number,
      max: number,
    ) => {
      if (locale === "zh-CN") {
        return reason === "integer"
          ? `${label}必须是整数。`
          : `${label}必须在 ${min} 到 ${max} 之间。`;
      }

      return reason === "integer"
        ? `${label} must be a whole number.`
        : `${label} must be between ${min} and ${max}.`;
    };
    const buildProxyError = () =>
      locale === "zh-CN"
        ? "自定义代理地址必须是包含主机名的 http 或 https URL。"
        : "Custom proxy URL must be an http or https URL with a host.";

    for (const [key, rule] of Object.entries(NUMERIC_RULES) as Array<
      [NumericDraftKey, { min: number; max: number }]
    >) {
      const parsed = Number(draft[key]);
      if (!Number.isInteger(parsed)) {
        errors[key] = buildNumberError(
          numberLabel(key),
          "integer",
          rule.min,
          rule.max,
        );
        continue;
      }

      if (parsed < rule.min || parsed > rule.max) {
        errors[key] = buildNumberError(
          numberLabel(key),
          "range",
          rule.min,
          rule.max,
        );
        continue;
      }

      parsedValues[key] = parsed;
    }

    const customProxyUrl = draft.customProxyUrl.trim();
    if (draft.proxyMode === "custom") {
      try {
        const parsedUrl = new URL(customProxyUrl);
        if (
          customProxyUrl.length === 0 ||
          (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") ||
          parsedUrl.hostname.length === 0
        ) {
          errors.customProxyUrl = buildProxyError();
        }
      } catch {
        errors.customProxyUrl = buildProxyError();
      }
    }

    if (Object.keys(errors).length > 0) {
      return { settings: null, errors };
    }

    return {
      errors,
      settings: {
        ...settings,
        queryTimeoutMs: parsedValues.queryTimeoutMs,
        httpProxy: {
          mode: draft.proxyMode,
          customUrl:
            draft.proxyMode === "custom" ? customProxyUrl : draft.customProxyUrl,
        },
        theme: draft.theme,
        language: draft.language,
        logging: {
          enabled: draft.loggingEnabled,
          level: draft.loggingLevel,
        },
      },
    } satisfies SettingsValidation;
  }, [draft, locale, messages.settings.labels, settings]);

  const updateDraft = <Key extends keyof SettingsDraft>(
    key: Key,
    value: SettingsDraft[Key],
  ) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setValidationError(null);
  };

  const loadSettings = async () => {
    if (loadingSettingsRef.current) {
      return;
    }

    loadingSettingsRef.current = true;
    setLoadingSettings(true);
    try {
      const latest = await api.getSettings();
      replaceSettings(latest);
      setDraft(draftFromSettings(latest));
      setValidationError(null);
      setError(null);
      toast.success(messages.settings.loadSuccess);
    } catch (loadError) {
      const message = formatCommandError(loadError, messages.settings.loadFailed);
      setError(message);
      toast.error(message);
    } finally {
      loadingSettingsRef.current = false;
      setLoadingSettings(false);
    }
  };

  const handleSave = async () => {
    if (savingRef.current) {
      return;
    }

    const nextSettings = validation.settings;
    if (!nextSettings) {
      const message =
        Object.values(validation.errors)[0] ?? messages.settings.invalidSettings;
      setValidationError(message);
      toast.error(message);
      return;
    }

    savingRef.current = true;
    setSaving(true);
    try {
      await saveSettings(nextSettings);
      toast.success(messages.settings.saveSuccess);
    } catch (saveError) {
      const message = formatCommandError(saveError, messages.settings.saveFailed);
      toast.error(message);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleExport = async () => {
    if (exportingRef.current) {
      return;
    }

    exportingRef.current = true;
    setExporting(true);
    try {
      const payload = await api.exportData();
      const json = JSON.stringify(payload, null, 2);
      setExportJson(json);
      setExportDialogOpen(true);
      toast.success(messages.settings.exportPrepared);
    } catch (exportError) {
      const message = formatCommandError(exportError, messages.settings.exportFailed);
      toast.error(message);
    } finally {
      exportingRef.current = false;
      setExporting(false);
    }
  };

  const handleCopyExport = async () => {
    if (copyingExportRef.current) {
      return;
    }

    copyingExportRef.current = true;
    try {
      await navigator.clipboard.writeText(exportJson);
      toast.success(messages.settings.exportCopied);
    } catch {
      toast.error(messages.settings.exportCopyFailed);
    } finally {
      copyingExportRef.current = false;
    }
  };

  const handleDownloadExport = async () => {
    if (downloadingExportRef.current) {
      return;
    }

    downloadingExportRef.current = true;
    try {
      const path = await saveDialog({
        defaultPath: "l4d2-server-hub-backup.json",
        filters: [
          {
            name: "JSON",
            extensions: ["json"],
          },
        ],
      });

      if (!path) {
        return;
      }

      await api.writeExportFile(path, exportJson);
      toast.success(messages.settings.exportDownloaded);
    } catch (downloadError) {
      const message = formatCommandError(
        downloadError,
        messages.settings.exportDownloadFailed,
      );
      toast.error(message);
    } finally {
      downloadingExportRef.current = false;
    }
  };

  const handleImport = async () => {
    if (importingRef.current) {
      return;
    }

    if (!importReplaceConfirmed) {
      toast.error(messages.settings.importConfirmError);
      return;
    }

    let payload: BackupPayload;
    try {
      payload = JSON.parse(importJson) as BackupPayload;
    } catch {
      toast.error(messages.settings.importInvalidJson);
      return;
    }

    importingRef.current = true;
    setImporting(true);
    try {
      const imported = await api.importData(payload);
      replaceSettings(imported.settings);
      setImportJson("");
      setImportReplaceConfirmed(false);
      setImportDialogOpen(false);
      toast.success(messages.settings.importCompleted);
    } catch (importError) {
      const message = formatCommandError(importError, messages.settings.importFailed);
      toast.error(message);
    } finally {
      importingRef.current = false;
      setImporting(false);
    }
  };

  const handleOpenLogFolder = async () => {
    if (openingLogFolderRef.current) {
      return;
    }

    openingLogFolderRef.current = true;
    setOpeningLogFolder(true);
    try {
      await api.openLogFolder();
    } catch (openError) {
      const message = formatCommandError(
        openError,
        messages.settings.openLogFolderFailed,
      );
      toast.error(message);
    } finally {
      openingLogFolderRef.current = false;
      setOpeningLogFolder(false);
    }
  };

  const handleClearLogFiles = async () => {
    if (clearingLogsRef.current) {
      return;
    }

    clearingLogsRef.current = true;
    setClearingLogs(true);
    try {
      const cleared = await api.clearLogFiles();
      toast.success(messages.settings.clearLogsSuccess(cleared));
    } catch (clearError) {
      const message = formatCommandError(
        clearError,
        messages.settings.clearLogsFailed,
      );
      toast.error(message);
    } finally {
      clearingLogsRef.current = false;
      setClearingLogs(false);
    }
  };

  return (
    <section className="page-layout">
      <div className="page-heading">
        <div>
          <p className="page-eyebrow">{messages.settings.eyebrow}</p>
          <h2>{messages.settings.title}</h2>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!settingsLoaded || loadingSettings}
            onClick={() => void loadSettings()}
          >
            <RefreshCw
              data-icon="inline-start"
              className={loadingSettings ? "animate-spin" : undefined}
            />
            {loadingSettings ? messages.common.refreshing : messages.common.refresh}
          </Button>
          <Button type="button" size="sm" disabled={saving} onClick={() => void handleSave()}>
            <Save data-icon="inline-start" />
            {saving ? messages.common.saving : messages.common.save}
          </Button>
        </div>
      </div>

      <div className="utility-panel overflow-auto p-4">
        <div className="mx-auto flex max-w-4xl flex-col gap-4">
          <section className="rounded-lg border bg-background/40 p-4">
            <div className="mb-4 flex items-center gap-3">
              <div className="empty-state-icon">
                <Settings aria-hidden="true" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-foreground">
                  {messages.settings.sectionTitle}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {messages.settings.sectionDescription}
                </p>
              </div>
            </div>

            {!settingsLoaded ? (
              <div className="grid min-h-40 place-items-center text-sm text-muted-foreground">
                {messages.common.refreshing}...
              </div>
            ) : (
              <form className="grid gap-5 md:grid-cols-[220px_minmax(0,1fr)]">
                <div>
                  <label htmlFor="query-timeout" className="text-sm font-medium text-foreground">
                    {messages.settings.labels.queryTimeout}
                  </label>
                  <p className="text-xs text-muted-foreground">
                    {messages.settings.labels.queryTimeoutDescription}
                  </p>
                </div>
                <div className="flex flex-col gap-1">
                  <Input
                    id="query-timeout"
                    className="w-56"
                    type="number"
                    min={NUMERIC_RULES.queryTimeoutMs.min}
                    max={NUMERIC_RULES.queryTimeoutMs.max}
                    value={draft.queryTimeoutMs}
                    onChange={(event) => updateDraft("queryTimeoutMs", event.target.value)}
                  />
                  {validation.errors.queryTimeoutMs ? (
                    <p className="text-xs text-destructive" role="alert">
                      {validation.errors.queryTimeoutMs}
                    </p>
                  ) : null}
                </div>

                <div>
                  <label htmlFor="proxy-mode" className="text-sm font-medium text-foreground">
                    {messages.settings.labels.proxy}
                  </label>
                  <p className="text-xs text-muted-foreground">
                    {messages.settings.labels.proxyDescription}
                  </p>
                </div>
                <div className="flex flex-col gap-2">
                  <Select
                    value={draft.proxyMode}
                    onValueChange={(value) => updateDraft("proxyMode", value as HttpProxyMode)}
                  >
                    <SelectTrigger id="proxy-mode" className="w-56">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="none">
                          {messages.settings.options.proxyNone}
                        </SelectItem>
                        <SelectItem value="system">
                          {messages.settings.options.proxySystem}
                        </SelectItem>
                        <SelectItem value="custom">
                          {messages.settings.options.proxyCustom}
                        </SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  {draft.proxyMode === "custom" ? (
                    <div className="flex w-56 max-w-full flex-col gap-1">
                      <Input
                        id="custom-proxy-url"
                        type="url"
                        placeholder={messages.settings.placeholders.customProxyUrl}
                        value={draft.customProxyUrl}
                        onChange={(event) =>
                          updateDraft("customProxyUrl", event.target.value)
                        }
                        aria-invalid={validation.errors.customProxyUrl ? true : undefined}
                      />
                      {validation.errors.customProxyUrl ? (
                        <p className="text-xs text-destructive" role="alert">
                          {validation.errors.customProxyUrl}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                <div>
                  <label htmlFor="theme" className="text-sm font-medium text-foreground">
                    {messages.settings.labels.theme}
                  </label>
                  <p className="text-xs text-muted-foreground">
                    {messages.settings.labels.themeDescription}
                  </p>
                </div>
                <Select
                  value={draft.theme}
                  onValueChange={(value) => updateDraft("theme", value as ThemePreference)}
                >
                  <SelectTrigger id="theme" className="w-56">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="system">{messages.settings.options.themeSystem}</SelectItem>
                      <SelectItem value="light">{messages.settings.options.themeLight}</SelectItem>
                      <SelectItem value="dark">{messages.settings.options.themeDark}</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>

                <div>
                  <label htmlFor="language" className="text-sm font-medium text-foreground">
                    {messages.settings.labels.language}
                  </label>
                  <p className="text-xs text-muted-foreground">
                    {messages.settings.labels.languageDescription}
                  </p>
                </div>
                <Select
                  value={draft.language}
                  onValueChange={(value) =>
                    updateDraft("language", value as LanguagePreference)
                  }
                >
                  <SelectTrigger id="language" className="w-56">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="system">
                        {messages.settings.options.languageSystem}
                      </SelectItem>
                      <SelectItem value="en">
                        {messages.settings.options.languageEnglish}
                      </SelectItem>
                      <SelectItem value="zh-CN">
                        {messages.settings.options.languageChinese}
                      </SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>

                <div className="border-t pt-5 md:col-span-2">
                  <h3 className="text-base font-semibold text-foreground">
                    {messages.settings.loggingSectionTitle}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {messages.settings.loggingSectionDescription}
                  </p>
                </div>

                <div>
                  <label htmlFor="logging-enabled" className="text-sm font-medium text-foreground">
                    {messages.settings.labels.loggingEnabled}
                  </label>
                  <p className="text-xs text-muted-foreground">
                    {messages.settings.labels.loggingEnabledDescription}
                  </p>
                </div>
                <label className="flex w-fit items-center gap-2 rounded-md border bg-background/60 px-3 py-2 text-sm">
                  <Checkbox
                    id="logging-enabled"
                    checked={draft.loggingEnabled}
                    onCheckedChange={(checked) =>
                      updateDraft("loggingEnabled", checked === true)
                    }
                  />
                  <span>
                    {draft.loggingEnabled ? messages.common.enabled : messages.common.disabled}
                  </span>
                </label>

                <div>
                  <label htmlFor="logging-level" className="text-sm font-medium text-foreground">
                    {messages.settings.labels.loggingLevel}
                  </label>
                  <p className="text-xs text-muted-foreground">
                    {messages.settings.labels.loggingLevelDescription}
                  </p>
                </div>
                <Select
                  value={draft.loggingLevel}
                  disabled={!draft.loggingEnabled}
                  onValueChange={(value) =>
                    updateDraft("loggingLevel", value as LogLevel)
                  }
                >
                  <SelectTrigger id="logging-level" className="w-56">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="error">{messages.settings.options.logError}</SelectItem>
                      <SelectItem value="warn">{messages.settings.options.logWarn}</SelectItem>
                      <SelectItem value="info">{messages.settings.options.logInfo}</SelectItem>
                      <SelectItem value="debug">{messages.settings.options.logDebug}</SelectItem>
                      <SelectItem value="trace">{messages.settings.options.logTrace}</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>

                <div className="md:col-start-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void handleOpenLogFolder()}
                      disabled={openingLogFolder}
                    >
                      <FolderOpen data-icon="inline-start" />
                      {messages.settings.openLogFolder}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void handleClearLogFiles()}
                      disabled={clearingLogs}
                    >
                      {clearingLogs ? (
                        <RefreshCw data-icon="inline-start" className="animate-spin" />
                      ) : (
                        <Trash2 data-icon="inline-start" />
                      )}
                      {clearingLogs
                        ? messages.settings.clearingLogs
                        : messages.settings.clearLogs}
                    </Button>
                  </div>
                </div>
              </form>
            )}

            {validationError ? (
              <p className="mt-4 text-sm text-destructive" role="alert">
                {validationError}
              </p>
            ) : null}
            {error ? (
              <p className="mt-2 text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
          </section>

          <section className="rounded-lg border bg-background/40 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => void handleExport()}
                disabled={exporting}
              >
                <Download data-icon="inline-start" />
                {messages.common.exportData}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setImportDialogOpen(true)}
                disabled={importing}
              >
                <Upload data-icon="inline-start" />
                {messages.common.importData}
              </Button>
            </div>
          </section>
        </div>
      </div>

      <Dialog open={isActive && exportDialogOpen} onOpenChange={setExportDialogOpen}>
        <DialogContent className="max-h-[calc(100vh-2rem)] sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{messages.settings.exportTitle}</DialogTitle>
            <DialogDescription>{messages.settings.exportDescription}</DialogDescription>
          </DialogHeader>
          <Textarea
            value={exportJson}
            readOnly
            className="h-[min(60vh,32rem)] min-h-0 resize-none overflow-auto font-mono text-xs [field-sizing:fixed]"
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => void handleDownloadExport()}>
              <Download data-icon="inline-start" />
              {messages.settings.exportDownload}
            </Button>
            <Button type="button" onClick={() => void handleCopyExport()}>
              {messages.common.copy}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isActive && importDialogOpen}
        onOpenChange={(open) => {
          setImportDialogOpen(open);
          if (!open) {
            setImportReplaceConfirmed(false);
          }
        }}
      >
        <DialogContent className="max-h-[calc(100vh-2rem)] sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{messages.settings.importTitle}</DialogTitle>
            <DialogDescription>{messages.settings.importDescription}</DialogDescription>
          </DialogHeader>
          <Textarea
            value={importJson}
            className="h-[min(52vh,28rem)] min-h-0 resize-none overflow-auto font-mono text-xs [field-sizing:fixed]"
            placeholder={messages.settings.placeholders.importJson}
            onChange={(event) => {
              setImportJson(event.target.value);
              setImportReplaceConfirmed(false);
            }}
          />
          <label className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <Checkbox
              checked={importReplaceConfirmed}
              disabled={importing || !importJson.trim()}
              onCheckedChange={(checked) =>
                setImportReplaceConfirmed(checked === true)
              }
            />
            <span className="leading-5">{messages.settings.importConfirm}</span>
          </label>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={importing}
              onClick={() => setImportDialogOpen(false)}
            >
              {messages.common.cancel}
            </Button>
            <Button
              type="button"
              disabled={importing || !importJson.trim() || !importReplaceConfirmed}
              onClick={() => void handleImport()}
            >
              {importing ? messages.common.saving : messages.common.importJson}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
