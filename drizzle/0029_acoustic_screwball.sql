CREATE TABLE `usage_counters` (
	`bucket` text NOT NULL,
	`feature` text NOT NULL,
	`window_start` integer NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`bucket`, `feature`, `window_start`)
);
--> statement-breakpoint
CREATE INDEX `usage_counters_window` ON `usage_counters` (`window_start`);