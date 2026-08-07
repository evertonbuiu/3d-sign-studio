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
import { splitGeometryForBuildPlate } from "@/lib/sign/split";
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
    const parts = build.parts.filter((p) => !editor.hidden.has(p.id));
    if (!parts.length) {
      toast.error("Nenhuma peça visível para exportar");
      return;
    }
    const base = slugify(editor.params.text || editor.projectName);
    if (mode === "unico" && !editor.params.splitForBuildPlate) {
      const buffer = geometriesToStl(parts.map((p) => p.geometry));
      downloadBlob(buffer, `${base}.stl`, "model/stl");
      toast.success("STL exportado");
      return;
    }
    const zip = new JSZip();
    let exportedSegments = 0;
    for (const part of parts) {
      const segments = editor.params.splitForBuildPlate
        ? splitGeometryForBuildPlate(part.geometry, {
            width: editor.params.buildWidth,
            depth: editor.params.buildDepth,
            margin: editor.params.splitMargin,
          })
        : [{ geometry: part.geometry, column: 1, row: 1, index: 1, total: 1 }];
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
          ? `${exportedSegments} segmentos cortados conforme a mesa e exportados em ZIP`
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
          <h1 className="font-display text-sm font-bold tracking-tight">3D Sign Maker PRO</h1>
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
          title="Mostrar e aplicar cortes conforme a mesa da impressora"
          onClick={() => {
            const active = !editor.params.splitForBuildPlate;
            editor.setParam("splitForBuildPlate", active);
            toast.success(
              active
                ? "Corte conforme a mesa ativado. Veja a prévia vermelha no modelo."
                : "Corte conforme a mesa desativado.",
            );
          }}
        >
          <Scissors className="h-3.5 w-3.5" />
          {editor.params.splitForBuildPlate ? "Corte ativo" : "Corte da mesa"}
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
