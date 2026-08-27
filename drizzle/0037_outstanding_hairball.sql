CREATE TABLE `source_quality` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` integer NOT NULL,
	`window_end` text NOT NULL,
	`window_days` integer NOT NULL,
	`fetched` integer DEFAULT 0 NOT NULL,
	`used` integer DEFAULT 0 NOT NULL,
	`curated` integer DEFAULT 0 NOT NULL,
	`mean_top_score` real,
	`mean_hindsight` real,
	`verdict` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `source_quality_window` ON `source_quality` (`source_id`,`window_end`,`window_days`);