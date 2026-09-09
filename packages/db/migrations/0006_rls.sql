-- Row-level security: defence in depth behind authorize(), never a replacement.
--
-- Every content table is filtered by the archive scope set on the connection
-- (`SET LOCAL everecho.archive_id`). An unscoped connection reads zero rows.
-- FORCE means the table owner is subject to the policy too, so a bug in
-- application code cannot read another family's archive even as the DB owner.
--
-- Operational tables (processing_job, audit_event, app_user, archive,
-- membership, invitation) are deliberately exempt: the worker polls across
-- archives and membership must be queryable by user. They are guarded by
-- authorize() alone, and they hold no memory content.

CREATE OR REPLACE FUNCTION everecho_current_archive() RETURNS uuid AS $$
  SELECT NULLIF(current_setting('everecho.archive_id', true), '')::uuid;
$$ LANGUAGE sql STABLE;

DO $$
DECLARE
  t text;
  content_tables text[] := ARRAY[
    'consent_policy', 'consent_record', 'teach_back_result', 'succession_directive', 'dispute_hold',
    'source_asset', 'asset_version', 'transcript', 'transcript_segment',
    'interview_session', 'interview_prompt', 'interview_response',
    'place', 'entity', 'relationship', 'memory', 'memory_entity', 'life_event',
    'claim', 'claim_evidence', 'contradiction', 'correction', 'memory_embedding',
    'generated_artifact', 'retrieval_snapshot', 'generated_response', 'response_claim',
    'provenance_record'
  ];
BEGIN
  FOREACH t IN ARRAY content_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL '
      'USING (archive_id = everecho_current_archive()) '
      'WITH CHECK (archive_id = everecho_current_archive())',
      t || '_archive_scope', t
    );
  END LOOP;
END $$;
