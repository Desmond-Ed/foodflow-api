-- Module A: Address Resolution & Delivery Fee Service
-- Nigerian addresses rarely resolve cleanly with a plain geocoder (no
-- reliable postal codes, landmark-based directions like "opposite so-and-so"),
-- so every resolved address is cached here: never pay the Nominatim
-- round-trip (or its 1 req/sec limit) twice for the same input.

CREATE TABLE IF NOT EXISTS resolved_addresses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  raw_address VARCHAR(255) NOT NULL,
  normalized_address VARCHAR(255) NOT NULL,
  latitude DECIMAL(10,7),
  longitude DECIMAL(10,7),
  confidence ENUM('high','medium','low') DEFAULT 'medium',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_normalized_address (normalized_address)
);

-- Vendors need known coordinates to quote a delivery distance/fee against.
ALTER TABLE vendors ADD COLUMN latitude DECIMAL(10,7) NULL;
ALTER TABLE vendors ADD COLUMN longitude DECIMAL(10,7) NULL;
