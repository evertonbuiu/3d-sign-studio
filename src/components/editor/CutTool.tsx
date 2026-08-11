import { useState, type ComponentType } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  ChevronDown,
  Grid3x3,
  Puzzle,
  Scissors,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { PartKind } from "@/lib/sign/model";
import { Field, MoneyField, NumberSlider } from "./PropertiesPanel";
import { useEditor } from "./store";

/** Card grande de seleção de modo (substitui o antigo <Select>). */
function ModeCard({
  icon: Icon,
  title,
  description,
  active,
  onClick,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col items-start gap-1.5 rounded-lg border p-3 text-left transition",
        active
          ? "border-primary bg-primary/10 ring-1 ring-primary/30"
          : "border-border bg-card hover:border-primary/40",
      )}
    >
      <Icon className={cn("h-4.5 w-4.5", active ? "text-primary" : "text-muted-foreground")} />
      <span className="text-sm font-medium leading-none">{title}</span>
      <span className="text-xs leading-snug text-muted-foreground">{description}</span>
    </button>
  );
}

/** Numera cada etapa do fluxo, no estilo "assistente" do Letra Maker. */
function StepLabel({ n, label }: { n: number; label: string }) {
  return (
    <div className="flex items-center gap-2 pt-1">
      <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground">
        {n}
      </span>
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
    </div>
  );
}

/** Alterna entre "todas as peças" e cada PartKind disponível no estilo atual. */
function TargetPicker({ options }: { options: (PartKind | "all")[] }) {
  const { params, setParam } = useEditor();
  const labelFor = (value: PartKind | "all") =>
    value === "all" ? "Todas" : value === "laterais" ? "Paredes" : value;
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((value) => {
        const active = params.manualCutTarget === value;
        return (
          <button
            key={value}
            type="button"
            onClick={() => setParam("manualCutTarget", value)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium capitalize transition",
              active
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-muted-foreground hover:border-primary/40",
            )}
          >
            {labelFor(value)}
          </button>
        );
      })}
    </div>
  );
}

