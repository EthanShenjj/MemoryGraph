# MemoryGraph 场景需求与现有方案调研

调研日期：2026-10-23（Asia/Shanghai）。对象：当前仓库中的 MemoryGraph，依据 README 与插件技能说明界定产品范围；没有对插件或竞品做安装、性能测试。

## 结论

有用户在经历“记得 AI 说过，但找不到原始回答”的问题，也已经有人付出行动成本：搜索本地 JSONL、让 AI 扫描记录、导出 Markdown、保存交接文档、安装第三方工具。现有材料支持问题存在，不能据此估算发生率、市场规模或付费意愿。

**基础历史搜索已经有官方功能和多个开源方案。MemoryGraph 更值得验证的价值是：用模糊记忆找回具体原话，显示可核验来源，在复杂任务分支中解释结论的来路，并让用户纠正已过时的记忆。** 这些也存在直接竞争，不能当成独有能力。

证据支持强弱：历史内容检索最明确；减少手工记笔记、找回来源与控制错误记忆有支持；用户是否愿意专门使用任务关系图、是否愿意付费，仍未验证。

## 范围与证据限制

- 检索 X、Reddit、公开 Discord 索引，并用官方 GitHub issue、官方文档与竞品仓库交叉检查。
- Reddit 读取了原帖与评论，区分普通求助、第三方评论和作者推广；同一作者跨 subreddit 发帖不算多份独立需求证据。
- Discord 通过 Answer Overflow 的公开索引获取，没有访问私密服务器。部分页面实时打开仅返回主题，评论来自搜索索引，故不视为原始 Discord 消息的完整核验。
- X 直接搜索与原帖打开未成功，浏览器尝试出现超时；可用的是第三方转录或镜像。X 证据一律降级，不把镜像浏览量或聚合人数用于市场推断。
- 这是定向定性桌面研究，不是随机抽样。推广帖数量、GitHub star、用户自报数据都不等于活跃使用或付费规模。
- 页面日期存在缓存与相对时间差异。能获得明确日期时保留日期；否则使用月份或“检索时可见”，不强行推算。

## 用户到底在为什么困扰

### 1. 记得讨论内容，忘了标题、目录和会话 ID

