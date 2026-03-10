# Rate Limiter Module Layout

- `src/`: Rate limiter library implementation.
- `demo/`: Runnable Express demo server.
  - `demo/config/rate-limiter.json`: Active config used by `demo/server.js`.
- `tests/`: Internal smoke tests.
- `examples/`: Reference-only files.
  - `examples/config/reference-rate-limiter.json`: Sample rules for learning/reference; not auto-loaded.

## Which config is actually used?

- Demo run (`npm run demo:rate-limiter`) uses: `rate-limiter/demo/config/rate-limiter.json`.
- Tests create temporary configs at runtime.
- The library uses whichever path you pass to `RateLimiter.init({ configPath })`.
