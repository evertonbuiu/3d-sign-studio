import { useMemo, useState } from "react";
import { Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { STYLES, STYLE_GROUPS } from "@/lib/sign/model";
import { cn } from "@/lib/utils";
import { useEditor } from "./store";

function Thumb({ style }: { style: (typeof STYLES)[number] }) {
  const { thumb } = style;
  return (
    <div
      className="relative flex h-14 w-full items-center justify-center overflow-hidden rounded-sm"
      style={{ background: thumb.plate ? thumb.body : "#1d232c" }}
    >
      {thumb.glow && thumb.glow !== "none" && (
        <div
          className="absolute h-9 w-16 rounded-full blur-lg"
          style={{ background: thumb.face, opacity: thumb.glow === "halo" ? 0.55 : 0.4 }}
        />
      )}
      <span
        className="relative font-display text-2xl leading-none"
        style={{
          color: thumb.outline ? "transparent" : thumb.face,
          WebkitTextStroke: thumb.outline ? `1.5px ${thumb.face}` : undefined,
          textShadow:
            thumb.layers && thumb.layers > 1
              ? `2px 2px 0 ${thumb.body}, 4px 4px 0 ${thumb.face}`
              : undefined,
        }}
      >
        Ab
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
            className="h-8 bg-card pl-7 text-xs"
          />
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-3">
        {STYLE_GROUPS.map((group) => {
          const items = filtered.filter((s) => s.group === group);
          if (!items.length) return null;
          return (
            <section key={group}>
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
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
                    <span className="mt-1.5 block text-[11px] font-medium leading-tight text-card-foreground">
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
