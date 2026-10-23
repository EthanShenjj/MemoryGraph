# MemoryGraph UI and language QA

## Design

- Muse-inspired three-column workspace: white project index, pale graph/results surface, and a white reading inspector. The reference is Meta's [Muse design article](https://introducing.muse.ai/).
- Soft rounded controls and source cards, clear list-like suggestions, and restrained blue actions follow Muse's visual direction. Amber still marks retrieved evidence.
- The supplied blue MemoryGraph character is the product companion: a compact avatar in the header, a quiet presence beside result summaries, and the main visual on first-open language selection.
- Desktop uses a 64 px header, 272 px project rail, and a resizable 432 px inspector. On narrow screens, the inspector opens as a dismissible bottom sheet after a task or result is selected.
- Results display source title, record title, excerpt, and match score on separate lines. Graph controls are hidden in results mode.
- Controls use visible keyboard focus and reduced-motion preferences remain supported.

## Language flow

- `node scripts/install.mjs memorygraph@<marketplace-name>` asks for 中文 or English before running `codex plugin add`.
- The choice is saved only after installation succeeds and is passed through MCP graph data to both the embedded widget and standalone snapshots.
- The dashboard can switch language afterward, and the later choice survives a reload.
- Native `codex plugin add` does not run a plugin-defined language prompt. If no installation preference exists, the first dashboard opening requires a language choice.
- Interface controls, state labels, empty states, and accessibility labels are translated. Original task titles and conversation evidence retain their source language.

## Checks completed

- Installer probe covers successful installation and a failed install preserving the prior preference.
- MCP protocol probe confirms that the selected language reaches widget data.
- Snapshot probe confirms the logo and character art are embedded in standalone HTML.
- Local index probe and inline widget JavaScript syntax check pass.
- Browser checks covered the character at desktop and narrow sizes, the first-open chooser, Chinese and English dashboards, saved language after reload, installation preference precedence, later manual language switching, desktop and narrow results, and opening and closing the narrow detail sheet.
