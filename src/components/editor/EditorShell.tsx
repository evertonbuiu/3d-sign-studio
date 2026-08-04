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
    <div className="grid h-full w-full place-items-center bg-viewport text-sm text-muted-foreground">
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
        <div className="grid min-h-0 flex-1 grid-cols-[240px_1fr_300px]">
          <StyleLibrary />
          <div className="min-h-0">
            <ClientOnly fallback={<ViewportFallback />}>
              <Suspense fallback={<ViewportFallback />}>
                <Viewport />
              </Suspense>
            </ClientOnly>
          </div>
          <PropertiesPanel />
        </div>
        <CostBar />
      </div>
    </EditorProvider>
  );
}
