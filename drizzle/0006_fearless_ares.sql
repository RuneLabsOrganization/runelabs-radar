CREATE TABLE `opportunities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`thesis` text NOT NULL,
	`sector` text,
	`status` text DEFAULT 'active' NOT NULL,
	`flip_score` integer NOT NULL,
	`hold_score` integer NOT NULL,
	`scores` text NOT NULL,
	`evidence` text DEFAULT '[]' NOT NULL,
	`window` text,
	`brief` text,
	`brief_generated_at` integer,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `opportunities_slug_unique` ON `opportunities` (`slug`);--> statement-breakpoint
ALTER TABLE `topic_clusters` ADD `coherence` real DEFAULT 0 NOT NULL;