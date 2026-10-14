---
impacto: nada_mudou
secao: corrigido
titulo: Aba oculta para de refazer as telas de atendimento a cada 45 segundos
---

O refetch de segurança do inbox, do quadro e do dossiê continuava rodando com a aba escondida, refazendo páginas inteiras de dados a cada 45 segundos sem ninguém olhando — numa instalação no plano gratuito do Supabase, isso pesa na cota de tráfego. Agora ele pausa enquanto a aba está oculta e confere imediatamente ao voltar para ela, como já faziam presença, chamada de voz, alertas e a atualização da interface.

Contribuição de @Tong-bit-art (#2821), a partir da issue #2235.
