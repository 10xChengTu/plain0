# F090 Git history and blame tools

日期：2026-07-26

## 目标与边界

`F090` 四条 acceptance：inline/文件 blame、hover 与 age heatmap 可用；文件与行历史、版本导航与 compare 可用；graph、refs、stash、worktree 工作流通过 fixture；不含 GitLens Plus、账号、云、品牌或 AI 代码。本 feature 建在 `F080`（`docs/research/2026-07-25-core-git.md`，已完成 S0-S4）之上，完全复用其边界：`GitExecMode`（`BackgroundRead`/`Write`/`Network`）三态硬化模型、`repo::resolve_repo_toplevel`（先 `TrustService::require_trusted` 后 `discovery::discover_repository`）、`GitPathBuf` 字节路径建模、每能力写死参数常量 + AST 契约锁定、破坏性写操作确认门（`plain-scm-discard.ts`/`plain-scm-network.ts` 先例）。ADR 0003 原文即把 blame/history/compare/graph 与 refs/stash/worktree 并列为"独立实现的本地增强"，本文档是这部分的技术方案。

F090 与 F080 的关键差异：F080 五条 acceptance 全部与"当前工作区状态"相关（status/diff/stage/commit/网络），F090 全部与"历史"相关——**只读浏览**（blame/history/graph/compare/refs）与**对历史/暂存的写操作**（stash 的增删改、worktree 的增删）混杂在一起，因此第一个决定性设计问题是把这两类严格分离到不同的 `GitExecMode` 与确认门规则下（决策 1/2）。

## 调研结论

### GitLens 许可证审计（决定性，已用真实 LICENSE/README 核实）

`gitkraken/vscode-gitlens` 采用双许可结构：仓库根 `LICENSE`（MIT）声明"除任何名为 `plus` 的目录外的所有文件"适用 MIT；每个 `plus` 目录下的文件单独适用 `LICENSE.plus`（专有条款，仓库内单独文件，未在本次调研中逐字获取全文，但其存在性与适用范围已通过 GitHub 仓库结构确认）。GitKraken 官方文档进一步确认：**Commit Graph、Launchpad、Worktrees、Visual File History 均标记为 `Pro`/`GitLens+` 功能**（对私有仓库需要账号登录才能使用，公共/本地仓库上可能有限免费），Cloud Patches/Code Suggest/Cloud Workspaces/AI 生成 commit-PR 属于 `Preview`（即将并入 Pro）。

这对 F090 的直接含义：

1. F090 要做的 **graph、worktree、（跨版本的）file history 三项能力，在 GitLens 里恰好全部是 `plus` 目录下的专有代码**，而不只是"AI/账号"部分。这印证了 `AGENTS.md` 第 7 条与 F090 acceptance 第 4 条的必要性——即使我们独立实现的是"同名功能"，也必须是全新代码，绝不能以"反正是免费用的功能"为由去看 GitLens 的 `plus` 源码。
2. GitLens 免费部分（inline blame、CodeLens、file annotations、revision navigation、side bar 的 branches/remotes/stashes/tags）虽然是 MIT，但 `AGENTS.md` 的纪律是"绝不移植 GitLens 代码"，不因许可证宽松而放宽——本文档后续的"参考"一律指**交互设计**（这些功能长什么样、怎么触发），从未读取或引用 GitLens 任何一行源码；命令与格式的技术依据全部来自 git 自身文档与本机实测，或 VS Code 自身 MIT 代码（见下一节，二者是不同的许可证与不同的项目，MIT 的 Code OSS 不受"绝不移植 GitLens"这条限制约束，但本文档仍只把它当**技术参考**而非直接消费其模块，与 F080 一贯做法一致）。

### 上游模块 Chat/AI 强耦合排查（本次调研最有价值的产出之一）

`F080` S2 已确认 `scm.contribution.js`/`scmInput.js`/`quickDiffModel.js` 三处硬耦合 `IChatContextPickService`/`IChatEditingService`，因此 Plain 从不消费官方 `SCMViewPane`，改为自建 `PlainScmView`。F090 需要的上游模块比 F080 更广（timeline、multi-diff-editor、scm 自身的 history 子系统），逐项排查如下——**全部通过读取本机已安装的真实发布包（`node_modules/@codingame/monaco-vscode-api@35.0.1`）与对应 override 包 35.0.1 版本的真实 tarball 完成，不是凭 Code OSS 源码目录推测**：

- **`@codingame/monaco-vscode-timeline-service-override@35.0.1`**（npm 已确认存在且与本项目 `monaco-vscode-api` 版本精确对齐，`dependencies` 只有 `@codingame/monaco-vscode-api@35.0.1` 一条）：下载真实 tarball 后对其全部 20 个文件（含 `timeline.contribution.js`、`timelinePane.js`、`timelineService.js`，以及**意外一并打包**的 `localHistory.contribution.js`/`localHistoryTimeline.js` 等 6 个 Local History 文件）做 `chat|copilot|IChatEditingService|IChatContextPickService|IChatWidgetService` 全文正则匹配，**零命中**。`TimelinePane` 构造函数的完整依赖列表（18 个 `__param`）全部是标准 Workbench 服务（`IKeybindingService`/`IStorageService`/`IEditorService`/`ICommandService`/`IProgressService`/`ITimelineService`/`ILabelService`/`IUriIdentityService`/`IExtensionService` 等），无一是 chat/AI 服务。**唯一需要留意的点**：`timelinePane.js` 第 742 行在渲染时调用 `this.extensionService.activateByEvent("onView:timeline")`——这正是"扩展宿主激活事件"的调用形状，但本机 `node_modules/@codingame/monaco-vscode-api` 的 `NullExtensionService.activateByEvent` 逐行确认是 `return Promise.resolve(undefined)` 的纯 no-op（同一枚举类的 `canAddExtension()` 恒 `false` 已被 `plain-theme-import-coordinator.ts` 现有注释引用为既定安全事实，`app/features/search/plain-search-service.ts` 已在生产代码路径实际注入 `IExtensionService` 且从未触发任何宿主行为），故此调用**已验证安全**、不会启动任何 Extension Host。Timeline 视图默认挂在 `files/browser/explorerViewlet.js` 的 `VIEW_CONTAINER`（Explorer 侧边栏容器），并**捆绑了与 F090 无关的 Local History**（VS Code 基于文件保存快照的本地撤销历史，非 git）。
- **`@codingame/monaco-vscode-multi-diff-editor-service-override@35.0.1`**（同样已确认与本项目版本精确对齐，`dependencies` 同上）：真实 tarball 只有 `multiDiffEditor.contribution.js` 一个贡献文件，其 `index.js` 只注册 `IMultiDiffSourceResolverService`/`MultiDiffSourceResolverService`。全文匹配 chat/copilot **零命中**。但 `multiDiffEditor.contribution.js` 本身**确实无条件 import 并注册**了 `ScmMultiDiffSourceResolverContribution`/`OpenScmGroupAction`（来自 `@codingame/monaco-vscode-api` 基础包内的 `.../multiDiffEditor/browser/scmMultiDiffSourceResolver.js`，本机已核实存在）——继续核查该文件本身：`ScmMultiDiffSourceResolverContribution` 构造函数只依赖 `IInstantiationService`/`IMultiDiffSourceResolverService`，内部创建的 `ScmHistoryItemResolver`/`ScmMultiDiffSourceResolver` 两个工具类分别只依赖 `ISCMService`/`IEditorService`/`IActivityService`，**同样零 chat 依赖**。结论：Multi-Diff-Editor 全链条（含它自带的 scm 特化 resolver）在 chat/AI 耦合意义上是**干净的**——这与 F080 S2 发现的 `scm.contribution.js`/`scmInput.js`/`quickDiffModel.js` 形成鲜明对比。
- **SCM 自身的 history 子系统**（`scmHistoryViewPane.ts`/`scmHistory.ts`/`scmHistoryChatContext.ts`，Code OSS 1.130.0 本地参考树逐文件核实）：`scmHistoryChatContext.ts` 里的 `SCMHistoryItemContextContribution`（`static ID = "workbench.contrib.chat.scmHistoryItemContextContribution"`）**确认**硬编码依赖 `IChatContextPickService`/`IChatWidgetService`/`ChatContextKeys`/`ISCMHistoryItemChangeVariableEntry`（均来自 `chat/` 目录）——这正是 F080 S0 阶段就已判定的耦合点，F090 必须继续绕开。但 `scmHistory.ts` 本身（607 行，纯渲染 + 布局算法，`renderSCMHistoryItemGraph`/`toISCMHistoryItemViewModelArray`/`compareHistoryItemRefs`）**全文零 chat 引用**，是纯 SVG 绘制 + 数据结构代码。

