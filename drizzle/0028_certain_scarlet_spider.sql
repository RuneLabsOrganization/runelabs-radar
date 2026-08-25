CREATE TABLE `agent_sessions` (
	`user_id` integer PRIMARY KEY NOT NULL,
	`last_project` text,
	`last_opportunity` text,
	`watch_topics` text DEFAULT '[]' NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `mcp_economy` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`cycle_key` text NOT NULL,
	`calls` integer DEFAULT 0 NOT NULL,
	`tokens_returned` integer DEFAULT 0 NOT NULL,
	`tokens_saved_vs_full` integer DEFAULT 0 NOT NULL,
	`tokens_saved_vs_diy` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_economy_user_cycle` ON `mcp_economy` (`user_id`,`cycle_key`);--> statement-breakpoint
CREATE TABLE `user_watches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`kind` text NOT NULL,
	`key` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_watches_user_kind_key` ON `user_watches` (`user_id`,`kind`,`key`);