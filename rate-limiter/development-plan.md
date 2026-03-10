# Development Plan — Config-Driven Rate Limiter for Node.js / Express

## 1. Goal

Build a configurable and demonstrable rate limiter system in JavaScript for Node.js, designed to be used as Express middleware.

The system is inspired by the rate limiter design approach discussed in Alex Xu’s System Design material, but this project is focused on a practical Node.js implementation with a clean, minimal, and easy-to-understand design.

The system must:

- work as Express middleware
- support runtime configuration refresh from disk without restart
- support multiple rate limiting algorithms at architecture level
- be usable in both single-node and distributed-style setups
- allow route-level or router-level attachment through simple tag-based middleware usage
- stay minimal in code design and avoid overengineering

---

## 2. Primary Product Intent

This is a **core rate limiter system first** project.

That means the first focus is:

- core rate limiter architecture
- configuration loading and validation
- middleware integration shape
- cache abstraction
- one working algorithm implementation
- runtime config refresh support

A demo Express server and route-level testing app will be created later as a separate stage.

---

## 3. Non-Goals for Initial Version

The first version will **not** aim to include:

- a production-grade distributed consistency guarantee
- Redis Lua scripts
- multi-rule config per single tag
- advanced observability platform integration
- persistent storage of last known good config across restart
- configurable refresh interval
- complicated class hierarchy
- event emitter based config propagation
- database-backed rule storage
- admin UI or remote rule management API

---

## 4. High-Level Design Principles

### 4.1 Configuration is the source of truth

All rate limiting behavior must come from config only.

Route code must not define:

- algorithm
- limits
- units
- extraction rules

Route code should only attach a middleware by tag.

### 4.2 Dead simple public interface

Middleware usage should be extremely simple and readable.

Example intent:

```js
app.use("/marketing/:post", RateLimiter.apply("marketing-post"));
```

### 4.3 One rule per tag

Each config tag maps to exactly one rate limiting rule.

If a route needs multiple rate limits, the user can cascade middleware manually using multiple tags.

Example idea:

```js
app.use(
    "/marketing/:post",
    RateLimiter.apply("marketing-post-ip"),
    RateLimiter.apply("marketing-post-user"),
    RateLimiter.apply("marketing-post-global"),
);
```

This keeps the internal design much simpler.

### 4.4 Strict startup validation

If middleware is attached with a tag that does not exist in config, startup must fail.

This is intentional to prevent silent business-impacting mistakes.

### 4.5 Runtime refresh should be forgiving

If runtime config refresh fails because of invalid or broken config:

- keep using the last known good config
- log errors to console
- do not crash the running service

However, if the system restarts and config is still invalid, startup must fail.

### 4.6 Minimal low-level design

Keep the code direct, readable, and functional.

Use a single public `RateLimiter` class with static members for shared state.

Internal helper modules are acceptable, but avoid unnecessary abstraction.

---

## 5. Public API Shape

## 5.1 System initialization

The rate limiter should be initialized once at application bootstrap.

Example intent:

```js
RateLimiter.init({
    configPath: "./config/rate-limiter.json",
    cache: {
        type: "memory",
    },
});
```

or

```js
RateLimiter.init({
    configPath: "./config/rate-limiter.json",
    cache: {
        type: "redis",
        options: {
            host: "localhost",
            port: 6379,
        },
    },
});
```

### Responsibilities of `RateLimiter.init(...)`

- load configuration from disk
- validate configuration
- initialize cache backend
- store live config in static memory
- start periodic config refresh loop
- prepare internal algorithm registry

---

## 5.2 Middleware attachment

The middleware interface should be simple:

```js
RateLimiter.apply("marketing-post");
```

### Responsibilities of `RateLimiter.apply(tag)`

- validate that the system has been initialized
- validate that the tag exists in currently loaded config
- create a rate limiter instance bound to that tag
- return Express middleware function

---

## 6. Core Functional Requirements

## 6.1 Required rate limit dimensions

