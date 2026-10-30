import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * O LEMBRETE POR MODELO APROVADO — quando a janela de 24 h do cliente fechou.
 *
 * O lembrete da agenda sai como texto livre. Num número que só manda texto livre
 * a quem escreveu nas últimas 24 h (o oficial da Meta, direto ou pelo parceiro),
 * a reserva feita dias antes cai fora da janela, e o cron PULA o lembrete (#2595)
 * — o cliente não é avisado. Com `calendar_event_types.reminder_meta_template_id`,
 * o lembrete sai pelo modelo aprovado DAQUELE número.
 *
 * As variáveis do modelo são posicionais (`{{1}}`, `{{2}}`…) e recebem, nesta
 * ordem: o primeiro nome do contato, o dia e a hora, o título do compromisso e
 * o endereço. Um modelo com mais variáveis do que isso, ou com um buraco na
 * numeração, não é usado: a Meta recusaria o envio de qualquer jeito.
 */
export const ORDEM_DAS_VARIAVEIS_DO_LEMBRETE = ["primeiro_nome", "quando", "titulo", "endereco"] as const;

export interface ModeloDoLembrete {
  id: string;
  name: string;
  language: string;
  /** O texto do corpo aprovado, com os `{{n}}`. */
  corpo: string;
}

/** O texto do BODY nos `components` espelhados da Meta (`meta_templates.components`). */
export function corpoDoModelo(components: unknown): string | null {
  if (!Array.isArray(components)) return null;
  const body = components.find(
    (c) => c && typeof c === "object" && String((c as { type?: unknown }).type).toUpperCase() === "BODY",
  ) as { text?: unknown } | undefined;
  return typeof body?.text === "string" && body.text.trim() ? body.text : null;
}

/**
 * Os valores do modelo e o texto como ele chega ao cliente (é o que fica na
 * conversa para quem atende e para o agente). `null` quando o modelo não serve:
 * numeração com buraco, mais variáveis do que a ordem cobre, ou uma peça vazia
 * (a Meta recusa parâmetro vazio). O primeiro nome vazio já vem com o substituto.
 */
export function valoresDoModeloDoLembrete(
  corpo: string,
  pecas: Record<string, string>,
): { valores: Record<string, string>; texto: string } | null {
  const numeros = [...new Set([...corpo.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => Number(m[1])))].sort(
    (a, b) => a - b,
  );
  if (numeros.length > ORDEM_DAS_VARIAVEIS_DO_LEMBRETE.length) return null;
  if (numeros.some((n, i) => n !== i + 1)) return null;
  const valores: Record<string, string> = {};
  for (const n of numeros) {
    const valor = (pecas[ORDEM_DAS_VARIAVEIS_DO_LEMBRETE[n - 1]!] ?? "").trim();
    if (!valor) return null;
    valores[String(n)] = valor;
  }
  const texto = corpo.replace(/\{\{\s*(\d+)\s*\}\}/g, (literal, n: string) => valores[n] ?? literal);
  return { valores, texto };
}

/**
 * O modelo configurado no tipo, só se for DESTA organização, DESTE número e
 * aprovado. Qualquer outra coisa é `null`: um modelo de outro número sairia pelo
 * número errado, e um não aprovado a Meta recusa.
 */
export async function lerModeloDoLembrete(
  admin: SupabaseClient,
  org: string,
  modeloId: string,
  canalId: string,
): Promise<ModeloDoLembrete | null> {
  const { data, error } = await admin
    .from("meta_templates")
    .select("id, name, language, status, channel_session_id, components")
    .eq("organization_id", org)
    .eq("id", modeloId)
    .maybeSingle();
  if (error || !data) return null;
  const linha = data as {
    id: string;
    name: string;
    language: string;
    status: string;
    channel_session_id: string | null;
    components: unknown;
  };
  if (linha.status !== "APPROVED" || linha.channel_session_id !== canalId) return null;
  const corpo = corpoDoModelo(linha.components);
  return corpo ? { id: linha.id, name: linha.name, language: linha.language, corpo } : null;
}
