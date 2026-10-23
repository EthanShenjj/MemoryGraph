# MemoryGraph

MemoryGraph 是一个本地优先的 Codex 会话检索插件，用于找回散落在项目任务和分支中的原始回答。它会优先展示带来源证据的记录，再通过交互式图谱解释任务关系。

[English documentation](./README.md)

## 核心功能

- 在明确选择的项目目录内，检索活跃与归档任务的原始问题和回答。可以切换目录，默认不会跨项目混入结果。
- 使用任务 ID 和 Turn ID 验证每条结果。
- 将任务分支、继续讨论与内容相似关系分开显示。
- 支持 Markdown 渲染，并可打开来源任务查看上下文。
- 交互式安装时选择中文或 English；Dashboard 会使用该语言，也可随时通过右上角按钮切换。
- 增量建立本地索引，不上传会话内容。
- 审核记忆候选，保存纠正、替代关系和审核历史；已替代或拒绝的记忆不会默认带入继续请求。

## 0.3：找回、核验、继续

在面板输入关键词后按 Enter，或点击“搜索历史”，会查询所选目录的完整已支持索引。项目目录、起止日期、归档范围与被排除结果可以显式设置；“仅筛选本页结果”是独立选项。结果支持分页。

索引保留全文，长回答的面板预览会标明已加载长度。点击“核验并展开原文”可重新读取来源文件、校验内容哈希并加载下一块；复制原始回答会先读取完整原文。来源不可用或内容变化时会提示重新搜索。原始文字与用于匹配的规范化文本分开保存。

“不正确”只排除当前项目、当前查询的这条结果，可显示后撤销。保存收到插件确认后才显示成功；静态 HTML 没有插件连接时不能保存审核或查询完整索引。记忆纠正与替代保留版本和理由，另一个窗口修改后需要刷新再保存。

“基于此记录继续”先打开材料预览，可加入相邻问答，再决定发送或复制。长原文不会静默截断；相邻问答达到载荷上限时会明确标注。历史结论和已确认记忆仍需核对当前适用性。

检索支持部分中英文词法别名（如退信/bounce），不包含向量语义模型。界面区分字面匹配、词法相关和上下文；排序分数不表示答案正确概率。

### 覆盖与限制

- 默认扫描 `~/.codex/sessions` 和 `~/.codex/archived_sessions` 中的 JSONL。`CODEX_SESSIONS_DIR` 与 `CODEX_ARCHIVED_SESSIONS_DIR` 可覆盖位置。
- 压缩的 `.jsonl.zst` 等文件目前不解码，会计入“不支持”并提示覆盖不完整；解析错误和读取失败同样可见。没有结果不等于历史中不存在。
- 每次选择一个精确项目目录；多项目联合搜索、跨工具接入和本地向量模型仍待后续评测。
- 索引格式升级后自动重建，审核与反馈独立保留。源文件仍是权威来源；索引和快照不替代完整备份。
- 搜索工具默认保留 HTML 快照；面板内分页和反复查询不自动新增快照。快照展示导出时状态。

### 开发验证

```bash
node scripts/probe-memory-index.mjs
node scripts/probe-product-state.mjs
node scripts/probe-retrieval.mjs
node scripts/probe-mcp.mjs
node scripts/probe-snapshot.mjs
node scripts/probe-install.mjs
node scripts/evaluate-retrieval.mjs --synthetic
```

面板与真实 MCP 进程的隔离联测使用已安装的 Playwright：将其所在 `node_modules` 加入 `NODE_PATH`，然后运行 `node scripts/probe-widget.mjs`。所有用例使用临时合成会话，不读取真实聊天。

真实召回评测可运行 `node scripts/evaluate-retrieval.mjs cases.json report.json`。输入是数组，每项包含 `id`、`cwd`、`query`、人工标注的 `expectedTurnIds`，可带 `after`、`before` 和 `includeArchived`。评测报告不输出原始问题和回答。合成评测不能替代真实用户验证。

## 在终端安装

首次安装时先添加 Marketplace。然后在本插件源码目录运行交互式安装命令，安装前会询问 Dashboard 语言：

```bash
codex plugin marketplace add /absolute/path/to/marketplace-root
node scripts/install.mjs memorygraph@<marketplace-name>
```

## 在 Codex 集成终端安装

如果已经添加过 Marketplace，在本插件源码目录执行：

```bash
node scripts/install.mjs memorygraph@<marketplace-name>
```

安装完成后新建一个 Codex 会话，以加载插件工具。
无交互终端可附加 `--language zh-CN` 或 `--language en`。直接运行原生 `codex plugin add` 时，Codex 不提供插件自定义的安装提示，因此 MemoryGraph 会在首次打开 Dashboard 时询问语言。来源任务标题与原始对话记录保留原文，方便核验来源。
