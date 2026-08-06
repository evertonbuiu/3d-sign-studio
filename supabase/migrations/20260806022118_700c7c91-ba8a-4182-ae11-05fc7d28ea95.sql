ALTER TABLE public.sign_projects
  ADD COLUMN IF NOT EXISTS vector_kind text,
  ADD COLUMN IF NOT EXISTS vector_name text,
  ADD COLUMN IF NOT EXISTS vector_content text;