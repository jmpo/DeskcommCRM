import { redirect } from "next/navigation";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { InboxLayout } from "@/components/inbox/InboxLayout";
import { traduzir } from "@/lib/i18n/dicionario";

export const dynamic = "force-dynamic";

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const user = await loadAuthUser();
  if (!user) redirect("/login");
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) {
    const idioma = user.idioma;
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {traduzir("Você não tem nenhuma organização ativa. Aceite um convite ou contate o admin.", idioma)}
      </div>
    );
  }
  const { id } = await searchParams;
  return <InboxLayout initialSelectedId={id ?? null} />;
}