**逐项自建 vs override 决策**：

| 模块                                                                                                                     | Chat/AI 耦合                                                                                         | 决策                                                             | 理由                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SCM（provider/view/quick-diff）                                                                                          | 有（`F080` 已确认三处）                                                                              | 自建（已完成）                                                   | 无需重复排查                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Timeline service override                                                                                                | 无                                                                                                   | **不采用**，自建                                                 | 虽然技术上干净，但（a）会捆绑无关的 Local History；（b）视图容器固定挂在 Explorer 而非 SCM 侧边栏，与 GitLens 式"历史在源码管理里"的预期信息架构不符；（c）`ITimelineProvider` 是"多来源时间线聚合"模型，Plain 只有 git 一个来源，自建一个直接消费 Rust log 命令的窄视图比适配通用聚合模型更简单、可控性更高——与 `PlainScmView`/`PlainSearchView` 已确立的"自建替代 vendor 聚合视图"先例一致                                                                                |
| Multi-Diff-Editor **核心 widget + 通用 `IMultiDiffSourceResolverService` seam**                                          | 无                                                                                                   | **采用 override**（`multi-diff-editor-service-override@35.0.1`） | 核心多文件 diff 渲染是通用、已验证干净的 Workbench 能力，与 F080 决策 4 复用 Monaco 核心 diff widget 同理；用于 commit 详情（一次提交改了哪些文件）与 compare 视图                                                                                                                                                                                                                                                                                                          |
| Multi-Diff-Editor 自带的 `ScmMultiDiffSourceResolverContribution`（`scm-history-item:`/`scm-multi-diff-source:` scheme） | 无（但耦合 `ISCMHistoryItem` 数据形状）                                                              | **不采用**，自建 resolver                                        | 该 vendor resolver 解析的 URI query 形状绑定 `ISCMHistoryItem`（`ISCMProvider.historyProvider` 的产出物）——`PlainScmProvider.historyProvider` 目前是 `constObservable(undefined)`（`F080` S2 明确记录"无可达代码读取它"），F090 不打算填充这个 observable（填充了也没有消费方，因为 `PlainScmView` 从不消费 vendor `SCMViewPane`），改为注册 Plain 自己的 `plain-git-commit:` scheme resolver，直接把 Rust 侧的 commit 文件列表映射成 `MultiDiffEditorItem[]`，语义上更简单 |
| SCM history 渲染算法（`scmHistory.ts` 的 swimlane 布局）                                                                 | 无（但物理上仍在被排除的 `contrib/scm/browser` 目录里，且是"图算法参考"而非"可独立复用的服务 seam"） | **不导入，自行实现**，只借鉴技术思路                             | 见下节"Graph 技术选型"                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

### Graph 技术选型：不解析 `--graph`，自建 DAG + swimlane 布局

明确推荐：**从 `git log --format=... --parents` 式的结构化输出自行构造 DAG，不解析 `git log --graph` 的 ASCII 输出**。理由：

