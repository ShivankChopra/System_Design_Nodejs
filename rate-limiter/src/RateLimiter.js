const path = require('path');
const { loadRules } = require('./config/loadRules');
const { createCacheService } = require('./cache/cacheService');
const { buildBuiltInExtractors } = require('./extractors/builtInExtractors');
const { fixedWindowCounter } = require('./algorithms/fixedWindowCounter');
const { tokenBucket } = require('./algorithms/tokenBucket');
const { leakyBucket } = require('./algorithms/leakyBucket');
const { slidingWindowLog } = require('./algorithms/slidingWindowLog');
const { buildRateLimitKey } = require('./utils/keyBuilder');
const { setRateLimitHeaders, setRetryAfterHeader } = require('./utils/headers');

class RateLimiter {
  static REFRESH_INTERVAL_MS = 10 * 1000;
  static initialized = false;
  static configPath = null;
  static rulesMap = new Map();
  static appliedTags = new Set();
  static cacheService = null;
  static extractors = {};
  static algorithms = {};
  static refreshIntervalHandle = null;

  static init(options) {
    if (RateLimiter.initialized) {
      throw new Error('Already initialized');
    }

    const opts = options || {};
    if (!opts.configPath) {
      throw new Error('RateLimiter.init requires configPath');
    }

    RateLimiter.configPath = path.resolve(opts.configPath);
    RateLimiter.extractors = {
      ...buildBuiltInExtractors(),
      ...(opts.extractors || {}),
    };

    const loaded = loadRules(RateLimiter.configPath, { extractors: RateLimiter.extractors });
    RateLimiter.rulesMap = loaded.rulesMap;
    RateLimiter.cacheService = createCacheService(opts.cache || { type: 'memory' });

    RateLimiter.algorithms = {
      'fixed-window-counter': fixedWindowCounter,
      'token-bucket': tokenBucket,
      'leaky-bucket': leakyBucket,
      'sliding-window-log': slidingWindowLog,
    };

    RateLimiter.startRefreshLoop();
    RateLimiter.initialized = true;
  }

  static apply(tag) {
    if (!RateLimiter.initialized) {
      throw new Error('RateLimiter is not initialized');
    }

    if (!tag || typeof tag !== 'string') {
      throw new Error('RateLimiter.apply requires a non-empty tag');
    }

    if (!RateLimiter.rulesMap.has(tag)) {
      throw new Error(`Rate limiter tag not found: ${tag}`);
    }

    RateLimiter.appliedTags.add(tag);

    return function rateLimiterMiddleware(req, res, next) {
      const rule = RateLimiter.rulesMap.get(tag);
      if (!rule) {
        console.error(`[RateLimiter] Missing rule at runtime for tag: ${tag}`);
        next();
        return;
      }

      if (!rule.enabled) {
        next();
        return;
      }

      try {
        const identity = RateLimiter.extractIdentity(req, rule, tag);
        req.rateLimiterIdentity = req.rateLimiterIdentity || {};
        req.rateLimiterIdentity[tag] = identity;
      } catch (error) {
        console.error(`[RateLimiter] Identity extraction failed for tag "${tag}": ${error.message}`);
        next();
        return;
      }

      try {
        const identity = req.rateLimiterIdentity[tag];
        const key = buildRateLimitKey(tag, identity);
        const evaluate = RateLimiter.algorithms[rule.algorithm];

        if (typeof evaluate !== 'function') {
          throw new Error(`Algorithm evaluator not found: ${rule.algorithm}`);
        }

        const evaluation = evaluate({
          key,
          rule,
          cacheService: RateLimiter.cacheService,
          now: Date.now(),
        });

        setRateLimitHeaders(res, evaluation);

        if (!evaluation.allowed) {
          if (typeof evaluation.retryAfter === 'number') {
            setRetryAfterHeader(res, evaluation.retryAfter);
          }
          res.status(429).send('Too Many Requests');
          return;
        }
      } catch (error) {
        console.error(`[RateLimiter] Runtime evaluation failed for tag "${tag}": ${error.message}`);
      }

      next();
    };
  }

  static startRefreshLoop() {
    RateLimiter.refreshIntervalHandle = setInterval(() => {
      RateLimiter.refreshConfigFromDisk();
    }, RateLimiter.REFRESH_INTERVAL_MS);

    if (typeof RateLimiter.refreshIntervalHandle.unref === 'function') {
      RateLimiter.refreshIntervalHandle.unref();
    }
  }

  static refreshConfigFromDisk() {
    try {
      const loaded = loadRules(RateLimiter.configPath, { extractors: RateLimiter.extractors });
      const nextRulesMap = new Map(loaded.rulesMap);

      for (const tag of RateLimiter.appliedTags) {
        if (!nextRulesMap.has(tag) && RateLimiter.rulesMap.has(tag)) {
          nextRulesMap.set(tag, RateLimiter.rulesMap.get(tag));
        }
      }

      RateLimiter.rulesMap = nextRulesMap;
    } catch (error) {
      console.error(`[RateLimiter] Config refresh failed: ${error.message}`);
    }
  }

  static extractIdentity(req, rule, tag) {
    const scope = rule.scope;

    let extractorName = scope;
    if (scope === 'custom') {
      extractorName = rule.extractorName;
    }

    const extractor = RateLimiter.extractors[extractorName];
    if (typeof extractor !== 'function') {
      throw new Error(`Extractor not found: ${extractorName}`);
    }

    const value = extractor(req);
    if (value === undefined || value === null || value === '') {
      throw new Error(`Empty identity for scope "${scope}" on tag "${tag}"`);
    }

    return String(value);
  }
}

module.exports = { RateLimiter };
