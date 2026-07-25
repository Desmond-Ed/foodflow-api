const {
  haversineDistanceKm,
  calculateDeliveryFee,
  MAX_DELIVERY_DISTANCE_KM,
} = require('../src/services/deliveryFeeService');

describe('haversineDistanceKm', () => {
  it('returns 0 for identical coordinates', () => {
    expect(haversineDistanceKm(6.6018, 3.3515, 6.6018, 3.3515)).toBeCloseTo(0, 5);
  });

  it('matches a hand-calculated distance between two known Lagos points', () => {
    // Ikeja City Mall to Murtala Muhammed Airport, roughly 5.6km apart.
    const distance = haversineDistanceKm(6.6018, 3.3515, 6.5774, 3.3211);
    expect(distance).toBeGreaterThan(3.5);
    expect(distance).toBeLessThan(4.5);
  });

  it('matches a hand-calculated distance for a longer known pair', () => {
    // Ikeja to Ikoyi (Awolowo Road), roughly 18-19km apart.
    const distance = haversineDistanceKm(6.6018, 3.3515, 6.4531, 3.423);
    expect(distance).toBeGreaterThan(16);
    expect(distance).toBeLessThan(20);
  });
});

describe('calculateDeliveryFee', () => {
  it('applies the base fee plus per-km rate', () => {
    // base 500 + 10km * 150/km = 2000
    expect(calculateDeliveryFee(10)).toBe(2000);
  });

  it('applies just the base fee at zero distance', () => {
    expect(calculateDeliveryFee(0)).toBe(500);
  });

  it('rejects distances beyond the max delivery range', () => {
    expect(() => calculateDeliveryFee(MAX_DELIVERY_DISTANCE_KM + 1)).toThrow(/exceeds the maximum range/);
  });

  it('allows a distance exactly at the max range', () => {
    expect(() => calculateDeliveryFee(MAX_DELIVERY_DISTANCE_KM)).not.toThrow();
  });
});
