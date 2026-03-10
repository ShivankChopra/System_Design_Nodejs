const { toSeconds } = require('../utils/time');
const IDLE_TTL_SECONDS = 300;

function toNowMs(now) {
  if (now === undefined || now === null) {
    return Date.now();
  }

  if (now instanceof Date) {
    return now.getTime();
  }

  if (typeof now !== 'number' || Number.isNaN(now) || now <= 0) {
    throw new Error('Invalid "now" value for token-bucket');
  }

  return now;
}

function tokenBucket({ key, rule, cacheService, now }) {
  if (!key) {
    throw new Error('token-bucket requires key');
  }

  if (!rule || typeof rule.limit !== 'number' || rule.limit <= 0) {
    throw new Error('token-bucket requires a valid rule.limit');
  }

  if (!cacheService) {
    throw new Error('token-bucket requires cacheService');
  }

  const nowMs = toNowMs(now);
  const unitSeconds = toSeconds(rule.unit);
  const capacity = Math.max(1, rule.limit);
  const refillRatePerSecond = rule.limit / unitSeconds;

  const cachedState = cacheService.get(key);
  const state = cachedState && typeof cachedState === 'object'
    ? {
      tokens: typeof cachedState.tokens === 'number' ? cachedState.tokens : capacity,
      lastRefillAtMs: typeof cachedState.lastRefillAtMs === 'number' ? cachedState.lastRefillAtMs : nowMs,
    }
    : { tokens: capacity, lastRefillAtMs: nowMs };

  const elapsedSeconds = Math.max(0, (nowMs - state.lastRefillAtMs) / 1000);
  state.tokens = Math.min(capacity, state.tokens + elapsedSeconds * refillRatePerSecond);
  state.lastRefillAtMs = nowMs;

  let allowed = false;
  if (state.tokens >= 1) {
    state.tokens -= 1;
    allowed = true;
  }

  const remaining = Math.max(0, Math.floor(state.tokens));
  const secondsToNextToken = state.tokens >= 1 ? 0 : (1 - state.tokens) / refillRatePerSecond;
  const secondsToFull = (capacity - state.tokens) / refillRatePerSecond;

  const resetAt = Math.ceil((nowMs + Math.max(0, secondsToFull) * 1000) / 1000);
  const retryAfter = allowed ? undefined : Math.ceil(Math.max(0, secondsToNextToken));

  cacheService.set(key, state, IDLE_TTL_SECONDS);

  return {
    allowed,
    limit: rule.limit,
    remaining,
    resetAt,
    retryAfter,
  };
}

module.exports = { tokenBucket };
