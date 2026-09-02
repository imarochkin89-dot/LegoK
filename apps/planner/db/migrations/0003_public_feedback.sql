CREATE TABLE IF NOT EXISTS planner_public_feedback_imports (
  message_id TEXT PRIMARY KEY,
  workspace_key TEXT NOT NULL,
  project_id TEXT NOT NULL,
  feedback_id TEXT NOT NULL,
  task_id TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL,
  client_name TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL,
  imported_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS planner_public_feedback_imports_project_idx
ON planner_public_feedback_imports (workspace_key, project_id, created_at);
