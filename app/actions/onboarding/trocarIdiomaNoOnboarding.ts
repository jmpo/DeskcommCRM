"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import { audit } from "@/lib/audit";
import { ipDoCliente } from "@/lib/http/ip-do-cliente";
import { IDIOMAS, type Idioma } from "@/lib/i18n/idiomas";
import { localizarSemeadura } from "@/lib/onboarding/semeadura-no-idioma";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireOnboardingCtx, OnboardingError } from "./_shared";

/**
 * O seletor de idioma DO WIZARD — e por que ele não é o do topo do `/app`.
 *
 * O seletor do topo grava só a preferência da pessoa (`trocarIdioma`), e de
 * propósito: lá a empresa já existe e tem colegas. No wizard, quem está montando
 * a empresa é quem a criou, e o idioma escolhido aqui é o idioma DELA — é com
 * ele que o funil semeado, o prompt do agente e as palavras de passagem são
 * escritos nos passos seguintes. Trocar só a pessoa deixaria a tela em espanhol
 * e o agente nascendo em português (o defeito do QA de 26/10/2026, por outra
 * porta).
 *
 * Por isso, aqui: a preferência da pessoa (como o seletor do topo) E, enquanto a
 * empresa não terminou o onboarding e quem troca é admin dela, o idioma da
 * empresa e os nomes semeados. Depois do onboarding, o idioma da empresa volta a
 * ter dono — Configurações › Empresa.
 */
export async function trocarIdiomaNoOnboarding(
  idioma: Idioma,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(IDIOMAS as readonly string[]).includes(idioma))
    return { ok: false, error: "idioma_desconhecido" };

  let ctx;
  try {
    ctx = await requireOnboardingCtx();
  } catch (err) {
    if (err instanceof OnboardingError) return { ok: false, error: err.code };
    throw err;
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ data: { locale: idioma } });
  if (error) return { ok: false, error: error.message };

  const hdrs = await headers();
  const trilha = {
    requestId: hdrs.get("x-request-id"),
    ip: ipDoCliente(hdrs),
    userAgent: hdrs.get("user-agent") ?? null,
  };
  await audit({
    action: "profile.updated",
    actorUserId: ctx.userId,
    organizationId: ctx.orgId,
    resourceType: "user",
    resourceId: ctx.userId,
    ...trilha,
    metadata: { locale: idioma, origem: "seletor_do_onboarding" },
  });

  if (ctx.role === "admin") {
    const admin = createAdminClient();
    // Só a empresa que ainda está no wizard: a escrita casa zero linhas numa
    // empresa que já terminou, e aí o idioma dela continua o de Configurações.
    const { data } = await admin
      .from("organizations")
      .update({ locale: idioma })
      .eq("id", ctx.orgId)
      .is("onboarded_at", null)
      .select("id");
    if (Array.isArray(data) && data.length > 0) {
      await localizarSemeadura(admin, ctx.orgId, idioma);
      await audit({
        action: "org.updated",
        actorUserId: ctx.userId,
        organizationId: ctx.orgId,
        resourceType: "organization",
        resourceId: ctx.orgId,
        ...trilha,
        metadata: { locale: idioma, origem: "seletor_do_onboarding" },
      });
    }
  }

  revalidatePath("/onboarding", "layout");
  return { ok: true };
}
