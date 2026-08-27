CREATE TABLE `verdict_claims` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`category` text NOT NULL,
	`task` text NOT NULL,
	`tier` text NOT NULL,
	`pick_name` text NOT NULL,
	`falsifier` text NOT NULL,
	`horizon_days` integer NOT NULL,
	`evidence_snapshot` text DEFAULT '[]' NOT NULL,
	`opened_at` integer NOT NULL,
	`closed_at` integer,
	`outcome` text
);
--> statement-breakpoint
CREATE INDEX `verdict_claim_cell` ON `verdict_claims` (`category`,`task`,`tier`);