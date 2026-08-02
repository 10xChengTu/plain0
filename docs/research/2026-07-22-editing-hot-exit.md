# F030 编辑主链：preview/固定、外部冲突与热退出恢复

日期：2026-07-22

## 目标与边界

`F030` Editing, preview and hot-exit recovery 在既有 F020 地基（版本化读 `wv1`/`PLR1`、版本化原子写 `PLW1`、FileService 版本化保存 consumer、Plain 保存错误处理器、粗粒度 watcher）之上补齐编辑主链的四个面：

1. preview/固定 tab 行为的可验证证据；
2. 打开文件被外部删除/变化时的明确产品语义；
3. 真实 working copy 注册（全局脏计数、关闭确认）与保存冲突证据；
4. 热退出恢复：脏内容在窗口重启后存活，存储由 Rust 权威管理。

按 2026-07-22 分工：本侧只做单元/Rust/Browser mock E2E 证据；真实桌面场景（杀进程恢复、关窗握手）登记 `docs/e2e-handover.md` 交接 Codex。

## 固定源码调研结论（锚定 Code OSS `5264f`、CodinGame v35.0.1）

调研与仓库审计已交叉复核，关键事实：

### Preview / pinned

- `editorGroupModel` 每组单 preview 槽，非 pinned 打开顶替旧 preview；tab 双击（`multiEditorTabsControl` 1109-1134）或编辑内容触发 pin；`enablePreview=false` 时整体退化为 pinned（`editorGroupView` 859）。
- Plain 已有 workbench override 内部 spread `view-common`，连锁 side-effect 引入真实 `EditorParts`/`EditorService`/`TextFileEditor`/`BinaryFileEditor`/`FileEditorInput` 工厂——preview 行为具备生效条件，`workbench.editor.enablePreview` 默认 `true` 且 Plain 未覆盖。
- 排除 `@codingame/monaco-vscode-editor-service-override`：它是 standalone 嵌入用的假 `EmptyEditorGroupsService`，与真 Workbench 模式互斥，禁止引入。

### 外部冲突链

- `TextFileEditorModel.onDidFilesChange` 的 orphan 判定只认精确本资源 `DELETED`（100ms 后 `stat()` 复核）与 `ADDED` 清除；`UPDATED` 不参与。`FileChangesEvent.contains` 对 `DELETED` 用 `findSubstr` 向上匹配父目录——目录级 `DELETED` 会命中其下所有打开文件；这印证 watcher 只发 root `UPDATED`、绝不伪造 root `DELETED` 的既有决策。
- 因此现状：**已打开文件被外部删除时 Plain 无自动反应**，只有手动 revert/reload 时 `stat()` 抛 `FileNotFound` 才被动置 orphan。
- 保存冲突不依赖 watcher：files patch 已把 `plainVersion` 映射到 etag，不匹配抛 `FILE_MODIFIED_SINCE`，进入 Plain 自有错误处理器（Reload / Save As / Details，F020 已明确排除 Retry/Overwrite）。该链缺的是测试证据，不是实现。
- 既有行为面必须显式锁定：根级粗 `UPDATED` 会被上游按祖先语义解释为影响该 root 下所有打开文件（clean 模型可能静默重载）。

### Working copy 与 hot exit

