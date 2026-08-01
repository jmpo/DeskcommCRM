import type { ReactNode } from "react";
import { PlatformModeBanner } from "./PlatformModeBanner";
import { AdminSidebar } from "./AdminSidebar";
import { TooltipProvider } from "@/components/ui/tooltip";

interface AdminShellProps {
  userEmail: string;
  children: ReactNode;
}

/**
 * Server component shell for /admin/*. Renders the cross-tenant banner
 * (sticky top), platform sidebar, and main content area.
 *
 * O `TooltipProvider` mora aqui, e não em cada componente, porque o Radix exige
 * um Provider ANCESTRAL de todo `Tooltip`: sem ele o componente lança
 * "`Tooltip` must be used within `TooltipProvider`" no cliente, e o React
 * derruba a árvore inteira — a tela vira a página de erro do Next, não um
 * tooltip quebrado. Derrubava /admin/inbox (TenantBadge), /admin/usage
 * (UsageCharts) e qualquer página que montasse UsageChart, num painel em que o
 * dono só vê um "Digest: <hash>" sem pista nenhuma.
 *
 * No lado /app cada uso embrulha o seu (CredentialCard, MessageBubble), por
 * isso lá nunca quebrou. Aqui, um Provider na casca cobre todas as telas de
 * uma vez e novas telas nascem funcionando — é o padrão recomendado pelo Radix
 * (Provider perto da raiz, compartilhando o delay entre os tooltips).
 */
export function AdminShell({ userEmail, children }: AdminShellProps) {
  return (
    <TooltipProvider>
      <div className="flex min-h-screen w-full flex-col bg-background">
        <PlatformModeBanner />
        <div className="flex flex-1">
          <AdminSidebar userEmail={userEmail} />
          <main className="flex-1 overflow-auto p-6">{children}</main>
        </div>
      </div>
    </TooltipProvider>
  );
}
