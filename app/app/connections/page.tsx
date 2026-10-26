import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { ConexoesShell } from "@/components/connections/ConexoesShell";
import { canalGraphParceiroLigado, GRAPH_PARTNER_LABEL } from "@/lib/channels/graph-parceiro/credentials";
import { traduzir } from "@/lib/i18n/dicionario";
import { umCliqueDisponivel } from "@/lib/channels/conexao-um-clique";
import { listSelectableChannels } from "@/lib/channels/selectable";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Conexões" };

export default async function ConnectionsPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  if (!(user.is_platform_admin && !user.support) && ROLE_RANK[activeOrg.role] < ROLE_RANK.admin) {
    redirect("/403");
  }
  const idioma = user.idioma;

  const key = process.env.WAHA_API_KEY;
  const wahaConfigured = Boolean(
    process.env.WAHA_API_BASE_URL && key && key !== "dev_plaintext_change_me",
  );
  const wacallsConfigured = Boolean(process.env.WACALLS_API_BASE_URL);

  // Sem número e com o oficial por um clique disponível, a tela abre nele: é o
  // caminho recomendado, e a aba do QR escondia que ele existia. Leitura que
  // falha mantém o padrão de sempre.
  const [umClique, temNumero] = await Promise.all([
    umCliqueDisponivel().catch(() => false),
    listSelectableChannels(createAdminClient(), activeOrg.orgId)
      .then((canais) => canais.length > 0)
      .catch(() => true),
  ]);

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{traduzir("Conexões", idioma)}</h1>
        <p className="text-sm text-muted-foreground">
          {traduzir(
            "Por onde seu negócio fala com o cliente. Conecte números por QR ou o número oficial da Meta, e acompanhe a saúde de cada um.",
            idioma,
          )}
        </p>
      </header>
      <ConexoesShell
        wahaConfigured={wahaConfigured}
        wacallsConfigured={wacallsConfigured}
        graphParceiro={canalGraphParceiroLigado() ? { label: GRAPH_PARTNER_LABEL } : null}
        abaInicial={umClique && !temNumero ? "parceiro" : "numeros"}
      />
    </div>
  );
}
