import { toast } from "sonner";
import { Eye, EyeOff, RotateCcw, Scissors, Trash2, Undo2, Upload, X } from "lucide-react";
import { Box3, Vector3 } from "three";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { FONTS, type FontId } from "@/lib/sign/fonts";
import type { PartKind, SignParams } from "@/lib/sign/model";
import { PRINTER_PROFILES } from "@/lib/sign/printers";
import { geometryCrossesCutPlane } from "@/lib/sign/split";
import { useEditor } from "./store";

const MAX_VECTOR_FILE_BYTES = 2_000_000;
const MAX_FONT_FILE_BYTES = 5_000_000;

function validateVectorFile(file: File): boolean {
  if (file.size <= MAX_VECTOR_FILE_BYTES) return true;
  toast.error("O arquivo vetorial deve ter no máximo 2 MB.");
  return false;
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

export function NumberSlider({
  label,
  keyName,
  min,
  max,
  step = 0.1,
  unit = "mm",
}: {
  label: string;
  keyName: keyof SignParams;
  min: number;
  max: number;
  step?: number;
  unit?: string;
}) {
  const { params, setParam } = useEditor();
  const value = Number(params[keyName]);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium text-muted-foreground">{label}</Label>
        <span className="text-sm tabular-nums text-foreground">
          {value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} {unit}
        </span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={([v]) => setParam(keyName, v as never)}
      />
    </div>
  );
}

function ColorField({ label, keyName }: { label: string; keyName: keyof SignParams }) {
  const { params, setParam } = useEditor();
  return (
    <div className="flex items-center justify-between gap-2">
      <Label className="text-sm font-medium text-muted-foreground">{label}</Label>
      <input
        type="color"
        value={String(params[keyName])}
        onChange={(e) => setParam(keyName, e.target.value as never)}
        className="h-7 w-12 cursor-pointer rounded border border-border bg-card"
      />
    </div>
  );
}

export function MoneyField({
  label,
  keyName,
  step = 1,
}: {
  label: string;
  keyName: keyof SignParams;
  step?: number;
}) {
  const { params, setParam } = useEditor();
  return (
    <Field label={label}>
      <Input
        type="number"
        step={step}
        value={Number(params[keyName])}
        onChange={(e) => setParam(keyName, Number(e.target.value) as never)}
        className="h-9 bg-card text-sm"
      />
    </Field>
  );
}

