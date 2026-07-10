CREATE TABLE `insights` (
	`date` text PRIMARY KEY NOT NULL,
	`items` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `stories` ADD `entities` text;