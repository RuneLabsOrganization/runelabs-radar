CREATE TABLE `user_profiles` (
	`user_id` integer PRIMARY KEY NOT NULL,
	`skills` text DEFAULT '[]' NOT NULL,
	`interests` text DEFAULT '[]' NOT NULL,
	`capital_band` text,
	`avoided_sectors` text DEFAULT '[]' NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
