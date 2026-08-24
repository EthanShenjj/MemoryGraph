# MemoryGraph design QA

## Status

**Blocked — implementation capture unavailable**

The visual reference is a private local design asset and is not distributed with the plugin.

The implementation under review is:

- `assets/widget.html`

## Implemented target characteristics

- Evidence-archive three-column workspace: deep-indigo project index, cool grid canvas, and warm reading inspector.
- 64 px application header, 272 px project rail, flexible graph canvas, and a 432 px default inspector that can be resized from 320–720 px when viewport space permits.
- Search and graph controls use translucent floating surfaces; the selected view uses a single blue gradient accent.
- Larger 276 × 148 px task cards with a provenance-colored top edge and stronger selection state.
- Blue selected state, amber retrieval state, and neutral context state.
- Dedicated "Source records / Memory candidates" inspector switch with counts.
- Search-first ranked record view with a one-click switch back to the DAG.
- Visible match evidence, literal highlighting, and local correctness feedback.
- Candidate-memory confirmation/rejection controls and project-continuation actions.
- Reading-first inspector typography: 13 px source content, 12.5 px metadata, and a 24 px detail title.
- Mouse, pointer, and keyboard resizing for the desktop inspector; width persists locally and double-click restores the default.
- Real transparent MemoryGraph mark served as a local MCP image resource.
- 页面固定采用浅色背景；移动端保留相同的档案层级与阅读优先级。
- Existing search, graph layers, Markdown rendering, node drag, source-task opening, and context inspection preserved.

## Automated checks completed

- Inline widget JavaScript parses successfully.
- MCP protocol/resource probe passes, including the PNG mark resource.
- Local incremental memory-index probe passes.

## Blocking condition

The matching user-opened local preview tab was claimed, but the Codex in-app browser rejected reloading its `file://` URL under the browser safety policy. No alternate browser path or policy workaround was attempted.

## Visual checks still required

At the same viewport as the selected target:

- Compare overall column proportions and header height.
- Check task-card density, title wrapping, and edge-label collisions.
- Verify the generated mark crop at 28 × 28 px.
- Verify the selected-card outline and amber match state.
- Switch between "Source records" and "Memory candidates" and inspect count/empty states.
- Switch between "Results" and "Graph"; test result selection, highlighted evidence, and zero-result state.
- Exercise result feedback, candidate-memory review, and all four project-continuation actions.
- Drag at least one node and confirm all connected edges remain anchored.
- Drag the inspector divider to its minimum and maximum widths, verify text reflow, test arrow-key resizing, and double-click reset.
- Inspect narrow-width behavior at the 900 px and 650 px breakpoints.

## Final result

Blocked until the updated local example is opened in the Codex in-app browser and a screenshot-based comparison can be completed.
