CREATE TABLE IF NOT EXISTS planner_files (
  id TEXT PRIMARY KEY,
  workspace_key TEXT NOT NULL,
  project_id TEXT NOT NULL,
  task_id TEXT,
  object_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  mime_type TEXT NOT NULL,
  uploaded_by_key TEXT NOT NULL,
  uploaded_by_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS planner_files_project_idx
ON planner_files (workspace_key, project_id, created_at);