1. `--graph` 的 ASCII 连线（`|`/`/`/`\`/`*`）是为终端等宽字体设计的视觉呈现，不是稳定的机器接口——git 官方文档明确声明这一渲染算法可能随版本调整视觉细节；同时 `--graph` 与 `--format` 组合时每行还会被插入不定长度的前导 ASCII 前缀，NUL/字段安全的下游解析会被这层可变前缀进一步复杂化。
2. 只要有 `%H`/`%P`（parent hashes）/`%D`（decoration）等字段，DAG 结构本身（谁是谁的父提交）已经是完整信息；把"哪几条线画在哪一列、什么时候合并/分叉"这一**纯前端布局问题**留给自己的渲染层，是关注点分离更清晰的架构。

布局算法方面，本机 Code OSS 1.130.0 参考树里 VS Code 自己的 `src/vs/workbench/contrib/scm/browser/scmHistory.ts`（Microsoft，MIT 许可）的 `toISCMHistoryItemViewModelArray` 函数实现了一套逐提交增量维护"泳道"（swimlane）数组的算法：按 `git log` 天然的时间倒序遍历提交；每个提交的 `inputSwimlanes` = 上一个提交的 `outputSwimlanes`；在 `inputSwimlanes` 里找到"等待"当前提交（即某泳道占位的 id 正是当前提交 id）的槽位，把该槽位替换为该提交的第一个父提交（该泳道延续下去）；若有更多父提交（merge 提交），追加为新的泳道（新分配一个循环使用的颜色）。这是与 `gitk`/`tig` 等工具概念上同源的经典技术（**这类工具是 GPL，本文档只讨论其公开已知的算法思路，不查看也不参考它们的实现代码**；VS Code 的 MIT 实现恰好是这一技术公开可查证、许可证清白的一个具体范例）。**F090 推荐方案**：由 Plain 自己全新实现同一思路的泳道分配算法（Rust 端产出 `{node_id, lane, parent_lanes[], color_index}` 序列，前端用 SVG/Canvas 渲染），不导入、不复制 `scmHistory.ts` 本身——该文件物理上位于将被排除的 `contrib/scm/browser` 目录，直接 import 会把它和其所在模块的其余（含 chat 耦合的）代码一起拖入依赖图，即使技术上可以只 import 这一个文件，也违反"自建视图，不消费 vendor 聚合貌似干净的子模块"这一 F080 S2 已确立的纪律（该次决策的判断依据正是"看似干净的子模块仍可能被同目录下的耦合文件在 bundle 分析里牵连"，`scmService.js` 是例外因为 F080 已验证其**零债务漂移**；`scmHistory.ts` 本次调研未做同等严格的 bundle 债务验证，成本上不值得为一个可以自己写的算法冒风险）。

## 实测事实（本地 git 2.50.1，构造真实仓库逐项验证，非凭记忆）

以下是本次调研为规避 `F080` 教训（文档凭记忆写的格式细节两次被实测推翻）而做的真实验证，每条都在 `/private/tmp` 下的临时仓库跑出真实输出并贴出实测结果；同类方法论：F080 已确认 `git show :<path>` 需要 `:0:<path>`、`--numstat -z` rename 顺序是 old 先 new 后。

### blame

- `git blame --line-porcelain -L <start>,<end> <path>`：`-L` 范围支持是编辑器"只 blame 可见视口行区间"按需加载的正确机制，1-based 闭区间；越界请求（如文件只有 5 行却要 `-L 10,10`）返回 exit 128，stderr `fatal: file <path> has only N lines`，可映射为结构化"范围超出"错误。
- **`--porcelain` 与 `--line-porcelain` 的确切差异**：`--porcelain` 对同一 commit 第二次及以后出现时，只打印 `<sha> <orig-line> <final-line> [<group-size>]` 一行，省略 author/committer/summary 等全部头部字段（省下的字节量与文件内"连续同 commit 行数"成正比）；`--line-porcelain` 对**每一行**都完整重复全部头部字段。F090 采用 `--line-porcelain`：viewport 级 `-L` 请求天然很小，省字节的价值低于"每行自包含、无需跨行状态机"带来的解析简单性。
- **`filename` 字段会在同一次 blame 输出中途改变**：对一个经历过 rename 的文件做 blame，早于 rename 的行的 `filename` 是旧路径、rename 之后新增的行是新路径——**证实 blame 默认（不加任何 `-M`/`-C`）就会跟随"整文件 rename 且同一提交里还有内容修改"的历史**（这是 blame 对目标文件自身沿革的默认追踪，与 `-M`（检测同一提交内的行内移动）、`-C`（检测跨文件复制）是两回事，后两者是相对昂贵的可选增强，本次调研判定 v1 不需要默认开启）。解析器必须把 `filename` 当作贯穿整个输出的可变状态字段，不能假设它对一次调用全程不变。
- **`author-time` 是 Unix 秒时间戳**（`author-time 1704074400` 形式），配合 `author-tz`（如 `+0800`）——age heatmap 直接消费每个 blame 分组的 `author-time`，无需额外命令。
- **关键陷阱（本次调研独立发现，非 F080 已知问题的重复）：`git blame` 的 `-z` 参数不会像 `git status`/`git diff` 的 `-z` 那样关闭路径引用转义**。对含非 ASCII 字符的文件名（`文件.txt`）做 blame，无论加不加 `-z`，`filename` 字段都原样输出 `"\346\226\207\344\273\266.txt"`（八进制转义 + 双引号包裹，即 `core.quotePath` 默认行为）；唯一能拿到未转义原始字节的方法是显式传 `-c core.quotePath=false`。**结论**：F090 的 blame 硬化参数必须无条件叠加 `-c core.quotePath=false`（不能像 status/diff 那样依赖 `-z`），且即便如此，`filename` 字段理论上仍可能因 Linux 任意字节文件名（含字面 LF）而破坏 blame porcelain 系列格式**没有 status/diff 那种 NUL 安全变体**这一固有限制——这是 blame 命令本身格式设计的限制，不是 Plain 实现的疏漏，需要在实施时用含 LF/非法 UTF-8 的真实文件名 fixture 验证解析器的失败模式（至少应是可识别的结构化解析失败，而非 panic 或数据错乱）。
- `--incremental`（VS Code 内置 git 扩展 `extensions/git/src/git.ts` 的 `blame2` 方法实际使用 `git blame --root --incremental [-w] [ref] -- <path>`，MIT，已读取该文件核实）：与 `--line-porcelain` 头部字段格式几乎一致，但**不包含行内容本身**（无 `\t<content>` 尾巴），且 git 内部会按"解析出结果的顺序"而非"文件行序"渐进吐出分组——适合"编辑器已有 buffer、只要 commit↔行区间映射"的场景。F090 **不采用** `--incremental`：`-L` 视口分片已经是文档要求的按需加载机制，`--line-porcelain` 自带内容对每次 viewport 请求这种小范围调用而言更简单自包含。
- Hover 需要的完整 commit message body（blame 的 `summary` 字段**只是首行摘要**，不含正文）：批量 `git log --no-walk -z --format=<FIXED, 以 %B 结尾> <sha1> <sha2> ...`，`--no-walk` 确认**保留调用者传入的原始顺序**（不按时间重排），按可见 viewport 内出现的**去重后**的 commit id 集合一次性拉取，避免大文件里同一 commit 覆盖上千行时重复请求。

### 文件与行历史

- `git log --follow --oneline -- <path>`：**证实 `--follow` 确实能跨越单次 rename 找到更早历史**（4 个提交：rename 提交 + 3 个更早提交），而不加 `--follow` 的 `git log -- <path>` 只看到 1 个提交（rename 提交本身）。这印证 git 官方文档称 `--follow` 为启发式的原因：它依赖同一提交内的 rename-detection（默认相似度阈值），对"内容大幅重写后再改名"或"先改名的提交、后大改内容的提交"分两步发生的情况可能追踪不到。
- `git log -L<start>,<end>:<path>`：**默认已经会跨 rename 追踪该行区间的历史**，不需要（也不能）额外加 `--follow`——实测 `--follow` 与 `-L` 同时使用报 `fatal: --follow requires exactly one pathspec`（git 判定 `-L` 语法里内嵌的路径不算作独立 pathspec），两者互斥。
- **`-L` 输出格式的真正复杂点（本次调研发现，值得单独强调）**：`git log -L<range>:<path>` 的每条记录 = "commit 元数据"（受 `--format`/`--pretty` 控制）紧跟"该行区间的 unified diff hunk 文本"，且 **`-z` 的 NUL 终止符只出现在元数据段末尾，hunk 文本段之后没有独立终止符**——下一条记录的元数据会**紧贴着**上一条记录 hunk 文本的末尾开始，两者之间无分隔符。若天真地把整个输出按 NUL 切分，会把"上一条的 hunk 尾部 + 下一条的元数据头部"混在同一段里，且 hunk 内容（真实源码）理论上可能包含容易与元数据格式混淆的文本，是与 `--graph` 类似的"貌似结构化、实则脆弱"的坑。**解决方案（已实测验证）**：`git log -L<range>:<path> --no-patch` **会完全抑制 hunk 输出**，只留下纯粹的、`-z` 安全的元数据记录序列（逐字节验证：输出退化为普通 `<meta><NUL><meta><NUL>` 序列，与不加 `-L` 的普通 `git log -z --format=...` 完全同构）。因此 F090 拆成两段命令：① `git log -z --format=<FIXED> --no-patch -L<range>:<path>` 取"这个行区间被哪些提交动过"的元数据列表（安全、复用 F080 既有的 NUL 解析纪律）；② 用户展开某一条具体 revision 时，再单独跑 `git log -1 -L<range>:<path> <sha>`（**限定单个 commit**，已实测确认单记录输出没有"混杂多条 hunk"的歧义，可以直接把整段输出当作"一个元数据块 + 一个 hunk 块"安全解析）取该次改动的具体 diff。这是把"列表元数据"与"具体内容"拆成两个不同粒度、不同安全性保证的命令,而不是硬解析一次调用里混杂的输出。
- 性能：git 官方文档与社区（GitLab 工程博客、`libgit2` issue #3027 等）一致认为 `-L`/blame 类"逐行溯源"操作本质是重复的文本 diff 计算，即使加 `-L` 限定范围仍可能较慢——GitLab 报告过对"提交历史很长的大文件"即便 `-L 1,70` 限定 70 行范围也观测到约 8 秒的真实耗时，证实这是 git 层面的算力限制而非 GitLab 自身实现问题。本机仓库（该 worktree 自身只有 138 个可见提交，作为迁移分支的浅历史，不足以复现大仓库量级）没有条件本地实测真实大仓库量级；F090 必须按此风险单独给 blame/`-L` 类调用比 status/diff 更谨慎的超时预算与强制可取消性（见"决策 4"）。

### compare / revision navigation（commit 详情、任意两版本对比）

- **关键陷阱（本次调研发现）**：对一个真正的 2-parent merge 提交，**`git show <merge-sha> --name-status`（不加任何额外参数）默认输出为空**（只有 commit 头部，没有任何文件行）——这是 git 对 merge 提交的默认"combined diff"行为（只显示与**所有**父提交都冲突的行，一次干净的自动合并没有这类行，因此看起来"这次提交什么都没改"）。`git diff-tree --no-commit-id --name-status -r <merge-sha>`（不加 `-m`/`-c`）同样对 merge 提交返回**完全空**输出。真实验证：`git show <merge> --first-parent --name-status` 才会正确显示"这次合并从被合并分支带入了什么"（即只显示相对第一父提交的差异，等价于 GitHub/GitLab 等平台展示 merge commit 的默认约定）；`git diff-tree -m --name-status -r <merge>` 则是"相对每个父提交分别求 diff 后拼接"，同一批文件在多父场景下可能重复出现且不带父提交归属标签，容易被误用。**结论**：F090 的 commit 详情/compare 命令必须固定带 `--first-parent`（非 v1 的可选项），否则对任意 merge 提交都会静默显示"无变更"这一具有欺骗性的空结果。
- 任意两版本内容对比复用 F080 已建立的 `GitBlobRev`/`git show <rev>:./<path>` 机制，但需要把"闭集 rev"从 `Head`/`Index` 扩展为"闭集识别符"（分支名、tag 名、commit 短哈希、`HEAD~N`），仍然不做通用 revspec 直通（不接受用户输入任意字符串直接拼进 revspec，收窄到 refs 命令返回的已知闭集 + 是否为合法十六进制/`~`/`^` 组成的 commit-ish 语法白名单校验）。

### stash 只读浏览

- `git stash list --format='<FIXED>' -z`：**证实 `--format` 与 `-z` 组合对 `stash list` 同样有效**（`stash list` 底层复用 `git log`/reflog 遍历机制），可拿到干净的、NUL 分隔、字段可任意用 `%x00`/`%x1f` 等分隔符自定义的结构化输出，不必解析 `stash@{N}: On <branch>: <message>` 这种人类可读默认格式。`%gd`（reflog 描述符，即 `stash@{N}`）、`%H`、`%s`、`%ct` 等字段均可直接取到。
- `git stash show -p stash@{N}`：显示该 stash 相对其应用基准的 diff，只读浏览可复用 F080 已有的 diff 解析路径（`--name-status -z`/`--numstat -z` 同构，未单独重新验证但预期行为一致，标注为"待实施时用真实 stash fixture 复测确认"）。

### worktree 只读浏览

- `git worktree list --porcelain`：每个 worktree 一个字段块，字段间 LF 分隔，块间以**空行**分隔；字段包括 `worktree <path>`、`HEAD <sha>`、`branch <ref>`（或 `detached`）、可选 `locked <reason>`（无 reason 时只有 `locked` 一词，本次未单独验证）、`prunable <reason>`（本次未构造出该场景，待实施时验证）。
- `git worktree list --porcelain -z`：**实测确认**块间分隔从"空行"变为**双 NUL**（`\0\0`），块内每个字段独立以单个 NUL 结尾——与 F080 已确立的"`-z` 让格式对内嵌控制字符安全"这一模式完全一致，是 F090 应采用的硬化形式（同样需要显式 `-c core.quotePath=false`，worktree 路径同样可能触发 `core.quotePath` 转义，本次未针对 worktree 路径专门构造非 ASCII fixture，标注为待实施时验证，但基于 blame 的实测结果推断适用同一转义规则）。

### refs

- `git for-each-ref --format='<字段>%00<字段>...' refs/heads refs/tags refs/remotes`：`%00` 作为**字段内**分隔符可以直接写进 `--format`（git 自己转换成字面 NUL 字节），不需要额外的 `-z` 选项；**记录间**分隔符固定是 LF——这是安全的，因为 git ref 名称语法本身禁止包含控制字符（不同于文件路径，无需额外的 NUL-safe 记录分隔）。
- `%(objecttype)`：轻量 tag（直接指向 commit）报告为 `commit`；附注 tag（annotated tag，tag 本身是一个独立对象）报告为 `tag`，此时 `%(*objectname)` 给出解引用后的真实 commit sha——refs 展示层必须用这个字段区分两种 tag，而不能假设 `%(objectname)` 恒是 commit sha。
- `%(upstream)`：无上游配置时为空字符串（与 F080 status 解析里"无 upstream 时整行缺失"是不同的建模——这里 for-each-ref 恒定输出该字段，只是值为空，属于 `Option`/空字符串两种建模都可行，需要在实施时选定并在契约里锁定）。
- 不建议解析 `git log --format=%D`（log 自带的 ref decoration）作为 refs 数据源——`%D` 是"`HEAD -> main`"、"`tag: v1.0, feature-branch`"这种人类可读、逗号+箭头混合的自由文本，结构化程度低于 `for-each-ref` 专用查询,只应作为"这个提交上有哪些 ref 指着"的辅助信息（graph 视图给节点打 ref 标签时可能有用），不作为 refs 主视图的数据源。

## 技术方案

### 决策 1：只读能力闭集 —— 全部 `GitExecMode::BackgroundRead`

除 stash/worktree 的写操作外，F090 每个只读能力都是参数写死的专用命令，复用 F080 的 `GIT_*_ARGS` 常量 + AST 契约锁定模式，禁止通用 `git_run`：

```
GIT_BLAME_BASE_ARGS   = ["-c", "core.quotePath=false", "blame", "--line-porcelain", "--root"]
                        （+ 可选 "-L<start>,<end>"，+ 可选 <rev>，+ "--", <path>）
                        ★ S0 实测修正：上面这个顺序是对的，本文档原先把 "-c"/"core.quotePath=false"
                          排在 "blame" 之后——真实 git 2.50.1 会把它理解成 blame 自己的 -c
                          （annotate 兼容模式）而非全局配置覆盖，直接 fatal: bad revision
                          'core.quotePath=false'。git 的全局 -c 必须排在子命令之前。
