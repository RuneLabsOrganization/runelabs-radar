ALTER TABLE `opportunities` ADD `window_months` integer;--> statement-breakpoint
ALTER TABLE `opportunities` ADD `verdict` text DEFAULT 'watch' NOT NULL;--> statement-breakpoint
ALTER TABLE `opportunities` ADD `confidence` integer DEFAULT 40 NOT NULL;--> statement-breakpoint
ALTER TABLE `opportunities` ADD `review` text;--> statement-breakpoint
ALTER TABLE `opportunities` ADD `reviewed_at` integer;