CREATE TABLE `patterns` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`headline` text NOT NULL,
	`detail` text NOT NULL,
	`score` real NOT NULL,
	`evidence` text DEFAULT '[]' NOT NULL,
	`date` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `topic_clusters` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`label` text NOT NULL,
	`summary` text,
	`size` integer NOT NULL,
	`heat` real DEFAULT 0 NOT NULL,
	`centroid` blob,
	`date` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `stories` ADD `cluster_id` integer;--> statement-breakpoint
ALTER TABLE `stories` ADD `map_x` real;--> statement-breakpoint
ALTER TABLE `stories` ADD `map_y` real;