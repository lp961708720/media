CREATE TABLE accounts (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT NOT NULL,
 platform TEXT NOT NULL CHECK(platform IN ('wechat','xhs')),
 data TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(id,owner_id)
);
CREATE TABLE records (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, account_id TEXT,
 kind TEXT NOT NULL CHECK(kind IN ('topic','benchmark','post','content','job','skill','provider','metric','asset','settings')),
 data TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
 deleted INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 FOREIGN KEY(account_id,owner_id) REFERENCES accounts(id,owner_id),
 CHECK(kind IN ('skill','provider','settings') OR account_id IS NOT NULL)
);
CREATE INDEX records_scope ON records(owner_id,account_id,kind,deleted,updated_at);
CREATE TABLE revisions (
 id TEXT PRIMARY KEY, record_id TEXT NOT NULL REFERENCES records(id), owner_id TEXT NOT NULL,
 revision INTEGER NOT NULL, data TEXT NOT NULL, source TEXT NOT NULL,
 created_at TEXT NOT NULL, UNIQUE(record_id,revision)
);
CREATE TABLE ai_runs (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, account_id TEXT NOT NULL,
 content_id TEXT NOT NULL REFERENCES records(id), source_revision INTEGER NOT NULL,
 status TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 FOREIGN KEY(account_id,owner_id) REFERENCES accounts(id,owner_id)
);
CREATE INDEX runs_scope ON ai_runs(owner_id,account_id,created_at);
CREATE TABLE audit_logs (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, account_id TEXT,
 action TEXT NOT NULL, target_id TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX audit_scope ON audit_logs(owner_id,created_at);
CREATE TABLE secrets (
 id TEXT PRIMARY KEY REFERENCES records(id), owner_id TEXT NOT NULL,
 ciphertext TEXT NOT NULL, mask TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE import_batches (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, account_id TEXT NOT NULL,
 checksum TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(owner_id,account_id,checksum),
 FOREIGN KEY(account_id,owner_id) REFERENCES accounts(id,owner_id)
);
