# Consistent Hashing Load Balancer Sandbox — Development Plan

## 1. Goal

Build a minimal but real sandbox in Node.js to learn and demonstrate how a centralized HTTP load balancer can use **consistent hashing with virtual nodes** to route requests across multiple backend servers.

The system should be small, easy to reason about, and implemented with actual HTTP servers and clients rather than mock objects.

The main learning goals are:

- understand how a consistent hashing ring works
- see how virtual nodes improve distribution
- observe how key ownership changes when servers are added or removed
- implement simple fallback routing when a selected backend fails
- keep the design intentionally minimal and cognitively light

---

## 2. High-Level System

The sandbox will contain three parts:

### 2.1 Backend servers

Simple HTTP servers that:

- expose a GET endpoint for handling requests
- return a response identifying which server handled the request
- self-register with the load balancer over HTTP when started

### 2.2 Load balancer

A central HTTP server that:

- receives client GET requests
- extracts a stable client key
- hashes the client key
- chooses a backend server using consistent hashing
- proxies the request to the chosen backend
- falls back to the next server in ring order if the selected one fails
- removes dead server virtual nodes from internal structures after failure
- accepts backend self-registration over HTTP

### 2.3 Test harness

A single test file that:

- creates backend servers
- creates clients
- sends requests through the load balancer
- simulates server addition and removal
- observes request distribution and remapping behavior

---

## 3. Scope

### In scope

- centralized HTTP load balancer
- consistent hashing ring
- virtual nodes per backend server
- non-cryptographic hashing using Murmur
- GET requests only
- backend self-registration via HTTP
- sorted ring lookup
- circular fallback to next virtual node on backend failure
- lazy pruning of dead backend nodes after failed routing attempt
- real HTTP proxying from load balancer to backend
- test scenarios for adding/removing servers and observing mapping changes

### Out of scope

- POST / PUT / DELETE support
- request body replay or buffering logic
- timestamps or heartbeat expiry windows
- sweeper jobs or background stale-node cleanup
- active health-check polling by the load balancer
- ring rebuild strategy
- persistence
- distributed or multi-load-balancer coordination
- production-hardening concerns such as TLS, auth, metrics backends, or circuit breakers

---

## 4. Core Design Decisions

### 4.1 Centralized architecture

This project is **not** client-side consistent hashing. It is a centralized reverse proxy that applies consistent hashing internally.

### 4.2 GET-only support

Only GET requests are supported.

Reason:

- keeps retry semantics safe
- avoids request body replay complexity
- keeps proxying and failover logic simple

### 4.3 Self-registration over HTTP only

Backend servers join the system by explicitly calling a load balancer registration endpoint.

There will be no hidden in-memory registration shortcuts.

### 4.4 No timestamp tracking

The load balancer will not store last-seen times.

Reason:

- keeps the project lighter
- avoids sweeper logic
- dead nodes are removed lazily when request routing discovers failure

### 4.5 Incremental ring maintenance

The ring will be updated incrementally:

- add server virtual nodes on registration
- remove server virtual nodes after failure

There will be no full ring rebuild step.

### 4.6 Murmur hashing

Use a Murmur-family non-cryptographic hash function for:

- client key hashing
- virtual node hashing

The ring should operate on numeric hash values sorted in ascending order.

---

## 5. Functional Requirements

### 5.1 Backend registration

The load balancer must expose an HTTP endpoint for server self-registration.

A backend server sends:

- `serverId`
- `addr` where `addr` is the combined host and port representation

Behavior:

- if `serverId` is not already known, create server entry and insert all virtual nodes
- if `serverId` already exists, ignore the registration

### 5.2 Request routing

The load balancer must expose a GET endpoint for client requests.

Behavior:

- read a stable routing key from request headers or query params
- hash the key
- find the owner virtual node in the ring
- map to the real server
- proxy the GET request to that backend

### 5.3 Failover

If a selected backend cannot be reached or fails during request forwarding:

