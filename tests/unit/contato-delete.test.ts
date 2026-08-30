import { beforeEach, describe, expect, it, vi } from "vitest";

const auditSpy = vi.fn(async () => undefined);

vi.mock("@/lib/audit", () => ({
  audit: auditSpy,
  isServiceRoleConfigured: () => false,
  hashEmail: (e: string) => e,
}));

const ORG = "c05e7a00-0000-4000-8000-000000000001";
const CONTATO = "c05e7a00-0000-4000-8000-0000000000c1";
const USUARIO = "c05e7a00-0000-4000-8000-0000000000a1";

const chamadas: Array<{ tabela: string; op: string }> = [];

function clienteFalso(opts?: { missing?: boolean; fk?: boolean }): unknown {
  return {
    from: (tabela: string) => {
      const del = {
        eq: () => del,
        select: () => del,
        maybeSingle: async () =>
          opts?.missing
            ? { data: null, error: null }
            : { data: { id: CONTATO }, error: null },
        then: (r: (v: unknown) => unknown) =>
          r({
            error: opts?.fk && tabela !== "contacts" ? { code: "23503", message: "fk" } : null,
          }),
      };
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () =>
                opts?.missing
                  ? { data: null, error: null }
                  : { data: { id: CONTATO, organization_id: ORG }, error: null },
            }),
          }),
        }),
        delete: () => {
          chamadas.push({ tabela, op: "delete" });
          return del;
        },
      };
    },
    rpc: () => ({ then: (r: (v: unknown) => unknown) => r({ error: null }) }),
  };
}

describe("deleteContactHandler", () => {
  beforeEach(() => {
    auditSpy.mockClear();
    chamadas.length = 0;
  });

  it("apaga mensagens e conversas antes do contato e audita", async () => {
    const { deleteContactHandler } = await import("@/app/api/v1/contacts/_handler");
    const out = await deleteContactHandler(
      clienteFalso() as never,
      { organization_id: ORG, actor: { type: "user", id: USUARIO }, requestId: "req-1" },
      CONTATO,
    );
    expect(out).toEqual({ id: CONTATO });
    expect(chamadas.map((c) => c.tabela)).toEqual(["messages", "conversations", "contacts"]);
    const ultima = (auditSpy.mock.calls.at(-1) as unknown as [Record<string, unknown>] | undefined)?.[0];
    expect(ultima).toMatchObject({
      action: "contact.deleted",
      resourceId: CONTATO,
      organizationId: ORG,
    });
  });

  it("404 se o contato não existe na org", async () => {
    const { deleteContactHandler } = await import("@/app/api/v1/contacts/_handler");
    await expect(
      deleteContactHandler(
        clienteFalso({ missing: true }) as never,
        { organization_id: ORG, actor: { type: "user", id: USUARIO }, requestId: "req-1" },
        CONTATO,
      ),
    ).rejects.toMatchObject({ status: 404, code: "not_found" });
    expect(auditSpy).not.toHaveBeenCalled();
  });
});
