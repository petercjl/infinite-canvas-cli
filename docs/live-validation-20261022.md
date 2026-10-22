# Live validation — 2026-10-22

Development version `0.1.0-dev.0`, Codex/macOS. Main-run-pass; independent clean-context regression not run. This records live validation before publication.

- Two board files, exactly one Chrome tab per board. Each board has three independent Agent conversations and three completed video tasks. Concurrent native runs were tracked by distinct session/run IDs.
- All six submissions used the native Agent Send button, ordered image references and the supplied prompt. Canvas imports, result inspection and grouping used their separate capability contracts.
- Each board has three saved native Frames. Every Frame contains the original reference node and its matching video node. Fresh API reads confirm one active video node per output URL and the expected membership.
- Six local MP4s were checked against saved sizes and SHA-256 hashes. The requests used the platform's 4-second, 9:16, 480p settings; all returned files are 480×854, with video-stream duration 4.041667 seconds and container duration 4.064 seconds.
- Current `npm run check`: 31 tests passed, zero failures. Coverage additionally verifies simultaneous first-use tab selection, same-board remote concurrency, late native-video deduplication and in-place editor synchronization. Coverage includes reference upload readiness scoped to the composer, native conversation readiness, idempotency, uncertain submission recovery, native Frame renderer metadata/backgrounds, artifact-preserving archival synchronization and managed Skill lifecycle.
- Canonical Skill is synchronized to Codex through the package-managed interface. Other Agent installations were not changed. Generic and Windows runtime support remains unverified.

Canvas API writes synchronize the current editor scene in place before subsequent work. The adapter preserves a single tab per board, queues native UI actions and canvas writes, and permits independent remote generation waits. Frame backgrounds and generated style identifiers are recognized as renderer-owned details; actual media identity, membership and geometry remain verified.

Private task IDs, board IDs, source images, prompts, video URLs, output paths and verification receipts are retained outside the distributed package. Live technical completion does not establish creative quality or independently attest provider model identity.
