"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { conditionConfigSchema, nodeBranches } from "@/lib/followup/graph-schema";
import {
  CAMPOS_DA_CONDICAO,
  COMBINADORES,
  comparador,
  comparadoresDoCampo,
  fraseDaCondicao,
  opcoes,
  type CampoDaCondicao,
  type Combinador,
  type OperadorDaCondicao,
} from "@/lib/followup/vocabulario";
import { Plus, Trash } from "@/lib/ui/icons";

import type { ConfigOf } from "./shared";

/**
 * Trocar de campo pode deixar o operador órfão: `gte` faz sentido em "passos
 * dados" e nunca é verdadeiro em "etiqueta". Em vez de manter na tela uma
 * escolha que o motor ignora, cai no primeiro operador que o campo novo
 * oferece.
 */
function operadorValidoPara(campo: CampoDaCondicao, atual: OperadorDaCondicao): OperadorDaCondicao {
  if (comparador(campo, atual).oferecido) return atual;
  return comparadoresDoCampo(campo)[0]!.op;
}

type ConditionConfig = ConfigOf<"condition">;
type Check = ConditionConfig["checks"][number];
type Branching = NonNullable<ConditionConfig["branching"]>;

/** Id novo que não colide com os já usados. Opaco de propósito: é a identidade
 *  da saída, e ela não pode mudar quando o usuário reescreve o rótulo. */
function novoIdDeRegra(usados: ReadonlySet<string>): string {
  for (let n = 1; ; n++) {
    const candidato = `regra-${n}`;
    if (!usados.has(candidato)) return candidato;
  }
}

/** No modo "uma saída por regra" toda regra precisa de id — é o que a aresta referencia. */
function comIdsEstaveis(checks: Check[]): Check[] {
  const usados = new Set(checks.flatMap((c) => (c.id === undefined ? [] : [c.id])));
  return checks.map((c) => {
    if (c.id !== undefined) return c;
    const id = novoIdDeRegra(usados);
    usados.add(id);
    return { ...c, id };
  });
}

