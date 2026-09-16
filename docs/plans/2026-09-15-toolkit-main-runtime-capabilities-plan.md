# Toolkit Main Runtime Capabilities Implementation Plan

> **For the agent:** REQUIRED SUB-SKILL: Use `sp-executing-plans` to implement this plan task-by-task.

**Goal:** Reorganize toolkit runtime boundaries and add tested main-process download, async integrity, archive, SM4, and renderer-facing download/archive capabilities without changing business projects.

**Architecture:** Main-only implementation lives under `src/main/libs`; renderer-consumable capabilities live under `src/main/capability` and expose Service/Notice schemas. `service`, `notice`, `preload`, and `shared` are explicit package subpaths. Download uses Electron `net.request` and inherits upper-layer certificate/session policy; archive uses mature ZIP libraries with an optional streaming decrypt Transform; SM4 is implemented directly from the standard with Node-crypto-style APIs.

**Tech Stack:** CommonJS, Electron 22, Node streams, `stream/promises`, `archiver`, `unzipper`, Node `crypto` primitives where applicable, Node test runner/Vitest as already configured.

---

## Task 1: Freeze and test the new package boundary

**Files:**
- Create: `tests/main-boundary.test.js`
- Modify: `package.json`
- Modify: `src/index.js` (remove root aggregate if present)
- Create/Modify: `src/main/index.js`

**Step 1: Write failing boundary tests**

Cover:

- root import is unavailable or no longer exposes an aggregate API;
- `@base-client/toolkit/main` is main-only;
- `@base-client/toolkit/service`, `/notice`, `/preload`, and `/shared` resolve;
- no main-only module is imported by `shared` or preload entry.

**Step 2: Run tests to verify failure**

Run: `npm test -- --run tests/main-boundary.test.js`

Expected: FAIL because the current root exports and paths do not match the new layout.

**Step 3: Implement only exports and empty boundary structure**

Update `package.json#exports` to explicit subpaths. Do not add compatibility aliases. Keep `main/index.js` as an explicitly main-scoped aggregate, not a root aggregate.

**Step 4: Run tests**

Run: `npm test -- --run tests/main-boundary.test.js`

Expected: PASS.

**Step 5: Commit**

```bash
git add package.json src tests/main-boundary.test.js
git commit -m "refactor: establish explicit toolkit runtime exports"
```

## Task 2: Reclassify toolkit source directories

**Files:**
- Move: `src/capability/*` into `src/main/capability/*` only after classifying each module
- Move: `src/enhance/*` into `src/main/enhance/*`
- Move: `src/capability/os/*` into `src/main/libs/os.js` or equivalent main-only utility
- Move: `src/paths.js` into `src/main/paths.js`
- Create: `src/main/libs/`
- Create: `src/preload/index.js`
- Modify: internal imports throughout `src/main`, `src/service`, `src/notice`, and `src/preload`

**Step 1: Add classification assertions**

Add tests that assert:

- `shared` contains no Electron/Node-only imports;
- `main/libs/os` is not exported through preload;
- `capability/example` remains a Service/Notice sample;
- `main/paths` remains main-only.

**Step 2: Run boundary tests and verify expected failures**

Run: `npm test -- --run tests/main-boundary.test.js`

Expected: FAIL until the physical moves and imports are complete.

**Step 3: Move modules and repair imports**

Do not split update-specific logic into `main/libs/update`. Keep update as a capability-level module and let future generic libs be adopted later. Move only modules that are clearly main-only into `main/libs`.

**Step 4: Run the complete toolkit suite**

Run: `npm test`

Expected: PASS with no import path failures.

**Step 5: Commit**

```bash
git add src tests
git commit -m "refactor: separate toolkit main preload and shared code"
```

## Task 3: Implement standard-based SM4 module

**Files:**
- Create: `src/main/libs/sm4/index.js`
- Create: `src/main/libs/sm4/block.js`
- Create: `src/main/libs/sm4/cbc.js`
- Create: `src/main/libs/sm4/padding.js`
- Create: `tests/sm4.test.js`

**Step 1: Write failing algorithm tests**

Cover:

- standard SM4 block test vector;
- key and IV length validation;
- CBC encryption/decryption round trip;
- PKCS#7 empty, aligned, and unaligned inputs;
- invalid padding failure;
- arbitrary stream chunk boundaries;
- no dependency on `sm-crypto`.

**Step 2: Run tests to verify failure**

Run: `npm test -- --run tests/sm4.test.js`

Expected: FAIL because the new module does not exist.

**Step 3: Implement the SM4 standard directly**

Implement S-box, system parameters, key expansion, 32 rounds, block operations, CBC state, PKCS#7, and Node-crypto-style `createCipheriv`/`createDecipheriv` with `update`, `final`, and `setAutoPadding`. Implement true incremental Transform behavior; never buffer the complete input.

**Step 4: Verify tests**

Run: `npm test -- --run tests/sm4.test.js`

Expected: PASS, including large stream and arbitrary chunk tests.

**Step 5: Commit**

```bash
git add src/main/libs/sm4 tests/sm4.test.js
git commit -m "feat: add standard SM4 CBC streaming implementation"
```

## Task 4: Implement asynchronous integrity library

**Files:**
- Create: `src/main/libs/integrity/index.js`
- Create: `tests/integrity.test.js`
- Modify later: existing update/installer callers only after this task is green

**Step 1: Write failing tests**

Cover SHA-256 and MD5, large files, wrong digest, missing file, and ensure the implementation uses streaming reads rather than `readFileSync`.

**Step 2: Run RED**

Run: `npm test -- --run tests/integrity.test.js`

