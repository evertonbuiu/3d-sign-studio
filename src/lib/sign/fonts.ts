import * as opentype from "opentype.js";
import { Shape, ShapePath } from "three";

import archivo from "@/assets/fonts/archivo-black.ttf?url";
import bebas from "@/assets/fonts/bebas-neue.ttf?url";
import montserrat from "@/assets/fonts/montserrat.ttf?url";
import poppins from "@/assets/fonts/poppins.ttf?url";
import roboto from "@/assets/fonts/roboto.ttf?url";

import { findGoogleFontById, GOOGLE_FONT_PACKAGES, loadGoogleFont } from "./googleFonts";

const LOCAL_FONTS = [
  { id: "archivo", label: "Archivo Black", url: archivo },
  { id: "montserrat", label: "Montserrat Bold", url: montserrat },
  { id: "bebas", label: "Bebas Neue", url: bebas },
  { id: "roboto", label: "Roboto Bold", url: roboto },
  { id: "poppins", label: "Poppins SemiBold", url: poppins },
] as const;

export type FontId = string;

export interface FontEntry {
  id: string;
  label: string;
  source: "local" | "google";
}

export function getLocalFonts(): FontEntry[] {
  return LOCAL_FONTS.map((f) => ({ id: f.id, label: f.label, source: "local" }));
}

export function getAvailableFonts(installedPackageIds: string[]): FontEntry[] {
  const installed = new Set(installedPackageIds);
  const googleFonts = GOOGLE_FONT_PACKAGES.filter((p) => installed.has(p.id)).flatMap((p) =>
    p.fonts.map((f) => ({ id: f.id, label: f.label, source: "google" as const })),
  );
  return [...getLocalFonts(), ...googleFonts];
}

const cache = new Map<string, opentype.Font>();

export async function loadFont(id: FontId): Promise<opentype.Font> {
  const cached = cache.get(id);
  if (cached) return cached;

  const local = LOCAL_FONTS.find((f) => f.id === id);
  if (local) {
    const response = await fetch(local.url);
    if (!response.ok) throw new Error(`Não foi possível carregar a fonte (${response.status}).`);
    const buffer = await response.arrayBuffer();
    const font = opentype.parse(buffer);
    cache.set(id, font);
    return font;
  }

  if (findGoogleFontById(id)) {
    const font = await loadGoogleFont(id);
    cache.set(id, font);
    return font;
  }

  throw new Error(`Fonte não encontrada: ${id}`);
}

/**
 * Converte um texto em contornos (THREE.Shape) já normalizados para que a
 * altura de caixa-alta corresponda exatamente a `capHeight` milímetros e o
 * conjunto fique centralizado na origem.
 */
export function textToShapes(
  font: opentype.Font,
  text: string,
  capHeight: number,
  tracking = 0,
): Shape[] {
  const source = text.length ? text : " ";
  const unitsPerEm = font.unitsPerEm || 1000;
  const capUnits = (font.tables?.["os2"]?.["sCapHeight"] as number | undefined) || unitsPerEm * 0.7;
  const fontSize = (capHeight * unitsPerEm) / capUnits;

  const path = new ShapePath();
  let cursorX = 0;
  const glyphs = font.stringToGlyphs(source);

  glyphs.forEach((glyph, index) => {
    const scale = fontSize / unitsPerEm;
    const glyphPath = glyph.getPath(cursorX, 0, fontSize);
    for (const cmd of glyphPath.commands) {
      switch (cmd.type) {
        case "M":
          path.moveTo(cmd.x, -cmd.y);
          break;
        case "L":
          path.lineTo(cmd.x, -cmd.y);
          break;
        case "C":
          path.bezierCurveTo(cmd.x1, -cmd.y1, cmd.x2, -cmd.y2, cmd.x, -cmd.y);
          break;
        case "Q":
          path.quadraticCurveTo(cmd.x1, -cmd.y1, cmd.x, -cmd.y);
          break;
        case "Z":
          path.currentPath?.closePath();
          break;
      }
    }
    cursorX += (glyph.advanceWidth ?? unitsPerEm / 2) * scale + tracking;
    const next = glyphs[index + 1];
    if (next) {
      cursorX += font.getKerningValue(glyph, next) * scale;
    }
  });

  return path.toShapes();
}
