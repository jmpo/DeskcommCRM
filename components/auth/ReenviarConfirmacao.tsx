"use client";

import { useState, useTransition } from "react";

import { reenviarConfirmacao } from "@/app/actions/auth/reenviarConfirmacao";
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";

/**
 * "Não chegou? Reenviar" — o que faltava nas duas telas onde a pessoa espera o
 * e-mail de confirmação: o aviso depois do cadastro e o login de uma conta que
 * ainda não foi confirmada.
 *
 * A resposta de sucesso é a mesma para qualquer endereço (ver
 * `reenviarConfirmacao`): a tela nunca diz "esse e-mail não tem conta".
 */
export function ReenviarConfirmacao({ email }: { email: string }) {
  const t = useT();
  const [pendente, startTransition] = useTransition();
  const [recado, setRecado] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);

  const reenviar = () => {
    setRecado(null);
    startTransition(async () => {
      const res = await reenviarConfirmacao(email);
      if (res.ok) {
        setRecado({
          tipo: "ok",
          texto: t("Pronto: se este e-mail tem cadastro pendente, um novo link acabou de sair."),
        });
      } else if (res.error === "rate_limited") {
        setRecado({ tipo: "erro", texto: t("Muitas tentativas. Aguarde alguns minutos.") });
      } else if (res.error === "email_indisponivel") {
        setRecado({
          tipo: "erro",
          texto: t(
            "Não conseguimos enviar o e-mail, porque o envio de e-mails desta instalação não está configurado. Avise quem administra o sistema.",
          ),
        });
      } else {
        setRecado({ tipo: "erro", texto: t("Confira o e-mail digitado.") });
      }
    });
  };

  return (
    <div className="space-y-2 text-center" data-testid="reenviar-confirmacao">
      <p className="text-xs text-muted-foreground">
        {t("Não chegou? Procure também no spam ou em Promoções — às vezes ele cai lá.")}
      </p>
      <Button type="button" variant="outline" size="sm" disabled={pendente} onClick={reenviar}>
        {pendente ? t("Reenviando…") : t("Reenviar e-mail de confirmação")}
      </Button>
      {recado && (
        <p
          role={recado.tipo === "erro" ? "alert" : "status"}
          className={
            recado.tipo === "erro" ? "text-xs text-destructive" : "text-xs text-muted-foreground"
          }
        >
          {recado.texto}
        </p>
      )}
    </div>
  );
}
