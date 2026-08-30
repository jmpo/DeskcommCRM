import { setAlertsEnabled } from "./permission";

export const NOTIFY_UI_CATEGORIES = [
  "message",
  "lead_assigned",
  "lead_won",
  "lead_lost",
  "mention",
] as const;

export type NotifyCategory = (typeof NOTIFY_UI_CATEGORIES)[number];
export type NotifyChannelPref = "in_app" | "push";

export type NotifyPrefs = Record<NotifyCategory, Record<NotifyChannelPref, boolean>>;

const KEY = "notify.prefs.v1";

export function prefsPadrao(): NotifyPrefs {
  let pushMsg = true;
  if (typeof window !== "undefined") {
    try {
      if (window.localStorage.getItem("alerts.enabled") === "0") pushMsg = false;
    } catch {
      // ignore
    }
  }
  return {
    message: { in_app: true, push: pushMsg },
    lead_assigned: { in_app: true, push: true },
    lead_won: { in_app: true, push: true },
    lead_lost: { in_app: true, push: true },
    mention: { in_app: true, push: true },
  };
}

export function lerPrefs(): NotifyPrefs {
  const base = prefsPadrao();
  if (typeof window === "undefined") return base;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<NotifyPrefs>;
    for (const cat of NOTIFY_UI_CATEGORIES) {
      const row = parsed[cat];
      if (!row) continue;
      if (typeof row.in_app === "boolean") base[cat].in_app = row.in_app;
      if (typeof row.push === "boolean") base[cat].push = row.push;
    }
  } catch {
    // JSON inválido — volta ao padrão
  }
  return base;
}

export function canalLigado(category: NotifyCategory, channel: NotifyChannelPref): boolean {
  return lerPrefs()[category][channel];
}

export function gravarCanal(
  category: NotifyCategory,
  channel: NotifyChannelPref,
  on: boolean,
): NotifyPrefs {
  const next = lerPrefs();
  next[category][channel] = on;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  }
  if (category === "message" && channel === "push") setAlertsEnabled(on);
  return next;
}
