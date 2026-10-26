-- manifest: **O aviso à equipe sai pelo número oficial, com um modelo aprovado.** `config_aviso_de_caso` ganha `modelo_id` (FK para `meta_templates`, `on delete set null`): o modelo aprovado, com UMA variável no corpo, que leva o aviso quando a conexão escolhida só manda modelo fora da janela de 24 h. O texto do aviso entra nessa variável numa linha só (a plataforma recusa valor com quebra de linha). `fn_definir_aviso_de_caso` ganha `p_modelo uuid default null` (8 parâmetros; a de 7 sai) e recusa com `aviso_de_caso_modelo_invalido` o modelo de outra organização ou de outra conexão. Sem modelo, nada muda: a conexão de texto livre segue igual, e a oficial segue sem servir. Idempotente, psql puro, sem BEGIN/COMMIT; espelho no apêndice do `baseline.sql`, antes da VARREDURA anon.
--
-- ═══ O que não dava para fazer ═══
--
-- A tela "Aviso no WhatsApp" só aceitava conexão que manda texto livre a
-- qualquer hora. Uma organização cujo único número estável é o oficial nunca
-- conseguia avisar a equipe: o switch travava (`so_canal_oficial`), a ação
-- "Mensagem para a equipe" pulava com `canal_nao_aceita_texto_livre` e o aviso
-- de caso era condenado com `canal_nao_aceita_aviso_livre`. Fora da janela de
-- 24 h, o número oficial só fala por modelo aprovado — e é isso que passa a
-- ser possível escolher.
--
-- ═══ Por que uma coluna na configuração, e não na regra ═══
--
-- O modelo é do NÚMERO que envia, como a conexão e o destino: a mesma escolha
-- serve ao aviso de caso, ao teste da tela e à ação "Mensagem para a equipe".
-- Na regra, cada automação teria de repetir a escolha, e a ação "Mensagem para
-- a equipe" não carrega destino nem conteúdo por decisão (#2642).
--
-- ═══ Por que `on delete set null` ═══
--
-- Apagar o modelo do espelho não pode apagar a configuração nem falhar o
-- DELETE. Sem modelo, a tela mostra o bloqueio e o envio recusa com o motivo.

alter table public.config_aviso_de_caso
  add column if not exists modelo_id uuid
    references public.meta_templates(id) on delete set null;

comment on column public.config_aviso_de_caso.modelo_id is
  'Modelo aprovado (meta_templates) que leva o aviso quando a conexão só manda modelo fora da janela de 24 h. Uma variável só, no corpo: o texto do aviso entra nela numa linha só. Nulo = texto livre (a conexão precisa aceitar). Migration 0783.';