2026 年 8 月的 r/ClaudeCode 求助帖描述：之前花约 20 分钟讨论方案，回来时面对 89 个会话，标题多为“fix this”一类首条消息；反复试开后，重开会话再解释约 10 分钟。评论者提供了 grep、会话 ID、检索 skill、交接 Markdown 等办法，也有人表示直接让 Claude 查日志即可。[原帖及评论](https://www.reddit.com/r/ClaudeCode/comments/1voffc7/have_you_ever_tried_to_find_an_old_claude_code/)

含义：检索线索通常是讨论主题、错误信息或方案约束。用户需要从内容定位到具体会话。帖中“没有搜索”等描述反映发帖时体验，不能直接当成今天的官方功能清单。

### 2. 想要原来那段回答，重生成的文字无法替代

r/ChatGPTPro 的讨论直接谈到：用户记得有价值的洞察和大致措辞，但找不到准确回答；分支和项目只能部分缓解。**主帖作者在评论中承认自己开发了相关产品，因此主帖属于利益相关证据。** 独立评论者也描述空结果，并分享“导出 ChatGPT 数据 → 用 Codex/Claude Code 找到消息与线程 ID → 回原会话”的实际办法。[讨论及披露](https://www.reddit.com/r/ChatGPTPro/comments/1toru2y/my_biggest_ai_problem_now_is_finding_the_thing_it/)

含义：原始文字、相邻上下文和可返回的出处，比重新总结更贴近这个场景。跨普通 ChatGPT/Claude 的需求是邻近市场，不能直接算作 Codex 插件用户需求。

### 3. 输出和决策散落，手工维护文档很难坚持

2026 年 10 月可检索到的 r/ClaudeAI 讨论提到：产物分散在旧聊天和多个文件夹，找不到时只能重做并再次消耗 tokens。评论中有集中写入 Markdown、维护索引、计划与交接文档、使用笔记应用等办法；也有人认为根本无需回看旧聊天。[原帖与评论](https://www.reddit.com/r/ClaudeAI/comments/1xb25tm/how_do_you_keep_track_of_your_work_with_claude/)

另一个跨会话追踪讨论强调手工记录容易停更，但作者后来披露自己也在开发相关产品，因此仅作为补充线索；它提示“自动提取的自述是否可信”是值得测试的问题。[利益相关讨论](https://www.reddit.com/r/ClaudeCode/comments/1v94yht/how_do_you_keep_track_of_what_you_actually_built/)

含义：应优先面向反复回访旧工作的人群。只做短任务、完成后不再查看历史的人，痛点可能很弱。

### 4. 旧指令和无关记忆被召回，反而干扰当前工作

Codex 的 session-recall 推广帖下，有评论者要求显示每条结果的日期和原始会话，并允许将错误结果标记为不再出现；原因是代码仓库变化后，旧指令仍在被召回。同帖也有用户直接质疑官方已经能搜历史，为什么还需要新工具。[推广帖中的支持与反对意见](https://www.reddit.com/r/codex/comments/1verd5i/i_built_an_opensource_memory_layer_for_codex_that/)

公开 Discord 的 The Shitty Coders Club 在 2026-09-30 的索引讨论中，用户推荐 vcc recall、pi session history、JSONL 关键词搜索，也有人说自己 fork 了工具来排除污染结果的记忆召回。评论来自公开搜索索引，实时主题页未完整返回评论。[Discord 公开索引](https://www.answeroverflow.com/m/1554987541554401281)

含义：召回更多内容并不一定更好。项目范围、来源标识、明确匹配与语义匹配的区分、拒绝和替代旧记忆，都可能影响信任；尚无量化效果证据。

### 5. 会话还在磁盘上，界面里却找不到

r/codex 的普通求助帖描述更新后聊天从列表消失，但文件仍在 .codex。评论建议通过 CLI 恢复会话并发送一条消息，让它重新出现在界面中；用户追问是否每条重要聊天都得这样处理。[用户求助与实际绕行方法](https://www.reddit.com/r/codex/comments/1u1xkho/all_chats_gone/)

X 的第三方聚合记录收录了 2026 年 10 月关于聊天缺失、回滚和跨设备显示不一致的用户反馈。不过没有成功直接读取 X 原帖，这部分仅作为低置信度的邻近问题信号。[X 反馈转录与来源入口](https://rantr.app/campaigns/codex-28/themes/chat-conversations-sometimes-disappear?lang=en)

含义：本地检索能帮助发现仍存在的记录。MemoryGraph 的索引与 HTML 快照不能被宣传为完整备份，也无法承诺恢复已经删除的源数据或修复官方同步。

## 三个平台分别能得出什么

| 平台 | 本轮找到的材料 | 可以支持的结论 | 不能支持的结论 |
| --- | --- | --- | --- |
| Reddit | 内容找回求助、手工办法、推广帖下的第三方反馈和反对意见 | 问题存在，有用户已经采取行动解决 | 用户普遍有痛点、推广作者数量代表需求规模 |
| Discord | Answer Overflow 中的 Pi/OpenClaw 社区讨论 | 相邻 agent 用户在用日志检索、记忆工具，并遇到召回污染 | Codex 官方 Discord 用户普遍需要本插件；私密服务器中的情况 |
| X | 第三方反馈转录、Recall 作者的索引镜像；直接页面访问未成功 | 存在相关线索，尤其是历史可见性问题 | 已完成 X 原帖逐条核验，或已证实 X 上的需求强度 |

X 另有 Recall 作者镜像提到检索旧会话、查看匹配片段和恢复工作。这是竞品作者陈述，且镜像正文未成功重取，故仅保留发现线索：[检索命中的作者镜像](https://c63706c8-c7b0-4ef4-8c3d-1b3ed59bea37.twstalker.com/zippoxer)。不将它计为独立用户验证。

## 必须考虑的官方进展

**Codex 已经实现基础能力。** openai/codex #16672 中，官方贡献者于 **2026-08-05** 确认实现了跨项目标题/内容搜索和结果跳转，并以 completed 关闭 issue。因此，不能继续用早期“只能搜标题”的帖子证明今天仍然完全没有正文检索。[官方 issue 与 8 月 5 日的实现确认](https://github.com/openai/codex/issues/16672)

剩余问题仍有近期线索：2026-09-19 的高级搜索请求要求日期、项目、来源、归档状态和完整历史覆盖；10 月评论继续要求对话式查找、可核验链接和项目过滤。它能证明用户仍在要求这些能力，不能证明每一项在所有版本都缺失。[近期需求与评论](https://github.com/openai/codex/issues/46586)

Claude Code 当前官方文档也有恢复、会话命名、内容预览、跨项目和分支过滤，以及分支会话管理。不能把早期恢复器的缺陷一概套用到当前版本。[官方会话文档](https://code.claude.com/docs/en/sessions)

## 用户现在如何解决

以下是文档级能力核对，没有实测质量。表中“仍需验证”不是断言竞品没有该能力。

| 方案 | 已公开的办法/能力 | 对 MemoryGraph 的影响 |
| --- | --- | --- |
| 原生搜索、resume、命名与预览 | Codex 已有跨项目内容搜索/跳转；Claude Code 有 picker、过滤和分支管理 | 使用成本最低，必须作为基线比较 |
| grep / rg / jq，或让 AI 读本地日志 | 搜索 JSONL 后按会话 ID 恢复；已有用户分享实际工作流 | 免费且灵活；MemoryGraph 需要减少操作、噪声和误定位 |
| Markdown、交接文档、决策日志 | 把有价值的输出和状态写到仓库或笔记中 | 用户可能更想维护任务产物；插件应证明能减少手工维护 |
| [Recall / zippoxer](https://github.com/zippoxer/recall) | TUI 全文检索、消息预览、复制会话 ID、一键恢复；有供 agent 调用的 CLI | “搜历史并继续”已有直接替代；无需 MCP 也可实现 |
| [sift](https://github.com/roccodaffuso/sift) | 多工具历史全文索引、稳定结果引用、上下文展开、增量刷新、离线和只读、agent skill | 本地、增量、原文引用等组合也已有竞争 |
| [Agent Sessions](https://github.com/jazzyalex/agent-sessions) | macOS 图形界面，多 agent 会话检索、读原文、恢复支持的会话，本地索引 | “有可视界面”不够；需要验证关系图是否提升找回效率 |
| [Session Recall / Davidyooo](https://github.com/Davidyooo/session-recall) | Codex 本地插件；模糊线索扩展、别名与语言变体、片段、置信度、匹配理由、重开会话 | 与 MemoryGraph 的插件形态和召回场景高度接近 |
| [Session Recall / AbsoluteMode](https://github.com/AbsoluteMode/session-recall) | Claude/Codex/Cursor 共享语义索引；session+turn 来源、原始上下文展开、项目和日期范围、默认本地 embedding | 连“语义检索 + 原文证据 + 本地 + MCP”也已有直接竞争；它与上一行是不同项目 |
| [claude-mem](https://github.com/thedotmack/claude-mem/blob/main/docs/public/architecture/database.mdx) | observations、摘要和用户 prompts 的检索，保留与 transcript 层的关系 | 长期记忆层也是替代选择；不能简单宣称这类产品只有摘要、没有来源 |

### 行为证据与商业证据分开看

Recall 发布帖有非作者评论表示长期难以找到 Claude/Codex 会话，并要求能复制会话 ID。[评论](https://www.reddit.com/r/codex/comments/1p8ktxe/i_built_a_tui_to_fulltext_search_my_codex/)

Claude Code Assist 作者自报约 2,000 人使用、收入约 200 美元，但这是作者自述，未经独立审计，也不能推导 MemoryGraph 的付费能力。[作者自报](https://www.reddit.com/r/ClaudeCode/comments/1ppyvoq/made_a_vs_code_extension_to_search_through_my/)

## 对 MemoryGraph 的建议

以下为调研后的产品判断，不是用户直接验证的结论。

1. **用结果表达价值。** 建议首先验证：“记得聊过什么，就能找回当时的原始回答、出处和上下文，并接着工作。” 对外宣传应避免把图谱本身作为首要收益。
2. **首先服务长期项目的重度用户。** 筛选经常回访旧规划、调试记录、失败尝试，且已经用日志或笔记找回内容的人。会话数量只是筛选线索，不是需求证明。
3. **把核验与失效处理做成完整闭环。** 展示原文、日期、任务/Turn 来源；分清“当时讨论过”“用户确认过”和“现在仍适用”；允许纠正、拒绝、替代。后者与代码现状的核对仍需额外能力。
4. **单独验证关系图。** 测试同一结论出现在多个分支时，图能否帮助找到最早出处、理解分歧和识别后来更改。用户现有证据支持“迷失”，尚未证明他们需要节点连线界面。
5. **将跨工具作为待验证扩展。** 竞品和用户工作流都跨多个 agent。当前 Codex 聚焦可以降低实现复杂度，但需验证目标用户的关键历史是否大量留在其他工具中。
6. **不要承诺全量恢复。** 本地未落盘、已清理或格式不支持的记录应明确显示缺口；单独说明历史检索、导出快照与备份的边界。

### 下一步最有用的验证

招募 5–8 名符合上述行为特征的用户，每人带来 3 个最近真实发生的“找原话/找决策”案例。用原生功能、其当前办法、MemoryGraph 完成相同类型任务，并平衡测试顺序，减少第二次已经记住答案的影响。

记录：是否找到正确原文、耗时、打开多少候选、来源是否对得上、能否识别过时结论、图谱是否实际帮助。先验证检索和继续工作的价值，再单独测试图谱；付费意愿需另做行为验证。

优先案例：模糊记得当时否决方案的理由；原回答被多个分支复制；某个旧指令已被替代；本地记录存在但原生界面难以找到。若原生功能或简单工具已经同样快速可靠地完成，MemoryGraph 就需要收窄定位或找到更强的任务。
