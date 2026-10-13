CREATE TABLE IF NOT EXISTS voice_task_proposals (
    id uuid PRIMARY KEY,
    identity text NOT NULL,
    instruction text NOT NULL,
    workspace text NOT NULL,
    plan_hash char(64) NOT NULL,
    status text NOT NULL CHECK (status IN ('pending', 'approved', 'cancelled')),
    task_id uuid UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    approved_at timestamptz,
    cancelled_at timestamptz
);

CREATE INDEX IF NOT EXISTS voice_task_proposals_identity_created_idx
    ON voice_task_proposals (identity, created_at DESC);
