const ALGORITHMS = new Set([
  'fixed-window-counter',
  'token-bucket',
  'leaky-bucket',
  'sliding-window-log',
]);

const SCOPES = new Set(['ip', 'user', 'session', 'global', 'custom']);
const UNITS = new Set(['second', 'minute', 'hour', 'day']);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateRule(tag, rule, extractors) {
  if (!isPlainObject(rule)) {
    throw new Error(`Rule must be an object for tag: ${tag}`);
  }

  const required = ['enabled', 'algorithm', 'scope', 'limit', 'unit'];
  for (const field of required) {
    if (!(field in rule)) {
      throw new Error(`Missing required field "${field}" for tag: ${tag}`);
    }
  }

  if (typeof rule.enabled !== 'boolean') {
    throw new Error(`Field "enabled" must be boolean for tag: ${tag}`);
  }

  if (!ALGORITHMS.has(rule.algorithm)) {
    throw new Error(`Unknown algorithm "${rule.algorithm}" for tag: ${tag}`);
  }

  if (!SCOPES.has(rule.scope)) {
    throw new Error(`Unknown scope "${rule.scope}" for tag: ${tag}`);
  }

  if (typeof rule.limit !== 'number' || rule.limit <= 0) {
    throw new Error(`Field "limit" must be a positive number for tag: ${tag}`);
  }

  if (!UNITS.has(rule.unit)) {
    throw new Error(`Unknown unit "${rule.unit}" for tag: ${tag}`);
  }

  if (rule.scope === 'custom') {
    if (!rule.extractorName || typeof rule.extractorName !== 'string') {
      throw new Error(`Field "extractorName" is required for custom scope: ${tag}`);
    }

    if (typeof extractors[rule.extractorName] !== 'function') {
      throw new Error(
        `Custom extractor "${rule.extractorName}" is not registered for tag: ${tag}`,
      );
    }
  }
}

function validateRules(config, context) {
  const extractors = (context && context.extractors) || {};

  if (!isPlainObject(config)) {
    throw new Error('Rate limiter config must be a JSON object');
  }

  if (!isPlainObject(config.rules)) {
    throw new Error('Rate limiter config must include a "rules" object');
  }

  const tags = Object.keys(config.rules);
  if (tags.length === 0) {
    throw new Error('Rate limiter config must include at least one rule');
  }

  for (const tag of tags) {
    if (!tag || typeof tag !== 'string') {
      throw new Error('Each rule tag must be a non-empty string');
    }

    validateRule(tag, config.rules[tag], extractors);
  }

  return true;
}

module.exports = { validateRules, ALGORITHMS, SCOPES, UNITS };
