CREATE INDEX `items_story` ON `items` (`story_id`);--> statement-breakpoint
CREATE INDEX `job_runs_job_status` ON `job_runs` (`job`,`status`,`finished_at`);--> statement-breakpoint
CREATE INDEX `llm_calls_ts` ON `llm_calls` (`ts`);--> statement-breakpoint
CREATE INDEX `llm_calls_feature_ts` ON `llm_calls` (`feature`,`ts`);--> statement-breakpoint
CREATE INDEX `patterns_date` ON `patterns` (`date`);--> statement-breakpoint
CREATE INDEX `stories_status_created` ON `stories` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `stories_top_score` ON `stories` (`top_score`);--> statement-breakpoint
CREATE INDEX `stories_cluster` ON `stories` (`cluster_id`);--> statement-breakpoint
CREATE INDEX `votes_story` ON `votes` (`story_id`);