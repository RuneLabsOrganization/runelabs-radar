CREATE TABLE `forecasts` (
	`date` text NOT NULL,
	`metric` text NOT NULL,
	`predicted` real NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`date`, `metric`)
);
