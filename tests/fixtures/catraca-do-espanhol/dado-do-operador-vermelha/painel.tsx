/**
 * Fixture VERMELHA do CEGO C (#603) — `t()` sobre o que o OPERADOR digitou.
 *
 * O `tipo` é parâmetro livre do componente: chega de quem chama, sem conjunto
 * fechado nenhum neste arquivo. É o desenho exato do defeito que o PR #600
 * achou vivo na `main` (`08257eed`): o operador cadastrou "Retorno", a chave
 * existia no dicionário, e a tela mostrou "Seguimiento" — dado de operador
 * traduzido como se fosse chave.
 *
 * O guardião tem de reprovar ESTE arquivo, apontando a linha da chamada
 * sobre `tipo`.
 * O `t` local é de mentira de propósito: a fixture prova o analisador, não o
 * runtime da tradução.
 */
const t = (texto: string) => texto;

export function PainelDoTipo({ tipo }: { tipo: string }) {
  return <p>{t(tipo)}</p>;
}
