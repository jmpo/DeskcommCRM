import type { MetadataRoute } from "next";

import { marcaDaSaida } from "@/lib/branding/saida";

/**
 * O manifesto do app instalado — é dele que o celular tira o NOME que aparece
 * embaixo do ícone e no topo de cada notificação.
 *
 * `force-dynamic` não é zelo: o `manifest.ts` é uma rota em cache por padrão,
 * e o `next build` a resolvia UMA vez, sem banco, com a marca padrão. Medido em
 * produção (25/09/2026): com nome próprio gravado em `platform_branding`, o
 * `/manifest.webmanifest` respondia o nome padrão do produto, com
 * `x-nextjs-cache: HIT` — e o iPhone instalou o app com esse nome. É o mesmo
 * defeito que `app/icon.tsx` documenta, e que só aparece na VPS do revendedor.
 */
export const dynamic = "force-dynamic";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const marca = await marcaDaSaida(null);
  return {
    name: marca.nome,
    short_name: marca.nome,
    display: "standalone",
    start_url: "/app",
    scope: "/",
    background_color: "#ffffff",
    icons: [
      { src: "/icone/192", sizes: "192x192", type: "image/png" },
      { src: "/icone/512", sizes: "512x512", type: "image/png" },
      { src: "/icon", sizes: "64x64", type: "image/png" },
    ],
  };
}
