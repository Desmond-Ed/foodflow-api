-- Module B: Paystack Payment Integration

CREATE TABLE IF NOT EXISTS payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  paystack_reference VARCHAR(100) NOT NULL UNIQUE,
  amount_naira DECIMAL(10,2) NOT NULL,
  status ENUM('pending','success','failed') DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES orders(id)
);

-- Paystack retries webhook delivery on timeout, so the same event_id can
-- arrive more than once. This table is the idempotency guard: an event_id
-- already present here means "already processed, no-op".
CREATE TABLE IF NOT EXISTS processed_webhook_events (
  id INT AUTO_INCREMENT PRIMARY KEY,
  event_id VARCHAR(150) NOT NULL UNIQUE,
  event_type VARCHAR(80) NOT NULL,
  processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
