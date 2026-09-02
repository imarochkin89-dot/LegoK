export const plannerFilesSchema = `
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
  )
`;

export const plannerFilesProjectIndex = `
  CREATE INDEX IF NOT EXISTS planner_files_project_idx
  ON planner_files (workspace_key, project_id, created_at)
`;

export const plannerNotificationReadsSchema = `
  CREATE TABLE IF NOT EXISTS planner_notification_reads (
    workspace_key TEXT NOT NULL,
    member_key TEXT NOT NULL,
    notification_key TEXT NOT NULL,
    read_at TEXT NOT NULL,
    PRIMARY KEY (workspace_key, member_key, notification_key)
  )
`;

export const plannerNotificationPreferencesSchema = `
  CREATE TABLE IF NOT EXISTS planner_notification_preferences (
    workspace_key TEXT NOT NULL,
    member_key TEXT NOT NULL,
    task_events INTEGER NOT NULL DEFAULT 1,
    deadlines INTEGER NOT NULL DEFAULT 1,
    comments INTEGER NOT NULL DEFAULT 1,
    files INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (workspace_key, member_key)
  )
`;

export const plannerNotificationReadsIndex = `
  CREATE INDEX IF NOT EXISTS planner_notification_reads_member_idx
  ON planner_notification_reads (workspace_key, member_key, read_at)
`;

export const plannerPublicSharesSchema = `
  CREATE TABLE IF NOT EXISTS planner_public_shares (
    id TEXT PRIMARY KEY,
    workspace_key TEXT NOT NULL,
    project_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    token_value TEXT NOT NULL,
    pin_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    snapshot TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    view_count INTEGER NOT NULL DEFAULT 0,
    last_viewed_at TEXT
  )
`;

export const plannerPublicSharesProjectIndex = `
  CREATE INDEX IF NOT EXISTS planner_public_shares_project_idx
  ON planner_public_shares (workspace_key, project_id, updated_at)
`;

export const plannerPublicShareSessionsSchema = `
  CREATE TABLE IF NOT EXISTS planner_public_share_sessions (
    session_hash TEXT PRIMARY KEY,
    share_id TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  )
`;

export const plannerPublicShareAttemptsSchema = `
  CREATE TABLE IF NOT EXISTS planner_public_share_attempts (
    share_id TEXT NOT NULL,
    visitor_key TEXT NOT NULL,
    window_started_at TEXT NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (share_id, visitor_key)
  )
`;
