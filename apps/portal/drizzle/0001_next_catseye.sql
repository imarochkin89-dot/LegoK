CREATE TABLE `public_updates` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`category` text DEFAULT 'progress' NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`published_at` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `public_updates_project_idx` ON `public_updates` (`project_id`,`pinned`,`published_at`);