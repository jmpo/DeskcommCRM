import type { RetratoDaInstalacao } from "@/lib/instalacao/retrato";
import type { Idioma } from "@/lib/i18n/idiomas";
import { traduzir } from "@/lib/i18n/dicionario";

/**
 * A primeira coisa que a pessoa lê no wizard: o que ela JÁ tem.
 *
 * Quem chega aqui acabou de instalar o sistema num servidor — escolheu a
 * inteligência artificial, colou a chave, subiu o WhatsApp — e era recebido por
 * um formulário em branco, como se tivesse acabado de chegar. Começar pelo que
 * já está pronto muda a pergunta de "quanto trabalho me espera?" para "o que
 * falta?".
 *
 * Cada linha é MEDIDA, nunca presumida. É o oposto do aviso que o painel de
 * provedores dá hoje ("tudo usa a chave que veio na instalação"), disparado sem
 * verificar se existe chave — a frase que tranquiliza enquanto o funcionário
 * está mudo.
 */
export function JaEstaPronto({
  retrato,
  idioma,
}: {
  retrato: RetratoDaInstalacao;
  idioma: Idioma;
}) {
  const t = (texto: string) => traduzir(texto, idioma);
  const itens: { pronto: boolean; texto: string }[] = [
    {
      pronto: true,
      texto: t("Servidor no ar e banco de dados instalado"),
    },
    {
      // Três estados, não dois: cadastrada-e-confirmada, cadastrada-e-sendo-
      // conferida, e nenhuma. A do meio existe porque a validação roda em
      // segundo plano — e dizer "falta a chave" a quem acabou de colá-la é a
      // frase que manda a pessoa cadastrar de novo o que já está lá.
      pronto: retrato.inteligencia.origemDaChave !== "nenhuma",
      texto:
        retrato.inteligencia.origemDaChave !== "nenhuma"
          ? `${t("Inteligência contratada:")} ${retrato.inteligencia.rotulo}`
          : retrato.inteligencia.chaveEmVerificacao
            ? t("Chave cadastrada — conferindo com a empresa de IA")
            : t("Falta a chave da inteligência artificial"),
    },
    {
      pronto: retrato.whatsapp.transporteApontado,
      texto: retrato.whatsapp.transporteApontado
        ? t("WhatsApp pronto para conectar seu número")
        : t("O WhatsApp desta instalação ainda não subiu"),
    },
    {
      pronto: Boolean(retrato.funil),
      texto: retrato.funil
        ? `${t("Funil de vendas criado:")} ${retrato.funil.nome}`
        : t("Nenhum funil de vendas ainda"),
    },
  ];

  const faltando = itens.filter((i) => !i.pronto).length;

  return (
    <section
      aria-labelledby="ja-pronto"
      className="rounded-lg border bg-background p-5"
    >
      <h3 id="ja-pronto" className="text-sm font-medium">
        {t("Você já instalou o sistema. Isto aqui já está de pé:")}
      </h3>
      <ul className="mt-3 space-y-1.5 text-sm">
        {itens.map((it) => (
          <li key={it.texto} className="flex items-start gap-2">
            <span
              aria-hidden
              className={
                "mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full " +
                (it.pronto ? "bg-emerald-500" : "bg-amber-500")
              }
            />
            <span className={it.pronto ? "" : "text-muted-foreground"}>{it.texto}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted-foreground">
        {faltando === 0
          ? t("Agora é montar quem vai atender por você.")
          : t("O que falta a gente resolve nos próximos passos.")}
      </p>
    </section>
  );
}

/**
 * A primeira coisa que lê quem CRIOU A CONTA pelo cadastro aberto — não quem
 * instalou o servidor.
 *
 * O cartão de cima ("Você já instalou o sistema. Servidor no ar e banco de
 * dados instalado…") é verdade para o dono da instalação e não diz nada ao
 * cliente do revendedor, que só criou uma conta (QA de 26/10/2026). Para ele o
 * que importa é o que vale agora: os dias de teste, até quando, e o que vem a
 * seguir. Os dias saem da assinatura (`cobranca_assinaturas.trial_ate`),
 * nunca de um número escrito aqui.
 */
export function BoasVindasDaConta({
  testeAte,
  diasRestantes,
  idioma,
}: {
  /** A data do fim do teste já formatada no fuso da empresa, ou `null` sem teste. */
  testeAte: string | null;
  diasRestantes: number | null;
  idioma: Idioma;
}) {
  const t = (texto: string) => traduzir(texto, idioma);
  return (
    <section aria-labelledby="boas-vindas-da-conta" className="rounded-lg border bg-background p-5" data-testid="boas-vindas-da-conta">
      <h3 id="boas-vindas-da-conta" className="text-sm font-medium">
        {testeAte && diasRestantes !== null
          ? t("Você tem {dias} dias grátis, até {data}.")
              .replace("{dias}", String(diasRestantes))
              .replace("{data}", testeAte)
          : t("Sua conta está criada.")}
      </h3>
      <p className="mt-2 text-sm text-muted-foreground">
        {t(
          "Em poucos passos: o nome do seu negócio, o WhatsApp por onde ele atende, como ele fala e onde organiza os clientes. Dá para pular e voltar depois.",
        )}
      </p>
    </section>
  );
}
