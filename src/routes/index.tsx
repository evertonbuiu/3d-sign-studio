import { createFileRoute } from "@tanstack/react-router";

import EditorShell from "@/components/editor/EditorShell";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Letra 3D line tape — Letras e placas 3D paramétricas" },
      {
        name: "description",
        content:
          "Crie letras caixa, placas, totens e logotipos 3D paramétricos, visualize em tempo real, calcule custos e exporte em STL para impressão 3D.",
      },
      { property: "og:title", content: "Letra 3D line tape — Letras e placas 3D paramétricas" },
      {
        property: "og:description",
        content:
          "Crie letras caixa, placas, totens e logotipos 3D paramétricos, visualize em tempo real, calcule custos e exporte em STL para impressão 3D.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: EditorShell,
});
