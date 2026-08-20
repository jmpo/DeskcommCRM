"use client";

import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

export interface PassoVisivel {
  segmento: string;
  rotulo: string;
  cumprido: boolean;
}

/**
 * O indicador de progresso.
 *
 * Duas coisas mudaram, e as duas eram defeito:
 *
 * 1. A lista era FIXA aqui dentro. Ela mostrava "Loja" mesmo quando a
 *    integração estava desligada — o padrão de toda instalação pelo kit — e a
 *    pessoa via um passo que nunca lhe seria oferecido. Agora os passos chegam
 *    de `lib/onboarding/passos.ts`, a mesma fonte que decide a ordem e monta o
 *    resumo final.
 *
 * 2. "Concluído" era `índice < atual`: bastava estar num passo adiante para os
 *    anteriores ficarem verdes, inclusive os que a pessoa pulou e os que nunca
 *    apareceram. Agora quem responde é o estado gravado.
 *
 * O passo ATUAL continua saindo da rota — o header `x-pathname` que alimentava
 * isso antes nunca era escrito por ninguém, e o indicador ficava travado no
 * primeiro passo o wizard inteiro.
 */
export function Stepper({ passos }: { passos: PassoVisivel[] }) {
  const pathname = usePathname() ?? "";
  const idx = passos.findIndex((p) => pathname.includes(`/${p.segmento}`));

  return (
    <ol
      aria-label="onboarding steps"
      className="flex w-full items-center justify-between gap-2 px-2 py-3"
    >
      {passos.map((p, i) => {
        const isActive = i === idx;
        return (
          <li
            key={p.segmento}
            aria-current={isActive ? "step" : undefined}
            className="flex flex-1 flex-col items-center text-xs"
          >
            <div
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-full border text-[11px] font-medium",
                isActive && "border-primary bg-primary text-primary-foreground",
                !isActive && p.cumprido && "border-primary/40 bg-primary/10 text-primary",
                !isActive && !p.cumprido && "border-muted-foreground/20 text-muted-foreground",
              )}
            >
              {i + 1}
            </div>
            <span
              className={cn(
                "mt-1 truncate",
                isActive ? "font-medium text-foreground" : "text-muted-foreground",
              )}
            >
              {p.rotulo}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
