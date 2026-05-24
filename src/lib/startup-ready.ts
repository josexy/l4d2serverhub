import { emit } from "@tauri-apps/api/event";

const FRONTEND_READY_EVENT = "l4d2://frontend-ready";

let hasAnnouncedStartupReady = false;

export function announceStartupReady() {
  if (hasAnnouncedStartupReady) {
    return;
  }

  hasAnnouncedStartupReady = true;
  void emit(FRONTEND_READY_EVENT).catch(() => {
    hasAnnouncedStartupReady = false;
  });
}
