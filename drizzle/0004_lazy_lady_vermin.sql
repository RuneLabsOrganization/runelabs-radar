CREATE TABLE `comps` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`product` text NOT NULL,
	`amount_usd` real,
	`note` text,
	`source_url` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `launches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`title` text NOT NULL,
	`url` text NOT NULL,
	`points` integer,
	`comments` integer,
	`category` text,
	`launched_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `launches_url_unique` ON `launches` (`url`);--> statement-breakpoint
CREATE TABLE `metric_points` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`entity` text NOT NULL,
	`metric` text NOT NULL,
	`value` real NOT NULL,
	`date` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `metric_points_key` ON `metric_points` (`source`,`entity`,`metric`,`date`);--> statement-breakpoint
CREATE TABLE `pain_points` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`summary` text NOT NULL,
	`sector` text,
	`intensity` integer DEFAULT 1 NOT NULL,
	`evidence` text DEFAULT '[]' NOT NULL,
	`last_seen_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `stories` ADD `embedding` blob;