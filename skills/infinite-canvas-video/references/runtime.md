# Runtime command reference

These commands are for the executing Agent and developers.

Browser invariant: one board file, one tab. Reuse the existing tab for that canvas ID. Concurrent tasks use distinct native conversations and captured session/run IDs within that tab. `BOARD_SELECTION_REQUIRED` means resolve duplicate tabs before continuing; preserve the existing tasks. UI submission and canvas writes are queued per board, while remote runs can progress concurrently.

```sh
infinite-canvas version --json
infinite-canvas capabilities --json
infinite-canvas doctor --json
infinite-canvas browser status --json
infinite-canvas browser open --json
infinite-canvas skill source --json
infinite-canvas skill status --agent AGENT_NAME --path RESOLVED_SKILL_DIR --json
infinite-canvas skill install --agent AGENT_NAME --path RESOLVED_SKILL_DIR --json
infinite-canvas skill update --agent AGENT_NAME --path RESOLVED_SKILL_DIR --json
infinite-canvas video generate --canvas BOARD_ID --prompt-file PROMPT_FILE --reference IMAGE_1 --reference IMAGE_2 --dry-run --json
infinite-canvas video generate --canvas BOARD_ID --prompt-file PROMPT_FILE --reference IMAGE_1 --reference IMAGE_2 --submit --json
infinite-canvas task get TASK_ID --json
infinite-canvas task wait TASK_ID --timeout 30 --json
infinite-canvas task resume TASK_ID --json
infinite-canvas task sync TASK_ID --json
infinite-canvas update auto off --json
```

`--output` is an output directory; the MP4 filename is the unique task ID. Existing different bytes are preserved. HTTPS reference downloads are bounded to 30 MiB, local images are validated, and redirecting media URLs are rejected. An interrupted task is resumed with its original inputs and captured run.

`board inspect --canvas ID --json` reads the board. `frame group --canvas ID --elements ELEMENT_IDS_JSON --frame-id FRAME_ID --json` previews grouping; `--submit` saves it. Only the selected existing unrotated image/video nodes are moved into the actual Frame. Layout uses a horizontal row with bounded media dimensions. Existing unrelated elements are preserved; conflicting Frame membership stops the operation.

State resides under the user's application-data directory (`INFINITE_CANVAS_STATE_DIR` can select another private location). It contains task state, reference copies, readback backups, download metadata and worker logs. Preserve it for recovery; treat media URLs and prompts as private. `INFINITE_CANVAS_AUTO_UPDATE=0` disables automatic registry detection. Explicit update installation requires `update install --yes`, refuses source checkouts and backs up the installed package. Unpublished development versions have no registry update available.

The CLI never prints browser credentials. Changing source, a live webpage deployment or a helper CLI version may require revalidation. JSON failures include `error.code` and `error.message`; keep the original task ID in user-facing recovery advice.

## Built-in Chrome runtime

Only Google Chrome is an external browser prerequisite. macOS discovery checks system and current-user Applications; Windows checks per-user and Program Files locations, then App Paths registry entries. `INFINITE_CANVAS_CHROME_BIN` selects an actual executable for a custom installation. No extra launcher is required. `INFINITE_CANVAS_BROWSER_BIN` remains an explicit legacy override and is verified against the same port/profile contract.

`browser status` is read-only. `chrome.installed` and `available` describe installation; `running` and `ready` describe the dedicated instance. A stopped but installed Chrome passes the browser dependency check in `doctor`. `browser open` and normal video execution launch/reuse it, verify process ownership, loopback CDP 9223 and the current-user profile. On Windows this profile is under the current home directory; on macOS it is under the current home directory with the same `.dianshang-chrome-profile` name. Windows uses built-in PowerShell process/TCP queries; macOS uses bounded nonblocking system process queries. Startup is queued so concurrent jobs share the browser. `doctor --live --canvas ID` requires the running, authenticated, editable board as well.