GIT_LOG_COMMIT_META_ARGS = ["log", "-z", "--format=%H%x1f%B", "--no-patch"]
                        ★ S0 实测修正：本文档原先设计的多字段格式
                          （%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%b）有真实的字段错位漏洞，
                          已用敌意 commit 复现：git config user.name 通过一次完全正常的
                          git commit 就能接受任意字节，**包括格式串自己的分隔符 0x1f**；
                          一旦作者名夹带该字节，它后面的所有字段全部错位。这与 F080 审查
                          发现的 pathspec/filter 属同一类问题——攻击者可控数据进入结构化协议。
                          改为 sha 后只留一个字段（%B）吸收其余全部字节，结构上不可能错位；
                          其他元数据若需要，必须各自独立取或改用不可被内容伪造的编码。
GIT_LOG_FILE_HISTORY_ARGS = GIT_LOG_COMMIT_META_ARGS + ["--follow", "--", <path>]
GIT_LOG_LINE_HISTORY_ARGS = GIT_LOG_COMMIT_META_ARGS + ["-L<start>,<end>:<path>"]
                        ★ S1 实测修正一：`--follow` 与 `-L` **互斥**，不能叠加
                          （`fatal: --follow requires exactly one pathspec`）。
                          故 line-history 变体不带 `--follow`，只有 file-history 带。
                        ★ S1 实测修正二：本文档原写的 drill-down 形状
                          ["log", "-1", "-L<start>,<end>:<path>", <sha>] **实测不可用**。
                          `-L<range>:<path>` 的 <path> 是相对**遍历起点**解析的：一旦
                          <sha> 是某次 rename 之前的提交，那棵树里并不存在"当前(rename 后)
                          路径名"，git 直接 `fatal: There is no path <path> in the commit`。
                          已用真实 rename fixture 复现并固化为永久回归测试。
                          改用的形状：重跑与 list **完全相同**的命令（隐式锚定 HEAD，
                          因此路径始终按当前名解析），再用 `--skip=<n> --max-count=1`
                          截取第 n 条；<n> 是调用方已持有的 list 下标。为覆盖"list 之后
                          仓库又有新提交导致下标漂移"的竞态，调用方必须同时传入期望 sha，
                          服务端校验落地 commit 与之一致，不一致返回
                          GIT_LINE_HISTORY_DETAIL_STALE_INDEX；下标越界时 git 退出码为 0
                          且输出为空(已实测)，映射为 GIT_LINE_HISTORY_DETAIL_NOT_FOUND。
