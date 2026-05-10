-- RainSafe full schema (MySQL 8+)
-- This is a full schema for the current system:
--   users, reports, activity_logs

CREATE DATABASE IF NOT EXISTS rainsafe
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE rainsafe;

-- Users
CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  email VARCHAR(191) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('user', 'admin') NOT NULL DEFAULT 'user',
  is_suspended TINYINT(1) NOT NULL DEFAULT 0,
  suspended_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email),
  KEY idx_users_role (role),
  KEY idx_users_suspended (is_suspended)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Reports
CREATE TABLE IF NOT EXISTS reports (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT UNSIGNED NOT NULL,
  location VARCHAR(191) NOT NULL,
  severity ENUM('Low', 'Medium', 'High') NOT NULL,
  description TEXT NULL,
  reporter_name VARCHAR(191) NULL,
  latitude DECIMAL(10,8) NULL,
  longitude DECIMAL(11,8) NULL,
  polygon_coords JSON NULL,
  is_false_report TINYINT(1) NOT NULL DEFAULT 0,
  false_report_note VARCHAR(255) NULL,
  flagged_false_at DATETIME NULL,
  false_marked_by INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_reports_user_id (user_id),
  KEY idx_reports_created_at (created_at),
  KEY idx_reports_location (location),
  KEY idx_reports_severity (severity),
  KEY idx_reports_false (is_false_report),
  KEY idx_reports_false_marked_by (false_marked_by),
  CONSTRAINT fk_reports_user
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_reports_false_marked_by
    FOREIGN KEY (false_marked_by) REFERENCES users(id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Activity logs
CREATE TABLE IF NOT EXISTS activity_logs (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT UNSIGNED NOT NULL,
  action VARCHAR(120) NOT NULL,
  details TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_activity_logs_user_id (user_id),
  KEY idx_activity_logs_created_at (created_at),
  CONSTRAINT fk_activity_logs_user
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
