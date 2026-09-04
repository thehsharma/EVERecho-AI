-- OPTIONAL migration: applied only when the pgvector extension is installable.
-- Failure here is recorded in db_capability and is not fatal; the portable
-- real[] path in 0007 remains the source of truth either way.

CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE memory_embedding ADD COLUMN IF NOT EXISTS embedding_v vector;

-- Keep the indexed vector column in step with the portable array column, so a
-- database that gains pgvector later needs only a backfill, not a rewrite.
CREATE OR REPLACE FUNCTION everecho_sync_embedding_vector() RETURNS trigger AS $$
BEGIN
  NEW.embedding_v := NEW.embedding::vector;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS memory_embedding_sync_vector ON memory_embedding;
CREATE TRIGGER memory_embedding_sync_vector
  BEFORE INSERT OR UPDATE OF embedding ON memory_embedding
  FOR EACH ROW EXECUTE FUNCTION everecho_sync_embedding_vector();

UPDATE memory_embedding SET embedding = embedding WHERE embedding_v IS NULL;
