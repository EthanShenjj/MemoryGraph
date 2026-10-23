# MemoryGraph

MemoryGraph is a local-first Codex plugin for finding exact answers across project conversations
and branches. It returns source-backed records first, then uses an interactive graph to explain
task relationships.

[Chinese README](./README.zh-CN.md)

## Features

- Search original prompts and answers in an explicitly selected project, including supported active and archived tasks. The default scope is the exact project directory.
- Verify every result with its task ID and Turn ID.
- Separate task forks and continuations from content similarity.
- Render Markdown and open the source task for context.
- Choose Chinese or English in the interactive installer. The dashboard uses that choice and remembers later changes made with its language button.
- Build an incremental local index without uploading conversations.
- Review extracted memory candidates before confirming them.

## Version 0.3

Press Enter in the dashboard or click **Search history** to query the selected project's full supported index. Project directory, date range, archive scope, excluded results, and pagination are explicit. **Filter this page only** is a separate mode.

Long answers remain searchable in full. Preview length is shown; **Verify and expand original** rereads the source and checks its complete hash. Copying an answer loads the entire original first. Missing or changed sources fail visibly. Original text is preserved separately from search normalization.

Feedback affects ranking before the page is selected. Incorrect results are excluded only for the same project/query and can be restored. Memory corrections, replacements, revisions, and reasons are persisted; stale reviews fail instead of overwriting another window. A save is reported successful only after plugin acknowledgement.

Continuing opens a material preview first, with optional neighboring turns. Full answers are not silently truncated. Neighboring context exceeding the payload limit is marked. Historical decisions still require checking against the current project.

### Coverage and limitations

- Reads JSONL in `~/.codex/sessions` and `~/.codex/archived_sessions`; override with `CODEX_SESSIONS_DIR` and `CODEX_ARCHIVED_SESSIONS_DIR`.
- Compressed files such as `.jsonl.zst` are currently reported as unsupported, not decoded. Read and parse failures produce partial-coverage warnings.
- One exact project at a time. Selected Chinese/English lexical aliases are supported; vector semantic search, multi-project unions, and other agent formats await evaluation.
- The disposable index rebuilds after a format upgrade. Reviews and feedback have separate storage. Snapshots are static exports, not full backups.
- Tool searches save HTML snapshots by default. Interactive dashboard searches and pagination do not create additional exports. Static exports cannot search or save without a plugin connection.

### Verification

Run the `scripts/probe-*.mjs` Node probes (except `probe-widget.mjs`, which also needs an installed Playwright available through `NODE_PATH`). The widget probe drives the real MCP server with isolated synthetic sessions, including failed saves and reloading reviews.

`node scripts/evaluate-retrieval.mjs --synthetic [report.json]` runs 48 labelled synthetic cases. For real evaluation pass a local JSON array instead: each case requires `id`, `cwd`, `query`, and human-labelled `expectedTurnIds`; optional date/archive filters are accepted. Reports omit source text. Synthetic results do not establish real-user accuracy or an advantage over native search.

## Install in a terminal

Add the marketplace once. From this plugin's source directory, run the interactive installer; it asks for the dashboard language before installing:

```bash
codex plugin marketplace add /absolute/path/to/marketplace-root
node scripts/install.mjs memorygraph@<marketplace-name>
```

## Install in the Codex integrated terminal

If the marketplace is already configured, run from this plugin's source directory:

```bash
node scripts/install.mjs memorygraph@<marketplace-name>
```

Start a new Codex thread after installation so the plugin tools are loaded.
For a noninteractive install, pass `--language zh-CN` or `--language en`. A direct `codex plugin add` install cannot show a plugin-defined prompt, so MemoryGraph asks on the first dashboard opening instead. Source task titles and original conversation records stay in their original language so their evidence remains verifiable.
