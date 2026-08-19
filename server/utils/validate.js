function parsePositiveInt(value) {
  const num = Number(value);
  if (!Number.isInteger(num) || num <= 0) return null;
  return num;
}

function isNonEmptyString(value, maxLen) {
  return typeof value === 'string' && value.trim().length > 0 && (!maxLen || value.length <= maxLen);
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

module.exports = { parsePositiveInt, isNonEmptyString, normalizeEmail };
