import { ImageResponse } from "next/og";

import { marcaEhADoProduto } from "@/lib/branding";
import { CORES_DA_MARCA, SIMBOLO } from "@/lib/branding/desenho";
import { letraDoIcone } from "@/lib/branding/icone";
import { encaixe, logoDoBucketParaIcone } from "@/lib/branding/icone-do-app";
import { marcaDaSaida, NEUTROS_DE_SAIDA } from "@/lib/branding/saida";

/**
 * Os ícones do APP INSTALADO, com a marca da instalação:
 *
 *   /icone/180    — tela inicial do iPhone (`apple-touch-icon`);
 *   /icone/192    — Android e manifesto;
 *   /icone/512    — Android (tela de abertura) e manifesto;
 *   /icone/selo   — o selo monocromático da barra de status do Android: só o
 *                   ALFA conta, então é branco sobre transparente.
 *
 * O favicon da aba continua em `app/icon.tsx` (64 px, inicial): numa aba de
 * 16 px, um logo não se lê. Aqui é onde o logo cabe — e o que decide COMO ele
 * entra (recorte do símbolo, cor do fundo) está em
 * `lib/branding/icone-do-app.ts`.
 *
 * `force-dynamic` pela mesma razão de `app/icon.tsx`: sem ela o build congela o
 * ícone de quem buildou dentro da imagem, que é uma só para todas as marcas.
 * Caminho público em `lib/auth/public-paths.ts`: o celular pede o ícone sem
 * sessão.
 */
export const dynamic = "force-dynamic";

const LADOS = { "180": 180, "192": 192, "512": 512, selo: 96 } as const;
type Lado = keyof typeof LADOS;

// 5 minutos: quem troca o logo vê o ícone novo logo; o celular só relê o
// ícone ao instalar de novo, então cache longo não compraria nada.
const CACHE = { "cache-control": "public, max-age=300, stale-while-revalidate=3600" };

export async function GET(_req: Request, { params }: { params: Promise<{ lado: string }> }) {
  const { lado: bruto } = await params;
  if (!(bruto in LADOS)) return new Response(null, { status: 404 });
  const nome = bruto as Lado;
  const lado = LADOS[nome];
  const tamanho = { width: lado, height: lado, headers: CACHE };

  const marca = await marcaDaSaida(null);
  const logo = await logoDoBucketParaIcone(marca.logoUrl);
  const doProduto = marcaEhADoProduto({ name: marca.nome, logoUrl: marca.logoUrl });

  if (nome === "selo") {
    if (logo?.silhueta && logo.simbolo) {
      const { w, h } = encaixe(logo.silhueta.largura, logo.silhueta.altura, lado, 0.9);
      return new ImageResponse(
        (
          <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- satori, não DOM */}
            <img src={logo.silhueta.src} width={w} height={h} alt="" />
          </div>
        ),
        tamanho,
      );
    }
    if (doProduto) {
      return new ImageResponse(
        (
          <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg viewBox={SIMBOLO.viewBox} width={Math.round(lado * 0.9)} height={Math.round(lado * 0.9)}>
              <g fill="#ffffff" transform={SIMBOLO.transform}>
                <path d={SIMBOLO.d} />
                <rect {...SIMBOLO.modulo} />
              </g>
            </svg>
          </div>
        ),
        tamanho,
      );
    }
    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#ffffff",
            fontSize: Math.round(lado * 0.8),
          }}
        >
          {letraDoIcone(marca.nome) ?? ""}
        </div>
      ),
      tamanho,
    );
  }

  if (logo) {
    // Símbolo recortado ocupa 64% (o respiro que os ícones do sistema têm);
    // o logo inteiro, 84% da largura — ele é largo e já tem pouca altura.
    const { w, h } = encaixe(logo.largura, logo.altura, lado, logo.simbolo ? 0.64 : 0.84);
    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: logo.fundo,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- satori, não DOM */}
          <img
            src={logo.src}
            width={w}
            height={logo.largura > 0 ? h : undefined}
            style={logo.largura > 0 ? undefined : { objectFit: "contain", width: w, height: w }}
            alt=""
          />
        </div>
      ),
      tamanho,
    );
  }

  if (doProduto) {
    const simbolo = Math.round(lado * 0.64);
    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: NEUTROS_DE_SAIDA.fundo,
          }}
        >
          <svg viewBox={SIMBOLO.viewBox} width={simbolo} height={simbolo}>
            <g fill={CORES_DA_MARCA.claro.simbolo} transform={SIMBOLO.transform}>
              <path d={SIMBOLO.d} />
              <rect {...SIMBOLO.modulo} />
            </g>
          </svg>
        </div>
      ),
      tamanho,
    );
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: marca.accent,
          color: marca.accentFg,
          fontSize: Math.round(lado * 0.55),
        }}
      >
        {letraDoIcone(marca.nome) ?? ""}
      </div>
    ),
    tamanho,
  );
}
