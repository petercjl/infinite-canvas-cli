---
name: infinite-canvas-video
description: "Use infinite-canvas to generate a video through an existing SealSeek Infinite Canvas Agent conversation UI, using a board ID, an unchanged user prompt, and ordered reference images; retrieve the video and group original image and video nodes in a Frame. Use when the user explicitly selects this canvas workflow."
---

# Infinite Canvas Video

Execute an explicitly selected canvas video request with the installed `infinite-canvas` capability. The application or user owns creative choices, prompt, reference selection/order and acceptance. The CLI owns native submission, authentication reuse, canvas writes, idempotency and recovery.

## Input and output

Require a board file ID, the exact prompt and 1–20 ordered PNG, JPEG or WebP references (local paths or HTTPS URLs). Ask only for missing required inputs. Preserve the prompt and image order; 图1 means the first attached image. Inherit model settings from the webpage. An authorized generation request allows one paid native Agent submission. A planning or dry-run request allows validation only.

Return the local MP4 from `artifacts[].path`, task ID, board ID and Frame ID. Success means `status=succeeded`, a nonempty downloaded video, original reference node IDs plus one video node in the saved Frame, and verified readback. A generated video with unfinished grouping is a partial result, reported with its task ID and recovery action.

## Capability resolution

Resolve `infinite-canvas` from PATH. Run `version --json`, `capabilities --json` and `skill source --json` to inspect the installed implementation and current canonical Skill. Minimum contract: native Agent Send, ordered references, existing-node grouping, task get/wait/resume, local video output. Load the selected host adapter in `adapters/`; `generic.json` is the portable fallback. If the entry or required feature is missing, return `CAPABILITY_UNAVAILABLE`; report the missing dependency instead of substituting another generation provider.

External dependencies are Node.js 22+, `playwright-core` and `image-size` (package managed), installed Google Chrome on macOS or Windows, and `sealseek-media` with image upload, canvas get/add capabilities. This Skill invokes the helper through the CLI contract; it does not compose another generation Skill. Browser authentication stays in the user's dedicated Chrome profile. Never copy cookies or tokens into a prompt, output or package.

## Installation and update

Treat plugin installation/update as one operation covering the CLI and this companion Skill. Resolve the current Agent’s own Skill directory from its configuration/catalog, read `skill source --json`, then run `install --agent AGENT_NAME --path SKILL_DIRECTORY --json`. For a package upgrade use `update install --yes --agent AGENT_NAME --path SKILL_DIRECTORY --json`; even an unchanged version must reconcile the Skill. If npm was installed/upgraded directly or scripts were disabled, run the same `install` completion step afterward. Completion requires the actual CLI version plus `complete=true`, `skill.installed=true` and `skill.current=true`. Load the synchronized Skill; refresh the host session if discovery requires it. Missing targets or synchronization failure are an incomplete installation. Only the current/requested Agent is synchronized.

## Main line

1. Validate required inputs and authorization. Run `doctor --json`: its browser check means Chrome is available to launch; `browser_ready` separately reports runtime readiness. Use `browser open --json` to prepare Chrome. The CLI discovers and launches the system browser itself with fixed loopback 9223 and the persistent current-user `.dianshang-chrome-profile`; a separate launcher installation is unnecessary. For a UI compatibility check use `doctor --live --canvas ID --json`. On missing login, have the user sign in in that Chrome window, then return here. The CLI uses CDP port 9223 and the dedicated ecommerce profile. Enforce the single-tab constraint below before any submission or canvas write.
2. Prepare the exact prompt in a new file when needed; preserve any existing file. Run `video generate --canvas ID --prompt-file FILE --reference IMAGE1 --reference IMAGE2 --dry-run --json`, repeating `--reference` in order. Dry run checks local inputs; it does not prove provider availability.
3. For an authorized real request, run the same inputs with `--submit --json`. Save the returned task ID immediately. Repeated identical inputs reuse the same task. `--request-id KEY` provides caller-controlled idempotency; `--new` deliberately creates a new paid task and requires explicit intent to generate another video.
4. Follow `task wait TASK_ID --timeout 30 --json` or `task get TASK_ID --json`. The worker imports references, creates a new native Agent conversation, attaches images, pastes the exact prompt and clicks Send. Status/history reads track the captured session and run. Generation is submitted only through the native UI.
5. On completion, inspect the returned artifact and report its local path. The worker deduplicates the generated video against the board and groups the already imported image nodes and video into one actual Frame. Use the same task ID for any unfinished download or grouping.

