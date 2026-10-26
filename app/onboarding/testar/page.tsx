import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { TestarClient } from "./_client";
import { traduzir } from "@/lib/i18n/dicionario";

export const dynamic = "force-dynamic";

/**
 * "Ver ele atender" — o passo que faltava no fim do wizard.
 *
 * O onboarding terminava com um botão "Ir para o Inbox" que entregava a pessoa
 * numa caixa vazia dizendo "Sem conversas por aqui". Ela tinha acabado de montar
 * um funcionário e nunca o vira fazer nada. Se algo estivesse errado — chave sem
 * saldo, modelo que não responde — ela só descobriria quando um cliente de
 * verdade escrevesse.
 *
 * Aqui o ensaio roda o runtime real com `is_dry_run=true`: nada é enviado pelo
 * WhatsApp, nenhuma conversa é criada, nenhum contato é tocado.
 */
export default async function TestarPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/login");
  const idioma = user.idioma;

  const admin = createAdminClient();
  const { data: agente } = await admin
    .from("ai_agents")
    .select("id, name, published_version_id")
    .eq("organization_id", activeOrg.orgId)
    .eq("is_default", true)
    .maybeSingle();

  // Sem versão publicada (a pessoa pulou o telefone), o ensaio roda sobre o
  // RASCUNHO que o passo "Treinar" criou: é o mesmo prompt, modelo e chave, e o
  // ensaio não envia nada a ninguém. Antes a tela dizia "rascunho não responde,
  // não há o que ensaiar" — e quem pulou o telefone nunca via o agente falar.
  const publicada = (agente?.published_version_id as string | null | undefined) ?? null;
  let rascunho: string | null = null;
  if (agente?.id && !publicada) {
    const { data: versao } = await admin
      .from("ai_agent_versions")
      .select("id")
      .eq("organization_id", activeOrg.orgId)
      .eq("agent_id", agente.id as string)
      .eq("status", "draft")
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    rascunho = (versao?.id as string | undefined) ?? null;
  }

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-2xl font-semibold tracking-tight">{traduzir("Veja ele atender", idioma)}</h2>
        <p className="text-sm text-muted-foreground">
          {traduzir(
            "Escreva como se fosse um cliente. Nada é enviado pelo WhatsApp — é só um ensaio, entre você e ele.",
            idioma,
          )}
        </p>
      </header>
      <TestarClient
        nome={(agente?.name as string | undefined) ?? null}
        agenteId={(agente?.id as string | undefined) ?? null}
        versaoId={publicada ?? rascunho}
        publicada={publicada !== null}
      />
    </div>
  );
}
