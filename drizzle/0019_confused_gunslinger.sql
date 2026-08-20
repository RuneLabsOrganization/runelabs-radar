CREATE TABLE `plan_entitlements` (
	`user_id` integer PRIMARY KEY NOT NULL,
	`tier` text DEFAULT 'free' NOT NULL,
	`plans_per_month` integer DEFAULT 3 NOT NULL,
	`reset_day` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