The system must support rate limiting based on request identity extracted from:

- IP
- user id
- session id
- global/static key
- custom extractor function

---

## 6.2 Required rate limiting parameters

Each rule must fundamentally define:

- time unit
    - seconds
    - minutes
    - hours
    - days

- number of allowed requests per time unit

---

## 6.3 Required HTTP behavior

The middleware must support traditional HTTP rate limit headers:

- `X-RateLimit-Limit`
- `X-RateLimit-Remaining`
- `X-RateLimit-Reset`
- `Retry-After` (on rejection)

When a request exceeds the limit, respond with:

- HTTP status `429 Too Many Requests`

---

## 6.4 Required cache/storage modes

The system must support:

- in-memory cache
- Redis cache

### Interpretation

For this project, “memcache” is treated as **in-process memory storage**, not Memcached server support.

---

## 6.5 Required algorithm support at architecture level

Architecture must be designed to support all of these algorithms:

- Token Bucket
- Leaky Bucket
- Fixed Window Counter
- Sliding Window Log

### Initial implementation scope

Only **one algorithm** should be fully implemented in v1.

Recommended first implementation:

- **Fixed Window Counter**

Reason:

- simplest to implement
- easiest to reason about
- fits both memory and Redis backend easily
- good for validating the core architecture before expanding

---

## 7. Startup and Runtime Behavior Rules

## 7.1 Startup validation rules

Startup must fail if:

- config file is missing
- config JSON is malformed
- config schema is invalid
- algorithm name is invalid
- required rule fields are missing
- duplicate tags exist
- `RateLimiter.apply(tag)` is called for a tag missing in config
- cache backend initialization fails

---

## 7.2 Runtime refresh rules

Config refresh will be hardcoded to run every **1 minute**.

If refresh succeeds:

- replace active config map in memory

If refresh fails:

- keep last known good config in memory
- log error to console
- do not stop request processing

### Important note

The last known good config only exists in memory.
It does not need to be persisted to disk.

---

## 7.3 Identity extraction failure rules

If request identity extraction fails at runtime:

- allow the request
- log a hard error to console
- do not apply rate limiting for that request

Reason:

- extraction issues may come from runtime environment problems
- do not block business traffic because of extraction failure
- fail-open is acceptable here for v1

---

## 8. Configuration Design

## 8.1 Design goals for config

Config should remain:

- dead simple
- readable
- easy to edit manually
- reloadable from disk
- fully policy-driven

---

## 8.2 Proposed config structure

```json
{
    "rules": {
        "marketing-post": {
            "enabled": true,
            "algorithm": "fixed-window-counter",
            "scope": "ip",
            "limit": 10,
            "unit": "minute"
        },
        "login-user": {
            "enabled": true,
            "algorithm": "fixed-window-counter",
            "scope": "custom",
            "extractorName": "userId",
            "limit": 5,
            "unit": "minute"
        },
        "public-api-global": {
            "enabled": true,
            "algorithm": "fixed-window-counter",
            "scope": "global",
            "limit": 1000,
            "unit": "minute"
        }
    }
}
```

---

## 8.3 Rule fields

### Required fields per tag

- `enabled`
- `algorithm`
- `scope`
- `limit`
- `unit`

### Conditionally required

- `extractorName` when `scope = "custom"`

---

## 8.4 Scope meanings

### `ip`

Use request IP as the identity key.

### `user`

Use a built-in user identity extraction rule.

Expected source should be clearly defined in implementation, for example:

- `req.user.id`

### `session`

Use a built-in session identity extraction rule.

Expected source should be clearly defined in implementation, for example:

- `req.session.id`

### `global`

Use one constant key for all requests.

Example:

- `"global"`

### `custom`

Use a registered custom extractor function referenced by name.

---

## 9. Request Identity Extraction Design

## 9.1 Why this matters

Rate limiting is only meaningful if each request can be mapped to a stable identity key.

The system must separate:

- rate limit policy
- identity extraction logic

---

## 9.2 Built-in extraction strategies

