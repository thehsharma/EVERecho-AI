CREATE TABLE family_subscription (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
 provider_id text UNIQUE,
 status text NOT NULL DEFAULT 'creating',
 checkout_url text,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX family_subscription_one_open ON family_subscription(user_id)
 WHERE status NOT IN ('cancelled','completed','expired');
CREATE TABLE family_subscription_event (
 event_id text PRIMARY KEY,
 processed_at timestamptz NOT NULL DEFAULT now()
);
