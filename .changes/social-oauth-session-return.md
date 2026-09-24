---
impacto: nada_mudou
secao: corrigido
titulo: Retorno de OAuth de redes sociais preserva a sessão em SameSite=Strict
---

O retorno da autorização OAuth de canais sociais agora passa por `/auth/social-return`, um documento intermediário sem efeitos que realiza uma navegação interna same-origin para `/app/connections?aba=sociais`. Isso garante que navegadores enviem os cookies de sessão de volta mesmo sob a política `SameSite=Strict`, evitando redirecionamentos indesejados para a tela de login. Conexões pendentes antigas também são recuperadas de forma transparente no proxy. O aviso de autorização concluída ou não concluída na aba Redes sociais continua aparecendo na volta: a página intermediária passa adiante só esse sinal, sem repetir nenhum dado recebido do provedor.

Contribuição de @saraivabr (#1579).
