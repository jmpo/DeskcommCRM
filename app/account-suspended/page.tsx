import Link from "next/link";
import { emailDeSuporte } from "@/lib/branding/saida";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export const metadata = {
  title: "Conta suspensa",
};

/**
 * Esta tela entregava o NOSSO endereço de suporte ao cliente de um revendedor —
 * e aqui isso é ativamente errado: quem suspendeu a conta foi o revendedor, e
 * escrever para nós não desbloqueia nada. O endereço agora sai de
 * `SUPPORT_EMAIL` (o do operador) e, quando ninguém configurou, o parágrafo do
 * contato simplesmente NÃO renderiza. Cair de volta num endereço do produto
 * seria o defeito de volta, com o agravante de parecer resolvido.
 */
export default function AccountSuspendedPage() {
  const suporte = emailDeSuporte();
  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <Card className="w-full max-w-md p-8 text-center space-y-4">
        <h1 className="text-2xl font-semibold">Conta suspensa</h1>
        {suporte ? (
          <p className="text-sm text-muted-foreground">
            Sua conta está suspensa. Entre em contato com{" "}
            <a
              href={`mailto:${suporte}`}
              className="underline underline-offset-4 hover:text-foreground transition-colors"
            >
              {suporte}
            </a>{" "}
            para mais informações.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Sua conta está suspensa. Fale com quem administra este sistema para
            saber o motivo e como reativá-la.
          </p>
        )}
        <div className="pt-2">
          <Button asChild variant="outline">
            <Link href="/login">Sair</Link>
          </Button>
        </div>
      </Card>
    </main>
  );
}
