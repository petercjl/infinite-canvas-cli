# Local implementation validation

Latest live evidence: [2026-10-22 end-to-end validation](live-validation-20261022.md). The sections below preserve the initial implementation validation snapshot.

Version: `0.1.0-dev.0`. Platform actually exercised: Codex on macOS, Node.js 25.9.0.

## Passed

- `npm run check`: 17 tests, zero failures. Includes strict flags, ordered references, actual CLI dry run, missing-provider doctor failure, idempotency conflicts, native-result deduplication, importing a missing video, preserving original nodes in a Frame, uncertain submission recovery, continuing a failed Frame save without a second send, managed Skill synchronization, rollback, user-file preservation and update detection behavior.
- Actual dedicated ecommerce Chrome connection verified: fixed CDP port/profile/process flags, requested board ID and all four unique native controls.
- Read-only editor adapter check: saved and live scene signatures match. Read-only prior completed conversation check: result parser finds one video and its two returned reference URLs.
- Package tarball inspected: 19 intended files, source/Skill/resources present; development evidence, local home paths, board IDs and credentials absent.
- Exact tarball installed in a fresh temporary npm prefix; real packaged entry reports the correct version and performs a reference-image dry run without paid action.
- Source-linked local command reports the correct version; doctor succeeds. Canonical bundled Skill installed and verified through package-managed commands for Codex only.
- Current base Skill validator: valid. Portable Skill scan: zero errors/warnings. Capability validator: zero errors/warnings. Codex adapter structural gap count: zero.

## Pending by scope

- A real generation and actual Frame mutation through this packaged CLI have not been executed. The user requested implementation before live testing/debugging.
- Clean-context regression has not been run; it requires separate user authorization and an accepted standard result.
- Windows QA runner is declared but has not run. The Windows ecommerce browser runtime and other Agent runtimes remain unverified.
- Package is unpublished. The shared structural package audit reports missing OIDC publication workflow and a publication-to-QA dependency. These are release setup gates, intentionally deferred until publication is requested. No local npm publication or release workflow was created.

The current service save API has no documented conditional revision write. Backup, fresh-read conflict detection, browser synchronization checks and readback verification reduce conflicts; they do not establish service-level atomic compare-and-swap semantics.
