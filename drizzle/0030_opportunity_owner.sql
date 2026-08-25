ALTER TABLE `opportunities` ADD `owner_user_id` integer;--> statement-breakpoint
DROP INDEX `opportunities_slug_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `opportunities_owner_slug` ON `opportunities` (`owner_user_id`,`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `opportunities_public_slug` ON `opportunities` (`slug`) WHERE `owner_user_id` is null;--> statement-breakpoint
CREATE INDEX `opportunities_owner_status` ON `opportunities` (`owner_user_id`,`status`);
