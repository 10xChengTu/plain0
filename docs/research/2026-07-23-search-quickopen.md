# F040 Quick Open、全文搜索与替换

日期：2026-07-23

## 目标与边界

`F040` Quick Open, workspace search and replace 的三条 acceptance：文件/内容搜索遵守 ignore 与 include/exclude 规则；结果流式返回且可取消、不阻塞 UI；替换计划在写入前校验文件版本。搜索一律由 Rust 实现（AGENTS.md 原生服务规则）；本侧只做单元/Rust/Browser mock E2E，真实桌面场景登记 `docs/e2e-handover.md`。

## 固定源码调研结论（锚定 Code OSS `5264f`、CodinGame v35.0.1，双路调研交叉复核）

### 现状

- Cmd+P 是「有键位、无 provider」空壳：quickaccess override 随 workbench override 传递引入（命令面板可用），但空前缀 `AnythingQuickAccessProvider` 注册在 **search-service-override 包**的 `search.contribution` 内，该包未安装。
- `ISearchService` 是 missing-services 桩（`textSearch` 恒空、`fileSearch` 只看内存 model）；Search viewlet/Activity Bar 图标不存在；排除面对 search 中立放行。
- `src-tauri` 无 search 域；Cargo 无 regex/ignore/grep 类 crate；现有 `ignore::Walk` 禁令扫描范围不覆盖未来 search 域（护栏盲区，需扩展）。

### 上游协议要点

- Quick Open：`AnythingQuickAccessProvider.getFilePicks` → `ISearchService.fileSearch(IFileQuery)`；客户端硬上限 `MAX_RESULTS=512`、200ms 去抖；`getAbsolutePathFileResult` 支持 `~`/绝对路径直输——与「WebView 不接触原生绝对路径」边界冲突，必须中和。
- `SearchService` 基类按 `folder.scheme` 查表分派给 `registerSearchResultProvider(scheme, type, provider)` 注册的 provider；`activateByEvent('onSearch:')` 在无 Extension Host 下是 no-op。**Plain 可绕开包默认工厂，直接 extends 未打补丁的基类并注册 `plain-workspace:` provider。**
- 流式：`textSearch(query, onProgress, token)` 逐条推 `IFileMatch`；新搜索自动取消旧搜索；命中 `search.maxResults`（默认 20000）提前终止并回 `limitHit: true`（UI 显示截断提示）。
- 替换：`ReplaceService.replace` → `ResourceTextEdit[]` → `IBulkEditService.apply`（bulk-edit override 是已打 patch 的传递依赖）→ working copy model edit → 普通 `save()`——**与手动编辑保存同链路，天然复用 wv1/PLR1/PLW1 版本化保存与 `FILE_MODIFIED_SINCE` 冲突面**，无需新写路径。preview diff 是纯前端 `Schemas.internal` 内存模型。
- 配置面：`search.exclude`（继承 `files.exclude`）、`search.useIgnoreFiles`（默认 true）、`useGlobalIgnoreFiles`/`useParentIgnoreFiles`（默认 false）、`search.followSymlinks`（**默认 true，必须收窄**）、`search.maxResults`。

### 关键排除

- **禁止 spread `search-service-override` 默认根工厂**：其构造函数对 `fileService.getProvider(Schemas.file)` 的结果直接属性访问，Plain 无 `file:` provider 会 `TypeError` 崩溃；其两条兜底（File System Access Worker、纯 JS 逐文件正则）均为前端实现且硬编码 `file:` scheme，违反 Rust 权威。只允许窄子模块导入（比照 dialogs/working-copy 先例）。
- **`ignore::WalkBuilder` 不可用**：构造即要求 ambient 路径并自做 `std::fs` 遍历，违反 capability 纪律。遍历必须手写有界版（复用 directory_copy/delete 的 cap_std DFS 帧栈范式与万条目/256 层预算惯例）。
- **ripgrep sidecar 路线废弃**（修正 docs/architecture.md 第 6 节旧决策）：外部 rg 进程按路径自行 ambient 遍历，无法纳入 capability root handle 权威；改为进程内 `grep-searcher` 对已授权打开的文件 handle 搜索（`cap_std::fs::File::into_std()`），显式 `BinaryDetection::quit(0x00)` 对齐 rg 的二进制探测语义。
- **正则引擎只用 `regex` crate**（线性时间、无 ReDoS）：不支持 `usePCRE2`/lookaround/backreference，语义比上游窄，UI/文档如实标注，不伪装支持。
- `ignore::gitignore::GitignoreBuilder` 可局部复用（`add_line` 纯字符串喂规则、无 I/O）：`.gitignore` 字节由既有 8 MiB capability reader 读出按行喂入，只借语义匹配；include/exclude glob 用 `globset`。

