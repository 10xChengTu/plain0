# F200 完整搜索工作流

日期：2026-08-04

## 事实基线

F040 已交付进程内 ripgrep crate 引擎（`grep-matcher`/`grep-regex`/`grep-searcher`，capability-relative 文件句柄上 `search_reader`）、有界 DFS 遍历（50,000 条目/深度 256）、分层 `.gitignore`（单文件 8 MiB 上限）、`search.exclude` globset、二进制 quit(0) 剔除、单文件 8 MiB 默认/64 MiB 硬上限、文本结果 20,000 硬上限、wake+poll+cancel 流式协议与有界批队列背压。F140 已把 `rootId` 身份贯穿文件/文本搜索。真实 `E2E-004`（5,008 文件）已验证流式取消、分层忽略、默认排除与含版本冲突的替换。这些能力不重做。

代码审计确认 F200 前仍有以下真实缺口：

- `search-contribution.ts` 明确未注册任何 command/menu/keybinding（`doNotRegisterOpenCommand: true`）；打开 Search 视图只能点 Activity Bar 图标，无 `Cmd/Ctrl+Shift+F`、无命令面板条目。`docs/e2e-handover.md` 中 E2E-004 步骤文本假定 `Cmd+Shift+F` 可用，与代码事实不符，本轮以代码为准修正记录。
- `PlainSearchView` 只有正则复选框；`isCaseSensitive`/`isWordMatch` 后端已支持但 UI 未接线。
- 替换文本逐字应用：`$1` 捕获组不生效（`plain-replace-coordinator` 测试锁定 verbatim 语义）；Rust 匹配不回传捕获组。
- undo 语义为逐文件独立 undo entry（有意取舍，已记录于 features.json platformGaps），但撤销行为本身零测试。
- 正则不支持构造（lookaround/backreference 等 PCRE2-only）只有一条 `"(unclosed"` 通用语法错误测试，无逐构造测试背书。
- 二进制/超限跳过与 20,000 截断只有 Rust 计数器，Search UI 不展示「跳过 N 个文件」/「结果已截断」，Browser 层无断言。

## 架构裁定

### 1. 入口是显式命令闭集，不引入上游 SearchView

新增 Plain 自有命令：`Search: Find in Files`（`Cmd/Ctrl+Shift+F`，打开并聚焦 Search 视图搜索输入框）与 `Search: Replace in Files`（`Cmd/Ctrl+Shift+H`，同视图并聚焦替换输入框）。命令经现有 Workbench 命令/快捷键注册模式接入并纳入架构守卫闭集。`%` 前缀 TextSearchQuickAccess 维持 F040 的显式排除（上游 provider 依赖排除面，自建收益不抵新增表面），在本文档重申而非默默继承。大小写敏感与全字匹配开关接入视图工具条，直接映射既有 `isCaseSensitive`/`isWordMatch` 请求字段；开关状态为会话内存态，不新增持久化通道。

### 2. 捕获组展开由 Rust 单一正则权威计算

前端绝不用 JS `RegExp` 平行实现替换展开（两套正则方言必然漂移）。新增有界批量命令 `workspace_search_expand_replacements`：输入为 pattern + 既有搜索 flags + 替换模板 + 待展开的 `expectedText` 列表（即 Rust 先前产出的原始匹配文本），Rust 用同一 `grep-regex` 管线对每条 expectedText 锚定重匹配并以 `Captures::expand` 展开模板，返回逐条替换文本；重匹配失败或模板引用越界组按 fail-closed 逐条报错，前端把该文件降级为冲突处理，零写入。仅正则模式启用模板展开；字面量搜索保持逐字替换（与 VS Code 语义一致）。列表长度、单条文本与模板长度均设硬上限。DTO/strict codec/native/mock/架构守卫全链同步。

### 3. undo 语义维持逐文件独立并补齐测试背书

跨文件共享 undo 分组会破坏既有「逐 resource 冲突隔离」合同，不做。语义冻结为：每文件一个 undo entry，撤销该文件的本次替换并保持已保存状态机一致；该语义在 features.json platformGaps 继续如实记载，并新增真实测试：Browser 场景在替换后对已打开编辑器执行 undo，断言内容恢复且未串到其他文件。

### 4. 正则能力边界逐构造测试背书

Rust 定向单测覆盖 `(?=...)`、`(?<=...)`、`\1` 三类 PCRE2-only 构造均返回 `INVALID_SEARCH_REGEX` 且错误文案非空、不含路径；Browser 场景断言 UI 将该错误准确展示。能力声明维持现有文档位置（`text_search.rs` doc、architecture.md、platformGaps），不新增运行时开关。

### 5. 跳过与截断必须可见

搜索完成消息扩展为同时展示「Skipped N files（binary/oversized 合计，鼠标悬停或明细区分）」与「结果已达上限，已截断」两类准确状态；数据全部来自既有 Rust 计数器/标志，前端不自行推断。Browser mock 注入二进制/超限 fixture 与截断标志以断言 UI 文案。

### 6. 真实桌面验收登记暂缓

按用户 2026-08-04 指示，真实 Tauri 桌面矩阵（大文件/二进制跳过提示、Cmd+Shift+F 真实键位、捕获组替换落盘）登记为 `E2E-026` 待执行，与 `E2E-025` 一并攒批；F200 的关闭以自动化两层全绿 + E2E-026 登记完备为准，桌面证据补跑后回填。

## 垂直切片

1. **S1 入口与开关**：Find/Replace in Files 命令与快捷键、视图聚焦语义、case/word 开关接线与守卫闭集；Browser 覆盖（键位打开聚焦、开关改变请求体）。
2. **S2 捕获组替换**：Rust `workspace_search_expand_replacements` + DTO/codec/native/mock、coordinator 接线与冲突降级、字面量/正则模式分流；Rust/前端单测 + Browser 覆盖（$1 展开落盘、越界组 fail-closed、字面量模式 $1 逐字）。
3. **S3 能力背书与可见状态**：PCRE2-only 逐构造 Rust 测试与 UI 错误断言、skipped/truncation UI 状态与 Browser fixture、undo 行为 Browser 测试。
4. **S4 收口**：`E2E-026` 登记（暂缓）、progress/features 收账、完整 `pnpm check` 与全量 Browser 回归。

每个切片先通过自己的最小验证并独立提交，再开始下一项；F200 关闭前不切换 F210。
