/**
 * Os planos que o cadastro público enxerga, e a regra de quando ele exige um.
 *
 * É o espelho, no servidor, de `fn_trial_na_criacao_da_org` (migration 0679):
 * sem plano escolhido, a empresa nasce no plano padrão; sem padrão, o gatilho
 * recusa com `plano_obrigatorio` — EXCETO quando o revendedor não tem plano
 * NENHUM (nem padrão, nem oferecido): aí a empresa nasce isenta, como antes da
 * 0679 (decisão do dono, doc 146, opção B). Os dois lados têm de usar o mesmo
 * critério: se a tela deixasse passar o que o gatilho recusa, a conta nasceria
 * no GoTrue sem organização.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { moduloLigado } from "@/lib/instalacao/modulos";

export interface PlanoDoCadastro {
  id: string;
  nome: string;
  preco_cents: number;
  intervalo: string;
  trial_dias: number;
}

export interface PlanosDoCadastro {
  padraoId: string | null;
  /**
   * Os dias de teste do plano PADRÃO (o que a empresa ganha sem escolher nada).
   * É o que o `/signup` anuncia: "14 dias grátis" lido do plano, nunca escrito
   * na tela — o revendedor muda o plano e a frase acompanha.
   */
  padraoTrialDias: number | null;
  oferecidos: PlanoDoCadastro[];
}

/** `null` quando a leitura falhou: quem decide uma AÇÃO trata como recusa. */
export async function lerPlanosDoCadastro(admin: SupabaseClient): Promise<PlanosDoCadastro | null> {
  const [oferecidos, padrao] = await Promise.all([
    admin
      .from("cobranca_planos")
      .select("id, nome, preco_cents, intervalo, trial_dias")
      .is("arquivado_em", null)
      .eq("oferecido_ao_cliente", true)
      .order("preco_cents"),
    admin
      .from("cobranca_planos")
      .select("id, trial_dias")
      .is("arquivado_em", null)
      .eq("padrao_no_cadastro", true)
      .maybeSingle(),
  ]);
  if (oferecidos.error || padrao.error) return null;
  return {
    padraoId: padrao.data?.id ?? null,
    padraoTrialDias: typeof padrao.data?.trial_dias === "number" ? padrao.data.trial_dias : null,
    oferecidos: oferecidos.data ?? [],
  };
}

/** Cadastro SEM plano escolhido é recusado? O mesmo critério do gatilho. */
export function cadastroExigeEscolhaDePlano(planos: Pick<PlanosDoCadastro, "padraoId" | "oferecidos">): boolean {
  return planos.padraoId === null && planos.oferecidos.length > 0;
}

export interface CadastroNaTela {
  oferecidos: PlanoDoCadastro[];
  padraoId: string | null;
  padraoTrialDias: number | null;
  /** O cadastro sem escolha seria recusado: o Google some e o seletor é obrigatório. */
  exigeEscolha: boolean;
}

/**
 * O que as telas de cadastro (`/signup`, `/get-started`) mostram. Cobrança
 * desligada, ou leitura que falha: nada — a tela não esconde nem exige coisa
 * alguma, e quem recusa é a action (e, por baixo dela, o gatilho).
 */
export async function lerCadastroNaTela(admin: SupabaseClient): Promise<CadastroNaTela> {
  const nada: CadastroNaTela = { oferecidos: [], padraoId: null, padraoTrialDias: null, exigeEscolha: false };
  if (!(await moduloLigado(admin, "cobranca"))) return nada;
  const lidos = await lerPlanosDoCadastro(admin);
  if (!lidos) return nada;
  return { ...lidos, exigeEscolha: cadastroExigeEscolhaDePlano(lidos) };
}

/** O plano que o seletor já traz marcado: o padrão, quando ele está entre os oferecidos. */
export function planoInicialDoSeletor(oferecidos: readonly PlanoDoCadastro[], padraoId: string | null): string | undefined {
  return oferecidos.find((p) => p.id === padraoId)?.id ?? oferecidos[0]?.id;
}
