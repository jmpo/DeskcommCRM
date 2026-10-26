/**
 * O que os gatilhos semeiam numa empresa nova, no idioma DELA.
 *
 * Toda organização nasce com o funil "Pedidos" e oito etapas
 * (`fn_seed_default_pipeline_for_org`) e com três tipos de agendamento
 * (`fn_semear_tipos_de_agendamento`). Os nomes estão escritos em português
 * dentro das funções do banco — e numa empresa de Assunção eles apareciam assim
 * no quadro, no seletor do agendamento e no ensaio do agente.
 *
 * ─── Por que aqui, e não no gatilho ────────────────────────────────────────
 *
 * Traduzir no gatilho seria mudar de schema (função do banco, migration e
 * apêndice no baseline) para resolver um RÓTULO. Aqui o nome é trocado logo
 * depois do nascimento, pelo mesmo cliente de serviço que acabou de criar a
 * empresa, e só nas linhas que ainda têm um nome SEMEADO (`name in (...)`): uma
 * etapa que alguém já renomeou nunca é tocada. Os SLUGS não mudam — a 0621
 * (`fn_ligar_funil_pulado`) liga o funil pulado pelo slug, e o quadro do
 * onboarding (0156) troca as etapas pelo id do funil.
 *
 * Também roda quando a pessoa troca o idioma DENTRO do wizard: as duas direções
 * estão na tabela, então trocar de volta para o português devolve os nomes de
 * antes.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Idioma } from "@/lib/i18n/idiomas";
import { logger } from "@/lib/logger";

type NomePorIdioma = Record<Idioma, string>;

/** O funil que o gatilho semeia (slug `pedidos`). O nome é o mesmo nos dois idiomas. */
export const FUNIL_SEMEADO = {
  slug: "pedidos",
  nome: { "pt-BR": "Pedidos", es: "Pedidos" } satisfies NomePorIdioma,
};

/** As etapas semeadas, pelo slug que o gatilho grava. */
export const ETAPAS_SEMEADAS: Record<string, NomePorIdioma> = {
  carrinho_abandonado: { "pt-BR": "Carrinho abandonado", es: "Carrito abandonado" },
  aguardando_pagamento: { "pt-BR": "Aguardando pagamento", es: "Esperando el pago" },
  pago: { "pt-BR": "Pago", es: "Pagado" },
  em_separacao: { "pt-BR": "Em separação", es: "En preparación" },
  enviado: { "pt-BR": "Enviado", es: "Enviado" },
  entregue: { "pt-BR": "Entregue", es: "Entregado" },
  pos_venda: { "pt-BR": "Pós-venda", es: "Posventa" },
  cancelado: { "pt-BR": "Cancelado", es: "Cancelado" },
};

/** Os tipos de agendamento semeados, pelo slug. */
export const TIPOS_DE_AGENDAMENTO_SEMEADOS: Record<string, NomePorIdioma> = {
  consulta: { "pt-BR": "Consulta", es: "Consulta" },
  reuniao: { "pt-BR": "Reunião", es: "Reunión" },
  atendimento: { "pt-BR": "Atendimento", es: "Atención" },
};

/** Os nomes semeados que NÃO são o do idioma pedido — só eles são trocados. */
function outrosNomes(nomes: NomePorIdioma, idioma: Idioma): string[] {
  return Object.entries(nomes)
    .filter(([codigo, nome]) => codigo !== idioma && nome !== nomes[idioma])
    .map(([, nome]) => nome);
}

export interface ResultadoDaLocalizacao {
  etapas: number;
  tipos: number;
}

/**
 * Renomeia o que foi semeado para o idioma da empresa. **Nunca lança**: a
 * empresa já existe e funciona; um nome em outro idioma é degradação que se
 * conserta pela tela, e nunca motivo para o cadastro falhar no meio.
 */
export async function localizarSemeadura(
  admin: SupabaseClient,
  organizationId: string,
  idioma: Idioma,
): Promise<ResultadoDaLocalizacao> {
  const resultado: ResultadoDaLocalizacao = { etapas: 0, tipos: 0 };
  try {
    const { data: funil, error: funilErr } = await admin
      .from("crm_pipelines")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("slug", FUNIL_SEMEADO.slug)
      .maybeSingle();
    if (funilErr) throw new Error(funilErr.message);

    if (funil?.id) {
      for (const [slug, nomes] of Object.entries(ETAPAS_SEMEADAS)) {
        const trocar = outrosNomes(nomes, idioma);
        if (trocar.length === 0) continue;
        const { data, error } = await admin
          .from("crm_stages")
          .update({ name: nomes[idioma] })
          .eq("organization_id", organizationId)
          .eq("pipeline_id", funil.id as string)
          .eq("slug", slug)
          .in("name", trocar)
          .select("id");
        if (error) throw new Error(error.message);
        resultado.etapas += Array.isArray(data) ? data.length : 0;
      }
    }

    for (const [slug, nomes] of Object.entries(TIPOS_DE_AGENDAMENTO_SEMEADOS)) {
      const trocar = outrosNomes(nomes, idioma);
      if (trocar.length === 0) continue;
      const { data, error } = await admin
        .from("calendar_event_types")
        .update({ name: nomes[idioma] })
        .eq("organization_id", organizationId)
        .eq("slug", slug)
        .in("name", trocar)
        .select("id");
      if (error) throw new Error(error.message);
      resultado.tipos += Array.isArray(data) ? data.length : 0;
    }
  } catch (err) {
    logger.warn("[onboarding] não consegui pôr a semeadura no idioma da empresa", {
      organization_id: organizationId,
      idioma,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return resultado;
}
