-- Operational metadata only: no names, notes, audio, or conversation text.
CREATE TABLE memorial_turn (
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
 mode text NOT NULL CHECK(mode IN ('local-preview','ai-simulation')),
 tone text NOT NULL CHECK(tone IN ('gentle','warm','reflective','cheerful')),
 duration_ms integer NOT NULL CHECK(duration_ms>=0),
 speech_characters integer NOT NULL DEFAULT 0 CHECK(speech_characters>=0),
 audio_bytes integer NOT NULL DEFAULT 0 CHECK(audio_bytes>=0),
 succeeded boolean NOT NULL,
 voice_failed boolean NOT NULL DEFAULT false,
 feedback text CHECK(feedback IN ('helpful','wrong_tone','invented_detail','unfamiliar_style')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX memorial_turn_owner_time ON memorial_turn(user_id,created_at DESC);
ALTER TABLE memorial_turn ENABLE ROW LEVEL SECURITY;
ALTER TABLE memorial_turn FORCE ROW LEVEL SECURITY;
CREATE POLICY memorial_turn_owner_policy ON memorial_turn
 USING(user_id::text=current_setting('everecho.memorial_user_id',true))
 WITH CHECK(user_id::text=current_setting('everecho.memorial_user_id',true));
