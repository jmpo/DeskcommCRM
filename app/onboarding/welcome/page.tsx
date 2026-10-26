import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { redirect } from "next/navigation";
import { WelcomeForm } from "./_form";
import { marcaDaSaida } from "@/lib/branding/saida";
import { createClient } from "@/lib/supabase/server";
import { lerRetratoDaInstalacao } from "@/lib/instalacao/retrato";
import { BoasVindasDaConta, JaEstaPronto } from "../_components/JaEstaPronto";
import { createAdminClient } from "@/lib/supabase/admin";
import { moduloLigado } from "@/lib/instalacao/modulos";
import { formatadorDeData } from "@/lib/cobranca/fuso";
import { FUSOS_DO_ONBOARDING } from "@/lib/tempo/fusos";
import { traduzir } from "@/lib/i18n/dicionario";
import type { Idioma } from "@/lib/i18n/idiomas";

export const dynamic = "force-dynamic";

export default async function WelcomePage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/login");
  const idioma = user.idioma;

  // O nome em texto vem do resolvedor do BANCO (`marcaDaSaida`), não do
  // `branding()` — que lê só o `.env`. O banco vence; o `.env` é o piso.
  const marca = await marcaDaSaida(null);

  const supabase = await createClient();
  const retrato = await lerRetratoDaInstalacao({ supabase, orgId: activeOrg.orgId });

  // Quem administra a INSTALAÇÃO lê o retrato do servidor; quem só criou uma
  // conta (cadastro aberto) lê os dias de teste.
  const daInstalacao = user.is_platform_admin && !user.support;
  const teste = daInstalacao ? null : await testeDaConta(activeOrg.orgId, idioma, activeOrg.timezone ?? null);

  // O fuso que o formulário já traz marcado: o da empresa (que nasce com o do
  // navegador no cadastro), quando ele está entre as opções.
  const fusoInicial = FUSOS_DO_ONBOARDING.some((f) => f.id === activeOrg.timezone)
    ? (activeOrg.timezone as string)
    : null;

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-2xl font-semibold tracking-tight">
          {traduzir("Boas-vindas ao", idioma)} {marca.nome}
        </h2>
        <p className="text-sm text-muted-foreground">
          {traduzir("Vamos montar quem vai atender seus clientes — e onde ele vai trabalhar.", idioma)}
        </p>
      </header>

      {daInstalacao ? (
        <JaEstaPronto retrato={retrato} idioma={idioma} />
      ) : (
        <BoasVindasDaConta testeAte={teste?.ate ?? null} diasRestantes={teste?.dias ?? null} idioma={idioma} />
      )}

      {/*
        O instalador NUNCA pergunta o nome do negócio: toda organização nasce
        "Minha Empresa", hardcoded. Mandar esse texto como valor inicial fazia a
        pessoa ter de apagá-lo antes de escrever o nome dela — e quem não
        percebia seguia com o placeholder no cabeçalho do sistema para sempre.
      */}
      <WelcomeForm
        defaultOrgName={retrato.empresa.aindaSemNomeProprio ? "" : activeOrg.name}
        orgId={activeOrg.orgId}
        fusoInicial={fusoInicial}
      />
    </div>
  );
}

/**
 * Os dias de teste da empresa (`cobranca_assinaturas.trial_ate`), com a data no
 * fuso dela. Fora do componente porque lê o relógio. Falha de leitura → `null`
 * (o cartão sai sem data, nunca a tela quebrada).
 */
async function testeDaConta(
  orgId: string,
  idioma: Idioma,
  fuso: string | null,
): Promise<{ ate: string; dias: number } | null> {
  try {
    const admin = createAdminClient();
    if (!(await moduloLigado(admin, "cobranca"))) return null;
    const { data } = await admin
      .from("cobranca_assinaturas")
      .select("estado, trial_ate")
      .eq("organization_id", orgId)
      .maybeSingle();
    const ate = (data as { estado?: string; trial_ate?: string | null } | null)?.trial_ate ?? null;
    if (data?.estado !== "trial" || !ate) return null;
    return {
      ate: formatadorDeData(idioma, fuso, { day: "numeric", month: "long" }).format(new Date(ate)),
      dias: Math.max(0, Math.ceil((Date.parse(ate) - Date.now()) / 86_400_000)),
    };
  } catch {
    return null;
  }
}
