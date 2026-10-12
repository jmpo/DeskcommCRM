/**
 * O anúncio que trouxe a pessoa aparece na inbox: na bolha da mensagem nascida
 * do clique e no painel ao lado — e a conversa selecionada é legível no escuro.
 *
 * Pedido de operação (Pedilo, 12/10/2026): "cuando un cliente viene de un
 * anuncio, que ese anuncio aparezca en la conversación y al costado, para saber
 * por qué anuncio de Meta Ads vino". O dado já existia (`metadata.anuncio` na
 * mensagem, `source_metadata.ad_*` no contato) e nenhuma tela o mostrava.
 *
 * Os endereços vêm de fora (o payload do anúncio) e vão parar em `href`/`src`:
 * por isso o filtro `https:` é medido aqui nos dois leitores.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ConversationListItem } from "@/components/inbox/ConversationListItem";
import { conversaDeExemplo } from "@/components/inbox/__fixtures__/conversa";
import { MessageBubble } from "@/components/inbox/MessageBubble";
import {
  lerAnuncioDaMensagem,
  lerAnuncioDoContato,
  metadataDoAnuncio,
  urlSegura,
  type AtribuicaoDeAnuncio,
} from "@/lib/leads/atribuicao-de-anuncio";
import type { Message } from "@/lib/types/messaging";

const atribuicao = (over: Partial<AtribuicaoDeAnuncio> = {}): AtribuicaoDeAnuncio => ({
  plataforma: "meta_ads",
  sourceId: "clique-1",
  adId: "120251615780570072",
  titulo: "DELIVERY GRATIS",
  corpo: "Pico de alta presión. Pagás cuando te llega.",
  sourceUrl: "https://fb.me/pico",
  miniatura: "https://scontent.example.fbcdn.net/pico.jpg",
  bruto: {},
  ...over,
});

describe("urlSegura — só https chega a href/src da inbox", () => {
  it.each([
    ["https://fb.me/pico", "https://fb.me/pico"],
    ["http://fb.me/pico", null],
    ["javascript:alert(1)", null],
    ["data:text/html,<b>x</b>", null],
    ["não é url", null],
    ["", null],
    [42, null],
  ])("%s → %s", (entrada, esperado) => {
    expect(urlSegura(entrada)).toBe(esperado);
  });
});

describe("metadataDoAnuncio — a mensagem guarda o link e a imagem, não o clique", () => {
  it("título, texto, id, link e miniatura", () => {
    expect(metadataDoAnuncio(atribuicao())).toEqual({
      anuncio: {
        titulo: "DELIVERY GRATIS",
        texto: "Pico de alta presión. Pagás cuando te llega.",
        ad_id: "120251615780570072",
        url: "https://fb.me/pico",
        miniatura: "https://scontent.example.fbcdn.net/pico.jpg",
      },
    });
  });

  it("endereço que não é https não é gravado", () => {
    const { anuncio } = metadataDoAnuncio(atribuicao({ sourceUrl: "javascript:alert(1)", miniatura: "http://x/y.jpg" }));
    expect(anuncio).toEqual({
      titulo: "DELIVERY GRATIS",
      texto: "Pico de alta presión. Pagás cuando te llega.",
      ad_id: "120251615780570072",
    });
  });

  it("lerAnuncioDaMensagem devolve os endereços só se forem https", () => {
    expect(lerAnuncioDaMensagem({ titulo: "T", url: "javascript:x", miniatura: "https://a/b.jpg" })).toEqual({
      titulo: "T",
      texto: null,
      ad_id: null,
      url: null,
      miniatura: "https://a/b.jpg",
    });
  });
});

describe("lerAnuncioDoContato — o primeiro toque, como a inbox o mostra", () => {
  const carimbado = {
    ad_platform: "meta_ads",
    ad_id: "120251615780570072",
    ad_title: "DELIVERY GRATIS",
    ad_body: "Pico de alta presión.",
    ad_source_url: "https://fb.me/pico",
    ad_captured_at: "2026-10-12T13:42:00.000Z",
  };

  it("contato carimbado a partir desta versão: a miniatura vem de ad_thumbnail_url", () => {
    expect(lerAnuncioDoContato({ ...carimbado, ad_thumbnail_url: "https://cdn.example/nova.jpg" })).toEqual({
      titulo: "DELIVERY GRATIS",
      texto: "Pico de alta presión.",
      ad_id: "120251615780570072",
      url: "https://fb.me/pico",
      miniatura: "https://cdn.example/nova.jpg",
      capturado_em: "2026-10-12T13:42:00.000Z",
    });
  });

  it("contato carimbado antes: a miniatura sai do payload cru, nas duas formas", () => {
    expect(lerAnuncioDoContato({ ...carimbado, ad_raw: { thumbnail_url: "https://cdn.example/oficial.jpg" } })?.miniatura).toBe(
      "https://cdn.example/oficial.jpg",
    );
    expect(lerAnuncioDoContato({ ...carimbado, ad_raw: { thumbnailUrl: "https://cdn.example/qr.jpg" } })?.miniatura).toBe(
      "https://cdn.example/qr.jpg",
    );
  });

  it("sem plataforma não há anúncio (contato que não veio de clique)", () => {
    expect(lerAnuncioDoContato({ waha_chat_id: "x", notify_name: "y" })).toBeNull();
    expect(lerAnuncioDoContato(null)).toBeNull();
    expect(lerAnuncioDoContato("lixo")).toBeNull();
  });

  it("link perigoso some, o resto fica", () => {
    const a = lerAnuncioDoContato({ ...carimbado, ad_source_url: "javascript:alert(1)" });
    expect(a?.url).toBeNull();
    expect(a?.titulo).toBe("DELIVERY GRATIS");
  });
});

function mensagem(over: Partial<Message> = {}): Message {
  return {
    id: "m1",
    organization_id: "org1",
    conversation_id: "c1",
    channel_session_id: "s1",
    contact_id: "ct1",
    external_id: null,
    type: "text",
    direction: "inbound",
    status: "received",
    ack: null,
    error_code: null,
    error_message: null,
    body: "¿Cuál es el precio?",
    media_url: null,
    media_mime: null,
    media_size_bytes: null,
    media_storage_path: null,
    sent_via: "external_device",
    sent_by_user_id: null,
    sent_at: "2026-10-12T13:42:00.000Z",
    delivered_at: null,
    read_at: null,
    metadata: {},
    created_at: "2026-10-12T13:42:00.000Z",
    updated_at: "2026-10-12T13:42:00.000Z",
    ...over,
  } as Message;
}

describe("a bolha da mensagem nascida do clique mostra o anúncio", () => {
  it("título, texto, imagem e link no topo da bolha, acima do texto do cliente", () => {
    render(<MessageBubble message={mensagem({ metadata: metadataDoAnuncio(atribuicao()) })} />);
    const cartao = screen.getByTestId("anuncio-card");
    expect(cartao).toHaveTextContent("DELIVERY GRATIS");
    expect(cartao).toHaveTextContent("Pico de alta presión. Pagás cuando te llega.");
    expect(screen.getByRole("link", { name: /Ver anúncio/ })).toHaveAttribute("href", "https://fb.me/pico");
    expect(cartao.querySelector("img")).toHaveAttribute("src", "https://scontent.example.fbcdn.net/pico.jpg");
    // Acima do que o cliente escreveu, como o WhatsApp mostra no celular.
    const texto = screen.getByText("¿Cuál es el precio?");
    expect(cartao.compareDocumentPosition(texto) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("mensagem antiga (só título e texto) mostra o cartão sem link nem imagem", () => {
    render(
      <MessageBubble
        message={mensagem({ metadata: { anuncio: { titulo: "ENVÍO GRATIS", texto: "Parasol.", ad_id: "1" } } })}
      />,
    );
    expect(screen.getByTestId("anuncio-card")).toHaveTextContent("ENVÍO GRATIS");
    expect(screen.queryByRole("link", { name: /Ver anúncio/ })).toBeNull();
    expect(screen.getByTestId("anuncio-card").querySelector("img")).toBeNull();
  });

  it("mensagem sem anúncio e mensagem ENVIADA não mostram cartão", () => {
    const { unmount } = render(<MessageBubble message={mensagem()} />);
    expect(screen.queryByTestId("anuncio-card")).toBeNull();
    unmount();
    render(
      <MessageBubble
        message={mensagem({ direction: "outbound", sent_via: "ai", metadata: metadataDoAnuncio(atribuicao()) })}
      />,
    );
    expect(screen.queryByTestId("anuncio-card")).toBeNull();
  });
});

describe("a conversa selecionada é legível no tema escuro", () => {
  it("o fundo da selecionada é o token que muda com o tema, não um degrau fixo da rampa", () => {
    // Os degraus `accent-50…950` têm o MESMO hex nos dois temas (globals.css);
    // o `accent-50` quase branco no escuro punha o nome (`text-text`, claro)
    // branco sobre branco — o defeito da captura de 12/10/2026.
    render(<ConversationListItem {...conversaDeExemplo.props} conversation={conversaDeExemplo.conversation} isSelected />);
    const linha = screen.getByRole("button", { current: true });
    expect(linha.className).toContain("bg-accent-soft");
    expect(linha.className).not.toMatch(/\bbg-accent-(50|100|200|300|400|500|600|700|800|900|950)\b/);
  });
});