- 当前 `missing-services.js` 为 `IWorkingCopyService`/`IWorkingCopyBackupService`/`IWorkingCopyFileService`/`IWorkingCopyEditorService` 注册**桩**：编辑/保存可用（经验事实：Browser E2E 14/14），但全局脏计数恒 0、关闭确认/备份/恢复链全部不通、`BrowserTextFileService.registerListeners` 的 shutdown veto 因无人 fire `onBeforeShutdown` 而形同虚设。
- `@codingame/monaco-vscode-working-copy-service-override@35.0.1`（依赖仅 api + files override）提供真 `IWorkingCopyService` 等；`storage` 选项：`'memory'` 纯内存、`'userData'` 落 `vscode-userdata:` scheme（Plain 该 scheme 默认是 `InMemoryFileSystemProvider`，reload 即丢；`createIndexedDBProviders()` 可落 IndexedDB 但脱离 Rust 权威与生命周期管理，排除）、`null` 不注册 backup service 留坑自填。
- 上游恢复链：`WorkingCopyBackupTracker.restoreBackups` 在 `LifecyclePhase.Restored` 后经 `IWorkingCopyEditorService` handler 把 backup 批量开为 pinned 编辑器；`FileEditorWorkingCopyEditorHandler` 的 `handles()` 不挑 scheme，`plain-workspace:` 可直接被恢复。
- browser 版 tracker 依赖 `beforeunload` 单点；Tauri 关窗是 Rust `WindowEvent::CloseRequested`，WebView `beforeunload` 触发时机因引擎而异，不可依赖。
- `files.hotExit` web 分支只有 `off/onExitAndWindowClose`，默认后者；`workspace.transient` 强制关闭 hot exit。
- Rust 侧无任何现成持久化域；可复用范式：staged 原子写（stage+校验+`renameat` 发布）、per-window mutation gate、`WindowEvent::Destroyed` 清理、`Dir::open_ambient_dir` capability 打开。Tauri app data 路径目前完全未使用。
- 同类项目排除：Zed（SQLite 自管状态，架构不同且恢复链有已知一致性 bug）、Lapce（buffer 另存重放，无冲突 UX 层），只保留「脏内容独立持久化、启动重放」思路。

## 技术方案

### 决策 1：外部删除/变化语义（先拍板后写码）

- 打开文件的外部删除：原方案假设上游会对每个打开文件调用 `watch(resource)`，实施探针推翻了这一点——本 Workbench 组合下 `watch()` 只在 root 级发生（recursive），上游依赖 root watch 的细粒度原生事件，而 Plain 的 Rust watcher 有意丢弃它们。修正后的登记点是 `plainReadFile()`（文件内容被解析打开的精确时刻），以每 root 上限 256 条的 LRU 集合近似「最近打开」；每次该 root 的 watcher wake 后对集合做**有界** `workspace_stat` 复核（单飞 + dirty 合并，state 身份校验隔离撤销后的迟到结果），确认消失的 fire 精确单资源 `DELETED`，此前 missing 的重新出现 fire `ADDED`（上游据此清 orphan），其他 stat 错误 fail-safe 不伪造删除。已记录的近似代价：跟踪的是「最近读取」而非「当前打开」，超 256 条时最旧被逐出、其外部删除退化为 S2 前行为；已撤销 root 的 state 条目无主动删除（watcher 撤销后无触发源，纯有界惰性驻留）。不引入 per-file native watcher，不改 Rust 协议。
- 根级粗 `UPDATED` 的祖先命中语义：接受为既定行为并以测试锁定（clean 打开文件在无关外部变化后允许重载刷新；dirty 文件不得丢失编辑内容——上游模型对 dirty 不做静默 revert）。
- 保存冲突 UX 维持 F020 合同（Reload/Save As/Details，无 Retry/Overwrite）。

### 决策 2：working copy 激活（S3 实现期间修正）

