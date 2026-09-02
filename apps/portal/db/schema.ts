import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const publicFeedbackThreads = sqliteTable("public_feedback_threads", {
  id: text("id").primaryKey(),
  shareId: text("share_id").notNull(),
  projectId: text("project_id").notNull(),
  category: text("category").notNull(),
  subject: text("subject").notNull(),
  taskId: text("task_id").notNull().default(""),
  taskTitle: text("task_title").notNull().default(""),
  clientName: text("client_name").notNull(),
  clientContact: text("client_contact").notNull().default(""),
  status: text("status").notNull().default("new"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, table => [
  index("public_feedback_threads_project_idx").on(table.projectId, table.updatedAt),
  index("public_feedback_threads_share_idx").on(table.shareId, table.updatedAt),
]);

export const publicFeedbackMessages = sqliteTable("public_feedback_messages", {
  id: text("id").primaryKey(),
  threadId: text("thread_id").notNull(),
  authorType: text("author_type").notNull(),
  authorName: text("author_name").notNull(),
  body: text("body").notNull(),
  createdAt: text("created_at").notNull(),
}, table => [index("public_feedback_messages_thread_idx").on(table.threadId, table.createdAt)]);

export const publicUpdates = sqliteTable("public_updates", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  category: text("category").notNull().default("progress"),
  pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
  publishedAt: text("published_at").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, table => [index("public_updates_project_idx").on(table.projectId, table.pinned, table.publishedAt)]);
