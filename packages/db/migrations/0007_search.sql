-- Hybrid retrieval: PostgreSQL full-text plus vector similarity.

-- Generated column: the search vector cannot drift from the row it describes.
ALTER TABLE memory
  ADD COLUMN search_tsv tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(body, '')), 'B')
  ) STORED;
CREATE INDEX memory_search_idx ON memory USING gin (search_tsv);

ALTER TABLE transcript_segment
  ADD COLUMN search_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce(corrected_text, text, ''))) STORED;
CREATE INDEX transcript_segment_search_idx ON transcript_segment USING gin (search_tsv);

/**
 * Cosine distance over real[] — the portable path that works on any PostgreSQL.
 * When pgvector is available, migration 0008 adds an indexed `vector` column and
 * the retrieval layer swaps this expression for the `<=>` operator; the query,
 * ranking and tests are otherwise identical.
 */
CREATE OR REPLACE FUNCTION everecho_cosine_distance(a real[], b real[])
RETURNS double precision AS $$
DECLARE
  dot double precision := 0;
  norm_a double precision := 0;
  norm_b double precision := 0;
  i integer;
BEGIN
  IF a IS NULL OR b IS NULL OR array_length(a, 1) IS DISTINCT FROM array_length(b, 1) THEN
    RETURN 1;
  END IF;
  FOR i IN 1..array_length(a, 1) LOOP
    dot := dot + (a[i]::double precision * b[i]::double precision);
    norm_a := norm_a + (a[i]::double precision * a[i]::double precision);
    norm_b := norm_b + (b[i]::double precision * b[i]::double precision);
  END LOOP;
  IF norm_a = 0 OR norm_b = 0 THEN
    RETURN 1;
  END IF;
  RETURN 1 - (dot / (sqrt(norm_a) * sqrt(norm_b)));
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE;
