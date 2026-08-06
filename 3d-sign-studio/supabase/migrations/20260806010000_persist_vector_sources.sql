ALTER TABLE public.sign_projects
  ADD COLUMN vector_name TEXT,
  ADD COLUMN vector_kind TEXT,
  ADD COLUMN vector_content TEXT;

ALTER TABLE public.sign_projects
  ADD CONSTRAINT sign_projects_vector_kind_check
  CHECK (vector_kind IS NULL OR vector_kind IN ('svg', 'dxf')),
  ADD CONSTRAINT sign_projects_vector_source_complete_check
  CHECK (
    (vector_name IS NULL AND vector_kind IS NULL AND vector_content IS NULL)
    OR
    (vector_name IS NOT NULL AND vector_kind IS NOT NULL AND vector_content IS NOT NULL)
  ),
  ADD CONSTRAINT sign_projects_vector_content_size_check
  CHECK (vector_content IS NULL OR octet_length(vector_content) <= 2000000);
