import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Box } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Entrar — 3D Sign Maker PRO" },
      {
        name: "description",
        content: "Acesse sua conta para salvar projetos de letras 3D na nuvem.",
      },
      { property: "og:title", content: "Entrar — 3D Sign Maker PRO" },
      {
        property: "og:description",
        content: "Acesse sua conta para salvar projetos de letras 3D na nuvem.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) void navigate({ to: "/" });
    });
  }, [navigate]);

  async function handlePassword(mode: "entrar" | "criar") {
    setLoading(true);
    try {
      if (mode === "entrar") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        void navigate({ to: "/" });
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        if (data.session) void navigate({ to: "/" });
        else toast.success("Confirme seu e-mail para ativar a conta.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível autenticar");
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      toast.error("Não foi possível entrar com o Google");
      return;
    }
    if (result.redirected) return;
    void navigate({ to: "/" });
  }

  return (
    <main className="grid min-h-screen place-items-center bg-panel px-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-sm">
        <div className="mb-6 flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded bg-primary text-primary-foreground">
            <Box className="h-4 w-4" />
          </div>
          <div>
            <h1 className="font-display text-base font-bold">3D Sign Maker PRO</h1>
            <p className="text-xs text-muted-foreground">Salve seus projetos na nuvem</p>
          </div>
        </div>

        <Button variant="outline" className="w-full" onClick={() => void handleGoogle()}>
          Continuar com Google
        </Button>

        <div className="my-4 flex items-center gap-3 text-[11px] uppercase text-muted-foreground">
          <span className="h-px flex-1 bg-border" /> ou <span className="h-px flex-1 bg-border" />
        </div>

        <Tabs defaultValue="entrar">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="entrar">Entrar</TabsTrigger>
            <TabsTrigger value="criar">Criar conta</TabsTrigger>
          </TabsList>
          {(["entrar", "criar"] as const).map((mode) => (
            <TabsContent key={mode} value={mode} className="space-y-3 pt-4">
              <div className="space-y-1.5">
                <Label className="text-xs">E-mail</Label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="voce@empresa.com.br"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Senha</Label>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                />
              </div>
              <Button
                className="w-full"
                disabled={loading || !email || !password}
                onClick={() => void handlePassword(mode)}
              >
                {mode === "entrar" ? "Entrar" : "Criar conta"}
              </Button>
            </TabsContent>
          ))}
        </Tabs>

        <button
          type="button"
          onClick={() => void navigate({ to: "/" })}
          className="mt-4 w-full text-center text-xs text-muted-foreground hover:text-foreground"
        >
          Continuar sem conta
        </button>
      </div>
    </main>
  );
}
