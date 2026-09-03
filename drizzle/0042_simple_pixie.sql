CREATE INDEX `items_fetched_at` ON `items` (`fetched_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `job_runs_running_unique` ON `job_runs` (`job`) WHERE "job_runs"."status" = 'running';--> statement-breakpoint
CREATE INDEX `llm_calls_feature_user_ts` ON `llm_calls` (`feature`,`user_id`,`ts`);