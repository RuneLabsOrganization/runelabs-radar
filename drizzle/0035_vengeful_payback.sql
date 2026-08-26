CREATE TABLE `kit_evidence` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`pick_id` integer NOT NULL,
	`kind` text NOT NULL,
	`source_url` text NOT NULL,
	`excerpt` text,
	`sentiment` integer DEFAULT 0 NOT NULL,
	`observed_at` integer NOT NULL,
	FOREIGN KEY (`pick_id`) REFERENCES `kit_picks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `kit_evidence_pick` ON `kit_evidence` (`pick_id`);--> statement-breakpoint
CREATE TABLE `kit_pick_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`category` text NOT NULL,
	`task` text NOT NULL,
	`tier` text NOT NULL,
	`from_pick` text,
	`to_pick` text NOT NULL,
	`reason` text NOT NULL,
	`changed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `kit_history_cell` ON `kit_pick_history` (`category`,`task`);--> statement-breakpoint
CREATE TABLE `kit_picks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`category` text NOT NULL,
	`task` text NOT NULL,
	`tier` text NOT NULL,
	`pick_name` text NOT NULL,
	`pick_url` text,
	`price_model` text DEFAULT 'seat' NOT NULL,
	`price_usd_month` real,
	`price_note` text,
	`risk_flag` text,
	`why` text,
	`skip` text,
	`confidence` text DEFAULT 'low' NOT NULL,
	`evidence_count` integer DEFAULT 0 NOT NULL,
	`distinct_sources` integer DEFAULT 0 NOT NULL,
	`verified_at` integer,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kit_pick_cell` ON `kit_picks` (`category`,`task`,`tier`);--> statement-breakpoint
ALTER TABLE `user_profiles` ADD `kit_persona` text;--> statement-breakpoint
ALTER TABLE `user_profiles` ADD `kit_tier` text;