GIT_SHOW_COMMIT_ARGS  = ["show", "--no-color", "--no-textconv", "--no-ext-diff",
                          "--first-parent", "--name-status"]（复用 F080 diff 双调用模式再加 --numstat 变体取增删行数）
                        ★ S2 实测修正：上面这个形状不可用——真实 git 2.50.1 的
                          `git show ... --name-status` 会在 -z 的 NUL 记录数据之前
                          先输出一段人类可读、LF 终止、含攻击者可控自由文本 commit
                          message 的头部（`commit <sha>`/`Merge: <p1> <p2>`/
                          `Author:`/`Date:`），与 `diff --name-status -z`（从第一字节起
                          纯 NUL 记录）形状完全不同；且 `--no-patch` 不能与
                          `--name-status` 同时用于 `git show`（`fatal: options
                          '--name-only', '--name-status', '--check', and '-s'
                          cannot be used together`），无法像 S1 的 `log -L --no-patch`
                          那样压成纯元数据。改为：`show_commit` 从不调用 `git show`；
                          解析 sha 的第一父提交（`git log -1 -z --format=%P --no-patch
                          <sha>`，%P 是 git 自己计算的定长十六进制+空格字段，不同于
                          %an/%s/%B，天然不需要 %x1f 分隔符防护）后，对
                          <parent-or-empty-tree-sha>/<sha> 两个显式版本号跑一次纯
                          `git diff --name-status -z`/`--numstat -z`（复用
                          super::diff 已审计的两次调用模式），根提交（零父）用 git 自身
                          固定空树 sha `4b825dc642cb6eb9a060e54bf8d69288fbee4904`
                          代替父提交——已实测确认与 `git show --first-parent` 剥离头部
                          后逐字节相同。另需 `-C --find-copies-harder`（而非只有
                          `-M`）才能检测到源文件完全未改动的拷贝，且需要独立的
                          `git rev-parse --verify -q <sha>^{commit}` 存在性闸门（%P/
                          --parents 都无法区分"不是提交"与"零父根提交"，两者均静默
                          exit 0 空输出）。详见 progress.md 的 F090 S2 条目。
GIT_LOG_GRAPH_ARGS    = ["log", "-z", "--format=<FIXED, 含 %H%x1f%P%x1f...>", "--all"|"--branches"（不用 --all，因其会带出 refs/stash，见实测）]
GIT_FOR_EACH_REF_ARGS = ["for-each-ref", "--format=<FIXED，含 %00>", "refs/heads", "refs/tags", "refs/remotes"]
GIT_STASH_LIST_ARGS   = ["stash", "list", "-z", "--format=<FIXED>"]
GIT_STASH_SHOW_ARGS   = ["stash", "show", "-p", "--no-color", "--no-textconv", "--no-ext-diff"]（+ <stash-ref>）
GIT_WORKTREE_LIST_ARGS = ["worktree", "list", "--porcelain", "-z", "-c", "core.quotePath=false"]
```

每条都叠加 F080 `harden_background_read` 的既有防护（`GIT_OPTIONAL_LOCKS=0`、`core.hooksPath=<空>`、`core.fsmonitor=`、`GIT_TERMINAL_PROMPT=0`/`GIT_ASKPASS` 拒绝、固定 `LANG`/`LC_ALL`），diff 系命令继续叠加 `--no-textconv --no-ext-diff`。

### 决策 2：stash/worktree 的写操作单列，`GitExecMode::Write` + 确认门

F090 acceptance 第 3 条明确要求"stash、worktree 工作流通过 fixture"——只读浏览（list/show）不足以构成"工作流"，创建/应用/删除必须一并提供，且这些是**真正的写操作**，绝不能挂在 `BackgroundRead` 下：

| 操作              | 命令                                              | 破坏性等级                                                                                      | 确认门                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stash push`      | `git stash push -m <msg> [--include-untracked]`   | 低（工作区改动被移入 stash，未丢失，`stash list` 里能找回）                                     | 不需要强确认，但需提示"当前所有未暂存改动将被存入 stash"                                                                                                                                                                                                                                                                                                                                                                    |
| `stash apply`     | `git stash apply [--index] stash@{N}`             | 低（可能产生冲突，但不删除 stash 本身）                                                         | 冲突时展示冲突文件列表                                                                                                                                                                                                                                                                                                                                                                                                      |
| `stash pop`       | `git stash pop [--index] stash@{N}`               | 中（成功应用后**删除**该 stash 条目）                                                           | 确认门，措辞类似 `discard` 先例（"应用后将从 stash 列表移除，如果发生冲突需手动处理"）                                                                                                                                                                                                                                                                                                                                      |
| `stash drop`      | `git stash drop stash@{N}`                        | **高**（不可恢复地丢弃该 stash——除非用户记得其 sha 用 `git fsck` 手动找回，产品不承诺这条路径） | 强确认，措辞与 `discard`/`force push` 同级"不可撤销"                                                                                                                                                                                                                                                                                                                                                                        |
| `worktree add`    | `git worktree add [--detach] <path> <commit-ish>` | 低（新增，不影响任何既有数据）                                                                  | 需要用户显式指定新 worktree 落盘路径——落盘路径校验必须复用 workspace capability 边界纪律（不能创建到未授权目录），这是本命令与 F080 其余写命令最大的架构差异，见"风险与未知项"                                                                                                                                                                                                                                              |
| `worktree remove` | `git worktree remove [--force] <path>`            | 中～高（工作区有未提交改动时默认拒绝，`--force` 时**丢弃该 worktree 里所有未提交改动**）        | 已实测确认：不加 `--force` 对脏 worktree 报 `fatal: '<path>' contains modified or untracked files, use --force to delete it`（exit 128，可映射为 `GIT_WORKTREE_REMOVE_NEEDS_FORCE`）——**必须先无 `--force` 试跑一次探测是否脏**，脏则展示"将丢弃未提交改动"确认后才重试 `--force`，绝不无条件直接 `--force`（这是"预览影响 + 二次确认"原则在本命令上的具体落地，同 F080 S4 `push --force-with-lease` 的"先预览再确认"纪律） |

均复用 F080 `harden_write`（不叠加 `core.hooksPath`/`fsmonitor` 覆盖、不设 `GIT_OPTIONAL_LOCKS=0`，仍设 `GIT_TERMINAL_PROMPT=0`/`GIT_ASKPASS` 拒绝与固定 locale）。stash/worktree 的写命令不触网，不需要 `GitExecMode::Network`。

**只读 vs 写的清晰分界**：`stash list`/`stash show` 与 `worktree list` 是 `BackgroundRead`（被动触发，view 打开即查询，不弹确认），`stash push/apply/pop/drop` 与 `worktree add/remove` 是 `Write` + 用户显式点击触发 + （`pop`/`drop`/`remove --force`）强确认。这一分界必须在 AST 契约里用与 `validateGitDiscardConfirmationBoundary`/`validateGitNetworkConfirmationBoundary` 同构的新契约锁定（见下节）。

