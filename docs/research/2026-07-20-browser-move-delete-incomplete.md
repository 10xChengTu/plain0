# F020 Browser move / delete incomplete 可见失败矩阵

日期：2026-07-20

## 目标与边界

本方案只补 `F020` 已有 Rust/bridge/provider 不完整终态的 Browser consumer 证据：

1. 跨 root move 的 `targetPublishedSourceRetained` 与 `targetPublishedSourcePartiallyDeleted`；
2. confirmed delete 的 `entryRetained` 与 `entryPartiallyDeleted`。

验收必须穿过真实 Chromium、Workbench Explorer、BulkEdit/WorkingCopy/FileService、Plain provider、TypeScript bridge 和确定性 Tauri IPC mock。它不重新验证 Rust producer 的 nofollow receipt、mutation journal 或 syscall 计数，也不把 transport/DTO unknown、普通发布前失败、save conflict、DnD 或真实磁盘混入这两个矩阵。

实现仍按最小可回滚工作项拆分：本调研/方案先独立提交；Move 可见失败与 Delete 可见失败再分别实现、验收和提交。

## GitHub 固定源码调研

Plain 产品运行时固定在 Code OSS commit `5264f2156cbcd7aea5fd004d29eaa10209155d66` 与 CodinGame `v35.0.1`，因此以下结论不依赖浮动 `main`。

### Move / Cut / Paste

