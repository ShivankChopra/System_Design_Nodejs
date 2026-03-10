const UNIT_TO_SECONDS = {
  second: 1,
  minute: 60,
  hour: 60 * 60,
  day: 24 * 60 * 60,
};

function toSeconds(unit) {
  const value = UNIT_TO_SECONDS[unit];
  if (!value) {
    throw new Error(`Unsupported unit: ${unit}`);
  }

  return value;
}

module.exports = { toSeconds, UNIT_TO_SECONDS };
