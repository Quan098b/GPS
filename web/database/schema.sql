CREATE DATABASE IF NOT EXISTS gps_rescue
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE gps_rescue;

CREATE TABLE IF NOT EXISTS devices (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  device_id VARCHAR(100) NOT NULL,
  device_name VARCHAR(255) NULL,
  last_latitude DECIMAL(10,7) NULL,
  last_longitude DECIMAL(10,7) NULL,
  last_seen DATETIME NULL,
  battery INT NULL,
  rssi INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_devices_device_id (device_id),
  KEY idx_devices_last_seen (last_seen)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS rescue_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  device_id VARCHAR(100) NOT NULL,
  latitude DECIMAL(10,7) NOT NULL,
  longitude DECIMAL(10,7) NOT NULL,
  accuracy FLOAT NULL,
  battery INT NULL,
  rssi INT NULL,
  message VARCHAR(500) NULL,
  status ENUM('SOS','CONFIRMED','RESCUING','RESCUED','CANCELLED') NOT NULL DEFAULT 'SOS',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  confirmed_at DATETIME NULL,
  rescuing_at DATETIME NULL,
  rescued_at DATETIME NULL,
  confirmed_by VARCHAR(255) NULL,
  PRIMARY KEY (id),
  KEY idx_rescue_device_status (device_id, status),
  KEY idx_rescue_status_created (status, created_at),
  KEY idx_rescue_created_at (created_at),
  CONSTRAINT fk_rescue_device FOREIGN KEY (device_id) REFERENCES devices (device_id)
    ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS location_history (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  device_id VARCHAR(100) NOT NULL,
  rescue_event_id BIGINT UNSIGNED NULL,
  latitude DECIMAL(10,7) NOT NULL,
  longitude DECIMAL(10,7) NOT NULL,
  accuracy FLOAT NULL,
  battery INT NULL,
  rssi INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_location_device_created (device_id, created_at),
  KEY idx_location_event_created (rescue_event_id, created_at),
  KEY idx_location_created_at (created_at),
  CONSTRAINT fk_location_device FOREIGN KEY (device_id) REFERENCES devices (device_id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_location_rescue FOREIGN KEY (rescue_event_id) REFERENCES rescue_events (id)
    ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB;
