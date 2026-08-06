CREATE TABLE public.sign_projects (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Projeto sem nome',
  style_id TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  params JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sign_projects TO authenticated;
GRANT ALL ON public.sign_projects TO service_role;

ALTER TABLE public.sign_projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own sign projects"
  ON public.sign_projects FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX sign_projects_user_updated_idx ON public.sign_projects (user_id, updated_at DESC);

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER sign_projects_set_updated_at
BEFORE UPDATE ON public.sign_projects
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();