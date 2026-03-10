const { MemoryCache } = require('./memoryCache');

class CacheService {
  constructor(adapter) {
    this.adapter = adapter;
  }

  get(key) {
    return this.adapter.get(key);
  }

  set(key, value, ttlSeconds) {
    return this.adapter.set(key, value, ttlSeconds);
  }

  increment(key, ttlSeconds) {
    return this.adapter.increment(key, ttlSeconds);
  }

  delete(key) {
    return this.adapter.delete(key);
  }
}

function createCacheService(cacheOptions) {
  const options = cacheOptions || {};
  const type = options.type || 'memory';

  if (type !== 'memory') {
    throw new Error(`Unsupported cache type for now: ${type}`);
  }

  return new CacheService(new MemoryCache());
}

module.exports = { createCacheService, CacheService };