- 原方案假设 `...getWorkingCopyServiceOverride({ storage: null })` 整体 spread 即可只取 `IWorkingCopyService`/`IWorkingCopyEditorService`，backup service 坑位留白。实现探针推翻了这一点：该包的聚合入口 `index.js` 无条件导入 `browser/workingCopyBackupService.js` 与 `common/workingCopyHistoryService.js`，两者在模块顶层分别对 `registerWorkbenchContribution2(BrowserWorkingCopyBackupTracker, WorkbenchPhase.BlockStartup)` 与 `Registry.as(Extensions.Workbench).registerWorkbenchContribution(WorkingCopyHistoryTracker, LifecyclePhase.Restored)` 发起真实注册，且完全不受 `storage` 参数影响。`WorkingCopyHistoryTracker` 在每次真实保存时都会调用 `IWorkingCopyHistoryService.addEntry()`，其内部经 `IFileService.cloneFile()` 给 `plain-workspace:` 资源做本地历史快照，而 Plain 自有 files-service 补丁对任一端为 Plain 资源的 clone 操作总是拒绝，实测直接导致每次保存产生未捕获 rejection、破坏两个既有 E2E（`edits both roots...`、`routes all-five...`）。
- 修正方案：不导入该包的聚合入口，而是仿照既有 `DialogService` 手选模式，直接从 `@codingame/monaco-vscode-working-copy-service-override/vscode/vs/workbench/services/workingCopy/common/{workingCopyService,workingCopyEditorService}` 两个无副作用的类子路径导入 `WorkingCopyService`/`WorkingCopyEditorService`，在 `app/services.ts` 手写两条 `SyncDescriptor` 绑定；`IWorkingCopyBackupService`/`IWorkingCopyHistoryService` 完全不触碰，继续沿用 `missing-services.js` 的安全空桩（真实 backup 服务留给 S4/S5）。
- 连锁修正：探针同时发现 `IFilesConfigurationService` 的 `DEFAULT_AUTO_SAVE_MODE` 在 `isWeb` 下默认是 `AutoSaveConfiguration.AFTER_DELAY`（`DEFAULT_AUTO_SAVE_DELAY=1000ms`），而非本文档先前假设的桌面默认 `off`；这会让 `FileEditorInput.isSaving()` 因 `hasShortAutoSaveDelay()` 恒真而永远为真，掩盖 tab 级 `.dirty` CSS 类（`multiEditorTabsControl.doRedrawTabDirty` 的 `!editor.isSaving()` 门禁)。已在 `app/main.ts` 的 `configurationDefaults` 显式补 `"files.autoSave": "off"`，同时落实文档一直声明但从未真正生效的“默认关闭自动保存”。
- 依赖 allowlist、bundle 基线、排除面 guard、`app/main.ts` 配置默认值合同同步更新；禁止 `editor-service-override`、禁止 `createIndexedDBProviders`、禁止直接导入该包聚合入口（新增 harness 检查）。

### 决策 3：Plain backup 域（Rust 权威）

> 2026-08-03 F160 修订：下述 S4/S5 的“整组 roots 稳定身份目录”只描述 F030 当时实现，现已由 `docs/architecture.md` 与 ADR 0004 的稳定单 root 分区合同取代。原因是整组目录在多根下既无法把旧随机 authority 精确映射到成员 root，也会在增删 root 后让未变化 root 的脏内容暂时不可达；F160 的新协议让每条 entry 携带当前 rootId，由 Rust 内部稳定单 root identity 决定存储与重映射，绝不再做单根猜测。

