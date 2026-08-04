import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const paramsSchema = z.record(z.string(), z.unknown());

export const listSignProjects = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("sign_projects")
      .select("id, name, style_id, text, updated_at")
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getSignProject = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("sign_projects")
      .select("id, name, style_id, text, params, updated_at")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return row;
  });

export const saveSignProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid().nullable().optional(),
        name: z.string().min(1).max(120),
        styleId: z.string().min(1),
        text: z.string().max(120),
        params: paramsSchema,
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const payload = {
      user_id: context.userId,
      name: data.name,
      style_id: data.styleId,
      text: data.text,
      params: data.params as never,
    };

    if (data.id) {
      const { data: row, error } = await context.supabase
        .from("sign_projects")
        .update(payload)
        .eq("id", data.id)
        .select("id, name, updated_at")
        .single();
      if (error) throw new Error(error.message);
      return row;
    }

    const { data: row, error } = await context.supabase
      .from("sign_projects")
      .insert(payload)
      .select("id, name, updated_at")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const deleteSignProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("sign_projects").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
