CREATE TABLE `public_feedback_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`author_type` text NOT NULL,
	`author_name` text NOT NULL,
	`body` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `public_feedback_messages_thread_idx` ON `public_feedback_messages` (`thread_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `public_feedback_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`share_id` text NOT NULL,
	`project_id` text NOT NULL,
	`category` text NOT NULL,
	`subject` text NOT NULL,
	`task_id` text DEFAULT '' NOT NULL,
	`task_title` text DEFAULT '' NOT NULL,
	`client_name` text NOT NULL,
	`client_contact` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `public_feedback_threads_project_idx` ON `public_feedback_threads` (`project_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `public_feedback_threads_share_idx` ON `public_feedback_threads` (`share_id`,`updated_at`);