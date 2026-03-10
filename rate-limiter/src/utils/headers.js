function setRateLimitHeaders(res, evaluation) {
  res.setHeader('X-RateLimit-Limit', String(evaluation.limit));
  res.setHeader('X-RateLimit-Remaining', String(evaluation.remaining));
  res.setHeader('X-RateLimit-Reset', String(evaluation.resetAt));
}

function setRetryAfterHeader(res, retryAfterSeconds) {
  res.setHeader('Retry-After', String(retryAfterSeconds));
}

module.exports = { setRateLimitHeaders, setRetryAfterHeader };
