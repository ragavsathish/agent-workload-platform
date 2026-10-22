CREATE TABLE IF NOT EXISTS voice_task_progress (
    id bigserial PRIMARY KEY,
    task_id uuid NOT NULL,
    spoken text NOT NULL CHECK (char_length(spoken) BETWEEN 1 AND 240),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS voice_task_progress_task_id_idx
    ON voice_task_progress (task_id, id);
