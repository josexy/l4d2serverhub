import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

import type { ServerSnapshot } from "@/lib/types";

const DETAIL_WINDOW_LABEL_PREFIX = "server-detail";
const DETAIL_WINDOW_PAYLOAD_PREFIX = "l4d2:server-detail-window:";

export type ServerDetailWindowPayload = {
  address: string;
  serverId?: string | null;
  fallbackName?: string | null;
  snapshot?: ServerSnapshot | null;
  favoriteId?: string | null;
  historyRecordIds?: string[];
};

function hashAddress(address: string): string {
  let hash = 0x811c9dc5;

  for (let index = 0; index < address.length; index += 1) {
    hash ^= address.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(36);
}

export function serverDetailWindowLabel(address: string): string {
  return `${DETAIL_WINDOW_LABEL_PREFIX}-${hashAddress(address)}`;
}

export function serverDetailWindowPayloadKey(label: string): string {
  return `${DETAIL_WINDOW_PAYLOAD_PREFIX}${label}`;
}

function serverDetailWindowUrl(payloadKey: string): string {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("view", "server-detail");
  url.searchParams.set("payloadKey", payloadKey);
  return `${url.pathname}${url.search}`;
}

async function focusWindow(window: WebviewWindow) {
  await window.show();
  await window.unminimize();
  await window.setFocus();
}

function waitForWindowCreated(window: WebviewWindow): Promise<void> {
  return new Promise((resolve, reject) => {
    void window.once("tauri://created", () => resolve());
    void window.once("tauri://error", (event) => reject(event.payload));
  });
}

export async function openServerDetailWindow(payload: ServerDetailWindowPayload) {
  const label = serverDetailWindowLabel(payload.address);
  const existingWindow = await WebviewWindow.getByLabel(label);

  if (existingWindow) {
    await focusWindow(existingWindow);
    return;
  }

  const payloadKey = serverDetailWindowPayloadKey(label);
  localStorage.setItem(payloadKey, JSON.stringify(payload));

  const detailWindow = new WebviewWindow(label, {
    url: serverDetailWindowUrl(payloadKey),
    title: payload.fallbackName || payload.snapshot?.name || payload.address,
    width: 620,
    height: 760,
    minWidth: 480,
    minHeight: 560,
    center: true,
    visible: false,
  });

  await waitForWindowCreated(detailWindow);
}

export function readServerDetailWindowPayload(): ServerDetailWindowPayload | null {
  const params = new URLSearchParams(window.location.search);
  const payloadKey = params.get("payloadKey");

  if (!payloadKey?.startsWith(DETAIL_WINDOW_PAYLOAD_PREFIX)) {
    return null;
  }

  const rawPayload = localStorage.getItem(payloadKey);
  if (!rawPayload) {
    return null;
  }

  try {
    return JSON.parse(rawPayload) as ServerDetailWindowPayload;
  } catch {
    return null;
  }
}

export function isServerDetailWindowRoute(): boolean {
  return new URLSearchParams(window.location.search).get("view") === "server-detail";
}
