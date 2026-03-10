function buildRateLimitKey(tag, identity) {
  return `rate-limit:${tag}:${identity}`;
}

module.exports = { buildRateLimitKey };