Expected: FAIL because the library is absent.

**Step 3: Implement**

Use `createReadStream` and `stream/promises.pipeline`. Return a Promise with `{ valid, algorithm, expected, actual, size }` or throw a structured error according to the contract. Keep algorithm selection explicit.

**Step 4: Run GREEN**

Run: `npm test -- --run tests/integrity.test.js`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/main/libs/integrity tests/integrity.test.js
git commit -m "feat: add asynchronous streaming integrity checks"
```

## Task 5: Implement Electron-net download library

**Files:**
- Create: `src/main/libs/download/index.js`
- Create: `src/main/libs/download/electron-net-transport.js`
- Create: `tests/download.test.js`

**Step 1: Write failing tests with injected transport**

Cover one URL, fallback URLs, redirect handling, HTTP failures, progress, cancellation, timeout, temporary-file cleanup, and destination promotion. Include HTTP `Content-Encoding` fixtures for gzip/deflate/br; do not inspect or extract the downloaded file format.

**Step 2: Run RED**

Run: `npm test -- --run tests/download.test.js`

Expected: FAIL because the new library is absent.

**Step 3: Implement transport and task wrapper**

Use `electron.net.request` as the default transport after app readiness. Do not accept a session parameter in the public download API and do not alter certificate policy. Expose `{ promise, cancel() }` internally. Use temp files and atomically promote only after the response stream completes.

**Step 4: Run GREEN**

Run: `npm test -- --run tests/download.test.js`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/main/libs/download tests/download.test.js
git commit -m "feat: add Electron net streaming download library"
```

## Task 6: Implement ZIP archive library with optional decrypt Transform

**Files:**
- Create: `src/main/libs/archive/index.js`
- Create: `src/main/libs/archive/zip.js`
- Create: `tests/archive.test.js`

**Step 1: Write failing tests**

Cover plain ZIP, SM4-decrypted ZIP stream, arbitrary input chunking, target-parent plus ZIP-basename output directory, replacement of only that owned directory, path escape after `path.resolve`, unknown entry-type errors, `ENOSPC` propagation, cancellation, and staging cleanup. The first implementation does not restore ZIP symlink/hardlink metadata; entries exposed by the streaming parser as ordinary files are written as ordinary files.

**Step 2: Run RED**

Run: `npm test -- --run tests/archive.test.js`

Expected: FAIL because the new library is absent.

**Step 3: Implement using mature libraries**

Use `archiver` for creation and `unzipper.Parse()` for entry-by-entry extraction. Insert the optional SM4 Transform before the parser. Do not create an intermediate decrypted ZIP. Resolve each final path against the extraction root and reject anything outside it. Do not restore symlink/hardlink metadata; entries exposed as ordinary files are written as ordinary files. If the parser exposes an unknown entry type, fail with `entryType` and `entryPath`. Do not impose artificial size thresholds; propagate filesystem errors and clean staging.

**Step 4: Run GREEN**

Run: `npm test -- --run tests/archive.test.js`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/main/libs/archive tests/archive.test.js
git commit -m "feat: add streaming safe ZIP archive library"
```

## Task 7: Add renderer-facing download and archive capabilities

**Files:**
- Create: `src/main/capability/download/index.js`
- Create: `src/main/capability/archive/index.js`
- Create: `tests/capability-download.test.js`
- Create: `tests/capability-archive.test.js`

**Step 1: Write failing Service/Notice contract tests**

Verify Service returns only serializable `{ taskId }` and cancel acknowledgement. Verify state/progress/terminal results are Notice-only; no `getState` or `getProgress` handlers exist. Verify renderer receives no absolute paths or secrets.

**Step 2: Run RED**

Run: `npm test -- --run tests/capability-download.test.js tests/capability-archive.test.js`

Expected: FAIL until schemas and handlers are implemented.

**Step 3: Implement capability adapters**

`download` composes controlled scope/fileName resolution, download, integrity, temporary storage, Service `start/cancel`, and Notice `changed`. `archive` composes source/target scope resolution, archive library, optional decrypt key reference resolved in main, Service `extract/cancel`, and Notice `changed`. Keep `describe.json`, `main`, resource IDs, business keys, and application protocols out of toolkit.

**Step 4: Run GREEN**

Run: `npm test -- --run tests/capability-download.test.js tests/capability-archive.test.js`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/main/capability tests/capability-download.test.js tests/capability-archive.test.js
git commit -m "feat: expose download and archive capabilities"
```

## Task 8: Integrate exports and run full verification

**Files:**
- Modify: `package.json`
- Modify: `src/main/index.js`
- Modify: `src/preload/index.js`
- Modify: existing toolkit tests and documentation as needed

**Step 1: Add export and preload integration tests**

Verify explicit subpaths resolve, root aggregate import is absent, preload only installs Service/Notice bridges, and main-only libs cannot be imported through renderer-facing paths.

**Step 2: Run targeted tests**

Run: `npm test -- --run tests/main-boundary.test.js tests/sm4.test.js tests/integrity.test.js tests/download.test.js tests/archive.test.js tests/capability-download.test.js tests/capability-archive.test.js`

Expected: PASS.

**Step 3: Run full toolkit verification**

Run: `npm test`

Expected: all tests pass.

**Step 4: Run package/build checks**

Run: `npm pack --dry-run`

Expected: package contains the new `src/main`, `src/preload`, `src/service`, `src/notice`, and `src/shared` trees and no removed root aggregate.

**Step 5: Commit**

```bash
git add package.json src tests docs
git commit -m "feat: establish toolkit runtime capability architecture"
```

