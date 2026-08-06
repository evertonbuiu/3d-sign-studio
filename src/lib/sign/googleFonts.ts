import * as opentype from "opentype.js";

export interface GoogleFontEntry {
  id: string;
  label: string;
  family: string;
}

export interface GoogleFontPackage {
  id: string;
  name: string;
  description: string;
  fonts: GoogleFontEntry[];
}

export const GOOGLE_FONT_PACKAGES: GoogleFontPackage[] = [
  {
    id: "basico",
    name: "Básico",
    description: "Sans-serif versáteis para placas corporativas",
    fonts: [
      { id: "roboto", label: "Roboto", family: "Roboto" },
      { id: "open-sans", label: "Open Sans", family: "Open Sans" },
      { id: "lato", label: "Lato", family: "Lato" },
      { id: "inter", label: "Inter", family: "Inter" },
      { id: "montserrat", label: "Montserrat", family: "Montserrat" },
      { id: "poppins", label: "Poppins", family: "Poppins" },
    ],
  },
  {
    id: "display",
    name: "Display",
    description: "Fontes impactantes para letreiros e fachadas",
    fonts: [
      { id: "oswald", label: "Oswald", family: "Oswald" },
      { id: "anton", label: "Anton", family: "Anton" },
      { id: "bebas-neue", label: "Bebas Neue", family: "Bebas Neue" },
      { id: "archivo-black", label: "Archivo Black", family: "Archivo Black" },
      { id: "raleway", label: "Raleway", family: "Raleway" },
      { id: "kanit", label: "Kanit", family: "Kanit" },
    ],
  },
  {
    id: "serif",
    name: "Serif",
    description: "Fontes clássicas com elegância e legibilidade",
    fonts: [
      { id: "playfair-display", label: "Playfair Display", family: "Playfair Display" },
      { id: "merriweather", label: "Merriweather", family: "Merriweather" },
      { id: "libre-baskerville", label: "Libre Baskerville", family: "Libre Baskerville" },
      { id: "roboto-slab", label: "Roboto Slab", family: "Roboto Slab" },
      { id: "lora", label: "Lora", family: "Lora" },
    ],
  },
  {
    id: "criativo",
    name: "Criativo",
    description: "Fontes estilizadas para projetos diferenciados",
    fonts: [
      { id: "pacifico", label: "Pacifico", family: "Pacifico" },
      { id: "lobster", label: "Lobster", family: "Lobster" },
      { id: "dancing-script", label: "Dancing Script", family: "Dancing Script" },
      { id: "permanent-marker", label: "Permanent Marker", family: "Permanent Marker" },
      { id: "courgette", label: "Courgette", family: "Courgette" },
      { id: "righteous", label: "Righteous", family: "Righteous" },
    ],
  },
];

const GOOGLE_FONT_BY_ID = new Map(
  GOOGLE_FONT_PACKAGES.flatMap((p) => p.fonts).map((f) => [f.id, f]),
);

export function findGoogleFontById(id: string): GoogleFontEntry | undefined {
  return GOOGLE_FONT_BY_ID.get(id);
}

const DB_NAME = "sign-maker-fonts";
const STORE_NAME = "font-buffers";
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
}

async function getCachedBuffer(id: string): Promise<ArrayBuffer | null> {
  try {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(id);
      request.onsuccess = () => {
        const result = request.result;
        resolve(result ? new Uint8Array(result).buffer : null);
      };
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  }
}

async function setCachedBuffer(id: string, buffer: ArrayBuffer): Promise<void> {
  try {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const request = store.put(new Uint8Array(buffer), id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch {
    // ignore
  }
}

const INSTALLED_KEY = "sign-maker-installed-font-packages";

export function getInstalledFontPackageIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(INSTALLED_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export function setInstalledFontPackageIds(ids: string[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(INSTALLED_KEY, JSON.stringify(ids));
}

const memoryCache = new Map<string, opentype.Font>();

export async function loadGoogleFont(id: string): Promise<opentype.Font> {
  const cached = memoryCache.get(id);
  if (cached) return cached;

  const entry = findGoogleFontById(id);
  if (!entry) throw new Error(`Fonte não encontrada: ${id}`);

  const dbBuffer = await getCachedBuffer(id);
  if (dbBuffer) {
    const font = opentype.parse(dbBuffer);
    memoryCache.set(id, font);
    return font;
  }

  const { fetchGoogleFont } = await import("./googleFonts.functions");
  const { base64 } = await fetchGoogleFont({ data: { family: entry.family } });
  const binary = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const buffer = binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength);

  const font = opentype.parse(buffer);
  memoryCache.set(id, font);
  await setCachedBuffer(id, buffer);
  return font;
}
