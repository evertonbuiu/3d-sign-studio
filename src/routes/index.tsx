import { createFileRoute } from "@tanstack/react-router";

import EditorShell from "@/components/editor/EditorShell";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "3D Sign Maker PRO — Letras e placas 3D paramétricas" },
      {
        name: "description",
        content:
          "Crie letras caixa, placas, totens e logotipos 3D paramétricos, visualize em tempo real, calcule custos e exporte em STL para impressão 3D.",
      },
      { property: "og:title", content: "3D Sign Maker PRO" },
      {
        property: "og:description",
        content:
          "Editor paramétrico de letras 3D com visualização instantânea, orçamento automático e exportação STL.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: EditorShell,
});
