-- Memorial material is account-owned and never becomes archive evidence.
CREATE TABLE memorial_profile (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  profile jsonb NOT NULL,
  consent_version text NOT NULL DEFAULT 'memorial-2026-09',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX memorial_profile_owner ON memorial_profile(user_id, updated_at DESC);
ALTER TABLE memorial_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE memorial_profile FORCE ROW LEVEL SECURITY;
CREATE POLICY memorial_profile_owner_policy ON memorial_profile
  USING (user_id::text = current_setting('everecho.memorial_user_id', true))
  WITH CHECK (user_id::text = current_setting('everecho.memorial_user_id', true));

CREATE TABLE memorial_usage (
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  day date NOT NULL DEFAULT CURRENT_DATE,
  turns integer NOT NULL DEFAULT 0 CHECK (turns >= 0),
  PRIMARY KEY(user_id, day)
);
ALTER TABLE memorial_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE memorial_usage FORCE ROW LEVEL SECURITY;
CREATE POLICY memorial_usage_owner_policy ON memorial_usage
  USING (user_id::text = current_setting('everecho.memorial_user_id', true))
  WITH CHECK (user_id::text = current_setting('everecho.memorial_user_id', true));

CREATE TABLE memorial_voice (
 voice_id text PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
 name text NOT NULL,
 verified boolean NOT NULL,
 revoked boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE memorial_voice ENABLE ROW LEVEL SECURITY;
ALTER TABLE memorial_voice FORCE ROW LEVEL SECURITY;
CREATE POLICY memorial_voice_owner_policy ON memorial_voice
 USING (user_id::text = current_setting('everecho.memorial_user_id', true))
 WITH CHECK (user_id::text = current_setting('everecho.memorial_user_id', true));
