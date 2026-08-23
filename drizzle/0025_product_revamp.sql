CREATE TABLE `auth_account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `auth_user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `auth_session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `auth_user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_session_token_unique` ON `auth_session` (`token`);--> statement-breakpoint
CREATE TABLE `auth_user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`stripe_customer_id` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_user_email_unique` ON `auth_user` (`email`);--> statement-breakpoint
CREATE TABLE `auth_verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE TABLE `batch_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`batch_id` integer NOT NULL,
	`ref_type` text NOT NULL,
	`ref_id` integer,
	`ref_key` text,
	`idea_text` text,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `batches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `batch_run_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` integer NOT NULL,
	`batch_item_id` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`result_ref` text,
	`est_cost_usd` real DEFAULT 0 NOT NULL,
	`error` text,
	`finished_at` integer,
	FOREIGN KEY (`run_id`) REFERENCES `batch_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`batch_item_id`) REFERENCES `batch_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `batch_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`batch_id` integer NOT NULL,
	`op` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`requested_by` integer,
	`stats` text,
	`error` text,
	`created_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`batch_id`) REFERENCES `batches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requested_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `batches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` integer,
	`kind` text DEFAULT 'workspace' NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`cohort` text,
	`visibility` text DEFAULT 'private' NOT NULL,
	`description` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `batches_slug_unique` ON `batches` (`slug`);--> statement-breakpoint
CREATE TABLE `subscription` (
	`id` text PRIMARY KEY NOT NULL,
	`plan` text NOT NULL,
	`reference_id` text NOT NULL,
	`stripe_customer_id` text,
	`stripe_subscription_id` text,
	`status` text NOT NULL,
	`period_start` integer,
	`period_end` integer,
	`cancel_at_period_end` integer,
	`seats` integer,
	`trial_start` integer,
	`trial_end` integer
);
--> statement-breakpoint
ALTER TABLE `users` ADD COLUMN `email` text;--> statement-breakpoint
ALTER TABLE `users` ADD COLUMN `email_verified` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD COLUMN `auth_user_id` text;--> statement-breakpoint
ALTER TABLE `users` ADD COLUMN `stripe_customer_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_auth_user_id_unique` ON `users` (`auth_user_id`);