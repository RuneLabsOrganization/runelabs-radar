CREATE TABLE `agent_stack_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`rationale` text,
	`brave_hits` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
