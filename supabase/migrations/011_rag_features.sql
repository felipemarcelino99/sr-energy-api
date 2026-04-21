-- 1. RPC: match_machine_chunks (referenced in rag.service.ts but never created)
CREATE OR REPLACE FUNCTION match_machine_chunks(
  p_machine_id uuid,
  p_embedding  vector(1024),
  p_limit      int DEFAULT 5
)
RETURNS TABLE(content text, similarity float)
LANGUAGE sql STABLE AS $$
  SELECT content,
         1 - (embedding <=> p_embedding) AS similarity
  FROM machine_chunks
  WHERE machine_id = p_machine_id
  ORDER BY embedding <=> p_embedding
  LIMIT p_limit;
$$;

-- 2. RPC: match_chunks_multi_machine (for comparison feature)
CREATE OR REPLACE FUNCTION match_chunks_multi_machine(
  p_machine_ids uuid[],
  p_embedding   vector(1024),
  p_limit_per   int DEFAULT 5
)
RETURNS TABLE(machine_id uuid, content text, similarity float)
LANGUAGE sql STABLE AS $$
  SELECT machine_id,
         content,
         1 - (embedding <=> p_embedding) AS similarity
  FROM machine_chunks
  WHERE machine_id = ANY(p_machine_ids)
  ORDER BY embedding <=> p_embedding
  LIMIT p_limit_per * array_length(p_machine_ids, 1);
$$;

-- 3. pdf_hash column on machines (used to invalidate overview cache)
ALTER TABLE machines ADD COLUMN IF NOT EXISTS pdf_hash text;

-- 4. Curated answers table
CREATE TABLE IF NOT EXISTS rag_curated_answers (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id         uuid NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  question           text NOT NULL,
  question_embedding vector(1024) NOT NULL,
  answer             text NOT NULL,
  created_by         uuid NOT NULL REFERENCES auth.users(id),
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_curated_machine ON rag_curated_answers(machine_id);

-- 5. Machine overviews cache table
CREATE TABLE IF NOT EXISTS machine_overviews (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id   uuid NOT NULL UNIQUE REFERENCES machines(id) ON DELETE CASCADE,
  content      text NOT NULL,
  pdf_hash     text NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now()
);
