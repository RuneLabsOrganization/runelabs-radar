-- Rows written to the public radar by scout_opportunities before ownership
-- existed. They were fitted to one builder's constraints and were never meant
-- to be canonical. Archive (never delete) so the audit trail survives.
UPDATE `opportunities`
SET `status` = 'archived'
WHERE `owner_user_id` IS NULL
  AND `review` IS NOT NULL
  AND `review` LIKE '%scout-persisted%';
