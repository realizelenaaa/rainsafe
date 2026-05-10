-- RainSafe existing DB update script
-- Use this when tables already exist and you only need new columns/indexes.
-- Run this inside your current RainSafe database.

ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS is_false_report TINYINT(1) NOT NULL DEFAULT 0 AFTER polygon_coords,
  ADD COLUMN IF NOT EXISTS false_report_note VARCHAR(255) NULL AFTER is_false_report,
  ADD COLUMN IF NOT EXISTS flagged_false_at DATETIME NULL AFTER false_report_note,
  ADD COLUMN IF NOT EXISTS false_marked_by INT UNSIGNED NULL AFTER flagged_false_at;

ALTER TABLE reports
  ADD INDEX IF NOT EXISTS idx_reports_false (is_false_report),
  ADD INDEX IF NOT EXISTS idx_reports_false_marked_by (false_marked_by);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_suspended TINYINT(1) NOT NULL DEFAULT 0 AFTER role,
  ADD COLUMN IF NOT EXISTS suspended_at DATETIME NULL AFTER is_suspended;

ALTER TABLE users
  ADD INDEX IF NOT EXISTS idx_users_suspended (is_suspended);

-- Optional FK (if it does not exist yet)
SET @fk_exists := (
  SELECT COUNT(*)
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'reports'
    AND CONSTRAINT_NAME = 'fk_reports_false_marked_by'
    AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);

SET @sql_fk := IF(
  @fk_exists = 0,
  'ALTER TABLE reports ADD CONSTRAINT fk_reports_false_marked_by FOREIGN KEY (false_marked_by) REFERENCES users(id) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE stmt_fk FROM @sql_fk;
EXECUTE stmt_fk;
DEALLOCATE PREPARE stmt_fk;
