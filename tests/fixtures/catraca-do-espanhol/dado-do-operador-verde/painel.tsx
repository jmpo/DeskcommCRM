/**
 * Fixture VERDE do CEGO C (#603) — os três desenhos que passam, e só eles.
 *
 *   1. `t("literal")` — texto escrito no código, é para isso que existe `t()`;
 *   2. `t(ROTULOS[etapa])` — conjunto fechado declarado no módulo, coberto
 *      pela catraca de chave dinâmica (passo 1 da #603);
 *   3. `tDireto`, o wrapper passa-adireto: a função declara o parâmetro e o
 *      repassa para `t()` como corpo de chamada — é a ENTRADA da tradução, e
 *      quem chama `tDireto` é coberto no ponto de chamada.
 *
 * Nenhum dos três é dado que o operador digitou, então esta fixture tem de
 * passar com zero sítios. Provar o verde sem o vermelho ao lado seria provar
 * vacuidade — o vermelho está em `../dado-do-operador-vermelha`.
 */
const t = (texto: string) => texto;

const ROTULOS = {
  naFila: "Na fila",
  emAtendimento: "Em atendimento",
} as const;

export const tDireto = (texto: string) => t(texto);

export function PainelDoOperador({ etapa }: { etapa: keyof typeof ROTULOS }) {
  return (
    <p>
      {t("Fila atualizada")} · {t(ROTULOS[etapa])} · {tDireto("sem chave nenhuma")}
    </p>
  );
}