export default function CutTool() {
  const { params, setParam, style } = useEditor();
  const active = params.splitForBuildPlate;
  const [encaixeOpen, setEncaixeOpen] = useState(true);

  const targets: (PartKind | "all")[] = ["all", ...Array.from(new Set(style.parts))];

  function toggleActive() {
    const next = !active;
    setParam("splitForBuildPlate", next);
    toast.success(
      next ? "Corte ativado. Configure o plano abaixo." : "Ferramenta de corte desativada.",
    );
  }

  function applyCut() {
    const nextCut = {
      id: `${Date.now()}-${params.manualCuts.length + 1}`,
      angle: params.manualCutAngle,
      offset: params.manualCutOffset,
      target: params.manualCutTarget,
      connector: params.cutConnector,
      maleSide: params.cutMaleSide,
      connectorDepth: params.cutConnectorDepth,
      connectorWidth: params.cutConnectorWidth,
      connectorThickness: params.cutConnectorThickness,
      connectorClearance: params.cutConnectorClearance,
    };
    setParam("manualCuts", [...params.manualCuts, nextCut]);
    toast.success(`Corte ${params.manualCuts.length + 1} aplicado`);
  }

  return (
    <div className="border-b border-border bg-gradient-to-b from-primary/5 to-transparent p-3">
      <button
        type="button"
        onClick={toggleActive}
        className={cn(
          "flex w-full items-center gap-3 rounded-lg border p-3 text-left transition",
          active ? "border-primary bg-primary/10" : "border-border bg-card hover:border-primary/40",
        )}
      >
        <span
          className={cn(
            "grid h-9 w-9 shrink-0 place-items-center rounded-md",
            active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
          )}
        >
          <Scissors className="h-4.5 w-4.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-foreground">Ferramenta de corte</span>
          <span className="block truncate text-xs text-muted-foreground">
            {active
              ? "Ativa — configure o plano e o encaixe abaixo"
              : "Divida peças grandes para caber na mesa de impressão"}
          </span>
        </span>
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
            active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
          )}
        >
          {active ? "Ativo" : "Off"}
        </span>
      </button>

      {active ? (
        <div className="mt-3 space-y-3">
          <StepLabel n={1} label="Modo de corte" />
          <div className="grid grid-cols-2 gap-2">
            <ModeCard
              icon={Grid3x3}
              title="Automático"
              description="Grade pela área útil da mesa"
              active={params.splitMode === "automatic"}
              onClick={() => setParam("splitMode", "automatic")}
            />
            <ModeCard
              icon={SlidersHorizontal}
              title="Plano manual"
              description="Ângulo livre + encaixe"
              active={params.splitMode === "manual"}
              onClick={() => setParam("splitMode", "manual")}
            />
          </div>

          {params.splitMode === "automatic" ? (
            <MoneyField label="Margem da mesa (mm)" keyName="splitMargin" step={1} />
          ) : (
            <>
              <StepLabel n={2} label="Aplicar em" />
              <TargetPicker options={targets} />

              <StepLabel n={3} label="Posição do plano" />
              <div className="grid grid-cols-1 gap-3 rounded-lg border border-border bg-card p-3">
                <NumberSlider
                  label="Rotação do plano (eixo Z)"
                  keyName="manualCutAngle"
                  min={-180}
                  max={180}
                  step={1}
                  unit="°"
                />
                <NumberSlider
                  label="Posição do plano"
                  keyName="manualCutOffset"
                  min={-400}
                  max={400}
                  step={1}
                />
                <NumberSlider
                  label="Afastar partes na prévia"
                  keyName="manualCutSeparation"
                  min={0}
                  max={100}
                  step={1}
                />
              </div>

              <div className="rounded-lg border border-border bg-card">
                <button
                  type="button"
                  onClick={() => setEncaixeOpen((v) => !v)}
                  className="flex w-full items-center gap-2.5 p-3 text-left"
                >
                  <span
                    className={cn(
                      "grid h-7 w-7 shrink-0 place-items-center rounded-md",
                      params.cutConnector === "male-female"
                        ? "bg-primary/15 text-primary"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    <Puzzle className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">Encaixe macho e fêmea</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      Degrau contínuo que trava as duas metades nas paredes
                    </span>
                  </span>
                  <Switch
                    checked={params.cutConnector === "male-female"}
                    onCheckedChange={(value) => {
                      setParam("cutConnector", value ? "male-female" : "none");
                      if (value) {
                        setParam("cutConnectorThickness", Math.min(params.depth * 0.6, 60));
                        setEncaixeOpen(true);
                      }
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                      encaixeOpen && params.cutConnector === "male-female" ? "rotate-180" : "",
                    )}
                  />
                </button>
                {params.cutConnector === "male-female" && encaixeOpen ? (
                  <div className="space-y-3 border-t border-border p-3">
                    <Field label="Lado macho">
                      <div className="grid grid-cols-2 gap-2">
                        {(["part-1", "part-2"] as const).map((side) => (
                          <button
                            key={side}
                            type="button"
                            onClick={() => setParam("cutMaleSide", side)}
                            className={cn(
                              "rounded-md border px-3 py-1.5 text-sm font-medium transition",
                              params.cutMaleSide === side
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-border bg-background text-muted-foreground hover:border-primary/40",
                            )}
                          >
                            {side === "part-1" ? "Parte 1" : "Parte 2"}
                          </button>
                        ))}
                      </div>
                    </Field>
                    <div className="grid grid-cols-2 gap-3">
                      <NumberSlider
                        label="Profundidade"
                        keyName="cutConnectorDepth"
                        min={0.4}
                        max={20}
                        step={0.2}
                      />
                      <NumberSlider
                        label="Altura na parede"
                        keyName="cutConnectorThickness"
                        min={0.4}
                        max={Math.min(params.depth, 60)}
                        step={0.2}
                      />
                    </div>
                    <NumberSlider
                      label="Folga macho/fêmea"
                      keyName="cutConnectorClearance"
                      min={0}
                      max={1.5}
                      step={0.05}
                    />
                    <p className="flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      Aplicado só nas paredes (laterais). Se o plano cruzar uma curva muito
                      fechada da letra, você recebe um aviso e pode ajustar o ângulo.
                    </p>
                  </div>
                ) : null}
              </div>

              <div className="sticky bottom-0 -mx-3 flex gap-2 border-t border-border bg-panel px-3 pb-1 pt-2">
                <Button type="button" className="h-9 flex-1 gap-1.5 text-sm" onClick={applyCut}>
                  <Scissors className="h-3.5 w-3.5" />
                  Aplicar corte
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-9"
                  disabled={!params.manualCuts.length}
                  onClick={() => setParam("manualCuts", [])}
                  aria-label="Limpar cortes"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>

              {params.manualCuts.length ? (
                <div className="space-y-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Cortes aplicados ({params.manualCuts.length})
                  </p>
                  {params.manualCuts.map((cut, index) => (
                    <div
                      key={cut.id}
                      className="flex items-center justify-between gap-2 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="grid h-5 w-5 shrink-0 place-items-center rounded bg-muted text-[10px] font-semibold">
                          {index + 1}
                        </span>
                        <span className="truncate">
                          {cut.target === "all" ? "Todas" : cut.target} · {cut.angle}°
                          {cut.connector === "male-female" ? " · encaixe" : ""}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setParam(
                            "manualCuts",
                            params.manualCuts.filter((item) => item.id !== cut.id),
                          )
                        }
                        className="shrink-0 text-muted-foreground hover:text-foreground"
                        aria-label={`Remover corte ${index + 1}`}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                  <p className="pt-0.5 text-[11px] text-muted-foreground">
                    Ajuste o plano e clique em "Aplicar corte" de novo pra dividir em mais
                    segmentos. Os cortes aplicados são mantidos na exportação.
                  </p>
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
