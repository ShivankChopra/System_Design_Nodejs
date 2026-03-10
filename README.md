# System Design Primer (Node.js)

This repository contains hands-on system design case studies implemented in **Node.js**, inspired by concepts from Alex Xu's _System Design Interview_ books!

## Purpose

- Learn system design by building real, working modules.
- Translate interview-level design ideas into production-style Node.js code.
- Keep each topic practical with runnable demos and tests.

## Implemented So Far

### 1. Rate Limiter

Location: `rate-limiter/`

Includes:

- Multiple algorithms (only `token bucket` implemented for now..)
- Config-driven rules
- Express demo server
- Smoke tests

## Quick Start

Install dependencies:

```bash
npm install
```

Run smoke tests:

```bash
npm test
```

Run Rate Limiter Demo

Go to rate-limiter/ folder, then change the route configuration to set desired rate limiting. Then run demo server and test out the endpoint with your favourite API client!

```javascript
node server.js
```

## Notes

- This is a learning-focused implementation project.
- Designs are inspired by Alex Xu's material and adapted into working Node.js modules.
- This project is built with heavy AI-assisted coding to implement and iterate system design case studies in Node.js quickly (I use codex!)
