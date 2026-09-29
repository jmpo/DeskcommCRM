import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LoginForm } from "./LoginForm";
import { SignupForm } from "./SignupForm";

vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (value: string) => value }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@/app/actions/auth/signInWithPassword", () => ({ signInWithPassword: vi.fn() }));
vi.mock("@/app/actions/auth/signUp", () => ({ signUp: vi.fn() }));

describe("visibilidade de senha no acesso", () => {
  it("mostra e oculta a senha no login sem alterar o preenchimento", () => {
    render(<LoginForm />);
    const password = screen.getByLabelText("Senha");
    fireEvent.change(password, { target: { value: "Senha123!" } });
    expect(password).toHaveAttribute("type", "password");

    fireEvent.click(screen.getByRole("button", { name: "Mostrar senha" }));
    expect(password).toHaveAttribute("type", "text");
    expect(password).toHaveValue("Senha123!");
    expect(screen.getByRole("button", { name: "Ocultar senha" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: "Ocultar senha" }));
    expect(password).toHaveAttribute("type", "password");
  });

  // As specs e2e entram com getByLabel(/senha/i); nome do botão em aria-label o faria casar junto do campo.
  it("o botão não entra na busca por rótulo de senha", () => {
    render(<LoginForm />);
    expect(screen.getAllByLabelText(/senha/i)).toEqual([screen.getByLabelText("Senha")]);
  });

  it.each(["cadastro", "convite"])(
    "mostra cada senha separadamente no %s e informa a força",
    (modo) => {
      render(
        <SignupForm
          convite={
            modo === "convite" ? { token: "convite-teste", email: "teste@example.com" } : undefined
          }
        />,
      );
      const password = screen.getByLabelText("Senha");
      const confirmation = screen.getByLabelText("Confirmar senha");
      expect(password).toHaveAttribute("type", "password");
      expect(confirmation).toHaveAttribute("type", "password");

      fireEvent.change(password, { target: { value: "Senha123!" } });
      expect(screen.getByRole("meter", { name: "Força da senha" })).toHaveAttribute(
        "aria-valuenow",
        "4",
      );
      fireEvent.click(screen.getByRole("button", { name: "Mostrar senha" }));
      expect(password).toHaveAttribute("type", "text");
      expect(confirmation).toHaveAttribute("type", "password");
      fireEvent.click(screen.getByRole("button", { name: "Mostrar confirmação da senha" }));
      expect(confirmation).toHaveAttribute("type", "text");
    },
  );
});
