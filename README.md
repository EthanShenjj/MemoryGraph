# MemoryGraph

MemoryGraph is a local-first Codex plugin for finding exact answers across project conversations
and branches. It returns source-backed records first, then uses an interactive graph to explain
task relationships.

[Chinese README](./README.zh-CN.md)

## Features

- Search original prompts and answers across project tasks.
- Verify every result with its task ID and Turn ID.
- Separate task forks and continuations from content similarity.
- Render Markdown and open the source task for context.
- Build an incremental local index without uploading conversations.
- Review extracted memory candidates before confirming them.

## Install in a terminal

Add the marketplace once, then install the plugin:

```bash
codex plugin marketplace add /absolute/path/to/marketplace-root
codex plugin add memorygraph@<marketplace-name>
```

## Install in the Codex integrated terminal

If the marketplace is already configured, run:

```bash
codex plugin add memorygraph@<marketplace-name>
```

Start a new Codex thread after installation so the plugin tools are loaded.
