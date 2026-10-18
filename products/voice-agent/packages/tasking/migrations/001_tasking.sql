CREATE TABLE IF NOT EXISTS voice_task_proposals (
    id uuid PRIMARY KEY,
    identity text NOT NULL,
    instruction text NOT NULL,
    workspace text NOT NULL,
    session_album_key text,
    session_name text,
    plan_hash char(64) NOT NULL,
    status text NOT NULL CHECK (status IN ('pending', 'approved', 'cancelled')),
    task_id uuid UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    approved_at timestamptz,
    cancelled_at timestamptz
);

ALTER TABLE voice_task_proposals
    ADD COLUMN IF NOT EXISTS session_album_key text;

ALTER TABLE voice_task_proposals
    ADD COLUMN IF NOT EXISTS session_name text;

UPDATE voice_task_proposals
SET session_album_key = CASE mod(get_byte(decode(md5(id::text), 'hex'), 0), 20)
    WHEN 0 THEN 'kind-of-blue'
    WHEN 1 THEN 'a-love-supreme'
    WHEN 2 THEN 'time-out'
    WHEN 3 THEN 'blue-train'
    WHEN 4 THEN 'mingus-ah-um'
    WHEN 5 THEN 'moanin'
    WHEN 6 THEN 'maiden-voyage'
    WHEN 7 THEN 'speak-no-evil'
    WHEN 8 THEN 'saxophone-colossus'
    WHEN 9 THEN 'somethin-else'
    WHEN 10 THEN 'in-a-silent-way'
    WHEN 11 THEN 'the-sidewinder'
    WHEN 12 THEN 'song-for-my-father'
    WHEN 13 THEN 'head-hunters'
    WHEN 14 THEN 'heavy-weather'
    WHEN 15 THEN 'getz-gilberto'
    WHEN 16 THEN 'ella-and-louis'
    WHEN 17 THEN 'chet-baker-sings'
    WHEN 18 THEN 'shape-of-jazz-to-come'
    ELSE 'koln-concert'
END
WHERE session_album_key IS NULL;

ALTER TABLE voice_task_proposals
    ALTER COLUMN session_album_key SET NOT NULL;

WITH ranked AS (
    SELECT
        id,
        session_album_key,
        row_number() OVER (
            PARTITION BY identity, session_album_key
            ORDER BY created_at, id
        ) AS take
    FROM voice_task_proposals
), named AS (
    SELECT
        id,
        take,
        CASE session_album_key
            WHEN 'kind-of-blue' THEN 'Kind of Blue'
            WHEN 'a-love-supreme' THEN 'A Love Supreme'
            WHEN 'time-out' THEN 'Time Out'
            WHEN 'blue-train' THEN 'Blue Train'
            WHEN 'mingus-ah-um' THEN 'Mingus Ah Um'
            WHEN 'moanin' THEN 'Moanin'''
            WHEN 'maiden-voyage' THEN 'Maiden Voyage'
            WHEN 'speak-no-evil' THEN 'Speak No Evil'
            WHEN 'saxophone-colossus' THEN 'Saxophone Colossus'
            WHEN 'somethin-else' THEN 'Somethin'' Else'
            WHEN 'in-a-silent-way' THEN 'In a Silent Way'
            WHEN 'the-sidewinder' THEN 'The Sidewinder'
            WHEN 'song-for-my-father' THEN 'Song for My Father'
            WHEN 'head-hunters' THEN 'Head Hunters'
            WHEN 'heavy-weather' THEN 'Heavy Weather'
            WHEN 'getz-gilberto' THEN 'Getz/Gilberto'
            WHEN 'ella-and-louis' THEN 'Ella and Louis'
            WHEN 'chet-baker-sings' THEN 'Chet Baker Sings'
            WHEN 'shape-of-jazz-to-come' THEN 'The Shape of Jazz to Come'
            WHEN 'koln-concert' THEN 'The Köln Concert'
        END AS title
    FROM ranked
)
UPDATE voice_task_proposals AS proposal
SET session_name = named.title || CASE
    WHEN named.take = 1 THEN ''
    ELSE ' · Take ' || named.take::text
END
FROM named
WHERE proposal.id = named.id AND proposal.session_name IS NULL;

ALTER TABLE voice_task_proposals
    ALTER COLUMN session_name SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS voice_task_proposals_identity_session_name_idx
    ON voice_task_proposals (identity, session_name);

CREATE INDEX IF NOT EXISTS voice_task_proposals_identity_created_idx
    ON voice_task_proposals (identity, created_at DESC);
