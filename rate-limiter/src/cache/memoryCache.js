class MemoryCache {
  constructor() {
    this.store = new Map();
  }

  get(key) {
    this.purgeIfExpired(key);
    const entry = this.store.get(key);
    if (!entry) {
      return undefined;
    }

    return entry.value;
  }

  set(key, value, ttlSeconds) {
    const expiresAtMs = this.toExpiresAtEpochMs(ttlSeconds);
    this.store.set(key, { value, expiresAtMs });
    return true;
  }

  delete(key) {
    return this.store.delete(key);
  }

  increment(key, ttlSeconds) {
    this.purgeIfExpired(key);

    const currentEntry = this.store.get(key);
    if (!currentEntry) {
      this.store.set(key, {
        value: 1,
        expiresAtMs: this.toExpiresAtEpochMs(ttlSeconds),
      });
      return 1;
    }

    if (typeof currentEntry.value !== 'number' || Number.isNaN(currentEntry.value)) {
      throw new Error(`Cannot increment non-number value for key: ${key}`);
    }

    currentEntry.value += 1;
    this.store.set(key, currentEntry);
    return currentEntry.value;
  }

  purgeIfExpired(key) {
    const entry = this.store.get(key);
    if (!entry) {
      return;
    }

    if (entry.expiresAtMs !== null && entry.expiresAtMs <= Date.now()) {
      this.store.delete(key);
    }
  }

  toExpiresAtEpochMs(ttlSeconds) {
    if (ttlSeconds === undefined || ttlSeconds === null) {
      return null;
    }

    if (typeof ttlSeconds !== 'number' || ttlSeconds <= 0) {
      throw new Error('TTL must be a positive number when provided');
    }

    return Date.now() + ttlSeconds * 1000;
  }
}

module.exports = { MemoryCache };
