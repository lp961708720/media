CREATE TABLE IF NOT EXISTS import_details (
 id TEXT PRIMARY KEY,
 owner_id TEXT NOT NULL,
 account_id TEXT NOT NULL REFERENCES accounts(id),
 kind TEXT NOT NULL,
 data TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS import_details_scope ON import_details(owner_id,account_id,created_at);
