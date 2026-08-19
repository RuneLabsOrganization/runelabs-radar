CREATE TABLE `oauth_clients` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` text NOT NULL,
	`name` text,
	`redirect_uris` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_clients_client_id_unique` ON `oauth_clients` (`client_id`);--> statement-breakpoint
CREATE TABLE `oauth_codes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`client_id` text NOT NULL,
	`user_id` integer NOT NULL,
	`redirect_uri` text NOT NULL,
	`scope` text DEFAULT 'read' NOT NULL,
	`code_challenge` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_codes_code_unique` ON `oauth_codes` (`code`);--> statement-breakpoint
CREATE TABLE `oauth_tokens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`access_token` text NOT NULL,
	`refresh_token` text,
	`client_id` text NOT NULL,
	`user_id` integer NOT NULL,
	`scope` text DEFAULT 'read' NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_tokens_access_token_unique` ON `oauth_tokens` (`access_token`);--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_tokens_refresh_token_unique` ON `oauth_tokens` (`refresh_token`);--> statement-breakpoint
ALTER TABLE `opportunities` ADD `plan` text;--> statement-breakpoint
ALTER TABLE `opportunities` ADD `plan_generated_at` integer;