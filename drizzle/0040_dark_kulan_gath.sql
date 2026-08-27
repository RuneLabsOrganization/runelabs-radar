ALTER TABLE `kit_pick_history` ADD `change_kind` text DEFAULT 'unclassified' NOT NULL;--> statement-breakpoint
ALTER TABLE `kit_pick_history` ADD `held_days` integer;