-- 0100 — o índice do refresh de avatar nunca era usado.
--
-- A 0099 criou
--
--     create index idx_contacts_avatar_refresh
--       on public.contacts (organization_id, avatar_updated_at nulls first);
--
-- e a mensagem daquele commit (e a linha do MANIFEST) o chamavam de "índice
-- parcial". Não era: é um btree composto liderado por `organization_id`. E a
-- varredura do cron `contact-avatars` NÃO filtra organização nenhuma — ela varre
-- a plataforma inteira (app/api/v1/cron/contact-avatars/route.ts):
--
--     .not("wa_identity", "is", null)
--     .eq("is_anonymized", false)
--     .or("avatar_updated_at.is.null,avatar_updated_at.lt.<cutoff>")
--     .order("avatar_updated_at", { ascending: true, nullsFirst: true })
--     .limit(25)
--
-- Sem restrição na coluna líder, o planner não consegue usar o índice para
-- percorrer em ordem de `avatar_updated_at`, e cai em seq scan + top-N sort. Ou
-- seja: o índice ocupava espaço, era mantido a cada UPDATE do cron, e não
-- economizava nada — exatamente o seq scan que a 0099 dizia estar evitando.
--
-- Medido num Postgres descartável (pgvector/pgvector:pg17), 20.000 contatos em 5
-- organizações, 17.665 elegíveis, melhor de 3 execuções:
--
--   índice da 0099   Seq Scan + top-N heapsort · 17.665 linhas lidas · 10,272 ms
--   índice parcial   Index Scan                ·      25 linhas lidas ·  0,090 ms
--
-- 114× mais rápido, e o índice parcial ocupa 160 kB nessas 20 mil linhas — menor
-- que o composto, porque só indexa quem o cron pode escolher.
--
-- Os dois predicados que entram no WHERE são os imutáveis. O terceiro
-- (`avatar_updated_at < now() - 7 dias`) não pode: `now()` não é imutável e o
-- Postgres recusa a criação. Não faz falta — como os NULL vêm primeiro e é
-- justamente por eles que o cron começa, o Index Scan encontra as 25 linhas e
-- para, sem varrer o resto.
--
-- Auto-curativo: o drop só acontece se o índice presente for o antigo (o que
-- menciona organization_id). Em banco novo, e na segunda vez que este arquivo
-- rodar, o bloco é no-op — nada é reconstruído à toa no `update.sh` de um clone.

do $$
begin
  if exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname  = 'idx_contacts_avatar_refresh'
      and indexdef ilike '%organization_id%'
  ) then
    execute 'drop index public.idx_contacts_avatar_refresh';
  end if;
end
$$;

create index if not exists idx_contacts_avatar_refresh
  on public.contacts (avatar_updated_at nulls first)
  where wa_identity is not null and is_anonymized = false;

notify pgrst, 'reload schema';
