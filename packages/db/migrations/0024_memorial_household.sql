CREATE TABLE memorial_household (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_user_id uuid NOT NULL UNIQUE REFERENCES app_user(id) ON DELETE CASCADE,
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
 UNIQUE(id,owner_user_id)
);
CREATE TABLE memorial_household_seat (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 household_id uuid NOT NULL,
 owner_user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
 user_id uuid UNIQUE REFERENCES app_user(id) ON DELETE CASCADE,
 invite_hash text UNIQUE,
 expires_at timestamptz,
 FOREIGN KEY(household_id,owner_user_id) REFERENCES memorial_household(id,owner_user_id) ON DELETE CASCADE,
 CHECK(user_id IS NOT NULL OR invite_hash IS NOT NULL)
);
ALTER TABLE memorial_household ENABLE ROW LEVEL SECURITY;
ALTER TABLE memorial_household FORCE ROW LEVEL SECURITY;
CREATE POLICY memorial_household_owner ON memorial_household
 USING(owner_user_id::text=current_setting('everecho.memorial_user_id',true))
 WITH CHECK(owner_user_id::text=current_setting('everecho.memorial_user_id',true));
ALTER TABLE memorial_household_seat ENABLE ROW LEVEL SECURITY;
ALTER TABLE memorial_household_seat FORCE ROW LEVEL SECURITY;
CREATE POLICY memorial_household_access ON memorial_household_seat
 USING(owner_user_id::text=current_setting('everecho.memorial_user_id',true)
 OR user_id::text=current_setting('everecho.memorial_user_id',true)
 OR invite_hash=current_setting('everecho.household_invite_hash',true))
 WITH CHECK(owner_user_id::text=current_setting('everecho.memorial_user_id',true)
 OR user_id::text=current_setting('everecho.memorial_user_id',true));
