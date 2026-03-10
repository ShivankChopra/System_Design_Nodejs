const fs = require('fs');
const { validateRules } = require('./validateRules');

function loadRules(configPath, context) {
  const raw = fs.readFileSync(configPath, 'utf8');

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON in rate limiter config: ${error.message}`);
  }

  validateRules(parsed, context || {});

  const rulesMap = new Map(Object.entries(parsed.rules));
  return { rulesMap };
}

module.exports = { loadRules };
