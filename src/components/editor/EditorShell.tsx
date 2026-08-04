import { lazy, Suspense } from "react";
import { ClientOnly } from "@tanstack/react-router";

import CostBar from "./CostBar";
import PropertiesPanel from "./PropertiesPanel";
import StyleLibrary from "./StyleLibrary";
import Toolbar from "./Toolbar";
import { EditorProvider, useEditorState } from "./store";

const Viewport = lazy(() => import("./Viewport"));

function ViewportFallback() {
  return (
    <div className="absolute inset-0 grid place-items-center bg-viewport text-sm text-muted-foreground">
      Preparando visualização 3D...
    </div>
  );
}

export default function EditorShell() {
  const state = useEditorState();

  return (
    <EditorProvider value={state}>
      <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
        <Toolbar />
        <div className="grid min-h-0 flex-1 grid-cols-[280px_1fr_380px] grid-rows-[minmax(0,1fr)] overflow-hidden">
          <div className="min-h-0 overflow-hidden"><StyleLibrary /></div>
          <div className="relative min-h-0 overflow-hidden">
            <ClientOnly fallback={<ViewportFallback />}>
              <Suspense fallback={<ViewportFallback />}>
                <Viewport />
              </Suspense>
            </ClientOnly>
          </div>
          <div className="min-h-0 overflow-hidden"><PropertiesPanel /></div>
        </div>
        <CostBar />
      </div>
    </EditorProvider>
  );
}
