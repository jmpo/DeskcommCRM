import { isEmailConfigured } from "@/lib/email/resend";
import { InviteTeamForm } from "./_form";

export const dynamic = "force-dynamic";

export default function InviteTeamPage() {
  const emailReady = isEmailConfigured();
  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-2xl font-semibold tracking-tight">Quem trabalha com ele</h2>
        <p className="text-sm text-muted-foreground">
          Seu funcionário não trabalha sozinho: quando ele passar uma conversa adiante, é uma dessas pessoas que atende.
        </p>
      </header>
      {!emailReady ? (
        <div className="rounded-md border border-amber-300/60 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-100">
          <p className="font-medium">Esta instalação ainda não envia e-mail.</p>
          {/*
            A frase anterior dizia que os convites ficariam "registrados
            localmente" — e isso é falso: não existe tabela de convites, o
            convite É o link assinado. Quem confiasse na frase iria procurar
            depois uma lista de pendentes que nunca existiu. E o nome da
            variável de ambiente não ajuda quem só quer chamar um colega.
          */}
          <p className="mt-1">
            Você recebe um link para cada pessoa e manda por onde quiser — WhatsApp,
            e-mail, o que preferir. O link é o convite: quem abrir entra na sua
            empresa.
          </p>
        </div>
      ) : null}
      <InviteTeamForm />
    </div>
  );
}
