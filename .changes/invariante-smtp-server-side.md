---
impacto: nada_mudou
secao: corrigido
titulo: Invariante garante que a configuração de SMTP da instalação é estritamente server-side
---

Adiciona o teste de invariante `tests/invariants/configuracao-de-smtp-e-server-side.test.ts` para a tabela `platform_smtp_settings`, espelhando a proteção de suas irmãs (`platform_meta_app`, `platform_google_oauth`).

O teste afere privilégios revocados para `anon` e `authenticated`, permissão estrita ao `service_role`, ativação de RLS sem policies públicas, isolamento da senha criptografada via `fn_encrypt_oauth`/`fn_decrypt_oauth` e garantia de integridade do singleton.

Contribuição de @webtecnica.
