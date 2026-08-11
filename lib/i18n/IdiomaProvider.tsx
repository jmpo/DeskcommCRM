"use client";
import { createContext, useContext, useMemo } from "react";

import { traduzir } from "./dicionario";
import { normalizarIdioma, IDIOMA_PADRAO, type Idioma } from "./idiomas";

/**
 * O idioma da interface, com contexto PRÓPRIO — não pendurado no de autenticação.
 *
 * ─── Por que separado ──────────────────────────────────────────────────────
 *
 * A primeira versão lia o idioma do `AuthProvider`, que é onde o dado mora. Não
 * compilou o mundo real: dezenas de testes fazem `vi.mock` do módulo de
 * autenticação, e o mock não conhecia a função nova — 32 casos quebraram por
 * causa de um RÓTULO.
 *
 * O erro não foi o mock: foi o acoplamento. Traduzir é apresentação e não
 * precisa saber quem está logado; amarrá-lo à autenticação faz toda tela que
 * mostra texto depender de quem sabe permissão. O provider de idioma recebe o
 * código pronto de quem já o tem (o layout) e não pergunta nada a ninguém.
 *
 * ─── Ausência é o padrão, nunca erro ───────────────────────────────────────
 *
 * Sem provider, `t` devolve português. Um componente renderizado fora da árvore
 * — num teste, num e-mail, num fragmento isolado — continua mostrando texto
 * legível. A tradução não pode ser o motivo de nada quebrar.
 */
const Ctx = createContext<Idioma>(IDIOMA_PADRAO);

export function IdiomaProvider({
  locale,
  children,
}: {
  locale: string | null | undefined;
  children: React.ReactNode;
}) {
  const idioma = normalizarIdioma(locale);
  return <Ctx.Provider value={idioma}>{children}</Ctx.Provider>;
}

/** `t("Assumir")` → "Asumir" para quem escolheu espanhol. */
export function useT(): (texto: string) => string {
  const idioma = useContext(Ctx);
  // Identidade estável: sem isto, todo `useMemo`/`useEffect` que dependa de `t`
  // reexecutaria a cada render.
  return useMemo(() => (texto: string) => traduzir(texto, idioma), [idioma]);
}