export default function PropertiesPanel() {
  const {
    params,
    setParam,
    style,
    build,
    hidden,
    togglePart,
    explode,
    setExplode,
    wireframe,
    setWireframe,
    showOutlines,
    setShowOutlines,
    svgName,
    vectorKind,
    setSvg,
    setDxf,
    clearSvg,
    customFontName,
    setCustomFont,
    clearCustomFont,
    selectPrinter,
  } = useEditor();

  return (
    <div className="flex h-full flex-col border-l border-border bg-panel">
      <div className="border-b border-border p-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Propriedades
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{style.description}</p>
      </div>

      <div className="flex-1 overflow-y-auto">
        <Accordion type="multiple" defaultValue={["texto", "construcao", "led"]} className="px-3">
          <AccordionItem value="texto">
            <AccordionTrigger className="text-sm">Texto e fonte</AccordionTrigger>
            <AccordionContent className="space-y-3 pb-4">
              <Field label="Texto">
                <Input
                  value={params.text}
                  onChange={(e) => setParam("text", e.target.value)}
                  className="h-9 bg-card font-display text-sm"
                  maxLength={40}
                  disabled={Boolean(svgName)}
                />
              </Field>
              <Field label="Importar vetor (SVG / DXF)">
                {svgName ? (
                  <div className="flex items-center gap-2 rounded border border-border bg-card px-3 py-2">
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
                      {vectorKind}
                    </span>
                    <span className="flex-1 truncate text-sm">{svgName}</span>
                    <button
                      type="button"
                      onClick={clearSvg}
                      className="text-muted-foreground hover:text-foreground"
                      title="Remover arquivo e voltar ao texto"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex h-9 cursor-pointer items-center justify-center gap-2 rounded border border-dashed border-border bg-card px-2 text-sm text-muted-foreground hover:border-primary hover:text-foreground">
                      <Upload className="h-4 w-4" />
                      .svg
                      <input
                        type="file"
                        accept=".svg,image/svg+xml"
                        className="hidden"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          if (!validateVectorFile(file)) {
                            e.target.value = "";
                            return;
                          }
                          setSvg(file.name, await file.text());
                          e.target.value = "";
                        }}
                      />
                    </label>
                    <label className="flex h-9 cursor-pointer items-center justify-center gap-2 rounded border border-dashed border-border bg-card px-2 text-sm text-muted-foreground hover:border-primary hover:text-foreground">
                      <Upload className="h-4 w-4" />
                      .dxf
                      <input
                        type="file"
                        accept=".dxf,image/vnd.dxf,application/dxf"
                        className="hidden"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          if (!validateVectorFile(file)) {
                            e.target.value = "";
                            return;
                          }
                          const content = await file.text();
                          e.target.value = "";
                          const { dxfToShapes } = await import("@/lib/sign/dxf");
                          if (!dxfToShapes(content).length) {
                            toast.error(
                              "Nenhum contorno fechado encontrado no DXF. Use polilinhas/círculos fechados (sem textos ou hachuras).",
                            );
                            return;
                          }
                          setDxf(file.name, content);
                        }}
                      />
                    </label>
                  </div>
                )}
              </Field>

              <Field label="Fonte">
                <Select
                  value={customFontName ? "__custom__" : params.fontId}
                  onValueChange={(v) => {
                    if (v === "__custom__") return;
                    clearCustomFont();
                    setParam("fontId", v as FontId);
                  }}
                >
                  <SelectTrigger className="h-9 bg-card text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {customFontName ? (
                      <SelectItem value="__custom__" className="text-sm">
                        {customFontName} (local)
                      </SelectItem>
                    ) : null}
                    {FONTS.map((f) => (
                      <SelectItem key={f.id} value={f.id} className="text-sm">
                        {f.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <label className="mt-2 flex h-9 cursor-pointer items-center justify-center gap-2 rounded border border-dashed border-border bg-card px-2 text-sm text-muted-foreground hover:border-primary hover:text-foreground">
                  <Upload className="h-4 w-4" />
                  Importar fonte local (.ttf / .otf)
                  <input
                    type="file"
                    accept=".ttf,.otf,font/ttf,font/otf"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (!file) return;
                      if (file.size > MAX_FONT_FILE_BYTES) {
                        toast.error("A fonte deve ter no máximo 5 MB.");
                        return;
                      }
                      if (!/\.(ttf|otf)$/i.test(file.name)) {
                        toast.error("Selecione uma fonte TTF ou OTF válida.");
                        return;
                      }
                      try {
                        setCustomFont(
                          file.name.replace(/\.(ttf|otf)$/i, ""),
                          await file.arrayBuffer(),
                        );
                        toast.success(`Fonte ${file.name} carregada localmente.`);
                      } catch {
                        toast.error(
                          "Não foi possível ler essa fonte. Verifique se o arquivo TTF/OTF é válido.",
                        );
                      }
                    }}
                  />
                </label>
                {customFontName ? (
                  <button
                    type="button"
                    onClick={clearCustomFont}
                    className="mt-2 w-full text-xs text-muted-foreground hover:text-foreground"
                  >
                    Remover fonte local
                  </button>
                ) : null}
              </Field>
              <NumberSlider
                label="Altura da letra"
                keyName="letterHeight"
                min={30}
                max={800}
                step={5}
              />
              <NumberSlider label="Espaçamento" keyName="tracking" min={-10} max={40} step={0.5} />
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="construcao">
            <AccordionTrigger className="text-sm">Construção</AccordionTrigger>
            <AccordionContent className="space-y-3 pb-4">
              {style.id !== "neon-flex-fundo-impresso" ? (
                <NumberSlider label="Profundidade" keyName="depth" min={5} max={200} step={1} />
              ) : null}
              <NumberSlider label="Parede" keyName="wall" min={0.8} max={12} step={0.1} />
              {style.id !== "neon-flex-fundo-impresso" ? (
                <NumberSlider
                  label="Frente"
                  keyName="faceThickness"
                  min={0.6}
                  max={60}
                  step={0.2}
                />
              ) : null}
              <NumberSlider label="Fundo" keyName="backThickness" min={0.6} max={20} step={0.2} />
              {style.id === "neon-flex-fundo-impresso" ? (
                <div className="space-y-3 rounded-md border border-border bg-background/40 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Encaixe do Neon Flex
                  </p>
                  <NumberSlider
                    label="Espessura do Neon Flex"
                    keyName="neonFlexThickness"
                    min={4}
                    max={30}
                    step={0.5}
                  />
                  <p className="text-xs text-muted-foreground">
                    Define a largura livre do canal que acompanha somente o contorno da letra. Este
                    estilo não gera tampa.
                  </p>
                  <p className="text-xs font-medium text-muted-foreground">
                    Altura total impressa:{" "}
                    {(params.backThickness + params.neonFlexThickness).toFixed(1)} mm
                  </p>
                </div>
              ) : null}
              {style.id !== "neon-flex-fundo-impresso" ? (
                <>
                  <NumberSlider
                    label="Folga de encaixe"
                    keyName="clearance"
                    min={0}
                    max={1.5}
                    step={0.05}
                  />
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-medium text-muted-foreground">
                      Rebaixo para a frente
                    </Label>
                    <Switch
                      checked={params.faceRecess}
                      onCheckedChange={(v) => setParam("faceRecess", v)}
                    />
                  </div>
                  {params.faceRecess ? (
                    <NumberSlider
                      label="Aba do rebaixo"
                      keyName="recessLip"
                      min={0.4}
                      max={Math.max(params.wall - 0.4, 0.6)}
                      step={0.1}
                    />
                  ) : null}
                </>
              ) : null}
              {style.id === "fundo-acrilico-frente-acrilica-aba" ||
              style.id === "fundo-impresso-frente-impressa-aba" ? (
                <div className="space-y-3 rounded-md border border-border bg-background/40 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {style.id === "fundo-impresso-frente-impressa-aba"
                      ? "Aba de encaixe do fundo"
                      : "Aba traseira"}
                  </p>
                  <NumberSlider
                    label="Largura da aba"
                    keyName="backFlangeWidth"
                    min={0.6}
                    max={30}
                    step={0.1}
                  />
                  <NumberSlider
                    label="Espessura da aba"
                    keyName="backFlangeThickness"
                    min={0.6}
                    max={20}
                    step={0.2}
                  />
                </div>
              ) : null}
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="transformacao">
            <AccordionTrigger className="text-sm">Rotação e espelho</AccordionTrigger>
            <AccordionContent className="space-y-3 pb-4">
              <NumberSlider
                label="Rotação do modelo"
                keyName="modelRotation"
                min={-180}
                max={180}
                step={1}
                unit="°"
              />
              <div className="grid grid-cols-5 gap-1">
                {[0, 45, 90, 135].map((angle) => (
                  <Button
                    key={angle}
                    type="button"
                    size="sm"
                    variant={params.modelRotation === angle ? "default" : "outline"}
                    onClick={() => setParam("modelRotation", angle)}
                  >
                    {angle}°
                  </Button>
                ))}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setParam("modelRotation", 0)}
                  aria-label="Restaurar rotação"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="flex items-center justify-between gap-3 rounded border border-border p-2">
                <Label className="text-sm font-medium text-muted-foreground">
                  Espelho horizontal
                </Label>
                <Switch
                  checked={params.mirrorHorizontal}
                  onCheckedChange={(value) => setParam("mirrorHorizontal", value)}
                />
              </div>
              <div className="flex items-center justify-between gap-3 rounded border border-border p-2">
                <Label className="text-sm font-medium text-muted-foreground">
                  Espelho vertical
                </Label>
                <Switch
                  checked={params.mirrorVertical}
                  onCheckedChange={(value) => setParam("mirrorVertical", value)}
                />
              </div>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => {
                  setParam("modelRotation", 0);
                  setParam("mirrorHorizontal", false);
                  setParam("mirrorVertical", false);
                }}
              >
                Restaurar orientação
              </Button>
              <p className="text-xs text-muted-foreground">
                A orientação é aplicada na visualização, nos cortes e nos arquivos STL exportados.
              </p>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="led">
            <AccordionTrigger className="text-sm">Iluminação</AccordionTrigger>
            <AccordionContent className="space-y-3 pb-4">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium text-muted-foreground">LED ativo</Label>
                <Switch checked={params.led} onCheckedChange={(v) => setParam("led", v)} />
              </div>
              <NumberSlider
                label="Largura do canal"
                keyName="ledChannelWidth"
                min={3}
                max={40}
                step={0.5}
              />
              <NumberSlider
                label="Altura do canal"
                keyName="ledChannelHeight"
                min={2}
                max={30}
                step={0.5}
              />
              <NumberSlider
                label="Afastamento da parede"
                keyName="ledOffset"
                min={0}
                max={25}
                step={0.5}
              />
              <NumberSlider
                label="Potência da fita"
                keyName="ledPowerPerMeter"
                min={2}
                max={30}
                step={0.2}
                unit="W/m"
              />
              <ColorField label="Cor da luz" keyName="ledColor" />
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="corpo">
            <AccordionTrigger className="text-sm">Placa, totem e camadas</AccordionTrigger>
            <AccordionContent className="space-y-3 pb-4">
              <Field label="Modo do corpo">
                <Select
                  value={params.bodyMode}
                  onValueChange={(v) => setParam("bodyMode", v as SignParams["bodyMode"])}
                >
                  <SelectTrigger className="h-9 bg-card text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="letras" className="text-sm">
                      Letras soltas
                    </SelectItem>
                    <SelectItem value="placa" className="text-sm">
                      Placa
                    </SelectItem>
                    <SelectItem value="totem" className="text-sm">
                      Totem
                    </SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <NumberSlider
                label="Margem da placa"
                keyName="plateMargin"
                min={5}
                max={200}
                step={1}
              />
              <NumberSlider
                label="Espessura da placa"
                keyName="plateThickness"
                min={2}
                max={40}
                step={0.5}
              />
              <NumberSlider
                label="Altura do poste"
                keyName="poleHeight"
                min={100}
                max={2000}
                step={10}
              />
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium text-muted-foreground">Letras vazadas</Label>
                <Switch checked={params.cutout} onCheckedChange={(v) => setParam("cutout", v)} />
              </div>
              <NumberSlider
                label="Espessura da camada"
                keyName="layerThickness"
                min={1}
                max={30}
                step={0.5}
              />
              <NumberSlider
                label="Redução por camada"
                keyName="layerShrink"
                min={1}
                max={40}
                step={0.5}
              />
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="custos">
            <AccordionTrigger className="text-sm">Custos e produção</AccordionTrigger>
            <AccordionContent className="space-y-3 pb-4">
              <Field label="Modelo da impressora 3D">
                <Select value={params.printerId} onValueChange={selectPrinter}>
                  <SelectTrigger className="h-9 bg-card text-sm">
                    <SelectValue placeholder="Selecione a impressora" />
                  </SelectTrigger>
                  <SelectContent>
                    {PRINTER_PROFILES.map((printer) => (
                      <SelectItem key={printer.id} value={printer.id}>
                        {printer.manufacturer} — {printer.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <div className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
                Volume útil: {params.buildWidth} × {params.buildDepth} × {params.buildHeight} mm
                <br />
                Bico: {params.nozzleDiameter} mm · Filamento: {params.filamentDiameter} mm
                <br />
                Velocidade máxima: {params.maxPrintSpeed} mm/s
              </div>
              <div className="grid grid-cols-3 gap-2">
                <MoneyField label="Mesa X (mm)" keyName="buildWidth" />
                <MoneyField label="Mesa Y (mm)" keyName="buildDepth" />
                <MoneyField label="Altura Z (mm)" keyName="buildHeight" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <MoneyField label="Bico (mm)" keyName="nozzleDiameter" step={0.1} />
                <MoneyField label="Filamento (mm)" keyName="filamentDiameter" step={0.05} />
              </div>
              <MoneyField label="Velocidade máxima (mm/s)" keyName="maxPrintSpeed" />
              <MoneyField label="Filamento (R$/kg)" keyName="filamentPrice" />
              <MoneyField label="Densidade (g/cm³)" keyName="density" step={0.01} />
              <MoneyField label="Velocidade (cm³/h)" keyName="printSpeed" />
              <MoneyField label="Mão de obra (R$/h)" keyName="hourlyRate" />
              <MoneyField label="Energia (R$/kWh)" keyName="energyPrice" step={0.01} />
              <MoneyField label="Potência da impressora (W)" keyName="printerPower" />
              <MoneyField label="Margem (%)" keyName="margin" />
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="corte">
            <AccordionTrigger className="text-sm">Corte e encaixe</AccordionTrigger>
            <AccordionContent className="space-y-4 pb-4">
              <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-background/40 p-3">
                <div>
                  <Label className="text-sm font-medium text-muted-foreground">
                    Ativar ferramenta de corte
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Configure o plano e o encaixe antes de exportar.
                  </p>
                </div>
                <Switch
                  checked={params.splitForBuildPlate}
                  onCheckedChange={(value) => setParam("splitForBuildPlate", value)}
                />
              </div>
              {params.splitForBuildPlate ? (
                <>
                  <Field label="Modo do corte">
                    <Select
                      value={params.splitMode}
                      onValueChange={(value) =>
                        setParam("splitMode", value as SignParams["splitMode"])
                      }
                    >
                      <SelectTrigger className="h-9 bg-card text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="manual">Plano manual</SelectItem>
                        <SelectItem value="automatic">Automático pela mesa</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  {params.splitMode === "automatic" ? (
                    <MoneyField label="Margem da mesa (mm)" keyName="splitMargin" step={1} />
                  ) : (
                    <>
                      <Field label="Aplicar em">
                        <Select
                          value={params.manualCutTarget}
                          onValueChange={(value) =>
                            setParam("manualCutTarget", value as PartKind | "all")
                          }
                        >
                          <SelectTrigger className="h-9 bg-card text-sm">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">Todas as peças</SelectItem>
                            {Array.from(new Set(style.parts)).map((kind) => (
                              <SelectItem key={kind} value={kind}>
                                {kind === "laterais" ? "Somente paredes" : `Somente ${kind}`}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Field>
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
                      <div className="space-y-3 rounded-md border border-border bg-background/40 p-3">
                        <Field label="Encaixe no corte">
                          <Select
                            value={params.cutConnector}
                            onValueChange={(value) => {
                              setParam("cutConnector", value as SignParams["cutConnector"]);
                              if (value === "male-female") {
                                setParam("cutConnectorThickness", Math.min(params.depth * 0.6, 60));
                              }
                            }}
                          >
                            <SelectTrigger className="h-9 bg-card text-sm">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">Sem encaixe</SelectItem>
                              <SelectItem value="male-female">
                                Rebaixo nas paredes (macho e fêmea)
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </Field>
                        {params.cutConnector === "male-female" ? (
                          <>
                            <Field label="Lado macho">
                              <Select
                                value={params.cutMaleSide}
                                onValueChange={(value) =>
                                  setParam("cutMaleSide", value as SignParams["cutMaleSide"])
                                }
                              >
                                <SelectTrigger className="h-9 bg-card text-sm">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="part-1">Parte 1</SelectItem>
                                  <SelectItem value="part-2">Parte 2</SelectItem>
                                </SelectContent>
                              </Select>
                            </Field>
                            <NumberSlider
                              label="Profundidade do encaixe"
                              keyName="cutConnectorDepth"
                              min={0.4}
                              max={20}
                              step={0.2}
                            />
                            <NumberSlider
                              label="Altura do degrau na parede"
                              keyName="cutConnectorThickness"
                              min={0.4}
                              max={Math.min(params.depth, 60)}
                              step={0.2}
                            />
                            <NumberSlider
                              label="Largura na espessura da parede"
                              keyName="cutConnectorWidth"
                              min={10}
                              max={100}
                              step={5}
                              unit="%"
                            />
                            <p className="text-xs leading-relaxed text-muted-foreground">
                              O macho ocupa a faixa interna da espessura da parede. Em 50%, a metade
                              externa permanece como ombro de apoio, sem fechar o interior.
                            </p>
                            <NumberSlider
                              label="Folga macho/fêmea"
                              keyName="cutConnectorClearance"
                              min={0}
                              max={1.5}
                              step={0.05}
                            />
                          </>
                        ) : null}
                      </div>
                      <div className="space-y-3 rounded-md border border-border bg-background/40 p-3">
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            className="flex-1"
                            onClick={() => {
                              const targets = (build?.parts ?? []).filter(
                                (part) =>
                                  !hidden.has(part.id) &&
                                  (params.manualCutTarget === "all" ||
                                    part.kind === params.manualCutTarget),
                              );
                              const bounds = new Box3();
                              for (const part of targets) {
                                part.geometry.computeBoundingBox();
                                if (part.geometry.boundingBox) bounds.union(part.geometry.boundingBox);
                              }
                              const center = bounds.getCenter(new Vector3());
                              const origin = { x: center.x, y: center.y };
                              const crosses = targets.some((part) =>
                                geometryCrossesCutPlane(part.geometry, {
                                  angle: params.manualCutAngle,
                                  offset: params.manualCutOffset,
                                  origin,
                                }),
                              );
                              if (!targets.length || !crosses) {
                                toast.error("O plano não atravessa nenhuma peça do alvo selecionado.");
                                return;
                              }
                              const duplicate = params.manualCuts.some(
                                (cut) =>
                                  cut.target === params.manualCutTarget &&
                                  Math.abs(cut.angle - params.manualCutAngle) < 0.01 &&
                                  Math.abs(cut.offset - params.manualCutOffset) < 0.01,
                              );
                              if (duplicate) {
                                toast.error("Este corte já foi aplicado.");
                                return;
                              }
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
                            }}
                          >
                            <Scissors className="mr-2 h-4 w-4" />
                            Aplicar corte
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            disabled={!params.manualCuts.length}
                            onClick={() =>
                              setParam("manualCuts", params.manualCuts.slice(0, -1))
                            }
                            aria-label="Desfazer último corte"
                          >
                            <Undo2 className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            disabled={!params.manualCuts.length}
                            onClick={() => setParam("manualCuts", [])}
                            aria-label="Limpar cortes"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Arraste/ajuste o plano, aplique e repita para dividir a peça em três ou
                          mais segmentos. Os cortes aplicados são mantidos na exportação.
                        </p>
                        {params.manualCuts.length ? (
                          <div className="space-y-1">
                            {params.manualCuts.map((cut, index) => (
                              <div
                                key={cut.id}
                                className="flex items-center justify-between rounded border border-border px-2 py-1 text-xs"
                              >
                                <span>
                                  #{index + 1} · {cut.target === "all" ? "todas" : cut.target} ·{" "}
                                  {cut.angle}°
                                </span>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6"
                                  onClick={() =>
                                    setParam(
                                      "manualCuts",
                                      params.manualCuts.filter((item) => item.id !== cut.id),
                                    )
                                  }
                                  aria-label={`Remover corte ${index + 1}`}
                                >
                                  <X className="h-3 w-3" />
                                </Button>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </>
                  )}
                </>
              ) : null}
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="pecas">
            <AccordionTrigger className="text-sm">Peças do modelo</AccordionTrigger>
            <AccordionContent className="space-y-3 pb-4">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium text-muted-foreground">Modo wireframe</Label>
                <Switch checked={wireframe} onCheckedChange={setWireframe} />
              </div>
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium text-muted-foreground">
                  Contornos e offsets
                </Label>
                <Switch checked={showOutlines} onCheckedChange={setShowOutlines} />
              </div>
              {showOutlines && (
                <div className="grid grid-cols-2 gap-1 rounded border border-border bg-card p-2 text-xs">
                  {[
                    ["#0f172a", "Contorno da letra"],
                    ["#2563eb", "Parede interna"],
                    ["#f59e0b", "Canal LED"],
                    ["#10b981", "Difusor (folga)"],
                    ["#64748b", "Placa"],
                    ["#dc2626", "Furos"],
                  ].map(([color, label]) => (
                    <span key={label} className="flex items-center gap-1.5">
                      <span
                        className="h-2 w-4 rounded-sm"
                        style={{ background: color as string }}
                      />
                      {label}
                    </span>
                  ))}
                </div>
              )}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium text-muted-foreground">
                    Vista explodida
                  </Label>
                  <span className="text-sm tabular-nums">{explode.toFixed(0)} mm</span>
                </div>
                <Slider
                  value={[explode]}
                  min={0}
                  max={120}
                  step={1}
                  onValueChange={([v]) => setExplode(v ?? 0)}
                />
              </div>
              <div className="space-y-1">
                {build?.parts.map((part) => (
                  <button
                    key={part.id}
                    type="button"
                    onClick={() => togglePart(part.id)}
                    className="flex w-full items-center justify-between rounded border border-border bg-card px-2 py-1.5 text-left text-sm hover:border-primary/50"
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className="h-3 w-3 rounded-sm border border-border"
                        style={{ background: part.color }}
                      />
                      {part.name}
                    </span>
                    <span className="flex items-center gap-2 text-muted-foreground">
                      {part.volumeCm3.toFixed(1)} cm³
                      {hidden.has(part.id) ? (
                        <EyeOff className="h-3.5 w-3.5" />
                      ) : (
                        <Eye className="h-3.5 w-3.5" />
                      )}
                    </span>
                  </button>
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
    </div>
  );
}