- mark that server as failed for this request
- walk the ring forward in circular order
- skip already-tried real servers
- try the next eligible server
- after failure is confirmed, remove all virtual nodes for that dead server from internal structures

### 5.4 No backend available

If there are no servers in the ring, or all distinct candidate servers fail:

- return HTTP `503 Service Unavailable`

### 5.5 Observability

The sandbox should log enough information to inspect behavior.

Minimum useful logs:

- server registration
- ring insertion counts
- request key and request hash
- selected primary server
- fallback attempts
- dead server pruning
- final responding server

---

## 6. Non-Requirements / Limitations

The following are explicitly not required in version 1:

- support for non-idempotent methods
- graceful handling of partial stream retries for request bodies
- duplicate-registration refresh logic
- membership expiry based on heartbeat intervals
- server status states such as suspect / unhealthy / draining
- optimized ring mutation structures beyond simple arrays and maps
- hash collision recovery beyond basic defensive checks
- replication or quorum behavior
- weighted consistent hashing
- production-grade backpressure or connection pooling

---

## 7. Request Model

## 7.1 Routing key

Use a stable client-specific key.

Preferred form:

- request header: `x-client-key`

The same client key should map to the same backend while the ring membership remains unchanged.

### 7.2 Backend response format

Backend servers can respond with simple text such as:

`server-A handled key client-17`

This is enough for observing routing behavior.

---

## 8. Data Structures

Keep the design minimal.

### 8.1 Virtual node object

```js
node = {
    nodeKey,
    nodeHash,
    serverId,
};
```

Where:

- `nodeKey` = unique string for a virtual node, e.g. `server-A#vn:3`
- `nodeHash` = Murmur hash of `nodeKey`
- `serverId` = real backend server identity

### 8.2 Server map

```js
Map<serverId, {
  nodeHashes: [],
  addr
}>
```

Where:

- `nodeHashes` = list of all virtual node hashes owned by the server
- `addr` = combined host:port style address string

Purpose:

- detect duplicate registration
- look up backend address during proxying
- remove all virtual nodes for one server efficiently

### 8.3 Virtual node map

```js
Map<nodeHash, node>
```

Purpose:

- convert ring hash to virtual node metadata
- retrieve owning `serverId`

### 8.4 Sorted ring

```js
ringNodeHashes = [];
```

A sorted ascending array of all virtual node hashes.

Purpose:

- binary search for first owner node
- circular traversal for fallback

### 8.5 Important rule

`ringIndex` is **not** stored permanently in node objects.

Reason:

- indices shift whenever entries are inserted or removed
- index should be treated as runtime derived state only

---

## 9. Algorithms

## 9.1 Virtual node generation

For each real server, create `VIRTUAL_NODE_COUNT` virtual nodes.

Example virtual node key:

```txt
server-A#vn:0
server-A#vn:1
server-A#vn:2
```

For each:

- hash `nodeKey` using Murmur
- create node object
- store in `Map<nodeHash, node>`
- append hash to server’s `nodeHashes`
- insert hash into `ringNodeHashes`

Sort `ringNodeHashes` ascending after insertion.

## 9.2 Server registration algorithm

1. receive `serverId` and `addr`
2. if `servers.has(serverId)` is true, ignore
3. create server entry with empty `nodeHashes`
4. generate all virtual nodes for the server
5. insert all virtual node hashes into ring and node map
6. sort ring
7. save server entry

## 9.3 Request hash lookup

1. extract `clientKey`
2. compute `requestHash = murmur(clientKey)`
3. binary search `ringNodeHashes` for first hash `>= requestHash`
4. if none found, wrap to index `0`
5. that ring position is the primary virtual node

## 9.4 Fallback traversal

Input:

- starting ring index
- set of tried real server IDs

Algorithm:

1. look at current ring index
2. get `nodeHash`
3. resolve node via `nodes.get(nodeHash)`
4. get `serverId`
5. if `serverId` already tried, move to next ring index
6. otherwise attempt proxy to that server
7. if success, stop
8. if failure, record `serverId` as failed, remove that server from internal structures, continue scanning from next ring position
9. if all distinct servers are exhausted, return `503`

