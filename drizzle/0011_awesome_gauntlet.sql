CREATE TABLE `domain_digests` (
	`domain` text NOT NULL,
	`date` text NOT NULL,
	`text` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`domain`, `date`)
);