## Single-tab constraint and concurrency

**Each board file must be open in exactly one browser tab.** Multiple tabs editing the same board cause save conflicts and the website may suspend editing. Reuse that board's existing tab. A different board may have its own tab.

Run concurrent videos through separate native Agent conversations inside the board's single tab. Serialize the short UI operations: import references, create a fresh conversation, attach images, send once and capture session/run IDs. After submission, track each run independently while preparing another conversation in the same tab. Serialize canvas imports and Frame writes per board; remote generation waiting does not hold that queue. Keep the requested board file count unchanged when adding concurrent video tasks.

Start one `video generate --submit` task per requested video, record every returned ID, and poll all tasks together. Submit the remaining tasks while earlier runs generate. The CLI queues tab selection and composition per board, including simultaneous first use. Use the installed CLI's verified selectors and transport; ordinary runs require no new selector or endpoint exploration.

Conversation readiness means native session creation has completed before attaching references. Attachment readiness counts only the current composer and waits for uploaded HTTPS images. Other conversations may still stream during these steps. After canvas API writes, the CLI synchronizes the editor in place and verifies saved/live scene agreement. Page reload is excluded from this write path because the old scene's auto-save can replace newly imported nodes or Frames. Webpage contract changes return an adapter error for a separate repair cycle.

If duplicate tabs for a board are detected, stop new submissions and writes with `BOARD_SELECTION_REQUIRED`. Preserve all task/session/run IDs, resolve the duplicate tabs, then resume existing tasks. When the website displays its other-tab editing protection, restore editing in the single retained tab after duplicates are closed. Claim resumed generation only from the existing run; a tab conflict never authorizes another paid submission.

## Branches and recovery

- `CHROME_NOT_FOUND`: install Google Chrome or set `INFINITE_CANVAS_CHROME_BIN` to its actual executable; return to step 1.
- `BROWSER_PORT_CONFLICT` / `BROWSER_OWNERSHIP_UNVERIFIED`: preserve existing browser processes/profile files, resolve the 9223 ownership conflict, then return to step 1.
- `BROWSER_START_TIMEOUT`: inspect the dedicated profile’s existing Chrome and startup permissions; preserve task IDs and return to step 1 after readiness is restored.
- `waiting`: the monitoring window or a connection ended; use `task resume TASK_ID --json`, then return to step 4. Remote runs continue independently.
- `uncertain` / `SUBMISSION_UNCERTAIN`: preserve the task; resume inspects the captured session for exactly one run. If identity cannot be resolved, report the uncertainty and request inspection. Never start another paid task as an automatic retry.
- `canvas_pending`: return any downloaded video as a partial result, then resume the same task for import/grouping. It does not resubmit generation.
- For an explicitly requested repair of canvas archival after a completed task, use `task sync TASK_ID --json`. It reapplies the existing video's import/grouping with the original reference nodes and never generates another video. Preserve intentional user deletions unless restoration is authorized.
- `UI_LOCATOR_CHANGED`, `AGENT_MODE_REQUIRED`, `REFERENCE_ORDER_CHANGED`: stop and report the adapter issue. If sending may have happened, preserve the task and inspect its history before further action.
- `CANVAS_UNSAVED`, `CANVAS_CHANGED`, `UI_BUSY`: ask the user to finish active work and save; resume the same task after the board is settled.
- `PROVIDER_FAILURE`: report the existing run's failure. Another video attempt is a new paid action.
- File conflicts or unmanaged Skill/state: preserve existing files and report the exact conflict.

Read [runtime reference](references/runtime.md) only when command details or recovery diagnostics are needed, then return to the relevant main-line step. Do not infer completion from chat prose alone.

## QA and evolution

Check one clean user message, captured native session/run IDs, attachment order at submission, exactly one result URL, returned reference metadata when provided, artifact bytes/hash and saved Frame membership. Report unavailable reference metadata or absent ffprobe verification honestly. Scope claims to actually tested hosts and operating systems. The current browser adapter needs live validation after webpage changes; independent clean-context regression is user gated.

Install/update only the executing/requested Agent through package-managed `skill install/update --agent AGENT_NAME --path RESOLVED_SKILL_DIR`. A named adapter supplies a default only for that host; other valid Agent names use the generic adapter and their own explicitly resolved Skill directory. The package is the source of truth. Automatic update detection is bounded and can be disabled; installation is explicit. Keep model defaults and private assets outside the package.
