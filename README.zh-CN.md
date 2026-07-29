# MemoryGraph

MemoryGraph 是一个本地优先的 Codex 插件，用来快速找回散落在项目会话和分支任务中的原始内容。它会按工作目录建立本地索引，返回带来源证据的回答，并通过交互式图谱展示任务结构和内容关系。

[English documentation](./README.md)

## 核心功能

- 跨项目任务检索原始用户问题和 AI 回答。
- 每条结果保留来源任务 ID 和 Turn ID。
- 将项目归属、明确分支、继续讨论与内容相似关系分开显示。
- 在不同标签页查看原始记录、候选记忆和技术日志。
- 支持 Markdown 渲染，并可打开来源任务查看上下文。
- 使用增量本地索引，不上传会话内容。
- 可生成带日期、时间和标题的独立 HTML 快照，避免文件覆盖。

## 环境要求

- 支持插件的 Codex。
- 终端中可以执行 `node`。
- 已配置 Codex 插件 Marketplace。

## 从 Marketplace 安装

Codex 通过 Marketplace 快照安装插件。如果尚未添加 Marketplace，执行：

```bash
codex plugin marketplace add /absolute/path/to/marketplace-root
codex plugin add memorygraph@<marketplace-name>
```

如果 Marketplace 托管在 Git 仓库：

```bash
codex plugin marketplace add https://github.com/<owner>/<marketplace-repository>
codex plugin add memorygraph@<marketplace-name>
```

以上命令既可以在普通终端中运行，也可以在 Codex 集成终端中运行。安装完成后新建一个 Codex 会话，以加载插件的 Skill 和 MCP 工具。

## 更新本地插件

修改插件源码后，更新缓存版本并重新安装：

```bash
python3 ~/.codex/skills/.system/plugin-creator/scripts/update_plugin_cachebuster.py \
  /absolute/path/to/memorygraph
codex plugin add memorygraph@<marketplace-name>
```

## 在 Codex 中使用

可以直接输入：

```text
Search this project's MemoryGraph for the discussion about webhook retries.
```

MemoryGraph 会优先展示经过来源验证的原始记录。当需要理解任务分支、继续讨论、共享历史或内容关联时，再切换到图谱视图。

## 隐私说明

原始会话保留在本地。生成的索引、检索结果和 HTML 快照可能包含完整问题、回答、本机路径、任务 ID 和 Turn ID，请勿将这些文件打包到公开插件中。插件自带的 `.gitignore` 已排除常见私有测试产物和密钥文件。

## 验证

```bash
node ./scripts/probe-mcp.mjs
node ./scripts/probe-memory-index.mjs
node ./scripts/probe-snapshot.mjs
node ./scripts/probe-product-state.mjs
python3 ~/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py .
```
