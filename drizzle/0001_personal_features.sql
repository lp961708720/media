CREATE TABLE preferences (owner_id TEXT NOT NULL, key TEXT NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(owner_id,key));
CREATE TABLE extras (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, account_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('comment','report','workflow','evaluation','experiment')), data TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, deleted INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY(account_id,owner_id) REFERENCES accounts(id,owner_id));
CREATE INDEX extras_scope ON extras(owner_id,account_id,kind,deleted,updated_at);
CREATE TABLE extra_revisions (id TEXT PRIMARY KEY, extra_id TEXT NOT NULL REFERENCES extras(id), revision INTEGER NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(extra_id,revision));
CREATE TABLE usage_events (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, account_id TEXT, provider_id TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX usage_scope ON usage_events(owner_id,account_id,created_at);