## 技术方案

### 决策 1：前端组合

新增 `@codingame/monaco-vscode-search-service-override@35.0.1` 依赖，窄导入：

1. `SearchService` 基类 → `PlainSearchService extends SearchService`，构造时对 `plain-workspace:` 注册 Rust-backed `ISearchResultProvider`（fileSearch/textSearch/clearCache）；`SyncDescriptor` 绑定 `ISearchService`（MIDDLE_SERVICE_DESCRIPTORS 扩展）。
2. `search.contribution` 副作用导入（Search 视图容器、AnythingQuickAccessProvider、TextSearchQuickAccess）——导入前审计其间接导入链的顶层副作用（S3 的聚合入口教训）；若链上有不可接受副作用，改为逐个更细子模块导入并记录。
3. `ReplaceService` 类导入 + `IReplaceService` 绑定（替换切片）。
4. 绝对路径/`~` 直输面在 Plain 侧中和（探针确认其在 `plain-workspace:` 单 scheme 下的实际行为后选择：自然失效则以测试锁定，否则最小覆盖）。

### 决策 2：Rust search 域与 IPC

- 新建 `src-tauri/src/search/`：Cargo 新增 `grep-searcher`、`grep-regex`（或 `grep-matcher`+`regex`，以实现取舍）、`ignore`（仅 gitignore 语义）、`globset`，全部固定精确版本；Harness 把 `ignore::Walk`/`WalkBuilder` 禁令与 walkdir 类禁令扩展覆盖 search 域，依赖 allowlist 同步。
- 文件搜索 `workspace_search_files`：单次请求-响应（Quick Open 512 上限下无需流式）；请求 `{ roots, filePattern, includeGlobs, excludeGlobs, useIgnoreFiles, maxResults }`；Rust 手写有界 DFS（预算沿用万条目/256 层惯例，另设单次遍历文件数上限）+ gitignore/glob 过滤，返回相对路径列表 + `limitHit`；模糊打分留在前端（上游自带 scorer）。
- 文本搜索流式协议（复用仓库唯一事件流先例「wake 信号 + 显式 pull」）：
  - `workspace_search_start` → `{ searchId }`（UUID v4，窗口绑定）；
  - Rust 后台任务边遍历边匹配，结果分批入有界队列；每批就绪 `emit` 无 payload 的 `SEARCH_WAKE` 信号；
  - 前端按 `searchId + cursor` 调 `workspace_search_poll` 拉批次（严格 DTO：`{ entries: [{path, matches:[{line, column, length, previewText…}]}], done, limitHit }`，preview 截断去敏）；
  - `workspace_search_cancel { searchId }`；新搜索启动前前端先 cancel 旧 id；窗口销毁/root 撤销清理任务与队列；背压=有界队列满时生产端暂停。
- 8 MiB 单文件上限沿用（超限文件跳过并计入 message，不失败整个搜索）；NUL 探测跳过二进制；`followSymlinks` 恒按 Plain 边界（不跟随出 root，nofollow 遍历）。

### 决策 3：替换

- 复用上游 ReplaceService + 已 patch 的 bulk-edit 传递依赖；不新建写路径。验收聚焦交互面：单项/全部替换落盘正确；替换期间外部改写目标文件 → 该文件保存走 `FILE_MODIFIED_SINCE` → Plain 冲突处理器（无 Retry/Overwrite），其余文件不受影响；preview diff 纯内存不落盘。
- 未打开文件的临时 working copy 替换路径必须尊重 8 MiB 读上限与 mutation gate（超限文件替换失败可见、不静默跳过）。

### 决策 4：配置收窄

- `configurationDefaults` 显式：`search.followSymlinks: false`（Plain 边界）、其余沿用上游默认；`search.useGlobalIgnoreFiles`/`useParentIgnoreFiles` 保持 false 且 Rust 不实现全局/父级 ignore（roots 之外不可达，天然不适用——文档化）。
- `usePCRE2` 不支持：Rust 收到该标志时按普通 regex 处理并在 message 里如实说明（或前端隐藏开关，探针后择优）。

### 切片拆分（每片独立提交+验收）

1. **S1 前端骨架**：依赖 + 窄导入 + `PlainSearchService`（provider 先返回空结果）+ Search 视图/Cmd+P 可达且不崩溃；guard 全套更新；Browser 证据（Cmd+P 打开、Search 视图渲染、零 pageerror）。
2. **S2 文件搜索**：Rust 有界遍历 + gitignore/glob + `workspace_search_files` + bridge/mock + Quick Open 真实结果、512 截断、去抖下的旧响应丢弃；ignore 规则矩阵测试（.gitignore、search.exclude、include glob）。
3. **S3 文本搜索流式**：search 域后台任务 + wake/poll/cancel 协议 + `grep-searcher`/`regex` 匹配 + Search 视图流式渲染、取消、`limitHit` 截断提示、二进制/超限跳过 message；并发与生命周期（新搜索取消旧、窗口销毁清理）全矩阵。
4. **S4 替换**：ReplaceService 接线 + preview diff + 版本冲突交互证据 + 未打开文件替换的上限语义。
5. **S5 收口**：配置收窄证据、architecture.md 第 6 节修正（sidecar → 进程内）、E2E 交接条目（真实磁盘大目录搜索性能/取消、真实 .gitignore 生效）、F040 evidence 闭环。

