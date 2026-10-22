# Implementation decisions

- U: Input is board ID, exact video prompt and ordered references. Return the MP4 and group the existing reference/video nodes in a Frame.
- U: Native Agent conversation is the generation surface; each video uses a fresh conversation. Existing canvas APIs remain reusable.
- E: Browser exploration established native controls, one-message submission metadata, session/run status and history result shapes. Packaged live end-to-end validation remains separate.
- W: Capability operations own integration, recovery, idempotency and verifiable output. Applications own creative decisions and acceptance. Runtime guidance directly internalizes the small mechanical execution method; it has no external knowledge-base dependency.
- A: Default layout is a horizontal row, media width at most 320 and height at most 600, padding 32 and gap 24. This is a configurable future capability boundary, not a creative requirement.

Target: shareable npm package and canonical portable Skill, Codex/macOS first. Generic adapter and Windows packaging checks do not establish Windows live browser support. Source is local and unpublished. Publishing workflow is intentionally outside this implementation request.
