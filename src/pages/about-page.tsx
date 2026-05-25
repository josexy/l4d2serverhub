import { useEffect, useState } from "react";
import { ExternalLink, Info } from "lucide-react";

import { useI18n } from "@/lib/app-preferences";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { api } from "@/lib/api";

const APP_NAME = "L4D2 Server Hub";
const GITHUB_URL = "https://github.com/josexy/l4d2serverhub";

export function AboutPage() {
  const { messages } = useI18n();
  const [appVersion, setAppVersion] = useState<string | null>(null);

  useEffect(() => {
    let isCurrent = true;

    api
      .getAppVersion()
      .then((version) => {
        if (isCurrent) {
          setAppVersion(version);
        }
      })
      .catch(() => {
        if (isCurrent) {
          setAppVersion("-");
        }
      });

    return () => {
      isCurrent = false;
    };
  }, []);

  const versionLabel = appVersion ?? "...";

  return (
    <section className="page-layout">
      <div className="page-heading">
        <div>
          <p className="page-eyebrow">{messages.about.eyebrow}</p>
          <h2>{APP_NAME}</h2>
        </div>
        <div className="page-meta">v{versionLabel}</div>
      </div>

      <div className="utility-panel overflow-auto p-4">
        <div className="mx-auto flex max-w-2xl flex-col gap-4 rounded-lg border bg-background/30 p-4">
          <div className="flex items-center gap-3">
            <div className="empty-state-icon">
              <Info aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h3 className="truncate text-base font-semibold">{APP_NAME}</h3>
              <p className="text-sm text-muted-foreground">
                {messages.about.description}
              </p>
            </div>
          </div>

          <Separator />

          <dl className="grid grid-cols-[150px_minmax(0,1fr)] gap-x-4 gap-y-3 text-sm">
            <dt className="text-muted-foreground">{messages.about.version}</dt>
            <dd className="font-mono text-xs">{versionLabel}</dd>

            <dt className="text-muted-foreground">{messages.about.repository}</dt>
            <dd className="min-w-0 overflow-hidden">
              <Button
                asChild
                variant="link"
                className="h-auto min-w-0 max-w-full shrink justify-start p-0 whitespace-normal"
              >
                <a href={GITHUB_URL} target="_blank" rel="noreferrer">
                  <ExternalLink data-icon="inline-start" />
                  <span className="min-w-0 truncate">{GITHUB_URL}</span>
                </a>
              </Button>
            </dd>
          </dl>
        </div>
      </div>
    </section>
  );
}
