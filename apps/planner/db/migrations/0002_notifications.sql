CREATE TABLE IF NOT EXISTS planner_notification_reads (
  workspace_key TEXT NOT NULL,
  member_key TEXT NOT NULL,
  notification_key TEXT NOT NULL,
  read_at TEXT NOT NULL,
  PRIMARY KEY (workspace_key, member_key, notification_key)
);

CREATE TABLE IF NOT EXISTS planner_notification_preferences (
  workspace_key TEXT NOT NULL,
  member_key TEXT NOT NULL,
  task_events INTEGER NOT NULL DEFAULT 1,
  deadlines INTEGER NOT NULL DEFAULT 1,
  comments INTEGER NOT NULL DEFAULT 1,
  files INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_key, member_key)
);

CREATE INDEX IF NOT EXISTS planner_notification_reads_member_idx
ON planner_notification_reads (workspace_key, member_key, read_at);