export function ConditionForm({
  config,
  onChange,
  ramosLigados = [],
}: {
  config: ConditionConfig;
  onChange: (c: ConditionConfig) => void;
  /** Ramos deste nó que hoje têm aresta — para avisar antes de deixar alguma órfã. */
  ramosLigados?: string[];
}) {
  const [combinator, setCombinator] = useState(config.combinator);
  const [branching, setBranching] = useState<Branching>(config.branching ?? "combined");
  const [checks, setChecks] = useState(config.checks);
  const [error, setError] = useState<string | null>(null);
  /** Troca de modo pendente de confirmação, com quantas ligações ela deixa órfãs. */
  const [trocaPendente, setTrocaPendente] = useState<{ modo: Branching; orfas: number } | null>(null);

  /**
   * Recebe um OBJETO com o que mudou, e não a lista posicional de campos: era
   * justamente por remontar a config com `{ combinator, checks }` e mais nada
   * que qualquer campo novo morria na primeira edição do nó — o modo se apagava
   * sozinho e as bolinhas sumiam. Campo novo aqui entra como chave, não como
   * mais um parâmetro que alguém esquece de repassar.
   */
  const commit = (next: {
    combinator?: Combinador;
    branching?: Branching;
    checks?: Check[];
  }) => {
    const modo = next.branching ?? branching;
    const candidato: ConditionConfig = {
      combinator: next.combinator ?? combinator,
      // Só é escrito no modo novo: mexer num nó de fluxo antigo não passa a
      // gravar uma chave que ele nunca teve.
      ...(modo === "per_check" ? { branching: modo } : {}),
      checks: next.checks ?? checks,
    };
    const parsed = conditionConfigSchema.safeParse(candidato);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Configuração inválida.");
      return;
    }
    setError(null);
    onChange(parsed.data);
  };

  /** Quantas ligações existentes deixam de ter saída se o nó passar a `modo`. */
  const orfasSe = (modo: Branching): number => {
    const checksDoModo = modo === "per_check" ? comIdsEstaveis(checks) : checks;
    const idsDepois = new Set(
      nodeBranches({ type: "condition", config: { combinator, branching: modo, checks: checksDoModo } }).map(
        (b) => b.id,
      ),
    );
    return ramosLigados.filter((id) => !idsDepois.has(id)).length;
  };

  const aplicarModo = (modo: Branching) => {
    const proximosChecks = modo === "per_check" ? comIdsEstaveis(checks) : checks;
    setBranching(modo);
    setChecks(proximosChecks);
    setTrocaPendente(null);
    commit({ branching: modo, checks: proximosChecks });
  };

  const pedirModo = (modo: Branching) => {
    if (modo === branching) return;
    const orfas = orfasSe(modo);
    if (orfas > 0) {
      setTrocaPendente({ modo, orfas });
      return;
    }
    aplicarModo(modo);
  };

  const porRegra = branching === "per_check";

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="cond-branching">Como as regras decidem o caminho</Label>
        <Select value={branching} onValueChange={(v) => pedirModo(v as Branching)}>
          <SelectTrigger id="cond-branching">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="combined">Avaliar as regras juntas (uma saída de sim e uma de não)</SelectItem>
            <SelectItem value="per_check">Uma saída por regra</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {trocaPendente && (
        <div className="space-y-2 rounded-sm border border-warning bg-warning-bg p-2" data-testid="cond-troca-aviso">
          <p className="text-xs leading-snug text-warning-fg">
            Trocar de modo deixa {trocaPendente.orfas}{" "}
            {trocaPendente.orfas === 1 ? "ligação sem saída" : "ligações sem saída"} neste nó. Elas continuam
            desenhadas, mas param de levar a lugar nenhum até você religá-las.
          </p>
          <div className="flex gap-2">
            <Button type="button" size="sm" onClick={() => aplicarModo(trocaPendente.modo)}>
              Trocar mesmo assim
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setTrocaPendente(null)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {/* O combinador só aparece no modo em que ele decide alguma coisa. No modo
          uma-saída-por-regra a regra não vota, ela roteia — e o motor nem lê
          este campo. Mostrar um controle que não tem efeito é o mesmo defeito
          que o subtítulo do card tinha. O texto é o do vocabulário, não meu. */}
      {!porRegra && (
        <div className="space-y-2">
          <Label htmlFor="cond-combinator">Seguir por aqui quando</Label>
          <Select
            value={combinator}
            onValueChange={(v) => {
              const next = v as Combinador;
              setCombinator(next);
              commit({ combinator: next });
            }}
          >
            <SelectTrigger id="cond-combinator">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {opcoes(COMBINADORES).map(({ valor, rotulo }) => (
                <SelectItem key={valor} value={valor}>
                  {rotulo}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="space-y-3">
        {checks.map((check, idx) => (
          <div key={check.id ?? idx} className="space-y-2 rounded-sm border border-border p-2" data-testid={`condition-check-${idx}`}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-text-muted">Condição {idx + 1}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Remover condição"
                disabled={checks.length <= 1}
                onClick={() => {
                  const next = checks.filter((_, i) => i !== idx);
                  setChecks(next);
                  commit({ checks: next });
                }}
              >
                <Trash size={14} aria-hidden />
              </Button>
            </div>
            {porRegra && (
              <Input
                aria-label={`Nome da saída ${idx + 1}`}
                placeholder="Nome desta saída (opcional)"
                value={check.label ?? ""}
                onChange={(e) => {
                  const texto = e.target.value;
                  const next = checks.map((c, i) =>
                    // Sem texto o campo SOME da regra em vez de virar string vazia:
                    // o schema pede 1 a 60, e um rótulo vazio reprovaria a config
                    // inteira só porque o usuário apagou o que tinha escrito.
                    i === idx ? { ...c, ...(texto === "" ? { label: undefined } : { label: texto }) } : c,
                  );
                  setChecks(next);
                  commit({ checks: next });
                }}
              />
            )}
            <Select
              value={check.field}
              onValueChange={(v) => {
                const campo = v as CampoDaCondicao;
                const next = checks.map((c, i) =>
                  i === idx ? { ...c, field: campo, op: operadorValidoPara(campo, c.op) } : c,
                );
                setChecks(next);
                commit({ checks: next });
              }}
            >
              <SelectTrigger aria-label="Campo">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(CAMPOS_DA_CONDICAO) as CampoDaCondicao[]).map((f) => (
                  <SelectItem key={f} value={f}>
                    {CAMPOS_DA_CONDICAO[f].rotulo}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={check.op}
              onValueChange={(v) => {
                const next = checks.map((c, i) => (i === idx ? { ...c, op: v as OperadorDaCondicao } : c));
                setChecks(next);
                commit({ checks: next });
              }}
            >
              <SelectTrigger aria-label="Operador">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {comparadoresDoCampo(check.field).map(({ op, rotulo }) => (
                  <SelectItem key={op} value={op}>
                    {rotulo}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              aria-label="Valor"
              placeholder={CAMPOS_DA_CONDICAO[check.field].tipoDeValor === "numero" ? "Ex.: 3" : "Valor"}
              value={String(check.value)}
              onChange={(e) => {
                const next = checks.map((c, i) => (i === idx ? { ...c, value: e.target.value } : c));
                setChecks(next);
                commit({ checks: next });
              }}
            />
            {/* A frase inteira, para quem não tem certeza do que os três campos
                acima somam — e o aviso quando o motor nunca satisfaz o par. */}
            <p className="text-xs text-text-muted">{fraseDaCondicao(check.field, check.op, check.value)}</p>
            {comparador(check.field, check.op).aviso && (
              <p className="text-xs text-warning-fg">{comparador(check.field, check.op).aviso}</p>
            )}
          </div>
        ))}
      </div>

      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={checks.length >= 10}
        onClick={() => {
          const nova: Check = { field: "steps_taken", op: "gte", value: 0 };
          const next = porRegra
            ? comIdsEstaveis([...checks, nova])
            : [...checks, nova];
          setChecks(next);
          commit({ checks: next });
        }}
      >
        <Plus size={14} aria-hidden className="mr-1" /> Condição
      </Button>
      {error && <p className="text-xs text-error-fg">{error}</p>}
    </div>
  );
}