### 决策 3：前端呈现 —— 新增自建视图，不复用/不填充 `ISCMProvider.historyProvider`

延续决策"调研结论"表格的判断：F090 新增以下自建产物，均不消费任何 vendor 聚合贡献文件：

- **Inline blame**：Monaco `IModelDeltaDecoration` 的 `after`（`renderOptions.after.contentText`）机制，在每行末尾追加一段淡色文本（作者 + 相对时间）——这正是 VS Code 内置 `extensions/git/src/blame.ts`（MIT）的真实实现机制（`window.createTextEditorDecorationType({ after: {...} })` + `DecorationOptions.range` 取 `Position(line, MAX_SAFE_INTEGER)` 的零宽范围），本文档只引用其**技术机制**（decoration 的 `after` 字段是 Monaco/VS Code 公开 API 的既定用法，不构成"移植 GitLens 代码"，且该文件本身是 Code OSS 自己的 MIT 代码，非 GitLens）。悬浮态用 `languages.registerHoverProvider` 挂一个只对 blame decoration 所在行生效的 hover，展示完整 commit message + sha + 相对时间（复用决策 1 的批量 `git log --no-walk` 元数据）。
- **File blame（整文件侧栏）**、**age heatmap**（按 `author-time` 相对新旧做颜色插值,复用 GitLens 常见的"越新越暖"约定思路，非抄其调色板具体数值——调色板颜色本身应走 Plain 自己的主题色系统，不是能被"抄"或"不抄"的版权客体，但仍需自行设计而非截屏抠色 GitLens）、**graph**、**refs**、**stash**、**worktree**：全部是全新的 `ViewPane` 子类（`PlainGitBlameView`/`PlainGitGraphView`/`PlainGitRefsView`/`PlainGitStashView`/`PlainGitWorktreeView` 或合并为更少的几个 tab 化视图，具体聚合粒度留给实施阶段决定），复用 `scm-contribution.ts` 已确立的 `registerViewContainer`/`registerViews` 自建注册模式，可以选择放进已有的 `SCM_VIEW_CONTAINER_ID` 侧边栏容器（作为该容器下的额外 view，贴近 GitLens 的信息架构——"历史"归在源码管理面板下——但只借用**这一条信息架构惯例**，不借用其任何实现）或新开一个容器，留给实施阶段按 UI 复杂度判断。
- **Graph 渲染**：SVG（同 VS Code 参考实现的选型，量级可控、可精确控制每个 swimlane 的路径/圆点，比 Canvas 更易做 hit-testing 支持点击节点），布局算法见"Graph 技术选型"一节，自建实现。
- **Compare / commit 详情多文件视图**：**采用** `@codingame/monaco-vscode-multi-diff-editor-service-override@35.0.1`（决策依据见上表）——只安装该 override 包并使用其 `IMultiDiffSourceResolverService`/核心 `MultiDiffEditor` widget，注册 Plain 自己的 `IMultiDiffSourceResolver`（`plain-git-commit:` scheme），不使用其自带的 `ScmMultiDiffSourceResolverContribution`。这是 F090 相对 F080 决策 4 的一个新增点：F080 只复用了"并排 diff editor 核心"，F090 进一步复用"多文件 diff editor 核心"，同一纪律（复用干净的通用 widget，自己接入数据源）。

### 决策 4：性能与有界预算

- blame/`-L` 类命令按实测证据（GitLab 报告的 8 秒级耗时)必须有**独立于** F080 现有 30 秒 `GIT_EXEC_TIMEOUT` 的更谨慎处理——不一定是更长的超时（inline blame 是被动触发，用户不应该等 5 分钟），而是**更短的超时 + 前端主动取消**：viewport 滚动离开时应主动调用取消（复用 F080 S4 已建立的 `GitNetworkService::request_cancel` 同款模式，泛化成通用 `git_read_cancel`），避免用户快速滚动产生的大量过期 blame 请求持续占用子进程配额。
- graph/refs 视图需要"最近 N 条提交"这类分页/上限（不做无界 `git log --all`），复用 F080 已确立的"log 走分页/有界事件流"IPC 范式（架构文档已点名）。
- 本机没有条件构造出真正大仓库（该项目自身 worktree 只有 138 个可见提交）验证 blame/log/graph 在十万级提交仓库上的真实量级，只能引用 GitLab/`libgit2`/Chromium 社区的公开报告作为数量级参考,**必须在实施阶段用一个真实大仓库（例如浅克隆一份 linux/vscode 上游历史，或至少构造几千提交量级的合成仓库）做真实基准**，不能只凭本文档的引用数字定最终超时常量。

## 需要新增的 AST 契约清单

比照 `scripts/plain/boundary-contracts.mjs` 现有 `GIT_COMMAND_CONTRACTS`/`GIT_WRITE_COMMAND_CONTRACTS`/`validateGitCommandRegistration`/`validateGitRustBoundary`/`validateGitIpcBridgeBoundary`/`validateGitDiscardConfirmationBoundary`/`validateGitNetworkConfirmationBoundary` 的既有模式，F090 需要：

1. **`GIT_HISTORY_COMMAND_CONTRACTS`**（只读命令闭集）：blame、file-history、line-history-list、line-history-detail、show-commit（含 `--first-parent` 强制项）、log-graph、for-each-ref、stash-list、stash-show、worktree-list —— 每个命令的 Tauri handler 精确签名/函数体锁定,同 `GIT_COMMAND_CONTRACTS` 技法。
2. **`GIT_WRITE_HISTORY_COMMAND_CONTRACTS`**：stash-push/apply/pop/drop、worktree-add/remove —— 精确参数常量锁定（尤其 `GIT_WORKTREE_REMOVE_ARGS` 不得出现裸 `--force` 之外的其他强制项遗漏,以及"先无 force 探测再确认"这一调用顺序需要有专属契约而不能只锁最终参数）。
3. **`validateGitBlameHardeningArgs`**：专门锁定 `-c core.quotePath=false` **必须**出现在 blame 的参数常量里（这是本次调研独立发现的硬化点，容易在实施时被遗漏或被误判为"status/diff 已经这样做了所以 blame 也一样"——已实测证明不一样）。
4. **`validateGitStashConfirmationBoundary`**：与 `validateGitDiscardConfirmationBoundary`/`validateGitNetworkConfirmationBoundary` 同构,锁定 `gitStashPop`/`gitStashDrop` 唯一生产调用点、调用点精确函数体、以及确认状态机模块（`plain-scm-stash.ts`？具体命名留给实施）的审计过 module face。
5. **`validateGitWorktreeConfirmationBoundary`**：同构,锁定 `gitWorktreeRemove` 唯一生产调用点 + "先探测脏状态再决定是否需要 force 确认"这一分支逻辑必须存在（不能被简化成"永远直接 force"）。
6. **`validateGitReadCancelBoundary`**（可选,视实施是否真正做了 viewport 取消而定）：确保 blame 的取消调用不会被误用来取消其他命令。
7. 扩展现有 `FORBIDDEN_SPAWN_BYPASS_DEPENDENCIES`/git2/gix 机器禁令的适用范围文档（F090 不引入任何新的 crate 依赖,禁令本身无需修改,但需要在本 feature 的 Cargo.toml 审计里重申一次,同 F080 S0 先例）。

## 切片拆分（参考 F080 粒度,每片可独立验收、独立提交）