## 9.5 Next-ring traversal

A helper function should return the next circular ring index.

Behavior:

- if current index is not last index, return `index + 1`
- if current index is last index, wrap to `0`

Internal traversal should use ring indices, not repeated hash lookups.

## 9.6 Server removal

When a server is confirmed dead during request routing:

1. get its entry from `servers`
2. read `nodeHashes`
3. delete each node hash from `nodes`
4. remove all those hashes from `ringNodeHashes`
5. delete the server entry from `servers`

For demo scale, array filtering is acceptable.

---

## 10. Hashing Strategy

### 10.1 Hash function

Use a Murmur-family non-cryptographic hash.

Requirements for the chosen library:

- deterministic output
- stable numeric output usable for sorting
- easy use in Node.js

### 10.2 Hash inputs

- request routing key: `clientKey`
- virtual node key: `serverId#vn:index`

### 10.3 Collision handling

For demo scale, assume collisions are rare.

Minimal acceptable behavior:

- detect if a generated `nodeHash` already exists
- either throw an error or log and reject registration

Do not add collision-resolution complexity unless needed.

---

## 11. Proxying Strategy

### 11.1 Request handling

The load balancer receives a GET request and forwards it to the chosen backend.

The forwarded request should preserve enough information for the backend to echo the client key and server identity.

### 11.2 Proxy mechanism

Use Node.js HTTP request forwarding.

Allowed style:

- request-response piping for GET requests
- keep proxying simple and transparent

### 11.3 Failure conditions

Treat these as backend failure for sandbox purposes:

- connection refused
- socket hang-up
- request timeout
- unreachable host/port

On such failure:

- consider that backend dead
- prune it from internal structures
- continue fallback traversal

---

## 12. HTTP Endpoints

## 12.1 Load balancer endpoints

### `POST /register`

Used by backend servers to self-register.

Payload:

```json
{
    "serverId": "server-A",
    "addr": "127.0.0.1:4001"
}
```

Responses:

- `201` for newly registered
- `200` for already known and ignored

### `GET /route`

Used by clients.

Input:

- header `x-client-key`

Behavior:

- route through consistent hashing
- proxy to backend
- return backend response

Possible responses:

- `200` on success
- `400` if missing routing key
- `503` if no backend available

## 12.2 Backend endpoint

### `GET /handle`

Returns a simple response indicating server identity and key.

---

## 13. Test Harness Design

The test harness should be a single script that creates servers and clients functionally.

### 13.1 Server factory

A helper such as:

```js
createServer(serverId, port);
```

Responsibilities:

- start backend HTTP server
- expose `GET /handle`
- call load balancer `POST /register`
- provide methods to stop the server for failure simulation

### 13.2 Client factory

A helper such as:

```js
createClient(clientKey);
```

Responsibilities:

- send requests through the load balancer
- include `x-client-key`
- collect responses

### 13.3 Suggested scenarios

#### Scenario A: stable mapping

- start 3 servers
- send repeated requests from same keys
- verify same key keeps going to same server

#### Scenario B: distribution

- use many client keys
- count per-server hits
- inspect distribution with configured virtual node count

#### Scenario C: remove one server

- start 3 servers
- record mapping snapshot
- stop one backend
- send requests again
- observe lazy pruning and remapping

#### Scenario D: add one server

- start with 2 servers
- record mapping snapshot
- add third server
- observe partial remapping only

#### Scenario E: all servers down

- stop all servers
- verify `503`

---

## 14. Configuration

Keep configuration simple and centralized.

Suggested config values:

- `LOAD_BALANCER_PORT`
- `VIRTUAL_NODE_COUNT`
- `BACKEND_REQUEST_TIMEOUT_MS`
- `REGISTER_ENDPOINT`
- `ROUTE_ENDPOINT`

Use hardcoded config object first. Environment-variable support is optional.

---

## 15. Logging and Debugging

Log clearly but keep output readable.

Suggested log events:

- `[REGISTERED] server-A -> 127.0.0.1:4001`
- `[RING_ADD] server-A added 50 virtual nodes`
- `[ROUTE] clientKey=client-7 hash=123456789 primary=server-B`
- `[FAIL] server-B timeout, pruning server`
- `[FALLBACK] retrying next server server-C`
- `[SUCCESS] client-7 served by server-C`

Optional helpful debug helper:

- print ring summary showing total servers and total virtual nodes

---

## 16. Implementation Phases

## Phase 1 — Project skeleton

Goal:

- create project structure
- choose Murmur hash library
- define config
- create placeholder files and basic startup flow

Deliverables:

- Node.js project initialized
- hashing helper ready
- load balancer entry file
- test file entry point

## Phase 2 — Core data structures

Goal:

- implement internal in-memory structures
- implement helpers for insert, lookup, and delete

Deliverables:

- server map
- node map
- sorted ring array
- helper methods for:
    - add server virtual nodes
    - remove server virtual nodes
    - binary search owner index
    - get next circular index

## Phase 3 — Registration endpoint

Goal:

- expose HTTP self-registration endpoint on load balancer
- register server only once

Deliverables:

- `POST /register`
- duplicate server detection
- virtual node insertion and ring sorting
- registration logs

## Phase 4 — Backend server factory

Goal:

- create actual backend HTTP servers
- each server self-registers with the load balancer

Deliverables:

- `createServer(serverId, port)` helper
- backend `GET /handle`
- registration call on startup
- stop/shutdown helper for tests

## Phase 5 — Primary routing without failover

Goal:

- receive client GET request
- hash client key
- choose primary backend
- proxy request to backend

Deliverables:

- `GET /route`
- `x-client-key` extraction and validation
- consistent hashing lookup
- request forwarding to backend
- happy-path end-to-end success

## Phase 6 — Fallback and lazy pruning

Goal:

- handle backend failure
- walk ring to next eligible server
- prune failed server globally

Deliverables:

- backend timeout/error detection
- tried-server tracking
- circular fallback traversal
- dead server removal from all structures
- `503` when exhausted

## Phase 7 — Client factory and scenario runner

Goal:

- create a small client abstraction
- run repeatable experiments

Deliverables:

- `createClient(clientKey)` helper
- request loop helpers
- scenario scripts for stable routing and distribution

## Phase 8 — Membership change experiments

Goal:

- validate consistent hashing behavior under churn

Deliverables:

- remove-server scenario
- add-server scenario
- mapping snapshot comparison before/after changes
- per-server request count summary

## Phase 9 — Cleanup and documentation

Goal:

- make project easy to read and hand to Codex or future self

Deliverables:

- clean comments
- concise README notes
- explicit limitations section
- final code organization cleanup

---

## 17. Suggested File Layout

```txt
project-root/
  developmentPlan.md
  package.json
  src/
    config.js
    hash.js
    ConsistentLoadBalancer.js
    serverFactory.js
    clientFactory.js
    testSandbox.js
```

This is intentionally minimal.

---

## 18. Coding Style Guidance

- keep abstractions small and direct
- do not generalize early
- prefer simple arrays and maps over elaborate structures
- keep naming literal and boring
- keep ring traversal code explicit
- avoid introducing classes beyond what is clearly useful
- keep server address as a single `addr` string unless a real need appears to split it

---

## 19. Success Criteria

The sandbox is successful when all of the following are true:

- backend servers can self-register over HTTP
- a stable client key maps consistently to the same backend while membership is unchanged
- virtual nodes are visible in the ring structure
- backend failure causes fallback to another server
- failed server is pruned from ring structures
- adding or removing one server causes only partial key remapping
- no-server condition returns `503`
- behavior is easy to inspect through logs

---

## 20. Final Notes

This project is intentionally a learning sandbox, not a production load balancer.

The design should remain minimal, direct, and easy to reason about. Whenever a choice appears between elegance through more machinery versus a smaller and more transparent implementation, prefer the smaller implementation unless a real need appears.