-- A função ganha o oitavo parâmetro. `create or replace` com outra lista de
-- parâmetros cria OUTRA função: a de 7 sai logo abaixo, senão o PostgREST teria
-- duas e a chamada de 7 argumentos ficaria ambígua.
create or replace function public.fn_definir_aviso_de_caso(
  p_org uuid,
  p_channel uuid,
  p_telefone text,
  p_rotulo text,
  p_ligado boolean,
  p_confirma_contato boolean default false,
  p_resposta_whatsapp_habilitada boolean default false,
  p_modelo uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_antes public.config_aviso_de_caso;
  v_arch timestamptz;
  v_digitos text;
  v_variantes text[];
begin
  -- Papel + suporte, nesta ordem e na MESMA transação da escrita. `auth.uid()`
  -- nulo é o caminho do service role: quem escreve configuração é gente.
  if auth.uid() is null or p_org is null
     or not public.fn_role_at_least(p_org, 'admin')
     or not public.fn_support_write_allowed(p_org) then
    raise exception 'aviso_de_caso_forbidden' using errcode = '42501';
  end if;
  -- Quem NÃO tem fator cadastrado passa: a função já trata isso, e é coerente
  -- com a política de MFA opcional deste produto.
  if not public.fn_session_mfa_proven() then
    raise exception 'aviso_de_caso_mfa_required' using errcode = '42501';
  end if;
  if p_telefone is null or p_telefone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'aviso_de_caso_telefone_invalido' using errcode = '22023';
  end if;

  -- O canal é DA organização e não está arquivado. Sem isto a FK simples
  -- deixaria apontar para o canal de outro tenant — a FK composta do padrão
  -- 0228 não serve aqui porque o `on delete set null` anularia também
  -- `organization_id`, que é a chave primária desta tabela.
  if p_channel is not null then
    select archived_at into v_arch
      from public.channel_sessions
     where id = p_channel and organization_id = p_org;
    if not found or v_arch is not null then
      raise exception 'aviso_de_caso_canal_invalido' using errcode = '22023';
    end if;
  end if;

  -- O MODELO APROVADO é DESTA organização e DESTA conexão (migration 0783). A
  -- mesma regra de `lib/channels/linha-do-espelho.ts`: a linha gravada para a
  -- conexão, ou a linha sem conexão da conta oficial dela. Sem isto, a FK
  -- simples deixaria apontar para o modelo de outro tenant ou de outro número,
  -- e o envio sairia com uma definição que esta conexão não tem. Se ele está
  -- APROVADO e tem uma variável só é pergunta da rota (`lib/escalacao/
  -- modelo-do-aviso.ts`), e de novo do envio: o status muda na plataforma
  -- sem passar por aqui.
  if p_modelo is not null then
    if p_channel is null or not exists (
         select 1 from public.meta_templates t
          where t.id = p_modelo
            and t.organization_id = p_org
            and (t.channel_session_id = p_channel
                 or (t.channel_session_id is null and exists (
                       select 1 from public.channel_sessions s
                        where s.organization_id = p_org
                          and s.id = p_channel
                          and s.provider = 'meta_cloud'
                          and s.meta_waba_id = t.waba_id)))) then
      raise exception 'aviso_de_caso_modelo_invalido' using errcode = '22023';
    end if;
  end if;

  -- As duas grafias do nono dígito — a MESMA regra de
  -- `lib/channels/phone-variants.ts`. Comparar a string crua deixaria passar o
  -- número do suporte cadastrado com 9 e registrado sem.
  v_digitos := regexp_replace(p_telefone, '\D', '', 'g');
  v_variantes := array[v_digitos];
  if v_digitos like '55%' then
    if length(v_digitos) = 13
       and substring(v_digitos from 5 for 1) = '9'
       and substring(v_digitos from 6 for 1) between '6' and '9' then
      v_variantes := v_variantes || (substring(v_digitos from 1 for 4) || substring(v_digitos from 6));
    elsif length(v_digitos) = 12
       and substring(v_digitos from 5 for 1) between '6' and '9' then
      v_variantes := v_variantes || (substring(v_digitos from 1 for 4) || '9' || substring(v_digitos from 5));
    end if;
  end if;

  -- O NÚMERO DE AVISO NÃO PODE SER UM NÚMERO DA PRÓPRIA ORGANIZAÇÃO. É o laço
  -- robô-com-robô: a conexão de avisos manda para o número oficial, o agente
  -- dele responde, e as duas pontas se alimentam sem fim.
  -- A conexão ARQUIVADA fica FORA da conta. Ela não envia nem recebe, então o
  -- laço não acontece por ela — e contá-la bloqueia o número PARA SEMPRE, porque
  -- a conexão que já teve agente publicado não pode ser apagada (as versões a
  -- seguram) e o número nunca mais poderia receber aviso.
  if exists (
       select 1 from public.channel_sessions s
        where s.organization_id = p_org
          and s.archived_at is null
          and s.phone_number is not null
          and regexp_replace(s.phone_number, '\D', '', 'g') = any (v_variantes)) then
    raise exception 'aviso_de_caso_numero_da_propria_org' using errcode = '22023';
  end if;

  -- O número de aviso vira INTERNO: tudo o que chegar dele deixa de virar
  -- contato, conversa, lead e despacho do agente. Se ele já é um CLIENTE desta
  -- organização, as mensagens dessa pessoa param de chegar ao CRM — e isso não
  -- pode acontecer por engano. A tela pergunta e reenvia com `p_confirma_contato`.
  if not coalesce(p_confirma_contato, false) and exists (
       select 1 from public.contacts c
        where c.organization_id = p_org
          and c.phone_number is not null
          and regexp_replace(c.phone_number, '\D', '', 'g') = any (v_variantes)) then
    raise exception 'aviso_de_caso_numero_de_cliente' using errcode = '22023';
  end if;

  select * into v_antes from public.config_aviso_de_caso where organization_id = p_org;

  insert into public.config_aviso_de_caso
    (organization_id, channel_session_id, telefone_destino, rotulo, ligado, resposta_whatsapp_habilitada, modelo_id, criado_por, atualizado_por)
  values
    (p_org, p_channel, p_telefone, nullif(btrim(p_rotulo), ''), coalesce(p_ligado, false), coalesce(p_resposta_whatsapp_habilitada, false), p_modelo, auth.uid(), auth.uid())
  on conflict (organization_id) do update
    set channel_session_id = excluded.channel_session_id,
        telefone_destino   = excluded.telefone_destino,
        rotulo             = excluded.rotulo,
        ligado             = excluded.ligado,
        resposta_whatsapp_habilitada = excluded.resposta_whatsapp_habilitada,
        modelo_id          = excluded.modelo_id,
        atualizado_por     = auth.uid(),
        -- Trocou o número, o JID resolvido do anterior não vale mais — e é o
        -- JID que o corte da ingestão usa para reconhecer quem está em modo
        -- privacidade. Mantê-lo faria o corte continuar valendo para o número
        -- ANTIGO, que pode voltar a ser um cliente.
        destino_jid        = case
                               when excluded.telefone_destino is distinct from config_aviso_de_caso.telefone_destino
                               then null
                               else config_aviso_de_caso.destino_jid
                             end,
        updated_at         = now();

  return jsonb_build_object(
    'trocou_numero', (v_antes.telefone_destino is distinct from p_telefone),
    'antes_ligado',  coalesce(v_antes.ligado, false)
  );
end;
$$;
revoke all on function public.fn_definir_aviso_de_caso(uuid,uuid,text,text,boolean,boolean,boolean,uuid) from public, anon;
grant execute on function public.fn_definir_aviso_de_caso(uuid,uuid,text,text,boolean,boolean,boolean,uuid) to authenticated;
drop function if exists public.fn_definir_aviso_de_caso(uuid,uuid,text,text,boolean,boolean,boolean);
