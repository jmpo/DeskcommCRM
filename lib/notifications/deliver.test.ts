import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({ toast: vi.fn() }));
vi.mock("./emit", () => ({ emitNotification: vi.fn() }));

import { toast } from "sonner";
import { entregarAviso } from "./deliver";
import { emitNotification } from "./emit";
import { gravarCanal } from "./prefs";

describe("entregarAviso", () => {
  afterEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it("manda toast e push quando os dois canais estão ligados", () => {
    entregarAviso({
      category: "lead_assigned",
      kind: "lead_assigned",
      title: "Lead atribuído",
      body: "Carlos",
    });
    expect(toast).toHaveBeenCalledTimes(1);
    expect(emitNotification).toHaveBeenCalledTimes(1);
  });

  it("omite push quando o canal está desligado", () => {
    gravarCanal("lead_won", "push", false);
    entregarAviso({
      category: "lead_won",
      kind: "lead_won",
      title: "Lead ganho",
      body: "ok",
    });
    expect(toast).toHaveBeenCalledTimes(1);
    expect(emitNotification).not.toHaveBeenCalled();
  });
});
