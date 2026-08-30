"use client";

import { createContext, useContext, useEffect, type ReactNode } from "react";

/**
 * Id da conversa aberta no inbox. O listener de INSERT mora no AppShell
 * (ancestral), então além do contexto há um módulo-level lido no evento.
 */
let publishedId: string | null = null;

export function getOpenConversationId(): string | null {
  return publishedId;
}

const Ctx = createContext<string | null>(null);

export function OpenConversationProvider({
  conversationId,
  children,
}: {
  conversationId: string | null;
  children: ReactNode;
}) {
  useEffect(() => {
    publishedId = conversationId;
    return () => {
      publishedId = null;
    };
  }, [conversationId]);

  return <Ctx.Provider value={conversationId}>{children}</Ctx.Provider>;
}

export function useOpenConversationId(): string | null {
  return useContext(Ctx);
}