## 验收

每切片：定向单元/Harness → 聚焦 Browser → 全量 Browser → 完整 `pnpm check`；Rust 覆盖遍历预算、ignore 语义、二进制/超限跳过、流式背压、取消与生命周期。桌面证据由 Codex 按交接清单执行。

## 实施偏差记录（S1-S5，如实补记）

冻结方案基本落地，但四处真实实现细节只能靠实际跑通 Chromium/单元测试才会暴露，冻结时的文字未能预见；S5 收口时如实补记，不回头改写 S1-S4 已提交的 `progress.md` 历史条目本身。

1. **S1：官方 `SearchView` 的 notebook 污染 → 自建 `PlainSearchView`。** 决策 1 原打算复用官方 `ViewPaneContainer` 的视图注册路径，`new SyncDescriptor(SearchView)` 直接用上游 `SearchView`。真实 Chromium 全量回归（而非仅新增测试）立即复现排除面命中：`SearchView` 静态导入 `NotebookEditor`（仅用于一处 `instanceof` 判断，从未真正命中），而 `notebookEditor.js` 自身在模块顶层无条件 `CommandsRegistry.registerCommand` 出 `_notebook.selectKernel`、`workbench.extensions.action.showExtensionsForLanguage`、`workbench.extensions.action.showExtensionsWithIds`——分别撞上「notebooks, tasks or testing」与「extensions, gallery or marketplace」两个排除域，触发 `PLAIN_EXCLUDED_SURFACE_GUARD_V1`。改为新增 `app/features/search/plain-search-view.ts`：从零手写、直接 `extends` 官方未打补丁的 `ViewPane`（已审计其自身与 `viewPaneContainer.js` 均无 chat/notebook/extensions 顶层副作用），不使用官方 `SearchView`。
2. **S4：`ReplaceService` 对 `SearchModel` 树的鸭子类型耦合 → 自建协调器。** 决策 3 原计划「复用上游 `ReplaceService` + 已 patch 的 bulk-edit 传递依赖；不新建写路径」。实际审计发现 `ReplaceService.createEdits` 只认上游 `SearchTreeMatch`/`SearchTreeFileMatch`（`isSearchTreeMatch`/`isSearchTreeFileMatch` 是对上游 `SearchModel` 树实例的鸭子类型/品牌检查），而 `PlainSearchView` 用的是 S1/S3 就确定不采用的自建 `IFileMatch`/`ITextSearchMatch` 裸结果，传入会静默产出空 edits；其构造函数还额外拉入 `INotebookEditorModelResolverService`/`CellUri`/`isIMatchInNotebook`（notebook 域）与整个 `ISearchViewModelWorkbenchService`/`SearchModel` 树，远超本切片所需。改为在 `app/features/search/plain-replace-coordinator.ts` 自建薄协调器：直接调用已注册好的 `IBulkEditService.apply()`，再对每个受影响 resource 调用 `ITextFileService.files.get(resource)?.save()`——这正是上游 `ReplaceService.replace()` 剥离 `SearchModel` 外壳后的核心两步，天然复用同一条工作副本保存链。与上游「一次 `apply()` 覆盖全部 target」不同，本协调器按 resource 分组、每个 resource 独立 `apply()`+`save()`，一个文件的失败不再连坐拖垮同批次其他文件，代价是「全部替换」不再产生跨文件共享的单个 undo 分组。
3. **S4：已打开文件的 live-model 结果顶替与 preview 坐标 0-index 修正。** 真实 Chromium 首轮替换验收发现两个只能靠实跑复现的 bug：(a) 上游 `SearchService` 基类的 `textSearch()` 对**当前已在编辑器打开**的文件会调用其自身 `getOpenEditorResults()`（直接对 live model 跑 `model.findMatches()`），静默丢弃 Plain 自己 provider 对该文件的结果——这些替代匹配从未经过 Plain 的 `textSearchFileMatch`，不在 `matchLocations` WeakMap 里，导致「替换已打开文件」原地静默不生效；(b) 该替代匹配自身携带的 `rangeLocations[0].source`（本应可信的绝对坐标）在 `@codingame/monaco-vscode-api`（固定传递依赖）的 `searchHelpers.js`（`editorMatchToTextSearchResult`）里被有意构造成 **0-index**（`startLineNumber - 1` 等），与 Plain 自身 provider 及 Monaco 其余 Range API 的 1-index 约定不一致，原样使用会产生「行列各差一」的错误编辑范围，曾在真实运行中把已打开文件内容错位替换损坏。修复：`renderFileGroup` 渲染期一次性解析每个匹配的坐标来源——优先用 Plain 自己的 `getReplaceMatchLocation`（绝对列），否则回退到 `rangeLocation.source` 并 `+1` 修正为 1-index。
4. **S3/S4：文本搜索坐标从 preview 相对改为 `absoluteColumn`。** 决策 2 原方案文本搜索响应只带 preview 相对 `column`/`length`。S4 落地替换时发现：preview 窗口对超过 256 UTF-16 单元的长行会做窗口锚定裁剪，`column`/`length` 相对 `previewText` 而非整行，直接用它定位替换范围在长行上会产生错误范围。改为 Rust `WorkspaceSearchTextMatch` 新增 `absoluteColumn`（UTF-16、1-index、相对整行的绝对位置，与已有 preview 相对 `column` 并存），`text_search.rs` 的 `matched()` 在计算 preview 窗口的同时另外记录 `start_u16 + 1`；前端用模块级 `WeakMap<ITextSearchMatch, ReplaceMatchLocation>` 把每个匹配对象与该绝对范围绑定，替换绝不使用 preview 相对坐标。此修复顺带修复了 S3 遗留的「跳转到编辑器坐标对超 256 单元长行不准」的已知留白。
5. **S5：更正 S2 对 `files.exclude` 注册状态的不准确表述，并补上文本搜索自身的 exclude 缺口。** (a) S2 的 `progress.md` 条目称「`search.useIgnoreFiles`/`files.exclude` 的配置 schema 在当前 bundle 里完全未注册」；S5 用真实 Chromium 运行时探针核实：`files.exclude` 其实早已通过既有 Explorer service override 的导入链（`files.contribution._explorer.js` → `files.contribution._configuration.js`）注册，且带有真实上游默认值（`.git`/`.svn`/`.hg`/`.DS_Store`/`Thumbs.db`，Web 环境下另加 `*.crswap`）——这些默认自 F020 起就已经通过 `excludePattern` 对 Quick Open 文件搜索生效。真正未注册的只是 `search.contribution.js` 独有的 `search.exclude`/`search.useIgnoreFiles`/`search.followSymlinks` 三个键。此处如实更正说明范围，不回头编辑 S2 的历史 `progress.md` 条目本身。(b) 补齐 `search.exclude` 真实 schema 默认（`{"**/node_modules": true, "**/bower_components": true, "**/*.code-search": true}`，见决策 4 与 `app/features/search/search-contribution.ts`）后，新增的 Browser 证据最初仍失败：`PlainSearchView.runSearch()`（Search 视图文本搜索）手写构造 `ITextQuery` 时只设置 `folderQueries`/`contentPattern`，从未读取任何配置或设置 `excludePattern`——Quick Open（走 `collectExcludeGlobs` 读 `query.excludePattern`）遵守新默认，但 Search 视图文本搜索完全不受影响（对 `node_modules` 内容的文本搜索仍能命中）。已在 `plain-search-view.ts` 的 `runSearch()` 中补上等价的 `getExcludes()` 合并逻辑（读取 `files.exclude`/`search.exclude` 并集，`search.exclude` 覆盖同名 key，匹配上游 `mixin(..., true)` 语义），使文本搜索与文件搜索的排除行为一致。
6. **F140：S2 的裸相对路径响应不适用于后来已经落地的 multi-root workspace。** 冻结方案与 F040 首版把 file entry/text batch 都建模为仅有 `path`，前端统一拿 `roots[0]` 构造 URI；当两个已授权根都存在 `shared.txt` 时，两条真实结果会坍缩到首根，Quick Open 可能打开错误文件，Search Replace 也可能写错根。F140 把文件 entry 和文本 batch 都改为严格 `{rootId, path}`，Rust 在遍历每个 lease 时绑定其 `RootId`，TypeScript codec 验证 UUID/精确字段并冻结，provider 再以本次 query root Set 做成员校验。重复路径现在保留为两个不同 authority 的资源，query 外 root 即使由自定义 bridge 注入也会以 `ROOT_NOT_AUTHORIZED` fail closed。

## 排除项

- 不做 AI search、notebook search、search editor（`*.code-search`）、全局/父级 ignore、PCRE2、搜索历史持久化（内存即可）、rg sidecar、Extension Host search provider。
- Search viewlet 的 UI 细节（折叠/排序偏好持久化）沿上游默认，不定制。