1. **S0 blame 核心 + age heatmap**：Rust `git::blame` 模块（`--line-porcelain --root -c core.quotePath=false [-L] [-c]`,批量 `git log --no-walk` 元数据）、`GIT_HISTORY_COMMAND_CONTRACTS` 的 blame 子集、`validateGitBlameHardeningArgs`；前端 Monaco decoration + hover provider + age 颜色插值；含恶意含 LF/非 ASCII 文件名的 fixture（如实测出的行为超出可解析范围,记录为已知限制而非阻塞本切片）。
2. **S1 文件与行历史**（**已完成**；line-history-detail 的实际形状见上方 ★ S1 实测修正二，不是这里原写的 `-1 -L <sha>`）：`git::log` 模块的三个变体（file-history 用 `--follow`、line-history-list 用 `--no-patch -L`、line-history-detail 用 `--skip=<n> --max-count=1` + 期望 sha 校验）；前端侧栏列表 + 点开展示具体 diff hunk；含 rename fixture（验证 `--follow` 与默认 `-L` 追踪行为的实测结论）。
3. **S2 compare / commit 详情**（**已完成**；`show_commit` 的实际形状见上方 ★ S2 实测修正，不是这里原写的 `git show --first-parent --name-status`）：`show_commit(sha)` 命令（内部从不调用 `git show`，改为两个显式版本号的 `git diff`）、merge 提交 fixture（含两个独立控制组，验证空 diff 陷阱已被规避）；安装 `multi-diff-editor-service-override`、自建 `plain-git-commit:`/`plain-git-commit-blob:` resolver 接入 `MultiDiffEditorItem[]`；bundle 债务基线核对——实测 `sourceCount` +15（全部为 vendor 多文件 diff 相关文件，含调研阶段未覆盖到的 `editor/browser/widget/multiDiffEditor/` 核心 widget 文件）、`debtSourceCount`/`categoryCounts`/`debtSourceSha256` 零漂移。
4. **S3 graph + refs**：`git::log`（graph 用途,parents/refs 字段)+ `git::refs`（`for-each-ref`）模块；前端 SVG swimlane 布局算法（自建实现)+ refs 侧栏；性能基准（构造合成大仓库或浅克隆真实大仓库,给出真实数字而非只引用他人报告）。
5. **S4 stash 工作流**：`git::stash` 模块（list/show 只读 + push/apply/pop/drop 写)+ `validateGitStashConfirmationBoundary`；前端 stash 面板 + 确认对话框（pop/drop 走确认,push/apply 走提示不强确认）。
6. **S5 worktree 工作流**：`git::worktree` 模块（list 只读 + add/remove 写,remove 的"先探测脏状态再确认"两阶段调用)+ `validateGitWorktreeConfirmationBoundary`；`worktree add` 的落盘路径 workspace capability 边界校验（**授权模型已由主导会话裁定,见"风险与未知项"第 1 条:原生选择器选父目录 + `RelativePath::join_child` 校验单层子段;本切片只需实施,不需再做架构决策**）；前端 worktree 面板。
7. **S6 收口**：跨切片 evidence 闭环、`docs/e2e-handover.md` 新增条目、真实大仓库性能基准的最终数字回填、`features.json` F090 转 complete（均由主导会话操作,不在本文档范围）。

## ⚠ 跨切片必读：`GIT_LITERAL_PATHSPECS=1` 会静默破坏依赖 git 内部隐式 pathspec 的命令

**S4 实测发现，凡本域新增 git 命令都必须逐条排查这一项。** F080 的安全修复给 `exec.rs` 的 `apply_universal_hardening` 加了无条件、全模式的 `GIT_LITERAL_PATHSPECS=1`（用于堵住 discard 把 `a*.txt` 当 glob 从而连带销毁 `a1.txt`/`a2.txt` 的真实数据丢失漏洞）。S4 发现它会让 `git stash push --include-untracked` **静默半失败**：stash 条目正常创建、未跟踪内容也正确捕获进 stash commit，但**未跟踪文件不会从工作区删除**，且退出码与输出**均报告成功**——调用方无从察觉。根因是 git 内部用来选中"全部未跟踪文件"以便事后删除的那个默认 pathspec 表达式，依赖的正是该变量禁用掉的 glob/magic 语义。

- **排查方法**：用 `env -i` 构造与 `build_git_command` 完全一致的环境，对该变量做单变量二分（S4 即以此定位，并以 5/5 重复确认确定性）。
- **正确修法**：给该命令补一个显式的字面 pathspec（S4 用 `-- .`，并对 `push` 的**所有**分支统一加、不做两条略有差异的代码路径），**绝不削弱 `GIT_LITERAL_PATHSPECS=1` 本身**——那会静默重开 F080 那个数据丢失漏洞。
- **高危特征**：任何"对全部文件生效但不要求调用方显式给出 pathspec"的命令（git 内部会自行合成 pathspec）。本域已确认受影响：`stash push`。已确认**不**受影响：`status`/`diff`/`blame`/`log`/`show`/`stage`/`unstage`/`discard`（这些都由调用方显式传字面路径，字面语义正是所需）、`for-each-ref`（其模式是 ref pattern 而非 pathspec）。
- **新增命令时必须做的事**：写一个在**真实硬化环境下**跑通的集成测试并附控制组，而不是只在裸 git 下验证——S4 这个 bug 在裸 git 下完全不出现。

## ⚠ 跨切片必读：自建 `ViewPane` 必须声明**全部**构造参数的 DI 装饰器，不能只声明自己新增的那几个

**S4 实测发现，凡新增自建视图（含 F100 及以后）都适用。** `@codingame/monaco-vscode-api` 的 DI 装饰器存储在一个类**首次被装饰**时是**替换**而非追加依赖数组。因此子类若只给自己额外新增的服务标注装饰器（例如只标 index 10/11），基类 `ViewPane` 那九个参数的装饰器信息会被整体覆盖掉——后果不是"该视图坏掉"，而是 **SCM 容器内全部四个视图的构造一起失败**（S4 首轮全量 Playwright 因此一次性挂掉 16 个用例，且失败面**没有一个与 stash 相关**，极难从症状反推）。

- **正确写法**：把全部 11 个 index 的装饰器一并声明，包括继承自 `ViewPane` 的那九个。
- **为什么必须跑全量 E2E**：这个 bug 在单元测试与该视图自身的用例里都不出现，只有在同容器的**其他**视图被构造时才炸——S4 正是靠"每个切片必须跑全量 `pnpm test:e2e:browser`"这条纪律才发现的，根因则通过阅读 vendored 的 `instantiation.js` 源码确认。

## 风险与未知项清单

1. ~~**`worktree add` 的落盘路径授权模型是全新架构问题**~~ —— **已由主导会话裁定,S5 按此实施,不再是开放问题**。原始问题陈述保留于此以说明裁定理由：F080 全部写操作都在"已授权的单一 workspace root 内部"操作文件（stage/commit/discard 都不创建 root 外的新路径）,`worktree add <path>` 却要在**任意**文件系统路径创建一个新的工作目录——这个新路径既不在当前授权 root 内（通常故意选在 root 外,例如兄弟目录）,也没有经过 workspace 的目录选择器走 capability 流程。

   **裁定：要求用户先用原生目录选择器选定一个「父目录」,新 worktree 只能创建为该父目录下的一个单层子目录。** 具体约束：

   - 目标路径 = `<用户通过原生选择器选定的现有目录>` + `<用户输入的单个路径段>`。后者必须经 `RelativePath::join_child`（`src-tauri/src/path_policy.rs:68`,既有的单段校验入口）校验后再使用——**复用它,不要另写一套**;它已经拒绝分隔符、`..`、绝对路径、空段与跨平台歧义段,并有既有反向测试。
   - 因此 git 实际执行的 mkdir 落在一个**刚刚由原生选择器授权的目录内部**,与 F080 其余写命令"在已授权 root 内写"的信任姿态完全一致,不新增例外。
   - **明确否决**"自由指定路径 + 仅做存在性/可写性检查后放行 git 自己 mkdir"这一方案。理由:`cap_std::fs::Dir` 能力模型的全部意义就是任何未被授权的 `Dir` 之外的路径**不可达**;让 git 子进程去做这个 mkdir 等于把限制从我们的 FS 层"洗"到子进程层,能力模型即被架空。且在 macOS 上应用本就可能确实没有该路径的沙箱授权,自由指定只会产出难以解释的失败。
   - 附带收益:新 worktree 落在已授权父目录内,**创建后即可直接作为 workspace root 打开而不需要第二次系统授权弹窗**。
   - `worktree add` 仍是写操作 → `GitExecMode::Write` + 显式确认门（与 `remove` 的两阶段探测确认同一纪律,契约由 `validateGitWorktreeConfirmationBoundary` 锁定）。
   - 仍待 S5 实测确认的细节:`git worktree add` 要求目标路径不存在或为空目录,需确认"父目录已存在 + 子段不存在"这一组合在真实 git 下的确切行为与报错文案,并映射为结构化错误码。