- Explorer Cut 只设置 `pasteShouldMove=true` 和 cut 装饰；Paste 把资源包装为 rename `ResourceFileEdit`。[Code OSS Cut](https://github.com/microsoft/vscode/blob/5264f2156cbcd7aea5fd004d29eaa10209155d66/src/vs/workbench/contrib/files/browser/fileActions.ts#L1054-L1070)、[Paste](https://github.com/microsoft/vscode/blob/5264f2156cbcd7aea5fd004d29eaa10209155d66/src/vs/workbench/contrib/files/browser/fileActions.ts#L1123-L1233)
- Paste 失败只显示一次 `notificationService.error(...)`，随后在 `finally` 无条件清空 Cut/clipboard；它没有 Retry。[Code OSS paste failure](https://github.com/microsoft/vscode/blob/5264f2156cbcd7aea5fd004d29eaa10209155d66/src/vs/workbench/contrib/files/browser/fileActions.ts#L1269-L1287) 带 Retry 的是独立 create helper，不能移植到可能已经发布目标的 move。[Code OSS create Retry](https://github.com/microsoft/vscode/blob/5264f2156cbcd7aea5fd004d29eaa10209155d66/src/vs/workbench/contrib/files/browser/fileActions.ts#L893-L899)
- `RenameOperation` 只有成功后才生成 Undo；整个 BulkEdit 也只有全部成功才 push Undo。[Code OSS RenameOperation](https://github.com/microsoft/vscode/blob/5264f2156cbcd7aea5fd004d29eaa10209155d66/src/vs/workbench/contrib/bulkEdit/browser/bulkFileEdits.ts#L44-L80)、[BulkEdit apply](https://github.com/microsoft/vscode/blob/5264f2156cbcd7aea5fd004d29eaa10209155d66/src/vs/workbench/contrib/bulkEdit/browser/bulkFileEdits.ts#L342-L407)
- Explorer 的两层 progress 和 WorkingCopy move 都原样传播 rejection；BulkEditService 在 rethrow 前记录一次错误。[ExplorerService](https://github.com/microsoft/vscode/blob/5264f2156cbcd7aea5fd004d29eaa10209155d66/src/vs/workbench/contrib/files/browser/explorerService.ts#L188-L218)、[WorkingCopyFileService](https://github.com/microsoft/vscode/blob/5264f2156cbcd7aea5fd004d29eaa10209155d66/src/vs/workbench/services/workingCopy/common/workingCopyFileService.ts#L390-L446)、[BulkEditService](https://github.com/microsoft/vscode/blob/5264f2156cbcd7aea5fd004d29eaa10209155d66/src/vs/workbench/contrib/bulkEdit/browser/bulkEditService.ts#L258-L278)
- CodinGame `v35.0.1` 只组合固定 Explorer、BulkEdit、Files 和 Notifications 服务，不改写上述行为。[Explorer override](https://github.com/CodinGame/monaco-vscode-api/blob/v35.0.1/src/service-override/explorer.ts#L1-L15)、[BulkEdit override](https://github.com/CodinGame/monaco-vscode-api/blob/v35.0.1/src/service-override/bulkEdit.ts#L1-L11)、[Notifications override](https://github.com/CodinGame/monaco-vscode-api/blob/v35.0.1/src/service-override/notifications.ts#L15-L54)

上游错误文案假设“复制后源已被删除或移动”，但 Plain retained 的源可能完整保留，partial 也只删除一部分，因此不能把这句上游猜测冻结成 Plain 合同。Plain 要让已认证 retained/partial 直接显示 provider 的去敏 published-target 文案，同时保留单 toast、无 Retry、清空 Cut 和无 Undo 的上游行为。

### Confirmed delete

- 上游永久删除失败会再次弹出带 Retry 的确认框，并以 `ignoreIfNotExists=true` 重跑完整删除。[Code OSS delete failure](https://github.com/microsoft/vscode/blob/5264f2156cbcd7aea5fd004d29eaa10209155d66/src/vs/workbench/contrib/files/browser/fileActions.ts#L213-L253) 这对 Plain retained/partial 不安全。
- Plain 固定 API patch 在 `distinctParents` 之后、上游 try/catch 之前直接 `return runPlainWorkspaceDeleteCoordinator(...)`，因此所有 Plain permanent delete 都明确绕开上游 Retry/Trash fallback。这个边界必须保持，不能为了可见错误重新落回上游分支。
- 右键菜单 ActionRunner 会把 action rejection 显示为 Error notification；键盘命令则显示 Warning notification。[Code OSS ContextMenu ActionRunner](https://github.com/microsoft/vscode/blob/5264f2156cbcd7aea5fd004d29eaa10209155d66/src/vs/platform/contextview/browser/contextMenuHandler.ts#L152-L164)、[Keybinding service](https://github.com/microsoft/vscode/blob/5264f2156cbcd7aea5fd004d29eaa10209155d66/src/vs/platform/keybinding/common/abstractKeybindingService.ts#L363-L370)

原方案假设两个 Delete phase 走真实 Explorer 右键 `Delete Permanently`，由 ActionRunner 把 rejection 显示为 Error toast。实施探针推翻了这一点：固定 `ContextMenuHandler` 在 `onWillRun` 时同步 `hideContextView(false)`，随即销毁承载 `actionRunner.onDidRun` 监听器的 `menuDisposables`，早于确认框之后才 settle 的 rejection，因此右键路径永远不会为该场景显示通知。修正后的单一确定 surface 是与既有单根验收一致的键盘 `⌘Backspace`：`abstractKeybindingService` 以持久的 `.then(undefined, err => notificationService.warn(err))` 把 branded incomplete rejection 显示为一个 Warning toast。每 phase 仍先显示一次 Plain DOM 永久删除确认；失败后不出现第二个 `.monaco-dialog-box`，toast 也没有 Retry、Overwrite 或再次删除动作。

### 诊断日志

固定 `BulkEditService` 会在 rethrow 前记录一次结构化错误；`NotificationsAlerts` 只在通知是 Error 级时才把它再镜像进控制台并发出 ARIA alert，Warning 级不镜像。[NotificationsAlerts](https://github.com/microsoft/vscode/blob/5264f2156cbcd7aea5fd004d29eaa10209155d66/src/vs/workbench/browser/parts/notifications/notificationsAlerts.ts#L23-L56) 因此可见 toast 为 Error 级的 phase（Move）预期恰好两条去敏 `console.error`；可见 toast 为 Warning 级的 phase（Delete 键盘路径）只剩 BulkEditService 那一条。两个矩阵都不强行追求控制台零日志；`pageerror` 仍必须为零。

## 当前仓库事实

### Move

- Rust wire DTO 已严格区分 `moved`、`targetPublishedSourceRetained` 和带 `removedEntries` 的 `targetPublishedSourcePartiallyDeleted`；零次成功 source remove 是 retained，一次以上是 partial。正式目标发布后绝不自动回滚。
- `workspace-codec.ts` 保留两种终态与 reason/count 闭集；provider 对已认证 retained/partial 先按 source、target 顺序发两个 root `UPDATED`，再抛冻结的 `WORKSPACE_MOVE_INCOMPLETE`。Explorer patch 会把 Plain root update 提升为完整 refresh。
- provider catch 对 transport reject、畸形 DTO 或其他未认证 failure 也会刷新两个 root；实施前它错误地复用 `WORKSPACE_MOVE_INCOMPLETE` 的“目标已发布”文案。现已拆成独立去敏 `WORKSPACE_MOVE_OUTCOME_UNKNOWN`，不再把没有 publication 证据的 unknown 伪装成某个 wire 终态。

Move 可见层因此需要一个窄的固定 patch：Paste catch 只对上述两个 Plain 冻结错误直接显示其安全 message；其他 scheme/普通失败继续使用上游文案。两种 Plain toast 都不得有 Retry。retained/partial Browser 本项只验 `WORKSPACE_MOVE_INCOMPLETE`；unknown 的 provider/文案合同用单元与 Harness 锁定，Browser unknown 另立工作项。

### Delete

- provider 对 retained/partial 先把严格结果写入 authorization state、发当前 entry root `UPDATED`，再抛标准 `Unavailable`；只有 `deleted` 才发 entry `DELETED`。
- coordinator 在 begin 后的 catch 对原始选择涉及的全部 roots 再做一次 dedupe root refresh，把 retained/partial 包装为带 WeakMap 私有详情的 `WorkspaceDeleteIncompleteError`；finally 仍 best-effort cancel。余项不执行、无自动 replay、无 Bulk Undo。
- fixed API patch 的提前 return 让该 branded error 到达菜单 ActionRunner，现有错误 message `The permanent delete batch stopped after a native delete became incomplete.` 已去敏且不暴露 retained/partial、reason、count、root 或 path。无需新增 notification service、二次 modal 或产品测试 seam。

## Browser 矩阵

### Move retained / partial

| phase    | 固定操作                                               | IPC/fixture 终态                                                                                                                   | 两根 refresh 后的 Explorer                                         |
| -------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| retained | secondary `move-source.txt` Cut → primary `src/` Paste | 先发布完整 target，source remove syscall 失败且 source 不删；`targetPublishedSourceRetained/deleteFailed`                          | source 与 target 都存在且内容相同                                  |
| partial  | secondary `move-partial/` Cut → primary `src/` Paste   | 先发布含 `removed.txt`/`kept.txt` 的完整 target，只删 source `removed.txt`；`targetPublishedSourcePartiallyDeleted/deleteFailed/1` | target 两项完整；source 目录与 `kept.txt` 保留，`removed.txt` 消失 |

每 phase 恰好一次 `workspace_move`，第二 phase 后总数为 2；不出现 rename/copy/delete 或第二次 move。每次只有一个 Error toast，精确包含 `The workspace move published its target but could not remove all of its source.`，不含上游 stale-source 猜测，且 `Retry` 为 0。Cut 装饰/clipboard 在失败后清空，不选择或打开虚构成功目标，不产生成功 MOVE event 或 Undo。

### Move 实施结果

- provider 现用两个独立、冻结的 `FileOperationError`：只有已认证 retained/partial 使用 `WORKSPACE_MOVE_INCOMPLETE`；transport、codec 与其他需要双根 rescan 的未认证结果使用 `WORKSPACE_MOVE_OUTCOME_UNKNOWN`，安全文案只要求检查已刷新的 source/target，不声称 target 已发布。
- 固定 API Paste patch 只接受精确 name/message 且 `Object.isFrozen(error)` 的上述两个错误，直接显示安全 message；任意普通 Error、伪 name、伪 message 或非冻结对象仍进入上游 fallback。失败后的 Cut 清理保持在原有 `finally`，没有新增 Retry。补丁 SHA-256 为 `184ceed92b82bccb869ca91bc322e6c01740d8eb85cd9ddde47484e8959858f6`。
- Browser fixture 使用本地 `TestMultiRootMoveIncompleteScenario` 两项闭集。retained 先发布 target 后不删除 source；partial 先发布完整 target，再以 `node.entries.delete("removed.txt")` 的真实 boolean 结果产生 `removedEntries=1`，并保留 source `kept.txt`。Harness 同时禁止 raw receipt 参数、任意 callback 和 window mutation seam。
- 定向 provider/补丁/Harness 单测 178/178、聚焦 Browser 单次及重复 5/5、完整 Workspace Browser 12/12、全部 Browser 13/13 均通过；完整 `pnpm check` 为前端 595/595、Rust 255/255、bundle 2112 source/203 debt。两阶段均验证 exact IPC、双根 refresh、单 toast、无 Retry、Cut 清空、零 `pageerror`/native dialog，以及 retained/partial 的实际树终态。

### Delete retained / partial

| phase    | 固定操作                                          | IPC/fixture 终态                                               | root refresh 后的 Explorer                 |
| -------- | ------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------ |
| retained | primary `delete-retained.txt` → 选中 `⌘Backspace` | 首次 remove syscall 失败且树不变；`entryRetained/deleteFailed` | entry 完整保留                             |
| partial  | secondary `delete-partial/` → 选中 `⌘Backspace`   | 只删 `removed.txt`；`entryPartiallyDeleted/deleteFailed/1`     | 目录和 `kept.txt` 保留，`removed.txt` 消失 |

每 phase 先出现唯一 Plain DOM 永久且不可撤销确认；确认后的 mutation 顺序严格为 `prepare → begin → commit → cancel`，confirmationId/entryId/root/path/recursive 必须闭合。incomplete 终态分支把 fixture 的 `activeDelete` 置为 `undefined` 使批次失效，coordinator 的 finally 仍发出恰好一次 best-effort cancel。**订正**：E2E 并不断言这次 cancel 的错误码——mock 只记录请求、不记录 reject 结果，coordinator 又用空 catch 吞掉 cancel 失败，所以任何 Browser 断言都无法区分 cancel 成败。该 cancel 会被 fixture 既有的 `activeDelete` 校验拒绝，其拒绝语义由 mock 源码与 `boundary-contracts` 单元层锁定，不是本 E2E 的观测范围；Browser 层只锁「cancel 请求恰好出现一次、且之后不再有第二轮 prepare/begin/commit」。

每次最终只有一个 Warning toast，精确包含 `The permanent delete batch stopped after a native delete became incomplete.`，且没有 Retry。retained 至少观察 primary root post-commit `read_dir("")`，且这次观察发生在测试触碰树之前。partial 同样先于任何进一步交互观察到 secondary root `read_dir("")`；但 `read_dir("delete-partial")` **不**是同一类自动证据——探针证实已展开的子目录不会随 root 刷新自动重读，只有测试自身重新展开该目录才触发这次读取，所以这条断言被移到 `expandDirectory` 之后，如实标注为「重新展开触发」而非「自动刷新命中」。Explorer 可能合并 provider/coordinator 的重复 refresh，所以只锁受影响 root 至少一次读取，不锁 exact read 次数。

### Delete 实施结果

- fixture 以第四个 `deleteIncompleteScenarios` 闭集扩展同一 `installMultiRootNativeIpcMock`：primary 根按需追加 `delete-retained.txt`，secondary 根按需追加含 `removed.txt`/`kept.txt` 的 `delete-partial`；`workspace_commit_delete_entry` 在既有校验与正常删除语句之间按 FIFO 消费 retained（零树变更）与 partial（真实 `entries.delete("removed.txt")` 布尔结果推导 `removedEntries`）终态，并使批次失效，触发 coordinator 恰好一次的 best-effort cancel（该 cancel 被 fixture 已失效的 `activeDelete` 拒绝；拒绝语义由 mock 源码与单元层锁定，E2E 只断言 cancel 请求出现恰好一次、之后无第二轮 prepare/begin/commit，不断言其错误码）。
- 触发 surface 按上文修正为键盘 `⌘Backspace`，两 phase 各恰好一条 `prepare → begin → commit → cancel` 链、一个无 Retry 的去敏 Warning toast、一条 BulkEditService 结构化 `console.error`；树终态、受影响 root `read_dir` 刷新、零 native dialog/`pageerror`/第二确认框均已断言。
- Harness 更新 `validateWorkspaceMoveFailureBrowserFixture` 适配四参签名，新增 `validateWorkspaceDeleteFailureBrowserFixture` 锁定场景闭集、树种子、请求校验、retained/partial 分支顺序与禁止 window 控制面；配套 hostile mutation 单测就位。
- 独立对抗复核发现原 `forbiddenWindowControls` 只锁字面 `window`/`testWindow` receiver，不追踪别名（`const winAlias = window as unknown as ...`）也不锁 peek/target/tree-seed 引用范围，可被 plan 别名 + window 别名钩子绕过。修复：新增 `validateWorkspaceBrowserFixtureWindowAuthority` 把 callback 内每个可达全局对象的标识符（`window`/`globalThis`/`self`/`top`/`frames`/`document`/`eval`/`Function`）锁死为唯一一次、且必须落在被审计的 `testWindow` 声明语句内，`testWindow` 本身的所有引用也锁进固定语句 allowlist；两个既有验证器新增 peek 语句精确文本锁与 `deleteIncompletePlan`/`moveIncompletePlan`/commit-case `target`/`primaryEntries`/`secondaryEntries` 的引用范围锁（只允许出现在审计过的声明、peek、terminal 分支等语句区间内）。
- 验收：聚焦与合并 `shows retained and partial` 重复 5 次通过，全部 Browser E2E 14/14，完整 `pnpm check`（30 前端测试文件、600 用例、2277 模块、2112 bundle source、203 债务、Rust 255/255）通过。

### 公共负向证据

- Move 各 phase 恰好两条有序 console error：BulkEdit structured log 后跟 NotificationsAlerts 的可见 Error message，总数为 4。Delete 实施探针修正了原「同样两条」的假设：`NotificationsAlerts` 只把 Error 级通知镜像到控制台，而 Delete 的键盘路径显示 Warning toast，因此每 phase 只有一条 BulkEditService 结构化 `console.error`（记录的是 coordinator 包装前的 provider 通用 `Unavailable (FileSystemError)` 拒绝，不含 `WORKSPACE_DELETE_INCOMPLETE`），总数为 2。首次聚焦实现探针先核对真实稳定片段，再冻结，不锁 sourcemap 行号。
- `pageerror=[]`、native JavaScript dialog `=[]`；结束时 toast 为 0、确认 `.monaco-dialog-box` 为 0。
- toast 与 NotificationsAlerts 的直接安全 message 不得出现 wire status、reason、`removedEntries`、root UUID、`ENTRY_*`、本机用户或绝对路径；BulkEdit 的结构化开发诊断还会携带 Vite source-map 本机源码栈，因此只锁其错误 code/message 及不含 native DTO/root 身份，不把开发服务器栈误判为产品数据泄漏。
- retained 与 partial 必须以实际树差异证明，不能只返回不同 DTO；partial count 必须来自 fixture 实际成功删除数。

## 确定性 fixture 方案

只扩展 `tests/browser/workspace.spec.ts` 内的 `installMultiRootNativeIpcMock`，不改 `app/`、bridge contract 或生产 `browser-mock.ts`。第三参数是可结构化克隆的固定 FIFO 场景闭集，而不是任意 callback、原始 result DTO 或页面可写全局：

```ts
type TestMultiRootMoveIncompleteScenario = "moveRetained" | "movePartial";
```

Move 实施提交先保持两项专用闭集；Delete 工作项再以独立专用闭集扩展同一 fixture，避免未实现场景提前进入当前控制面。fixture 只在计划非空时增加对应节点。每个 scenario 必须匹配固定 root/path、按 FIFO 单次消费；错序、重复、耗尽或剩余计划都让测试 fixture 自身失败。move 仍先真实 clone/rebind target；delete 仍真实维护 active batch。禁止把 queue mutator 暴露到 `window`，也禁止让测试直接指定 status/reason/count。

Harness 需要锁定场景闭集、FIFO 消费、请求匹配、target publication 在 incomplete 返回之前、retained 零 source delete、partial 由实际删除计数生成，并禁止相关测试符号进入 `app/**`。既有 provider/Harness 继续证明双 root/root refresh、零成功事件、no-retry 和 authorization typestate。

## 排除项

- Move unknown 只在本项修正 provider 错误类型和安全文案，不加入 retained/partial Browser fixture；它不能预设 target 是否发布。
- Delete unknown 的可见文案是 `The permanent delete batch did not complete.`，同样另立 Browser phase。
- 不测试发布前 ordinary failure、Retry 点击、用户再次手动操作、批量多选、dirty editor、DnD、真实 Rust capability/磁盘、FSEvents 或 WKWebView。
- 不增加第二次失败 modal、自动 rollback、目标删除、source 恢复、Undo 或自动重试。

## 验收

每个实现提交先跑自己的定向 Harness/单元与聚焦 Browser；两个矩阵完成后统一执行：

```bash
pnpm check
pnpm exec playwright test tests/browser/workspace.spec.ts -g "shows retained and partial" --repeat-each=5 --retries=0
pnpm exec playwright test --retries=0
```

最终 build 仍必须通过 architecture/bundle guard；预计只改已有 source 与测试，source count、203 项迁移债务分类和 SHA 不应变化。

## 退出条件

本调研文档和 `progress.md` 已独立提交；Move 与 Delete 的 retained/partial 均已完成完整验收，当前最小工作项切到真实 multi-root Tauri 验收。该验收完成前，`F020` 保持 `in_progress`。
