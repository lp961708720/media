CREATE TABLE creative_projects (
 id TEXT PRIMARY KEY,
 owner_id TEXT NOT NULL,
 account_id TEXT NOT NULL,
 content_id TEXT NOT NULL REFERENCES records(id),
 data TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 FOREIGN KEY(account_id,owner_id) REFERENCES accounts(id,owner_id),
 UNIQUE(owner_id,content_id)
);
CREATE INDEX creative_projects_scope ON creative_projects(owner_id,account_id,updated_at);
CREATE TABLE creative_project_revisions (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES creative_projects(id),
 revision INTEGER NOT NULL,
 data TEXT NOT NULL,
 created_at TEXT NOT NULL,
 UNIQUE(project_id,revision)
);
CREATE TABLE creative_artifacts (
 id TEXT PRIMARY KEY,
 owner_id TEXT NOT NULL,
 account_id TEXT NOT NULL,
 project_id TEXT NOT NULL REFERENCES creative_projects(id),
 kind TEXT NOT NULL CHECK(kind IN ('analysis','audience','brief','draft','diagnostic','visual','prepublish','review','rule')),
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','rejected','applied')),
 data TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 FOREIGN KEY(account_id,owner_id) REFERENCES accounts(id,owner_id)
);
CREATE INDEX creative_artifacts_scope ON creative_artifacts(owner_id,account_id,project_id,kind,created_at);
CREATE UNIQUE INDEX creative_active_rule_family ON creative_artifacts(owner_id,account_id,json_extract(data,'$.family_id')) WHERE kind='rule' AND status='applied';
CREATE TABLE creative_artifact_revisions (
 id TEXT PRIMARY KEY,
 artifact_id TEXT NOT NULL REFERENCES creative_artifacts(id),
 revision INTEGER NOT NULL,
 status TEXT NOT NULL,
 data TEXT NOT NULL,
 created_at TEXT NOT NULL,
 UNIQUE(artifact_id,revision)
);
CREATE TABLE creative_account_state (
 owner_id TEXT NOT NULL,
 account_id TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 1,
 PRIMARY KEY(owner_id,account_id),
 FOREIGN KEY(account_id,owner_id) REFERENCES accounts(id,owner_id)
);
CREATE UNIQUE INDEX creative_rule_version ON creative_artifacts(owner_id,account_id,json_extract(data,'$.family_id'),json_extract(data,'$.version')) WHERE kind='rule';
CREATE UNIQUE INDEX creative_review_topic ON records(owner_id,account_id,json_extract(data,'$.creative_review_id'),json_extract(data,'$.creative_experiment_index')) WHERE kind='topic' AND deleted=0 AND json_extract(data,'$.creative_review_id') IS NOT NULL;