2. **大仓库真实性能数字缺失**：本文档引用的"GitLab 报告 8 秒级 blame 耗时"等是第三方公开报告,不是本机实测,必须在 S3/实施阶段用真实大仓库基准替换。
3. ~~**blame 对含 LF/非法 UTF-8 文件名的真实失败模式未验证**~~ —— **S0 实施阶段已实测证伪本条的前提并完成验证**。本条原文断言"macOS APFS 文件系统层面可能直接拒绝创建这类文件名,同 F080 S1 已记录的相同平台限制"——**这个假设是错的**：字面 `\n` 在 Rust 里就是合法字符串内容,`std::fs::write` 直接就能在 APFS 上创建含字面 LF 的文件名,不需要任何 `OsStr`/字节层技巧。S0 已用真实的字面 LF 文件名验证了 blame 解析路径。

   **连带纠正**：F080 S1 当年记录的"同一平台限制"同样不成立(它把一个未尝试的假设写成了已知平台限制),该处结论应视为已被本次实测推翻。教训:凡是"本平台做不到所以没测"的结论,必须真的尝试过一次再写进文档——否则它会像本例一样被下游切片继承为既定事实。

   仍然成立的部分：`-c core.quotePath=false` **必须**但**不充分**——它只影响 `>=0x80` 字节是否做八进制转义;文件名中的字面双引号/反斜杠/tab/控制字节无论该开关如何都会被 git 转义,因此解析器必须实现完整的 C 风格反转义(含 3 位八进制),不能依赖"开了这个 flag 就总是拿到原始字节"。S0 已按此实现。

4. **`stash show`/`worktree list` 是否需要 `-c core.quotePath=false`**：本次基于 blame 的实测结果推断适用同一转义规则,但未针对这两个命令单独构造 fixture 验证,标注为待实施确认。
5. **Graph 视图的性能上限**：swimlane 算法是 O(n × 活跃泳道数)增量维护,活跃泳道数在拥有大量长期并行分支的仓库里可能增长,需要一个"最多同时渲染 N 条泳道,超出折叠"的降级策略,具体阈值留给实施阶段依据真实基准决定。
6. **stash 的 `--include-untracked`/`--keep-index` 等变体是否要在 v1 暴露**：本文档只锁定最基础的 `push -m <msg>`,更多选项（含未跟踪文件、保留暂存区）是否纳入 v1 UI 留给实施阶段按最小可用范围判断。
7. **`for-each-ref` 的 `%(upstream)` 空字符串 vs `Option` 建模选择**：与 F080 status 解析"整行缺失建模为 Option"不是同一种"缺失",需要在实施时明确选定并写进 wire DTO 注释,避免与 F080 现有 `BranchUpstream: Option<..>` 的语义产生不一致的心智负担。

## 与 F100（DAP 调试）/ F110（遗留退役）的边界

- F090 完全不涉及调试器、DAP、launch.json——那是 F100 的范围,两者除了都在"phase 3"里推进外没有代码/命令层面的交集。
- F090 不改动、不清理 `monaco-vscode-api` 的 203 个排除域 source-map 债务文件——那是 F110 的范围;本文档提到的"不导入 vendor 聚合贡献文件"是 F090 自己新增代码的纪律,不代表 F090 要主动清理既有债务计数(债务基线预期在 F090 各切片里保持不变,只有新增的、F090 自己引入的干净 override 包依赖会让 `sourceCount` 增长,`debtSourceCount`/`categoryCounts`/`debtSourceSha256` 应逐字节不变,同 F080 S2/S3 的验证纪律)。
- F090 新增的 `multi-diff-editor-service-override` 依赖需要走 F080 已确立的"新增 pinned runtime dependency"审计流程(`check-boundaries.mjs`的 `allowedDependencies`),但不需要新增 pnpm patch(该包本身干净,不需要 AI 剥离)。

## 排除项

GitLens 账号/Launchpad/Cloud Patches/PR provider/品牌/AI commit message/AI 解冲突/MCP（沿用 F080 排除项)；GitLens+/Pro 的 Commit Graph/Worktrees/Visual File History **具体实现代码**（本文档已确认这三者恰是 GitLens `LICENSE.plus` 覆盖范围,F090 做的是同名但完全独立实现的功能,不参考其代码);`git2`/`gix`/`libgit2-sys`（ADR 0003 已定,本 feature 不重新讨论,继续等基准证明 CLI 读取成为瓶颈后再议);通用 `git_run`（本 feature 同 F080 一样,每个能力对应写死参数的专用命令);`git blame -M`/`-C`（同一提交内行移动检测、跨文件复制检测)作为默认开启项——留作 v2 可选增强,v1 不实现;stash 的 `--include-untracked`/`--keep-index` 等非默认变体的完整 UI 覆盖（见"风险与未知项"第 6 条,视实施阶段判断可能部分纳入)。

## F260 实施补记：commit search 缺口闭合（2026-08-24）

F230 完成度审计发现 `docs/product-scope.md:49` 的历史「搜索」在 F090 验收中被静默遗漏。F260 以一个窄的只读能力闭合该项，不扩大为任意 revision、pickaxe、正则或通用 Git 查询器：

- Rust 新增 `git_history_search`。message/author 是最多 256 bytes、无控制字符的 literal case-insensitive 查询；命令参数固定为 `--branches --tags --remotes --fixed-strings --regexp-ignore-case`，结果沿用 `HistoryList` 的 500 条预算。SHA 只接受 4–40 位十六进制，先以固定 `rev-parse --verify <prefix>^{commit}` 解析唯一 commit，未知或歧义前缀返回空列表。
- wire DTO、TypeScript request builder、native decoder 与 `PlainBridge` 都是闭集；每次调用仍携带显式授权 rootId。History view 复用 Source Control 的共享 repository selection，多根时只查询用户明确选择的仓库，不以活动编辑器或授权顺序覆盖该选择。
- 真实 Apple Git 2.50.1 fixture 覆盖 message 大小写、author 正则元字符 literal 语义、SHA 前缀、未知 SHA 与无效输入；单元/架构 hostile mutation 覆盖 handler 注册与改线、bridge 方法闭集和 request-builder 绕过；两条真实 Workbench Browser 场景覆盖三种搜索和多根路由。

明确排除：任意 argv、revision expression、正则模式、内容 pickaxe（`-S`/`-G`）、分页和历史搜索持久化。本切片只闭合 product-scope 中按 message/author/SHA 找 commit 的原始缺口。
