import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import JSZip from "jszip";

export const fetchGoogleFont = createServerFn({ method: "POST" })
  .validator((input) => z.object({ family: z.string().min(1).max(120) }).parse(input))
  .handler(async ({ data }) => {
    const url = `https://fonts.google.com/download?family=${encodeURIComponent(data.family)}`;
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "application/zip,application/octet-stream,*/*",
      },
    });
    if (!response.ok) {
      throw new Error(`Fonte não disponível no Google Fonts: ${data.family}`);
    }

    const buffer = await response.arrayBuffer();
    const zip = await JSZip.loadAsync(buffer);

    const entries = Object.values(zip.files).filter(
      (f) => !f.dir && /\.(ttf|otf)$/i.test(f.name),
    );
    if (!entries.length) {
      throw new Error(`Nenhum arquivo de fonte encontrado para ${data.family}`);
    }

    const fontFile = entries.sort((a, b) => {
      const weightA = extractWeight(a.name);
      const weightB = extractWeight(b.name);
      if (weightA !== weightB) return weightB - weightA;
      return a.name.localeCompare(b.name);
    })[0];

    const base64 = await fontFile.async("base64");
    return { family: data.family, base64, filename: fontFile.name };
  });

function extractWeight(name: string): number {
  const match = name.match(/(?:^|\D)(\d{3})(?:\D|$)/);
  return match ? Number(match[1]) : 400;
}
