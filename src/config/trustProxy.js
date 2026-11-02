function resolveTrustProxy(value) {
  if (value === undefined || value === null) {
    return false;
  }

  const normalized = String(value).trim().toLowerCase();

  if (normalized === '' || normalized === 'false' || normalized === '0') {
    return false;
  }

  if (normalized === 'true') {
    return 1;
  }

  if (/^\d+$/.test(normalized)) {
    const hops = Number(normalized);
    if (Number.isInteger(hops) && hops > 0) {
      return hops;
    }
  }

  return false;
}

module.exports = { resolveTrustProxy };
