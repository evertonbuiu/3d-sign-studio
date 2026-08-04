import { Boxes, Clock, DollarSign, Ruler, Weight, Zap } from "lucide-react";

import { brl } from "@/lib/sign/cost";
import { useEditor } from "./store";

function Metric({
  icon: Icon,
  label,
  value,
  strong,
}: {
  icon: typeof Boxes;
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex min-w-[130px] items-center gap-2.5 px-4">
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="leading-tight">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className={strong ? "text-sm font-semibold text-primary" : "text-sm font-medium"}>
          {value}
        </div>
      </div>
    </div>
  );
}

export default function CostBar() {
  const { build, cost, params } = useEditor();
  if (!build || !cost) {
    return (
      <div className="flex h-16 items-center border-t border-border bg-panel px-4 text-xs text-muted-foreground">
        Calculando orçamento...
      </div>
    );
  }

  const dims = `${Math.round(build.width)} × ${Math.round(build.height)} × ${Math.round(build.depth)} mm`;
  const ledPower = (build.ledLengthMm / 1000) * params.ledPowerPerMeter;

  return (
    <div className="flex h-16 items-center divide-x divide-border overflow-x-auto border-t border-border bg-panel">
      <Metric icon={Ruler} label="Dimensões" value={dims} />
      <Metric icon={Boxes} label="Volume impresso" value={`${build.printedVolumeCm3.toFixed(1)} cm³`} />
      <Metric icon={Weight} label="Peso estimado" value={`${cost.weightG.toFixed(0)} g`} />
      <Metric icon={Clock} label="Tempo de impressão" value={`${cost.hours.toFixed(1)} h`} />
      <Metric
        icon={Zap}
        label="Fita de LED"
        value={params.led ? `${(build.ledLengthMm / 1000).toFixed(2)} m · ${ledPower.toFixed(1)} W` : "—"}
      />
      <Metric icon={DollarSign} label="Custo" value={brl(cost.subtotal)} />
      <Metric icon={DollarSign} label="Preço de venda" value={brl(cost.total)} strong />
    </div>
  );
}
