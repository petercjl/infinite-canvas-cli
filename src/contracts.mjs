import {META} from './core.mjs';
import {installationContract} from './lifecycle.mjs';
const s={type:'string'},b={type:'boolean'};
export const commandContracts={
  'install':{options:{'--agent':{...s,required:true},'--path':s,'--json':b},sideEffects:'local-write',output:'Verified CLI and current Agent companion Skill; complete=true only when both are ready'},
  'video generate':{options:{'--canvas':s,'--prompt':s,'--prompt-file':s,'--reference':{...s,repeatable:true},'--output':s,'--request-id':s,'--new':b,'--submit':b,'--dry-run':b,'--json':b},sideEffects:'local-write',externalMutation:'With --submit: import references, send native Agent conversation, import a missing video, group selected elements in a Frame.',paid:'Only native webpage sending may charge credits.'},
  'task get|wait|resume|sync':{options:{'--timeout':s,'--json':b},sideEffects:'local-write',externalMutation:'resume continues original task; sync reapplies existing video archival and grouping; never a second generation.'},
  'frame group':{options:{'--canvas':s,'--elements':s,'--frame-id':s,'--name':s,'--submit':b,'--json':b},sideEffects:'local-write',externalMutation:'With --submit: reparent existing nodes and preserve their identities.'},
  'browser status':{options:{'--json':b},sideEffects:'none',output:'Chrome availability and separate CDP runtime readiness'},
  'browser open':{options:{'--json':b},sideEffects:'local-write',externalMutation:'Launch or reuse system Chrome on loopback 9223 with the current-user dedicated profile; no generation.'},
  'doctor':{options:{'--canvas':s,'--live':b,'--json':b},sideEffects:'none'},
  'skill source':{options:{'--json':b},sideEffects:'none'},
  'skill status|install|update':{options:{'--agent':s,'--path':s,'--json':b},sideEffects:'local-write'},
  'update check|install':{options:{'--yes':b,'--agent':s,'--path':s,'--json':b},sideEffects:'package-and-skill-update'},
  'update auto':{options:{'--json':b},sideEffects:'local-write'}
};
export const manifest={schema:'infinite-canvas-capabilities',schema_version:'1.0.0',package:META.name,version:META.version,
  installationLifecycle:{...installationContract,skillRequired:true,updateRequiresSkillSync:true,unresolvedTarget:'SKILL_TARGET_REQUIRED; no implicit cross-Agent installation'},
  input:{required:['canvas_id','prompt','references'],references:'ordered PNG/JPEG/WebP local files or HTTPS URLs'},
  output:{terminal:'local MP4 + saved Frame containing original reference nodes and one video node',fields:['task_id','status','canvas_id','session_id','run_id','frame_id','reference_element_ids','video_element_id','artifacts']},
  operations:['browser.status','browser.open','board.inspect','video.generate.native-agent','task.inspect','task.wait','task.resume','task.sync','frame.group-existing'],
  generationTransport:{kind:'native-browser-ui',newConversationPerLogicalVideo:true,singleTabPerCanvas:true,concurrency:'separate conversations in the same tab; queued UI submissions and canvas writes; parallel remote runs',submission:'click native Send',directGenerationAPI:false,mediaHelperScope:['canvas.get','canvas.add','image.upload'],requestedVideoParameters:'Convey task requirements in the prepared native Agent prompt; explicit final prompts stay unchanged; verify actual artifact metadata.',recovery:'saved sessionId/runId; read-only run and history APIs',model:'inherit webpage settings'},
  dependencies:{node:'>=22',browser:'Installed Google Chrome; built-in macOS/Windows discovery and startup on loopback 9223 with current-user dedicated profile',canvasAPI:'sealseek-media >=0.6.7, public CLI commands',libraries:['playwright-core','image-size'],optional:['ffprobe']},
  platforms:{'codex:macos':'tested: six native Agent video tasks across two boards; one tab per board; downloads, deduplication and Frame readback verified','generic:macos':'spec-compatible, runtime untested','sealseek:macos':'spec-compatible, runtime untested','generic:windows':'built-in Chrome discovery/startup implemented; actual host video end-to-end verification pending'},
  commandContracts,
  automaticUpdates:{enabledByDefault:true,defaultMode:'notify',intervalHours:24,timeoutMs:1500,trigger:'ordinary video/frame/doctor/capabilities entry; excludes help/version/skill/task polling',configuration:'private update-policy.json; update auto on|off|status',disable:'INFINITE_CANVAS_AUTO_UPDATE=0',recovery:'offline backoff preserves installation; source checkout updates through Git; explicit install keeps a package backup',installation:'explicit --yes only; no automatic installation'},
  limitations:['No service-side atomic canvas revision check; stop on detected user edits.','Frame grouping first version supports unrotated image/video nodes.','Do not submit another generation after unknown submission.']
};
export const HELP=`infinite-canvas ${META.version}

video generate --canvas ID (--prompt TEXT | --prompt-file FILE)
  --reference IMAGE ... [--output DIR] [--request-id KEY | --new]
  [--dry-run | --submit] --json
  Default: validate only. --submit starts one background native Agent task.
  Each logical video uses a fresh conversation. The prompt is sent unchanged.
  Final output: MP4 and a Frame containing the input nodes and resulting video.

task get TASK_ID --json
task wait TASK_ID [--timeout 30] --json       (1–60 seconds per wait)
task resume TASK_ID --json                  (same session/run, no resubmission)
task sync TASK_ID --json                    (reapply existing output to canvas, no generation)
frame group --canvas ID --elements IDS.json --frame-id ID [--name TEXT]
  [--submit] --json                         (preview by default)
browser status --json                       (read-only installation and runtime state)
browser open --json                         (built-in system Chrome startup/reuse)
board inspect --canvas ID --json
doctor [--live --canvas ID] --json
capabilities --json
version [--json]
install --agent AGENT_NAME --path SKILL_DIRECTORY --json
skill source --json
skill status|install|update [--agent codex|generic|AGENT_NAME] [--path DIR] --json
update check --json
update install --yes --agent AGENT_NAME [--path DIR] --json
update auto on|off|status --json

Runtime: Node >=22; installed Google Chrome on macOS/Windows; sealseek-media.
Chrome startup is bundled. doctor checks availability; doctor --live verifies a running editable board.
Configuration: INFINITE_CANVAS_STATE_DIR, INFINITE_CANVAS_CHROME_BIN,
INFINITE_CANVAS_BROWSER_BIN (optional legacy launcher override),
INFINITE_CANVAS_MEDIA_BIN. Credentials remain with their existing providers.
Package update detection is throttled and can be disabled using
INFINITE_CANVAS_AUTO_UPDATE=0. No generation is submitted by installation.
`;
