# Work People Architecture Scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Create independently runnable desktop and server foundations in the two user-selected repositories.

**Architecture:** Electron main owns gRPC and exposes a narrow preload API to Vue. A NestJS modular monolith owns PostgreSQL/Redis. A versioned protobuf contract connects them; Compose deploys backend infrastructure.

**Tech Stack:** Node.js 24 LTS, TypeScript, NestJS, grpc-js, PostgreSQL 18, Redis 8, Electron, Vue 3, electron-vite, npm.

**Spec:** `docs/architecture.md`

## Global Constraints

- Work in the existing client/server folders as explicitly requested; preserve Git history and do not create commits or publish.
- Single company with departments; no tenant layer and no speculative business CRUD.
- Compile NestJS server; native TypeScript stripping does not support its decorators.
- Contract package `workpeople.v1`; `HealthService.Check` returns `status`, `service`, `version`, `checkedAt`, `dependencies`.
- Renderer uses sandbox/context isolation, no Node integration, no arbitrary IPC or network credentials.
- Track package locks/examples; ignore environment secrets, dependencies, build output and local state.

## Review Focus

- Invalid configuration must fail with a useful message: test validation.
- Stopped dependencies must produce bounded degraded health: test health aggregation.
- Packaged protobuf and both loaders must interoperate: run real loopback gRPC test.
- Packaged Electron must contain proto/config defaults and a usable preload: inspect package and launch when supported.
- Repeated/concurrent migrations must be safe: transactions and advisory locking.

### Task 1: Contract and repository foundation (coordinator)

**Files:** both `.gitignore`, `.gitattributes`, `.editorconfig`; server `docs/architecture.md`; both `proto/workpeople/v1/health.proto`.

**Interfaces:** Produces the canonical HealthService schema described above.

- [x] Record selected architecture and implementation plan.
- [x] Create identical proto files and focused Git/editor settings.
- [x] Verify contract equality and ignore behavior for secrets, examples and locks.

### Task 2: NestJS application (server implementer)

**Files:** server package/TypeScript configuration, `src/config`, `src/infrastructure`, `src/modules`, `test`, `scripts`.

**Interfaces:** Consumes health proto; produces `dist/main.js`, `npm run build`, `npm test`, `npm run typecheck`, `npm run healthcheck`, `npm run migration:run`.

- [x] Test environment validation and health aggregation with injected database/cache doubles before implementation.
- [x] Implement config, PostgreSQL/Redis lifecycle, gRPC health and empty business modules.
- [x] Add bounded probe CLI and transactional migration runner with advisory lock/checksums.
- [x] Verify typecheck, build and tests after dependencies are installed.

### Task 3: Electron/Vue desktop (client implementer)

**Files:** client package/build config; `src/main`, `src/preload`, `src/shared`, `src/renderer`; `scripts/sync-contracts.mjs`.

**Interfaces:** Same proto; `window.workPeople.getHealth()` returns serializable success/error with a bounded deadline.

- [x] Build process boundaries and connection screen with loading, connected, degraded and unreachable states.
- [x] AppShell hosts ConnectionPanel; composable owns request state; use Vue Composition API.
- [x] Add IPC sender validation, sandbox/context isolation, CSP and TLS options.
- [x] Add sync/build/installer scripts and independent client documentation.
- [x] Verify typecheck, build and packaged resource/preload paths.

### Task 4: Deployment and integration (coordinator)

**Files:** server Dockerfile, compose files, dockerignore, environment example, migrations and README.

**Interfaces:** gRPC `50051`; internal `postgres:5432`, `redis:6379`; host binds `127.0.0.1`.

- [x] Add multi-stage image, dependency healthchecks, one-shot migrations and named volumes.
- [x] Document setup, configuration, local development and remote TLS in Russian.
- [x] Verify builds/tests, real gRPC call, Git ignores, proto equality and YAML syntax; record unavailable Docker runtime.
- [x] Obtain independent review and fix material findings.
