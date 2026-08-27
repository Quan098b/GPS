USE gps_rescue;

INSERT INTO devices
  (device_id, device_name, last_latitude, last_longitude, last_seen, battery, rssi)
VALUES
  ('RESCUE-DEMO-01', 'Thiết bị demo khu vực Thái Nguyên', 21.5945000, 105.8482000, NOW(), 82, -72)
ON DUPLICATE KEY UPDATE device_name = VALUES(device_name);

INSERT INTO rescue_events
  (device_id, latitude, longitude, accuracy, battery, rssi, message, status)
SELECT 'RESCUE-DEMO-01', 21.5945000, 105.8482000, 5.4, 82, -72, 'Dữ liệu minh họa - có thể hủy sau khi kiểm tra', 'SOS'
WHERE NOT EXISTS (
  SELECT 1 FROM rescue_events
  WHERE device_id = 'RESCUE-DEMO-01' AND status IN ('SOS', 'CONFIRMED', 'RESCUING')
);

INSERT INTO location_history
  (device_id, rescue_event_id, latitude, longitude, accuracy, battery, rssi)
SELECT 'RESCUE-DEMO-01', id, latitude, longitude, accuracy, battery, rssi
FROM rescue_events
WHERE device_id = 'RESCUE-DEMO-01'
ORDER BY id DESC LIMIT 1;
