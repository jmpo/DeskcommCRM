/**
 * O cartão do pino mostra à equipe o endereço aproximado que o Google deu
 * (chave de Mapas, 0444) — e, sem ele, o mesmo "Localização compartilhada" de antes.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LocationCard } from "./LocationCard";

describe("LocationCard", () => {
  it("com endereço aproximado: rua, cidade e departamento, marcados (aprox.)", () => {
    render(
      <LocationCard
        localizacao={{ latitude: -25.35, longitude: -57.44, aproximado: { rua: "Boqueron", cidade: "Capiatá", regiao: "Central" } }}
      />,
    );
    expect(screen.getByTestId("pino-detalhe").textContent).toBe("Boqueron, Capiatá, Central (aprox.)");
  });

  it("o nome que o cliente escolheu no WhatsApp vem antes do aproximado — é exato", () => {
    render(<LocationCard localizacao={{ latitude: -25.3, longitude: -57.5, nome: "Shopping del Sol", aproximado: { cidade: "Asunción" } }} />);
    expect(screen.getByTestId("pino-detalhe").textContent).toBe("Shopping del Sol");
  });

  it("controle: só coordenadas, o texto de sempre", () => {
    render(<LocationCard localizacao={{ latitude: -25.3, longitude: -57.5 }} />);
    expect(screen.getByTestId("pino-detalhe").textContent).toBe("Localização compartilhada");
  });
});
