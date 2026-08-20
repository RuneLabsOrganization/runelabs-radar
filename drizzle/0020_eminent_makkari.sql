CREATE TABLE `debates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`opportunity_id` integer,
	`idea_text` text,
	`transcript` text NOT NULL,
	`verdict` text NOT NULL,
	`confidence` integer DEFAULT 40 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`opportunity_id`) REFERENCES `opportunities`(`id`) ON UPDATE no action ON DELETE no action
);
