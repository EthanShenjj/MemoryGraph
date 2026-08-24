# MemoryGraph

MemoryGraph 是一个本地优先的 Codex 会话检索插件，用于找回散落在项目任务和分支中的原始回答。它会优先展示带来源证据的记录，再通过交互式图谱解释任务关系。

[English documentation](./README.md)

## 核心功能

- 跨项目任务检索原始问题和回答。
- 使用任务 ID 和 Turn ID 验证每条结果。
- 将任务分支、继续讨论与内容相似关系分开显示。
- 支持 Markdown 渲染，并可打开来源任务查看上下文。
- 界面默认使用简体中文，支持一键切换为英文，并在本机记住语言偏好。
- 增量建立本地索引，不上传会话内容。
- 候选记忆需要经过用户确认后才能保留。

## 在终端安装

首次安装时先添加 Marketplace，再安装插件：

```bash
codex plugin marketplace add /absolute/path/to/marketplace-root
codex plugin add memorygraph@<marketplace-name>
```

## 在 Codex 集成终端安装

如果已经添加过 Marketplace，只需执行：

```bash
codex plugin add memorygraph@<marketplace-name>
```

安装完成后新建一个 Codex 会话，以加载插件工具。
