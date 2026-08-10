"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";

import { refreshCredentialsView } from "../_actions";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import {
  credentialsListQueryKey,
  type CredentialRow,
  type Provider,
} from "@/hooks/ai/useCredentials";
import { IDS_DE_PROVEDOR, PROVEDORES } from "@/lib/ai/pontos/provedores";

const formSchema = z.object({
  // Derivado da lista única (`lib/ai/pontos/provedores.ts`), como a rota.
  provider: z.enum(IDS_DE_PROVEDOR),
  label: z.string().trim().min(1, "Obrigatório").max(80),
  api_key: z.string().trim().min(8, "API key muito curta").max(2048),
});

type FormValues = z.infer<typeof formSchema>;

interface CreateResponse {
  data: CredentialRow;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddCredentialDialog({ open, onOpenChange }: Props) {
  const router = useRouter();
  const qc = useQueryClient();
  const [provider, setProvider] = useState<Provider>("anthropic");
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof FormValues, string>>>({});

  const reset = () => {
    setProvider("anthropic");
    setLabel("");
    setApiKey("");
    setErrors({});
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    const parsed = formSchema.safeParse({ provider, label, api_key: apiKey });
    if (!parsed.success) {
      const flat = parsed.error.flatten().fieldErrors;
      setErrors({
        provider: flat.provider?.[0],
        label: flat.label?.[0],
        api_key: flat.api_key?.[0],
      });
      return;
    }

    setSubmitting(true);
    const validatingToast = toast.loading("Credencial salva. Validando…");
    try {
      const res = await apiClient.post<CreateResponse>(
        "/api/v1/ai/credentials",
        parsed.data,
      );
      toast.dismiss(validatingToast);
      toast.success("Credencial salva. Validação em segundo plano.");
      reset();
      onOpenChange(false);

      // Poll uma vez após ~3s para refletir validated_at no card.
      setTimeout(async () => {
        await qc.invalidateQueries({ queryKey: credentialsListQueryKey });
        const fresh = qc.getQueryData<CredentialRow[]>(credentialsListQueryKey);
        const justCreated = fresh?.find((c) => c.id === res.data.id);
        if (justCreated?.models_available != null) {
          toast.success(
            `Validada — ${justCreated.models_available} modelos disponíveis.`,
          );
        } else if (justCreated?.validation_error) {
          toast.error(`Validação falhou: ${justCreated.validation_error}`);
        }
      }, 3000);

      await qc.invalidateQueries({ queryKey: credentialsListQueryKey });
      await refreshCredentialsView();
      router.refresh();
    } catch (err) {
      toast.dismiss(validatingToast);
      showApiError(err);
    } finally {
      setSubmitting(false);
    }
  };

  const onOpenChangeWrapped = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChangeWrapped}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adicionar credencial</DialogTitle>
          <DialogDescription>
            A chave é cifrada (AES-GCM) antes de gravar e nunca é retornada em
            texto claro.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cred-provider">Provider</Label>
            <Select value={provider} onValueChange={(v) => setProvider(v as Provider)}>
              <SelectTrigger id="cred-provider">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROVEDORES.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.rotulo}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.provider && (
              <p className="text-xs text-destructive">{errors.provider}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="cred-label">Label</Label>
            <Input
              id="cred-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Ex: Produção"
              maxLength={80}
              required
            />
            {errors.label && <p className="text-xs text-destructive">{errors.label}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="cred-key">API key</Label>
            <Input
              id="cred-key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
              autoComplete="off"
              required
            />
            {errors.api_key && (
              <p className="text-xs text-destructive">{errors.api_key}</p>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChangeWrapped(false)}
              disabled={submitting}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Salvando…" : "Salvar e validar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