The system should internally support built-in extractors for:

- `ip`
- `user`
- `session`
- `global`

---

## 9.3 Custom extractor support

Custom extraction must be supported.

### Suggested bootstrap model

```js
RateLimiter.init({
    configPath: "./config/rate-limiter.json",
    cache: { type: "memory" },
    extractors: {
        userId: (req) => req.user?.id,
        sessionIdHeader: (req) => req.headers["x-session-id"],
    },
});
```

### Important behavior

If config refers to a custom extractor name that is not registered, startup validation should fail.

This preserves the strict startup safety model.

---

## 10. Cache Layer Design

## 10.1 Purpose

The cache layer stores rate limiting state such as:

- counters
- timestamps
- token counts
- refill markers
- bucket levels

depending on algorithm

---

## 10.2 Supported adapters

### Memory adapter

Used for:

- monolith/single-process mode
- local testing
- quick experimentation

Not suitable for true distributed enforcement.

### Redis adapter

Used for:

- distributed-style deployments
- shared state across multiple Node.js instances

### Limitation callout

Redis support in v1 is basic and intended for demonstration.
Strict atomic correctness is **not fully guaranteed** in this version.

No Lua scripts or advanced atomic coordination will be added in v1.

---

## 10.3 Cache abstraction responsibilities

The cache service layer should expose only the minimal operations needed by algorithms.

Example direction:

- `get(key)`
- `set(key, value, ttl)`
- `increment(key, ttl)`
- `delete(key)`

Some algorithms may later require richer operations, but v1 should stay minimal.

---

## 11. Algorithm Architecture

## 11.1 Supported algorithms at architecture level

- `token-bucket`
- `leaky-bucket`
- `fixed-window-counter`
- `sliding-window-log`

The code structure should make it easy to plug these in later.

---

## 11.2 v1 implementation target

Implement only:

- `fixed-window-counter`

### Why this should come first

It is the simplest algorithm for validating:

- config lookup
- middleware flow
- cache adapter integration
- header generation
- 429 handling
- runtime refresh

---

## 11.3 Suggested algorithm interface shape

Each algorithm module should expose a consistent contract.

Example direction:

```js
evaluate({
  key,
  rule,
  cacheService,
  now
}) => {
  allowed: boolean,
  limit: number,
  remaining: number,
  resetAt: number,
  retryAfter?: number
}
```

This keeps middleware logic independent of algorithm internals.

---

## 12. RateLimiter Class Responsibilities

## 12.1 Static responsibilities

The `RateLimiter` class static side should manage:

- initialized state
- config path
- live rule map
- cache service instance
- custom extractor registry
- algorithm registry
- refresh timer

### Static members conceptually

- `RateLimiter.rulesMap`
- `RateLimiter.cacheService`
- `RateLimiter.extractors`
- `RateLimiter.algorithms`
- `RateLimiter.configPath`
- `RateLimiter.refreshIntervalHandle`
- `RateLimiter.initialized`

---

## 12.2 Instance responsibilities

A `RateLimiter` instance should remain very light.

Each instance only needs to know:

- its `tag`

And during request handling it should:

- fetch current rule from static rule map
- extract request identity
- compute cache key
- delegate to the configured algorithm
- set headers
- allow or reject request

---

## 13. Middleware Request Flow

## 13.1 Request processing flow

For each incoming request:

1. middleware instance reads its tag
2. current rule is fetched from static rules map
3. if rule is disabled, allow request
4. extract identity key according to rule scope
5. if extraction fails:
    - log error
    - allow request

6. build rate limit storage key
7. call selected algorithm evaluator
8. if allowed:
    - set rate limit headers
    - call `next()`

9. if rejected:
    - set rate limit headers
    - set `Retry-After`
    - respond with `429`

---

## 13.2 Cache key format

Keep key structure predictable and simple.

Example direction:

```text
rate-limit:<tag>:<identity>
```

Examples:

```text
rate-limit:marketing-post:203.0.113.1
rate-limit:login-user:user-123
rate-limit:public-api-global:global
```

---

## 14. HTTP Header Rules

## 14.1 Required headers

On all requests where rule is successfully evaluated:

- `X-RateLimit-Limit`
- `X-RateLimit-Remaining`
- `X-RateLimit-Reset`

On blocked requests only:

- `Retry-After`

---

## 14.2 Reset semantics

Choose one simple convention and keep it consistent.

Recommended:

- `X-RateLimit-Reset` = epoch seconds when current window resets

This is easy to interpret and common enough.

---

## 14.3 Multiple middleware note

If multiple rate limiters are cascaded on a route, only the failing middleware should write the final rejection values for now.

No special header-merging logic is needed in v1.

---

## 15. Error Handling Rules

## 15.1 Fatal errors

These should stop startup:

- invalid config
- missing config
- invalid extractor references
- unknown algorithm
- duplicate tags
- missing tag used in middleware registration
- cache init failure

---

## 15.2 Non-fatal runtime errors

These should be logged and request should continue where appropriate:

- runtime config refresh failure
- request identity extraction failure
- recoverable runtime lookup issues

---

## 15.3 Logging policy for v1

Use simple console logging only.

Examples:

- startup validation failure
- refresh parse failure
- unknown runtime issue
- identity extraction failure
- Redis connectivity issue if request can continue safely

No logging framework required in v1.

---

## 16. Suggested Minimal Internal File Structure

```text
rate-limiter/
  src/
    RateLimiter.js
    config/
      loadRules.js
      validateRules.js
    cache/
      cacheService.js
      memoryCache.js
      redisCache.js
    algorithms/
      fixedWindowCounter.js
      tokenBucket.js
      leakyBucket.js
      slidingWindowLog.js
    extractors/
      builtInExtractors.js
    utils/
      time.js
      headers.js
      keyBuilder.js
  config/
    rate-limiter.json
```

### Notes

- all four algorithm files may exist for architecture clarity
- only `fixedWindowCounter.js` needs real implementation initially
- others can be placeholders with explicit “not implemented yet” handling if needed

---

## 17. Development Phases

## Phase 1 — Shape the architecture

Goal:

- finalize class shape
- finalize config schema
- finalize cache abstraction
- finalize algorithm interface
- finalize extractor registration model

Deliverable:

- skeleton project structure
- interface contracts clear on paper before coding

---

## Phase 2 — Build startup system

Implement:

- `RateLimiter.init(...)`
- config file load
- config schema validation
- startup strict failure logic
- static in-memory rules map
- hardcoded 1-minute refresh loop
- last-known-good runtime behavior

Deliverable:

- working bootstrap layer
- config successfully loads and refreshes

---

## Phase 3 — Build middleware surface

Implement:

- `RateLimiter.apply(tag)`
- instance creation
- middleware function generation
- strict tag existence validation

Deliverable:

- middleware can be attached by tag
- startup fails for missing tags

---

## Phase 4 — Build extractor layer

Implement:

- built-in extractors (`ip`, `user`, `session`, `global`)
- custom extractor registration
- runtime extraction failure logging + fail-open behavior

Deliverable:

- request identity can be resolved consistently

---

## Phase 5 — Build cache service layer

Implement:

- cache service abstraction
- memory cache adapter
- Redis cache adapter
- simple operations needed for fixed window counter

Deliverable:

- both storage modes usable by algorithm layer

---

## Phase 6 — Implement first algorithm

Implement:

- fixed window counter algorithm
- counter increment logic
- TTL/window logic
- result shape for headers and rejection

Deliverable:

- one complete end-to-end working algorithm

---

## Phase 7 — Wire headers and rejection behavior

Implement:

- `X-RateLimit-*` header writing
- `Retry-After`
- `429 Too Many Requests` response behavior

Deliverable:

- standards-aligned HTTP behavior for the working algorithm

---

## Phase 8 — Add remaining algorithm architecture placeholders

Implement:

- algorithm registry entries for all four algorithms
- clean placeholder modules for:
    - token bucket
    - leaky bucket
    - sliding window log

Deliverable:

- architecture ready for future expansion
- only one algorithm actually active and complete

---

## Phase 9 — Internal test pass

Test core system without full demo app yet:

- valid config startup
- invalid config startup failure
- missing tag startup failure
- runtime config refresh success
- runtime config refresh invalid file fallback
- memory backend flow
- Redis backend flow
- identity extraction success/failure
- 429 behavior
- headers correctness

Deliverable:

- core system is stable enough for later demo server

---

## 18. Testing Strategy for Core System

## 18.1 Unit testing targets

### Config tests

- valid config accepted
- malformed JSON rejected
- missing required fields rejected
- invalid algorithm rejected
- duplicate tag rejected
- invalid custom extractor reference rejected

### Extractor tests

- IP extraction works
- user extraction works when `req.user.id` exists
- session extraction works when `req.session.id` exists
- custom extractor works
- extractor failure allows request and logs error

### Cache tests

- memory adapter stores and reads correctly
- Redis adapter basic read/write works
- TTL behavior works as expected

### Algorithm tests

For fixed window counter:

- first requests allowed until limit
- request beyond limit blocked
- remaining count correct
- reset time correct

### Middleware tests

- sets headers on allowed requests
- sets headers + retry-after on blocked requests
- returns 429 when blocked
- allows request when rule disabled

---

## 18.2 Integration test targets later

These can be done with a simple demo Express app after core build:

- route-level application
- cascading multiple middleware tags
- config file change reflected after refresh interval
- Redis-backed shared behavior across multiple server instances

---

## 19. Engineering Limitations to State Clearly

The engineering plan must explicitly state these limitations:

### 19.1 Distributed support limitation

Redis-backed mode allows shared state usage across instances, but v1 does **not** attempt strong atomic correctness guarantees.

This is sufficient for demonstration and architecture exploration, not strict production-grade distributed correctness.

### 19.2 Refresh interval limitation

Config refresh interval is intentionally hardcoded to **1 minute** for simplicity in v1.

### 19.3 Single-rule-per-tag limitation

Each tag maps to exactly one rule.
Multiple limits for one route must be achieved by cascading multiple middleware instances.

### 19.4 Last-known-good limitation

Last known good config is kept only in running memory and is not persisted across restart.

---

## 20. Recommended v1 Completion Criteria

v1 should be considered complete when all of the following are true:

- `RateLimiter.init(...)` works
- `RateLimiter.apply("tag")` works
- startup validation is strict
- runtime refresh works with fallback to last known good config
- in-memory backend works
- Redis backend works at basic level
- custom extractors are supported
- fixed window counter algorithm works end-to-end
- `429` behavior works
- required rate limit headers work
- code remains minimal and easy to follow

---

## 21. Suggested Final Build Order

1. finalize config schema
2. implement strict config validator
3. implement `RateLimiter.init(...)`
4. implement static rules map and refresh loop
5. implement `RateLimiter.apply(tag)`
6. implement extractor registry and built-ins
7. implement cache service abstraction
8. implement memory backend
9. implement Redis backend
10. implement fixed window counter
11. wire middleware flow
12. wire response headers and 429 behavior
13. add placeholder algorithm registry for remaining algorithms
14. write core tests
15. only after that, build demo Express app

---

## 22. Final Design Summary

This project will produce a minimal, config-driven, Express-compatible rate limiter for Node.js with the following shape:

- tag-based middleware API
- strict startup validation
- runtime config refresh from disk
- in-memory and Redis support
- built-in and custom request identity extraction
- HTTP rate limit headers
- one rule per tag
- easy middleware cascading for multiple policies
- architecture ready for 4 algorithms
- one fully implemented algorithm in v1
- intentionally simple internal design centered around a single `RateLimiter` class with static shared state

This keeps the system practical, easy to reason about, and aligned with the learning and demonstration goals of the project.
