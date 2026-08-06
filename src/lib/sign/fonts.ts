import * as opentype from "opentype.js";
import { Shape, ShapePath } from "three";

import archivo from "@/assets/fonts/archivo-black.ttf?url";
import bebas from "@/assets/fonts/bebas-neue.ttf?url";
import montserrat from "@/assets/fonts/montserrat.ttf?url";
import poppins from "@/assets/fonts/poppins.ttf?url";
import roboto from "@/assets/fonts/roboto.ttf?url";

interface FontDefinition {
  id: string;
  label: string;
  url: string;
  width?: number;
  slant?: number;
}

export const FONTS = [
  { id: "archivo", label: "Archivo Black", url: archivo },
  { id: "montserrat", label: "Montserrat Bold", url: montserrat },
  { id: "bebas", label: "Bebas Neue", url: bebas },
  { id: "roboto", label: "Roboto Bold", url: roboto },
  { id: "poppins", label: "Poppins SemiBold", url: poppins },
  { id: "archivo-condensed", label: "Archivo Black Condensada", url: archivo, width: 0.72 },
  { id: "archivo-wide", label: "Archivo Black Expandida", url: archivo, width: 1.25 },
  { id: "archivo-oblique", label: "Archivo Black Inclinada", url: archivo, slant: 0.18 },
  { id: "montserrat-condensed", label: "Montserrat Condensada", url: montserrat, width: 0.75 },
  { id: "montserrat-wide", label: "Montserrat Expandida", url: montserrat, width: 1.22 },
  { id: "montserrat-oblique", label: "Montserrat Inclinada", url: montserrat, slant: 0.17 },
  { id: "bebas-condensed", label: "Bebas Neue Estreita", url: bebas, width: 0.72 },
  { id: "bebas-wide", label: "Bebas Neue Larga", url: bebas, width: 1.25 },
  { id: "bebas-oblique", label: "Bebas Neue Inclinada", url: bebas, slant: 0.2 },
  { id: "roboto-condensed", label: "Roboto Condensada", url: roboto, width: 0.76 },
  { id: "roboto-wide", label: "Roboto Expandida", url: roboto, width: 1.2 },
  { id: "roboto-oblique", label: "Roboto Inclinada", url: roboto, slant: 0.16 },
  { id: "poppins-condensed", label: "Poppins Condensada", url: poppins, width: 0.76 },
  { id: "poppins-wide", label: "Poppins Expandida", url: poppins, width: 1.22 },
  { id: "poppins-oblique", label: "Poppins Inclinada", url: poppins, slant: 0.16 },
] as const satisfies readonly FontDefinition[];

export type FontId = (typeof FONTS)[number]["id"];

const cache = new Map<string, opentype.Font>();
const transforms = new WeakMap<opentype.Font, { width: number; slant: number }>();

export function parseCustomFont(buffer: ArrayBuffer): opentype.Font {
  const font = opentype.parse(buffer);
  transforms.set(font, { width: 1, slant: 0 });
  return font;
}

export async function loadFont(id: FontId): Promise<opentype.Font> {
  const cached = cache.get(id);
  if (cached) return cached;
  const entry = FONTS.find((f) => f.id === id) ?? FONTS[0];
  const response = await fetch(entry.url);
  if (!response.ok) throw new Error(`Não foi possível carregar a fonte (${response.status}).`);
  const buffer = await response.arrayBuffer();
  const font = opentype.parse(buffer);
  transforms.set(font, {
    width: "width" in entry ? entry.width : 1,
    slant: "slant" in entry ? entry.slant : 0,
  });
  cache.set(id, font);
  return font;
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
  const transform = transforms.get(font) ?? { width: 1, slant: 0 };
  const point = (x: number, y: number) => ({
    x: x * transform.width + -y * transform.slant,
    y: -y,
  });

  const path = new ShapePath();
  let cursorX = 0;
  const glyphs = font.stringToGlyphs(source);

  glyphs.forEach((glyph, index) => {
    const scale = fontSize / unitsPerEm;
    const glyphPath = glyph.getPath(cursorX, 0, fontSize);
    for (const cmd of glyphPath.commands) {
      switch (cmd.type) {
        case "M": {
          const p = point(cmd.x, cmd.y);
          path.moveTo(p.x, p.y);
          break;
        }
        case "L": {
          const p = point(cmd.x, cmd.y);
          path.lineTo(p.x, p.y);
          break;
        }
        case "C": {
          const p1 = point(cmd.x1, cmd.y1);
          const p2 = point(cmd.x2, cmd.y2);
          const p = point(cmd.x, cmd.y);
          path.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, p.x, p.y);
          break;
        }
        case "Q": {
          const p1 = point(cmd.x1, cmd.y1);
          const p = point(cmd.x, cmd.y);
          path.quadraticCurveTo(p1.x, p1.y, p.x, p.y);
          break;
        }
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

