import { env } from "@/lib/env";

export function vapidPronto(): boolean {
  return env.VAPID_PUBLIC_KEY.trim().length > 0 && env.VAPID_PRIVATE_KEY.trim().length > 0;
}

export function vapidPublica(): string | null {
  const k = env.VAPID_PUBLIC_KEY.trim();
  return k.length > 0 ? k : null;
}

export function vapidSubject(): string {
  const mail = env.SUPPORT_EMAIL.trim();
  if (mail.includes("@")) return `mailto:${mail}`;
  return env.NEXT_PUBLIC_APP_URL;
}
