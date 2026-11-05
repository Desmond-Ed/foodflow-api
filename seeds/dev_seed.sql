-- Development-only seed data. Not applied by `npm run migrate`; this file is
-- mounted into the local Docker MySQL entrypoint after the migrations run.

INSERT INTO vendors (name, city) VALUES
  ('Mama Nkechi Kitchen', 'Lagos'),
  ('Chicken Republic - Ikeja', 'Lagos');

-- Resolve vendor ids by name so the seed does not assume AUTO_INCREMENT values.
INSERT INTO menu_items (vendor_id, name, price_naira)
SELECT id, 'Jollof Rice + Chicken', 3500.00 FROM vendors WHERE name = 'Mama Nkechi Kitchen'
UNION ALL
SELECT id, 'Egusi Soup + Pounded Yam', 4000.00 FROM vendors WHERE name = 'Mama Nkechi Kitchen'
UNION ALL
SELECT id, 'Spicy Chicken Meal', 3200.00 FROM vendors WHERE name = 'Chicken Republic - Ikeja';

INSERT INTO riders (name, phone) VALUES ('Tunde Bello', '08012345678');

INSERT INTO customers (name, phone) VALUES ('Desmond Eguono', '08087654321');

-- Vendors need known coordinates to quote a delivery distance/fee against.
UPDATE vendors SET latitude = 6.6018, longitude = 3.3515 WHERE name = 'Mama Nkechi Kitchen';
UPDATE vendors SET latitude = 6.6059, longitude = 3.3491 WHERE name = 'Chicken Republic - Ikeja';
