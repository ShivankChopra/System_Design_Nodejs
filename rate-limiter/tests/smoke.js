const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { RateLimiter } = require('../src');
const { tokenBucket } = require('../src/algorithms/tokenBucket');
const { createCacheService } = require('../src/cache/cacheService');

function resetRateLimiter() {
  RateLimiter.initialized = false;
  RateLimiter.configPath = null;
  RateLimiter.rulesMap = new Map();
  RateLimiter.appliedTags = new Set();
  RateLimiter.cacheService = null;
  RateLimiter.extractors = {};
  RateLimiter.algorithms = {};
  if (RateLimiter.refreshIntervalHandle) {
    clearInterval(RateLimiter.refreshIntervalHandle);
  }
  RateLimiter.refreshIntervalHandle = null;
}

function makeTempConfigFile(configObject) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rate-limiter-'));
  const file = path.join(dir, 'rate-limiter.json');
  fs.writeFileSync(file, JSON.stringify(configObject, null, 2));
  return { dir, file };
}

function makeBaseConfig() {
  return {
    rules: {
      'marketing-post': {
        enabled: true,
        algorithm: 'token-bucket',
        scope: 'ip',
        limit: 1,
        unit: 'minute',
      },
      'login-user': {
        enabled: true,
        algorithm: 'token-bucket',
        scope: 'custom',
        extractorName: 'userId',
        limit: 1,
        unit: 'minute',
      },
      'public-api-global': {
        enabled: true,
        algorithm: 'token-bucket',
        scope: 'global',
        limit: 1,
        unit: 'minute',
      },
    },
  };
}

function mockRes() {
  return {
    headers: {},
    statusCode: 200,
    body: null,
    setHeader(k, v) {
      this.headers[k] = v;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(body) {
      this.body = body;
      return this;
    },
  };
}

function invokeMiddlewareExpectNext(middleware, req, res) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Expected middleware to call next(), but it did not'));
    }, 50);

    try {
      middleware(req, res, () => {
        clearTimeout(timeout);
        resolve({ nextCalled: true, req, res });
      });
    } catch (error) {
      clearTimeout(timeout);
      reject(error);
    }
  });
}

function invokeMiddlewareNoNext(middleware, req, res) {
  return new Promise((resolve, reject) => {
    try {
      middleware(req, res, () => {
        resolve({ nextCalled: true, req, res });
      });
      resolve({ nextCalled: false, req, res });
    } catch (error) {
      reject(error);
    }
  });
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(error.stack || error.message);
    process.exitCode = 1;
  } finally {
    resetRateLimiter();
  }
}

(async () => {
  await test('valid startup loads rules and allows apply(tag)', () => {
    const cfg = makeTempConfigFile(makeBaseConfig());

    RateLimiter.init({
      configPath: cfg.file,
      extractors: { userId: (req) => req.user && req.user.id },
    });

    assert.strictEqual(typeof RateLimiter.apply('marketing-post'), 'function');
    assert.strictEqual(RateLimiter.rulesMap.get('marketing-post').algorithm, 'token-bucket');
  });

  await test('missing tag at apply throws synchronously', () => {
    const cfg = makeTempConfigFile(makeBaseConfig());

    RateLimiter.init({
      configPath: cfg.file,
      extractors: { userId: (req) => req.user && req.user.id },
    });

    assert.throws(() => RateLimiter.apply('does-not-exist'), /tag not found/);
  });

  await test('token-bucket supports fractional limit values like 0.5/sec', () => {
    const cacheService = createCacheService({ type: 'memory' });
    const key = 'rate-limit:fractional:test';
    const rule = { limit: 0.5, unit: 'second' };
    const now = Date.now();

    const first = tokenBucket({ key, rule, cacheService, now });
    const second = tokenBucket({ key, rule, cacheService, now });
    const third = tokenBucket({ key, rule, cacheService, now: now + 2000 });

    assert.strictEqual(first.allowed, true);
    assert.strictEqual(second.allowed, false);
    assert.strictEqual(second.retryAfter, 2);
    assert.strictEqual(third.allowed, true);
  });

  await test('headers are set and blocked request returns 429 with retry-after', async () => {
    const cfg = makeTempConfigFile(makeBaseConfig());

    RateLimiter.init({
      configPath: cfg.file,
      extractors: { userId: (req) => req.user && req.user.id },
    });

    const middleware = RateLimiter.apply('public-api-global');

    const res1 = mockRes();
    const call1 = await invokeMiddlewareExpectNext(middleware, { headers: {}, socket: {} }, res1);

    assert.strictEqual(call1.nextCalled, true);
    assert.ok(res1.headers['X-RateLimit-Limit']);
    assert.ok(res1.headers['X-RateLimit-Remaining']);
    assert.ok(res1.headers['X-RateLimit-Reset']);

    const res2 = mockRes();
    const call2 = await invokeMiddlewareNoNext(middleware, { headers: {}, socket: {} }, res2);

    assert.strictEqual(call2.nextCalled, false);
    assert.strictEqual(res2.statusCode, 429);
    assert.strictEqual(res2.body, 'Too Many Requests');
    assert.ok(res2.headers['Retry-After']);
  });

  await test('identity extraction failure is fail-open', async () => {
    const cfg = makeTempConfigFile(makeBaseConfig());

    RateLimiter.init({
      configPath: cfg.file,
      extractors: { userId: (req) => req.user && req.user.id },
    });

    const middleware = RateLimiter.apply('login-user');
    const call = await invokeMiddlewareExpectNext(middleware, { headers: {}, socket: {} }, mockRes());

    assert.strictEqual(call.nextCalled, true);
  });

  await test('runtime refresh preserves applied missing tags from last-known-good rules', () => {
    const cfg = makeTempConfigFile(makeBaseConfig());

    RateLimiter.init({
      configPath: cfg.file,
      extractors: { userId: (req) => req.user && req.user.id },
    });

    RateLimiter.apply('marketing-post');

    const changed = {
      rules: {
        'public-api-global': {
          enabled: true,
          algorithm: 'token-bucket',
          scope: 'global',
          limit: 2,
          unit: 'minute',
        },
      },
    };

    fs.writeFileSync(cfg.file, JSON.stringify(changed, null, 2));
    RateLimiter.refreshConfigFromDisk();

    assert.ok(RateLimiter.rulesMap.has('marketing-post'));
    assert.strictEqual(RateLimiter.rulesMap.get('public-api-global').limit, 2);
  });

  if (!process.exitCode) {
    console.log('\nAll smoke tests passed.');
  }
})();
