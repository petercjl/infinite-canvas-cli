# Infinite Canvas CLI

`@petercjl/infinite-canvas-cli` uses an existing SealSeek Infinite Canvas board to generate videos through its native Agent conversation. It imports ordered reference images, sends the supplied prompt in a fresh conversation, downloads the video, and groups the original image nodes and video node in a Frame.

This package requires Node.js 22+, installed Google Chrome on macOS or Windows and an installed `sealseek-media` CLI supporting image upload and canvas get/add. The package discovers and launches Chrome itself on loopback port 9223 with a persistent current-user dedicated profile. Browser login is completed in that window. The website supplies the selected model and authenticated account. Each authorized generation can incur charges.

Each board file uses exactly one browser tab. Concurrent videos run in separate Agent conversations within that tab; UI submissions and canvas writes are queued while remote generation runs in parallel. Duplicate tabs must be resolved before submission or saving.

`doctor` distinguishes Chrome installation from runtime state. An installed executable passes the browser dependency check while Chrome is stopped. `browser open` launches or reuses the dedicated instance; video execution prepares it automatically. A port/profile conflict is reported explicitly. Chrome outside the standard paths can be selected with `INFINITE_CANVAS_CHROME_BIN`.

## Installation lifecycle

Installing or updating this plugin means preparing both the CLI and its companion Skill for the current Agent. A successful npm command alone is a partial installation. The executing Agent resolves its own Skill directory, reads `infinite-canvas skill source --json`, and completes `infinite-canvas install --agent AGENT_NAME --path SKILL_DIRECTORY --json`. Verify the CLI version and a receipt with `complete=true`, `skill.installed=true` and `skill.current=true`, then load the installed Skill (refresh the Agent session when required). npm installation prints this handoff; if lifecycle scripts are disabled, follow this same flow explicitly. Unknown destinations require resolution before completion; no other Agent directory is changed.

For updates use `infinite-canvas update install --yes --agent AGENT_NAME --path SKILL_DIRECTORY --json`; this synchronizes the selected Skill even if the npm version is unchanged, and refuses missing or edited/unmanaged targets before package replacement. Direct npm upgrades must be followed by the same `install` verification step.

## Agent usage

Provide the board ID, prompt and reference image attachments in their intended order. Send the Agent:

> 使用 infinite-canvas，画板 ID 为「画板ID」，按所附图片顺序作为图1、图2，生成视频：「完整提示词」。

To install:

> 安装 @petercjl/infinite-canvas-cli 及其配套 Skill。

To update:

> 更新 @petercjl/infinite-canvas-cli 及其配套 Skill。

To recover:

> 使用 infinite-canvas，恢复任务「任务ID」。

To synchronize the current Agent’s Skill:

> 将 infinite-canvas 当前安装包的配套 Skill 同步到当前 Agent。

Codex/macOS has completed six live video tasks across two boards. Other Agent adapters require runtime verification.

## Developer entry points

```sh
npm install
npm test
node bin/infinite-canvas.mjs --help
node bin/infinite-canvas.mjs doctor --json
```

See the bundled [Skill](skills/infinite-canvas-video/SKILL.md) and [runtime commands](skills/infinite-canvas-video/references/runtime.md). `capabilities --json` exposes machine-readable contracts. Video generation defaults to dry run; `--submit` starts a background job and returns its task ID. Resume never clicks Send again after a submission intent has been recorded.

Canvas operations reuse the existing helper CLI. Frame grouping provides the missing atomic operation for reparenting existing nodes, with backup, fresh-read conflict checks and save/readback verification. Website-authenticated read and canvas operations are isolated in one browser adapter. The adapter does not directly submit generation endpoints.

The service has no documented compare-and-swap canvas save contract. Avoid concurrent manual editing during a job; detected unsaved or conflicting changes stop progress for recovery. Canvas synchronization relies on the current webpage editor adapter and must be revalidated when the webpage changes.

Video verification uses the npm-managed platform ffprobe, checked before video submission and exposed by `doctor --json`. Install with optional dependencies enabled. Advanced hosts can configure `INFINITE_CANVAS_FFPROBE_BIN`; see THIRD_PARTY_NOTICES.md for supported binaries and licensing. Existing generated tasks resume verification after dependency repair without another paid submission.