- 新建 `src-tauri/src/backup/`：窗口绑定的 backup store，落在 Tauri `app_local_data_dir()/backups/<identity>/` 下，目录经 `Dir::open_ambient_dir` 打开为 capability 后全部 handle-relative 操作；写入复用 staged 原子写范式；批量枚举/读取/丢弃各配严格 DTO；窗口销毁清理挂起句柄（内容保留，供重启恢复）。
- **目录身份（S4 实施后修正）**：S4 首版以会话内随机 `workspaceId` 作目录键，但该 id 不跨应用重启，无法支撑「重启后恢复」这一 F030 acceptance。S5 修正为 Rust 内部派生的**稳定 workspace 身份**：对已授权 roots 的 canonical 路径集合排序后做 SHA-256（十六进制小写作目录名）。canonical 路径与哈希只在 Rust 内部使用、不进 WebView；同一组 roots 重开得到同一身份，topology 变化（增删根）产生新身份、旧身份下的 backup 自然不可达（与上游 workspace identity 变更语义一致）；EMPTY workspace 无身份，backup 命令维持 `BACKUP_UNAVAILABLE`。
- 命令闭集（预计）：`backup_write`、`backup_read_all`（启动一次性枚举+读取）、`backup_discard`、`backup_discard_all`；大小上限沿用 8 MiB/条，超限拒绝并可见失败。
- 前端 `PlainWorkingCopyBackupService` 实现 `IWorkingCopyBackupService` 接口，经既有 bridge 风格路由到上述命令；以 `SyncDescriptor` 替换 DI 坑位（与 `PlainWorkspacesService` 同法）。browser mock 提供确定性内存实现供 E2E。
- tracker：继承 common `WorkingCopyBackupTracker` 自定义 Plain tracker（不用 packaged browser tracker 的 `beforeunload` 单点）。S5 当时的实现确实让 `onFinalBeforeShutdown` 恒不 veto，并把真实关窗握手留作后续；恢复链则额外订阅 `onDidRegisterHandler` 与 `onDidChangeWorkspaceFolders`，在 Plain 启动后才授权 workspace 的架构下重拉 `getBackups()`、合并进 `unrestoredBackups` 并调用基类 `restoreBackups()`，全程只用 `protected` 成员与公开事件，未 patch 上游。**2026-08-02 F160 S1 后续修订**：这一关窗缺口现已关闭。Rust `CloseCoordinator` 统一拦截窗口 close/应用 quit，`PlainLifecycleService` 运行 Workbench veto → final backup → storage → will-shutdown 后回一次性 allow；tracker 的 final veto 会取消旧节流任务、按 content version 最多重拍 4 次，写失败/持续变化回 veto。Browser 已用可注入 native close/quit 证明最新 backup_write 严格先于 allow，并证明失败后窗口保持可重试；真实桌面证据转入 E2E-018。

### 切片拆分（每片独立提交+验收）

1. **S1 preview/固定证据**：无生产改动（或仅配置显式化）；Browser E2E 覆盖单击 preview 顶替、双击/编辑 pin、`enablePreview` 语义；复核 excluded-surface 不裁剪 tab UI。
2. **S2 外部删除精确 DELETED**：provider watch 集合 + 有界 stat 复核 + 单资源 DELETED；单元 + Browser E2E（外部删除已打开文件 → tab orphan 装饰；外部恢复 → 清除）；同时锁定粗 UPDATED 祖先语义的现状测试。
3. **S3 working-copy 激活**：新依赖 + `storage:null` 组合 + guard 更新；真实脏计数/DirtyFilesIndicator/关闭确认路径的 Browser 证据；保存冲突（etag 不匹配）E2E 证据。
4. **S4 Rust backup 域**：命令闭集 + capability/原子写/生命周期 + 全套 Rust 测试；TypeScript bridge + browser mock。
5. **S5 PlainWorkingCopyBackupService + tracker + 恢复链**：DI 接线、启动恢复、丢弃时机（保存成功/显式 revert 后 discard）；Browser E2E：编辑不保存 → 重载页面（mock 持久层保留）→ 恢复为 dirty 编辑器。
6. **桌面项登记**：杀进程重启恢复、真实 `CloseRequested` 握手、真实磁盘 backup 目录审计 → `docs/e2e-handover.md` 新条目。

## 验收

每切片：定向单元/Harness → 聚焦 Browser → 全量 Browser → 完整 `pnpm check`。F030 汇总验收沿用 `progress.md` 当前验收命令；桌面证据由 Codex 按交接清单执行后回写。

## 排除项

- 不引入 `editor-service-override`、IndexedDB 持久层、per-file native watcher、Trash/undo 语义扩展。
- Markdown/图片预览等富预览面不属于 F030（`BinaryFileEditor` 降级已随上游链存在，仅作现状测试，不新建 webview）。
- 自动保存（`files.autoSave`）默认关闭，不在本项启用。
