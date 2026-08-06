import { useMemo, useState } from "react";
import { Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { STYLES, STYLE_GROUPS } from "@/lib/sign/model";
import { cn } from "@/lib/utils";
import { useEditor } from "./store";

function Thumb({ style }: { style: (typeof STYLES)[number] }) {
  const { thumb } = style;
  const hasFront = style.parts.includes("frente");
  const hasBack = style.parts.includes("fundo");
  const hasWalls = style.parts.includes("laterais");
  const hasPlate = style.parts.includes("placa") || Boolean(thumb.plate);
  const hasPole = style.parts.includes("poste");
  const isNeon = style.id.includes("neon");
  const isOpenNeon = style.id === "neon-flex-fundo-impresso";
  const hasFlange = style.id.includes("aba");
  const isAcrylic = style.id.includes("acrilico") || style.id.includes("petg");
  const isBackLight = thumb.glow === "back" || thumb.glow === "halo";
  const filterId = `glow-${style.id}`;
  const badge = isOpenNeon
    ? "CONTORNO"
    : hasFlange
      ? "ENCAIXE"
      : hasPole
        ? "TOTEM"
        : hasPlate
          ? "PLACA"
          : isAcrylic
            ? "ACRÍLICO"
            : thumb.layers && thumb.layers > 1
              ? `${thumb.layers} CAMADAS`
              : isBackLight
                ? "HALO"
                : hasFront && hasBack
                  ? "FECHADA"
                  : "ABERTA";

  return (
    <div className="relative h-20 w-full overflow-hidden rounded-sm bg-[#151b24]">
      <svg viewBox="0 0 120 72" className="h-full w-full" aria-hidden="true">
        <defs>
          <linearGradient id={`${filterId}-bg`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#273242" />
            <stop offset="1" stopColor="#111720" />
          </linearGradient>
          <filter id={filterId} x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <rect width="120" height="72" fill={`url(#${filterId}-bg)`} />

        {hasPole ? <path d="M56 42h8v30h-8z" fill={thumb.body} /> : null}
        {hasPlate ? (
          <g transform={hasPole ? "translate(0 -5)" : undefined}>
            <path d="M18 12h80l7 6v43H25l-7-6z" fill="#0b1017" opacity=".7" />
            <path d="M15 9h82v46H15z" fill={thumb.body} stroke="#8190a4" strokeWidth="1" />
            <path d="M20 14h72v36H20z" fill="#202a38" opacity=".65" />
          </g>
        ) : null}

        {isBackLight ? (
          <text
            x="59"
            y="49"
            textAnchor="middle"
            fontFamily="Arial Black, sans-serif"
            fontSize="42"
            fill={thumb.face}
            opacity=".7"
            filter={`url(#${filterId})`}
          >
            A
          </text>
        ) : null}

        {hasFlange ? (
          <g transform="translate(4 3)" opacity=".9">
            <text
              x="59"
              y="49"
              textAnchor="middle"
              fontFamily="Arial Black, sans-serif"
              fontSize="42"
              fill="none"
              stroke={thumb.body}
              strokeWidth="7"
            >
              A
            </text>
            <text
              x="59"
              y="49"
              textAnchor="middle"
              fontFamily="Arial Black, sans-serif"
              fontSize="42"
              fill="none"
              stroke="#aeb9c8"
              strokeWidth="1"
              strokeDasharray="3 2"
            >
              A
            </text>
          </g>
        ) : null}

        {hasWalls && !hasPlate ? (
          <text
            x="63"
            y="51"
            textAnchor="middle"
            fontFamily="Arial Black, sans-serif"
            fontSize="42"
            fill={hasBack ? thumb.body : "none"}
            stroke={thumb.body}
            strokeWidth={hasBack ? "5" : "4"}
          >
            A
          </text>
        ) : null}

        {thumb.layers && thumb.layers > 1
          ? Array.from({ length: thumb.layers }, (_, index) => (
              <text
                key={index}
                x={56 + index * 3}
                y={47 + index * 3}
                textAnchor="middle"
                fontFamily="Arial Black, sans-serif"
                fontSize="40"
                fill={index === thumb.layers! - 1 ? thumb.face : index % 2 ? thumb.body : "#6ea8ff"}
              >
                A
              </text>
            ))
          : null}

        {isNeon ? (
          <text
            x="58"
            y="49"
            textAnchor="middle"
            fontFamily="Arial Black, sans-serif"
            fontSize="42"
            fill="none"
            stroke={thumb.face}
            strokeWidth={isOpenNeon ? "4" : "3"}
            strokeLinecap="round"
            strokeLinejoin="round"
            filter={`url(#${filterId})`}
          >
            A
          </text>
        ) : hasFront && !(thumb.layers && thumb.layers > 1) ? (
          <text
            x="58"
            y="48"
            textAnchor="middle"
            fontFamily="Arial Black, sans-serif"
            fontSize="42"
            fill={thumb.outline ? "none" : thumb.face}
            fillOpacity={isAcrylic ? ".78" : "1"}
            stroke={isAcrylic || thumb.outline ? thumb.face : "#ffffff"}
            strokeOpacity={isAcrylic ? ".9" : ".18"}
            strokeWidth={thumb.outline ? "3" : "1"}
            filter={
              thumb.glow === "front" || thumb.glow === "edge" ? `url(#${filterId})` : undefined
            }
          >
            A
          </text>
        ) : null}

        {!hasFront && !isNeon ? (
          <path d="M45 51 57 18h8l13 33h-8l-3-9H54l-3 9zm12-16h8l-4-12z" fill={thumb.body} />
        ) : null}
        <path d="M8 64h104" stroke="#7c8ca1" strokeOpacity=".25" />
      </svg>
      <span className="absolute bottom-1 right-1 rounded bg-black/65 px-1.5 py-0.5 text-[8px] font-semibold tracking-wide text-white/80">
        {badge}
      </span>
    </div>
  );
}

export default function StyleLibrary() {
  const { style, selectStyle } = useEditor();
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return STYLES.filter(
      (s) => !q || s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q),
    );
  }, [query]);

  return (
    <div className="flex h-full flex-col border-r border-border bg-panel">
      <div className="border-b border-border p-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Biblioteca de estilos
        </h2>
        <div className="relative mt-2">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar estilo"
            className="h-9 bg-card pl-7 text-sm"
          />
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-3">
        {STYLE_GROUPS.map((group) => {
          const items = filtered.filter((s) => s.group === group);
          if (!items.length) return null;
          return (
            <section key={group}>
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                {group}
              </h3>
              <div className="grid grid-cols-2 gap-2">
                {items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => selectStyle(item.id)}
                    title={item.description}
                    className={cn(
                      "group rounded-md border bg-card p-1.5 text-left transition-colors",
                      style.id === item.id
                        ? "border-primary ring-1 ring-primary"
                        : "border-border hover:border-primary/50",
                    )}
                  >
                    <Thumb style={item} />
                    <span className="mt-1.5 block text-sm font-medium leading-tight text-card-foreground">
                      {item.name}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
