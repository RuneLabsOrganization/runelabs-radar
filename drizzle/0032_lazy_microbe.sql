CREATE TABLE `wedge_values` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`axis` text NOT NULL,
	`slug` text NOT NULL,
	`label` text NOT NULL,
	`requires_tags` text DEFAULT '[]' NOT NULL,
	`excludes_tags` text DEFAULT '[]' NOT NULL,
	`weight` integer DEFAULT 10 NOT NULL,
	`active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wedge_values_axis_slug` ON `wedge_values` (`axis`,`slug`);--> statement-breakpoint
CREATE INDEX `wedge_values_axis_active` ON `wedge_values` (`axis`,`active`);