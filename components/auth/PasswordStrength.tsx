"use client";

import { useT } from "@/hooks/i18n/useT";

const REQUIREMENTS = [
  { label: "8 ou mais caracteres", test: (value: string) => value.length >= 8 },
  { label: "Uma letra", test: (value: string) => /[A-Za-zÀ-ÿ]/.test(value) },
  { label: "Um número", test: (value: string) => /[0-9]/.test(value) },
  { label: "Um símbolo", test: (value: string) => /[^A-Za-zÀ-ÿ0-9\s]/.test(value) },
] as const;

export function PasswordStrength({ password }: { password: string }) {
  const t = useT();
  const met = REQUIREMENTS.map((requirement) => requirement.test(password));
  const score = met.filter(Boolean).length;
  const label = ["Muito fraca", "Fraca", "Razoável", "Boa", "Forte"][score] ?? "Muito fraca";
  const barColor =
    ["bg-muted", "bg-destructive", "bg-warning", "bg-info", "bg-success"][score] ?? "bg-muted";

  return (
    <div className="space-y-2 pt-1" aria-live="polite">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="text-muted-foreground">{t("Força da senha")}</span>
        <span className="font-medium" data-testid="password-strength-label">
          {t(label)}
        </span>
      </div>
      <div
        className="grid grid-cols-4 gap-1"
        role="meter"
        aria-label={t("Força da senha")}
        aria-valuemin={0}
        aria-valuemax={4}
        aria-valuenow={score}
        aria-valuetext={t(label)}
      >
        {REQUIREMENTS.map((requirement, index) => (
          <span
            key={requirement.label}
            className={`h-1.5 rounded-full ${index < score ? barColor : "bg-muted"}`}
          />
        ))}
      </div>
      <ul className="grid gap-1 text-xs sm:grid-cols-2">
        {REQUIREMENTS.map((requirement, index) => (
          <li
            key={requirement.label}
            className={met[index] ? "text-success-fg" : "text-muted-foreground"}
          >
            <span aria-hidden>{met[index] ? "✓" : "•"}</span> {t(requirement.label)}
          </li>
        ))}
      </ul>
    </div>
  );
}
