CREATE TABLE `leads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_key` text NOT NULL,
	`owner_user_id` integer,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`thesis_skeleton` text NOT NULL,
	`sector` text,
	`primitive_refs` text DEFAULT '[]' NOT NULL,
	`wedge` text DEFAULT '{}' NOT NULL,
	`heuristic_score` integer DEFAULT 0 NOT NULL,
	`combination_index` integer DEFAULT 0 NOT NULL,
	`stage` text DEFAULT 'composed' NOT NULL,
	`opportunity_id` integer,
	`created_at` integer NOT NULL,
	`expires_at` integer,
	`dismissed_at` integer,
	`dismiss_reason` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `leads_owner_slug` ON `leads` (`owner_key`,`slug`);--> statement-breakpoint
CREATE INDEX `leads_owner_created` ON `leads` (`owner_key`,`created_at`);--> statement-breakpoint
CREATE INDEX `leads_expires` ON `leads` (`expires_at`);