import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { redirect } from "next/navigation";
import { fontesDoAppDaMeta } from "@/lib/channels/meta/app";
import { metaPodeReceber } from "@/lib/channels/meta/webhook";
import { nomeCurtoDaSessao } from "@/lib/channels/nome-da-sessao";
import { getWahaClient } from "@/lib/waha/client";
import { ConnectWhatsappClient } from "./_client";
import { traduzir } from "@/lib/i18n/dicionario";
import { perfilDoPais } from "@/lib/legal/perfil-do-pais";
import { umCliqueDisponivel } from "@/lib/channels/conexao-um-clique";
import { listSelectableChannels } from "@/lib/channels/selectable";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function ConnectWhatsappPage({
  searchParams,
}: {
  searchParams: Promise<{ forma?: string }>;
}) {
  const { forma } = await searchParams;
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/login");
  const idioma = user.idioma;

  const wahaConfigured = getWahaClient() !== null;

  // Receber pelo canal oficial exige DOIS segredos, não um — a regra e o porquê
  // moram em `lib/channels/meta/webhook.ts`, ao lado de quem os consome. Agora os
  // dois podem vir do BANCO (`platform_meta_app`, migration 0257) e não só do
  // `.env`: `fontesDoAppDaMeta()` devolve a fonte VENCEDORA, sem misturar as duas
  // — App Secret de um lado com verify token do outro é um app que não existe, e
  // esta tela diria que está tudo pronto.
  const oficialPodeReceber = metaPodeReceber(await fontesDoAppDaMeta());
  // We don't try to start the session at SSR — client kicks off the call
  // (and shows graceful banner if WAHA is not reachable).

  // O número oficial com um clique (a instalação tem conta no provedor): vira a
  // primeira opção, a recomendada.
  const umClique = await umCliqueDisponivel().catch(() => false);
  // "Já conectei em outro lugar" só é verdade com um número de pé. Leitura que
  // falha esconde a saída (o "Pular" continua) em vez de oferecer uma mentira.
  const temNumero = await listSelectableChannels(createAdminClient(), activeOrg.orgId)
    .then((canais) => canais.length > 0)
    .catch(() => false);

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-2xl font-semibold tracking-tight">{traduzir("Dê um telefone a ele", idioma)}</h2>
        <p className="text-sm text-muted-foreground">
          {traduzir(
            "É por este número que ele vai atender seus clientes. Se você conecta pelo celular, tenha ele por perto.",
            idioma,
          )}
        </p>
      </header>
      <p className="text-sm text-muted-foreground">
        {traduzir("Novos canais começam em modo de teste. Após concluir a configuração, abra Conexões para autorizar seus números de teste ou liberar o público.", idioma)}
      </p>
      <ConnectWhatsappClient
        wahaConfigured={wahaConfigured}
        sessionName={nomeCurtoDaSessao(activeOrg.orgId)}
        oficialPodeReceber={oficialPodeReceber}
        telefoneExemplo={perfilDoPais(activeOrg.country).telefoneExemplo}
        umClique={umClique}
        visaoDaInstalacao={user.is_platform_admin && !user.support}
        temNumero={temNumero}
        // A volta da Meta no meio do wizard (`/app/connections/volta-do-parceiro`)
        // reabre aqui, no caminho do parceiro, para a tela concluir a conexão.
        formaInicial={forma === "parceiro" ? "parceiro" : null}
      />
    </div>
  );
}
