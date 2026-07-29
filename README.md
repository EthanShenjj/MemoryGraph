# MemoryGraph

MemoryGraph is a local-first Codex plugin for finding exact information across project
conversations. It indexes tasks for one working directory, retrieves source-backed answers, and
shows task structure and content relationships on an interactive graph.

[Chinese documentation](./README.zh-CN.md)

## Core features

- Search original user prompts and assistant answers across project tasks.
- Keep every result linked to its source task ID and Turn ID.
- Separate task membership, forks, and continuations from content similarity.
- Review source records, memory candidates, and technical logs in separate tabs.
- Render source answers as Markdown and open the source task for surrounding context.
- Incrementally refresh a local index without uploading conversation data.
- Save optional standalone HTML snapshots with collision-safe filenames.

## Requirements

- Codex with plugin support.
- Node.js available as `node`.
- A configured Codex plugin marketplace.

## Install from a marketplace

Codex installs plugins from configured marketplace snapshots. If the marketplace has not been
added yet, run:

```bash
codex plugin marketplace add /absolute/path/to/marketplace-root
codex plugin add memorygraph@<marketplace-name>
```

For a Git-hosted marketplace:

```bash
codex plugin marketplace add https://github.com/<owner>/<marketplace-repository>
codex plugin add memorygraph@<marketplace-name>
```

You can run the same commands in a regular terminal or the Codex integrated terminal. Start a new
Codex thread after installation so the plugin skills and MCP tools are loaded.

## Update an existing installation

After updating the local plugin source, refresh its cachebuster and reinstall it:

```bash
python3 ~/.codex/skills/.system/plugin-creator/scripts/update_plugin_cachebuster.py \
  /absolute/path/to/memorygraph
codex plugin add memorygraph@<marketplace-name>
```

## Use in Codex

Ask naturally:

```text
Search this project's MemoryGraph for the discussion about webhook retries.
```

MemoryGraph will return ranked source records first. Open the graph when you need to understand
task branches, continuations, shared history, or content relationships.

## Privacy

Source conversations remain local. Generated indexes, results, and HTML snapshots can contain full
prompts, answers, local paths, task IDs, and Turn IDs. Never include those artifacts in a public
plugin package. The included `.gitignore` excludes common private test outputs and secret files.

## Verify

```bash
node ./scripts/probe-mcp.mjs
node ./scripts/probe-memory-index.mjs
node ./scripts/probe-snapshot.mjs
node ./scripts/probe-product-state.mjs
python3 ~/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py .
```
