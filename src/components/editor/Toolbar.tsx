import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import JSZip from "jszip";
import {
  Box,
  CloudUpload,
  Download,
  FolderOpen,
  LogIn,
  LogOut,
  Scissors,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import type { User } from "@supabase/supabase-js";
import { Box3, Vector3 } from "three";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { isSupabaseConfigured, supabase } from "@/integrations/supabase/client";
import { geometriesToStl, downloadBlob, slugify } from "@/lib/sign/stl";
import {
  splitGeometryByPlane,
  splitGeometryByPlanes,
  splitGeometryForBuildPlate,
  partSupportsCutConnector,
} from "@/lib/sign/split";
import { transformGeometryForPlacement } from "@/lib/sign/placement";
import {
  deleteSignProject,
  getSignProject,
  listSignProjects,
  saveSignProject,
} from "@/lib/signProjects.functions";
import { useEditor } from "./store";

export default function Toolbar() {
  const editor = useEditor();
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    supabase.auth.getUser().then(({ data }) => setUser(data.user ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        setUser(session?.user ?? null);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const list = useServerFn(listSignProjects);
  const load = useServerFn(getSignProject);
  const save = useServerFn(saveSignProject);
  const remove = useServerFn(deleteSignProject);

  const projects = useQuery({
    queryKey: ["sign-projects"],
    queryFn: () => list(),
    enabled: Boolean(user) && open,
  });

  const saveMutation = useMutation({
    mutationFn: () =>
      save({
        data: {
          id: editor.projectId,
          name: editor.projectName,
          styleId: editor.style.id,
          text: editor.params.text,
          params: editor.params as unknown as Record<string, unknown>,
          vectorSource: editor.vectorSource,
        },
      }),
    onSuccess: (row) => {
      if (row) editor.setProject(row.id, row.name);
      queryClient.invalidateQueries({ queryKey: ["sign-projects"] });
      toast.success("Projeto salvo na nuvem");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function exportStl(mode: "unico" | "pecas") {
    const build = editor.build;
    if (!build) return;
    const sourceParts = build.parts.filter((p) => !editor.hidden.has(p.id));
    if (!sourceParts.length) {
      toast.error("Nenhuma peça visível para exportar");
      return;
    }
    const sourceBounds = new Box3();
    for (const part of sourceParts) {
      part.geometry.computeBoundingBox();
      if (part.geometry.boundingBox) sourceBounds.union(part.geometry.boundingBox);
    }
    const sourceCenter = sourceBounds.getCenter(new Vector3());
    const placement = {
      rotation: editor.params.modelRotation,
      mirrorX: editor.params.mirrorHorizontal,
      mirrorY: editor.params.mirrorVertical,
    };
    const parts = sourceParts.map((part) => ({
      ...part,
      geometry: transformGeometryForPlacement(part.geometry, placement, sourceCenter),
    }));
    const base = slugify(editor.params.text || editor.projectName);
    const cutBounds = new Box3();
    for (const part of parts) {
      part.geometry.computeBoundingBox();
      if (part.geometry.boundingBox) cutBounds.union(part.geometry.boundingBox);
    }
    const cutCenter = cutBounds.getCenter(new Vector3());
    const cutOrigin = { x: cutCenter.x, y: cutCenter.y };
    if (mode === "unico" && !editor.params.splitForBuildPlate) {
      const buffer = geometriesToStl(parts.map((p) => p.geometry));
      downloadBlob(buffer, `${base}.stl`, "model/stl");
      toast.success("STL exportado");
      return;
    }
    const zip = new JSZip();
    let exportedSegments = 0;
    // A política do encaixe pertence ao estilo completo, não só às peças
    // visíveis/exportadas. Caso contrário, ocultar `Frente + laterais` faria o
    // fundo separado parecer um estilo sem paredes e receber macho/fêmea.
    const styleHasWalls = build.parts.some((part) => part.kind === "laterais");
    for (const part of parts) {
      const connectorEnabled = partSupportsCutConnector(part.kind, styleHasWalls);
      let segments;
      try {
        segments = editor.params.splitForBuildPlate
          ? editor.params.splitMode === "manual"
            ? editor.params.manualCuts.length
              ? (() => {
                  const cuts = editor.params.manualCuts
                    .filter((cut) => cut.target === "all" || cut.target === part.kind)
                    .map((cut) => ({
                      angle: cut.angle,
                      offset: cut.offset,
                      connector: connectorEnabled ? cut.connector : "none" as const,
                      maleSide: cut.maleSide,
                      connectorDepth: cut.connectorDepth,
                      connectorWidth: cut.connectorWidth,
                      connectorThickness: cut.connectorThickness,
                      connectorClearance: cut.connectorClearance,
                      connectorBackInset:
                        part.id === "fundo-laterais" ? editor.params.backThickness : 0,
                      connectorFrontInset:
                        part.id === "frente-laterais" ? editor.params.faceThickness : 0,
                    }));
                  return cuts.length
                    ? splitGeometryByPlanes(part.geometry, cuts, cutOrigin)
                    : [{ geometry: part.geometry, column: 1, row: 1, index: 1, total: 1 }];
                })()
              : splitGeometryByPlane(part.geometry, {
                  angle: editor.params.manualCutAngle,
                  offset: editor.params.manualCutOffset,
                  connector: connectorEnabled ? editor.params.cutConnector : "none",
                  maleSide: editor.params.cutMaleSide,
                  connectorDepth: editor.params.cutConnectorDepth,
                  connectorWidth: editor.params.cutConnectorWidth,
                  connectorThickness: editor.params.cutConnectorThickness,
                  connectorClearance: editor.params.cutConnectorClearance,
                  connectorBackInset:
                    part.id === "fundo-laterais" ? editor.params.backThickness : 0,
                  connectorFrontInset:
                    part.id === "frente-laterais" ? editor.params.faceThickness : 0,
                  origin: cutOrigin,
                })
            : splitGeometryForBuildPlate(part.geometry, {
                width: editor.params.buildWidth,
                depth: editor.params.buildDepth,
                margin: editor.params.splitMargin,
              })
          : [{ geometry: part.geometry, column: 1, row: 1, index: 1, total: 1 }];
      } catch (error) {
        console.error(`Falha ao cortar a peça ${part.name}`, error);
        toast.error(
          `Não foi possível cortar a peça ${part.name}. Ajuste o plano e tente novamente.`,
        );
        return;
      }
      for (const segment of segments) {
        exportedSegments += 1;
        const suffix =
          segment.total > 1
            ? `-segmento-${String(segment.index).padStart(2, "0")}-x${segment.column}-y${segment.row}`
            : "";
        zip.file(`${base}-${slugify(part.name)}${suffix}.stl`, geometriesToStl([segment.geometry]));
      }
    }
    void zip.generateAsync({ type: "blob" }).then((blob) => {
      downloadBlob(blob, `${base}-pecas.zip`, "application/zip");
      toast.success(
        editor.params.splitForBuildPlate
          ? `${exportedSegments} segmentos cortados e exportados em ZIP`
          : "Peças exportadas em ZIP",
      );
    });
  }

  async function openProject(id: string) {
    const row = await load({ data: { id } });
    if (!row) return;
    editor.loadProject({
      id: row.id,
      name: row.name,
      styleId: row.style_id,
      params: (row.params ?? {}) as never,
      vectorSource:
        row.vector_kind && row.vector_name && row.vector_content
          ? {
              kind: row.vector_kind,
              name: row.vector_name,
              content: row.vector_content,
            }
          : null,
    });
    setOpen(false);
    toast.success("Projeto carregado");
  }

  return (
    <header className="flex h-14 items-center gap-3 border-b border-border bg-card px-4">
      <div className="flex items-center gap-2">
        <div className="grid h-8 w-8 place-items-center rounded bg-primary text-primary-foreground">
          <Box className="h-4 w-4" />
        </div>
        <div className="leading-tight">
          <h1 className="font-display text-sm font-bold tracking-tight">Letra 3D line tape</h1>
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Letras e placas paramétricas
          </p>
        </div>
      </div>

      <Input
        value={editor.projectName}
        onChange={(e) => editor.setProject(editor.projectId, e.target.value)}
        className="ml-4 h-8 w-56 text-xs"
        aria-label="Nome do projeto"
      />

      <div className="ml-auto flex items-center gap-2">
        <Button
          size="sm"
          variant={editor.params.splitForBuildPlate ? "default" : "outline"}
          className="h-8 gap-1.5 text-xs"
          title="Configurar e aplicar cortes no modelo"
          onClick={() => {
            const active = !editor.params.splitForBuildPlate;
            editor.setParam("splitForBuildPlate", active);
            toast.success(
              active
                ? "Corte ativado. Configure o modo no painel de produção."
                : "Corte desativado.",
            );
          }}
        >
          <Scissors className="h-3.5 w-3.5" />
          {editor.params.splitForBuildPlate ? "Corte ativo" : "Ferramenta de corte"}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs">
              <Download className="h-3.5 w-3.5" /> Exportar STL
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem className="text-xs" onSelect={() => exportStl("unico")}>
              {editor.params.splitForBuildPlate
                ? "Exportar segmentos cortados (.zip)"
                : "STL combinado — shells separados"}
            </DropdownMenuItem>
            <DropdownMenuItem className="text-xs" onSelect={() => exportStl("pecas")}>
              Peças separadas (.zip)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {user ? (
          <>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs">
                  <FolderOpen className="h-3.5 w-3.5" /> Meus projetos
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Meus projetos</DialogTitle>
                  <DialogDescription>Projetos salvos na sua conta.</DialogDescription>
                </DialogHeader>
                <div className="max-h-80 space-y-1.5 overflow-y-auto">
                  {projects.data?.length ? (
                    projects.data.map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center justify-between rounded border border-border px-3 py-2"
                      >
                        <button
                          type="button"
                          onClick={() => void openProject(p.id)}
                          className="text-left text-sm hover:text-primary"
                        >
                          {p.name}
                          <span className="ml-2 text-xs text-muted-foreground">{p.text}</span>
                        </button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={async () => {
                            await remove({ data: { id: p.id } });
                            void queryClient.invalidateQueries({ queryKey: ["sign-projects"] });
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))
                  ) : (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      Nenhum projeto salvo ainda.
                    </p>
                  )}
                </div>
              </DialogContent>
            </Dialog>

            <Button
              size="sm"
              className="h-8 gap-1.5 text-xs"
              disabled={saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
            >
              <CloudUpload className="h-3.5 w-3.5" /> Salvar
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              title="Sair"
              onClick={async () => {
                await queryClient.cancelQueries();
                queryClient.clear();
                await supabase.auth.signOut();
              }}
            >
              <LogOut className="h-3.5 w-3.5" />
            </Button>
          </>
        ) : (
          <Button asChild size="sm" className="h-8 gap-1.5 text-xs">
            <Link to="/auth">
              <LogIn className="h-3.5 w-3.5" /> Entrar
            </Link>
          </Button>
        )}
      </div>
    </header>
  );
}

