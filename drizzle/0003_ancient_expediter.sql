CREATE TABLE `stacks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`venture` text NOT NULL,
	`title` text NOT NULL,
	`tagline` text,
	`layers` text NOT NULL,
	`cost_note` text,
	`time_to_mvp` text,
	`rationale` text,
	`runelabs_verdict` text,
	`verdict_author` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stacks_venture_unique` ON `stacks` (`venture`);