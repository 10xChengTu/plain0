# Browser 双根缺失父目录新建失败调研与方案

日期：2026-07-20

## 目标与边界

本工作项只补 `F020` 的 Browser 可见失败证据：在真实 Chromium、真实 Workbench、官方 NotificationService、Plain FileService patch、Plain provider、TypeScript bridge 与现有双根 Tauri IPC mock 的组合链路中，分别从 primary root 新建文件、从 secondary root 新建目录；两个目标都含一个不存在的父目录，最终必须单次失败、显示去敏错误且不递归创建父目录。

这正对应已冻结 multi-root 方案中的 `missing-parent create`。它不覆盖 save、rename、copy、move、delete、watcher 外部变化或真实磁盘；尤其不把尚未开始的 move retained/partial 和 delete retained/partial/unknown 状态机并入普通的发布前 create 失败。

## GitHub 固定源码调研

Plain 当前产品运行时固定为 Code OSS commit `5264f2156cbcd7aea5fd004d29eaa10209155d66`。以下事实都固定到该 commit，不依赖浮动的 `main`：

- 上游 [`createFile`/`writeFile`](https://github.com/microsoft/vscode/blob/5264f2156cbcd7aea5fd004d29eaa10209155d66/src/vs/platform/files/common/fileService.ts#L359-L431) 在目标不存在时先递归 `mkdirp(dirname(target))`，因此 `parent/new.txt` 会自动创建 `parent`。
- 上游 [`createFolder`](https://github.com/microsoft/vscode/blob/5264f2156cbcd7aea5fd004d29eaa10209155d66/src/vs/platform/files/common/fileService.ts#L970-L1025) 对完整目标执行递归 `mkdirp`；固定集成测试还明确把一次创建多层目录作为成功语义。[Code OSS disk FileService test](https://github.com/microsoft/vscode/blob/5264f2156cbcd7aea5fd004d29eaa10209155d66/src/vs/platform/files/test/node/diskFileService.integrationTest.ts#L195-L215)
- Explorer 的固定 [New File/New Folder action](https://github.com/microsoft/vscode/blob/5264f2156cbcd7aea5fd004d29eaa10209155d66/src/vs/workbench/contrib/files/browser/fileActions.ts#L893-L982) 会把输入与当前目录 join 后交给 bulk edit；内部路径分隔符是受支持的交互。失败由同一 action 显示 Error notification，并提供用户显式触发的 `Retry`。
- `FileNotFound` 会映射为 `FILE_NOT_FOUND`，WorkingCopy/BulkEdit 不把失败改写为成功。[provider error mapping](https://github.com/microsoft/vscode/blob/5264f2156cbcd7aea5fd004d29eaa10209155d66/src/vs/platform/files/common/files.ts#L896-L920)、[WorkingCopyFileService](https://github.com/microsoft/vscode/blob/5264f2156cbcd7aea5fd004d29eaa10209155d66/src/vs/workbench/services/workingCopy/common/workingCopyFileService.ts#L346-L446)

可复用的是 Explorer 的真实输入、bulk edit 和可见错误 surface；不能继承的是递归 `mkdirp`、目标 `exists` 预检、通用 write fallback 或失败后自动重试。Plain 继续保留上游手动 `Retry` action，但测试不点击它，并以唯一原生调用证明没有自动 replay。

相邻方案也不改变这一选择。Zed 固定实现会在 rename 的任意 `NotFound` 后创建 target parent 并重试，[这与 Plain 的 no-auto-mkdir/no-retry 合同冲突](https://github.com/zed-industries/zed/blob/ba1990441dc71e852216311ec7c4e873de710117/crates/project/src/worktree_store.rs#L654-L705)；Tauri 官方 plugin-fs 的直接 [`copy_file`](https://github.com/tauri-apps/plugins-workspace/blob/fs-v2.5.1/plugins/fs/src/commands.rs#L378-L410) / [`rename`](https://github.com/tauri-apps/plugins-workspace/blob/fs-v2.5.1/plugins/fs/src/commands.rs#L805-L839) 依赖 ambient path、非结构化底层错误和不同的覆盖语义，也不能替代 Plain 的 opaque root 与 capability-relative Rust command。现有整包方案因此都不适合直接接入。

### CodinGame 通知组合补充调研

首次实现探针发现，Explorer 已经精确调用 `workspace_create_file` 并收到失败，但 DOM 没有 notification toast，错误只由 Monaco 的 [`StandaloneNotificationService`](https://github.com/microsoft/vscode/blob/5264f2156cbcd7aea5fd004d29eaa10209155d66/src/vs/editor/standalone/browser/standaloneServices.ts#L316-L354) 写到 `console.error`，其 `prompt()` 还直接返回 `NO_OP`。这不是应当放宽测试的差异，而是当前 Plain Workbench 组合缺失官方通知 override：

- `@codingame/monaco-vscode-notifications-service-override@35.0.1` 的 npm 元数据固定到 Git commit `d8367168c23c9d0a9ba5bc84b8034e5435e9eb93`，且只有一个直接依赖：同版本 `@codingame/monaco-vscode-api`。
- 同一固定提交中的 [`CustomWorkbench`](https://github.com/CodinGame/monaco-vscode-api/blob/d8367168c23c9d0a9ba5bc84b8034e5435e9eb93/src/service-override/workbench.ts) 明确把 `createNotificationsHandlers` 覆盖为空，并注明通知组件由 notification service override 创建；单独接入 workbench override 因此不会得到真实 toast。
- 官方 [`notifications.ts`](https://github.com/CodinGame/monaco-vscode-api/blob/d8367168c23c9d0a9ba5bc84b8034e5435e9eb93/src/service-override/notifications.ts) 只把 `INotificationService` 绑定到延迟实例化的 `NotificationService`，并在 Workbench render 生命周期创建 `NotificationsCenter`、`NotificationsToasts`、`NotificationsAlerts`、`NotificationsStatus` 及固定命令。它没有注册扩展，也不导入 Extension Host、AI、Chat、Auth、Sync、Gallery、Remote、Task、Testing、Notebook、Telemetry、Speech 或 MCP service override。
- 官方 35.0.1 demo 同样以默认 import 和一次零参数 spread 选择该服务，[没有要求额外 notification contribution 或扩展宿主](https://github.com/CodinGame/monaco-vscode-api/blob/v35.0.1/demo/src/setup.common.ts#L420-L430)。

因此选定方案增加一个前置组合修复：把同版本 notifications override 作为显式 direct dependency，在 `app/services.ts` 的固定 allowlist 中直接 import/call，并由 Harness 锁定唯一模块、唯一零参 spread 与顺序。它不是通用扩展能力，也不改变 native 权限；最终 build 后仍必须运行现有 architecture/bundle guard，不能只凭包级依赖审计宣称禁用域不可达。

### 已处理失败的 Progress observer 补充方案

接入官方 NotificationService 后的第二次 Browser 探针已经显示真实 toast 和 `Retry`，但每个被 Explorer 捕获的 create rejection 仍产生三个 `pageerror`。Trace 把三者精确对应到固定 Code OSS `ProgressService` 为同一个原始 task 创建的 detached observer：notification model 的 [ignored `promise.finally`](https://github.com/microsoft/vscode/blob/5264f2156cbcd7aea5fd004d29eaa10209155d66/src/vs/workbench/services/progress/browser/progressService.ts#L204-L230)、notification cleanup 的 [ignored async IIFE](https://github.com/microsoft/vscode/blob/5264f2156cbcd7aea5fd004d29eaa10209155d66/src/vs/workbench/services/progress/browser/progressService.ts#L413-L438)，以及 Activity Bar cleanup 的 [ignored `promise.finally`](https://github.com/microsoft/vscode/blob/5264f2156cbcd7aea5fd004d29eaa10209155d66/src/vs/workbench/services/progress/browser/progressService.ts#L472-L496)。`finally()` 会返回一个保留原 rejection 的新 promise；忽略这个新分支会产生 unhandled rejection，即使 Explorer 已经在原 task 上显示了可见错误。

完整 Code OSS Workbench 用全局 `unhandledrejection` listener 统一记录并 `preventDefault`；CodinGame 的固定 [`CustomWorkbench.registerErrorHandler`](https://github.com/CodinGame/monaco-vscode-api/blob/d8367168c23c9d0a9ba5bc84b8034e5435e9eb93/src/service-override/workbench.ts#L31-L37) 则明确不接管宿主的全局错误事件，所以该组合差异会把三个 detached observer 暴露成 Browser `pageerror`。Plain 不安装按消息匹配的全局吞错 listener，也不在测试中过滤 pageerror：固定 `view-common-service-override@35.0.1` patch 只把上述三个 observer 改为 resolve/reject 两端执行相同 cleanup；原始 task promise、rejection identity、Explorer catch/toast、取消和 progress timing 都保持不变。

固定上游 `BulkEditService.apply` 在 rethrow 前会显式执行 `logService.error(err)`；这一条诊断不是 standalone notification fallback，也不是 unhandled rejection。Plain 保留每个失败操作恰好一条该日志，并在 E2E 中精确验证两条日志都只含固定去敏错误而不含 rootId 或 `ENTRY_NOT_FOUND`；禁止为了“控制台全绿”删除上游诊断。

## 当前仓库事实

- `src-tauri/src/workspace/writer.rs` 的 file/directory create 都只执行单级 no-clobber 创建；`writer/tests.rs` 已锁定缺失父目录返回 `ENTRY_NOT_FOUND` 且零副作用。
- `app/features/workspace/file-system-provider.ts` 把确定的 `ENTRY_NOT_FOUND` 映射为 `FileNotFound`、`rescan: false`；不发 `ADDED`，也不把已知发布前失败伪装成 root 状态未知。
- 固定 files-service patch 的 Plain create 分支只调用私有 `plainCreateFile`/`plainCreateDirectory`；两个 `mkdirp` 入口都有 tripwire，且失败前不做 target stat、write 或 generic fallback。
- `tests/unit/workbench-workspace-mutation-patch.test.mjs` 已证明 file/directory missing-parent 不产生 stat/write/mkdir 或 operation event；`tests/unit/workspace-file-system-provider.test.ts` 已证明 provider 的精确错误映射和零 file-change event。
- `installMultiRootNativeIpcMock(page, "supported")` 已有两个独立 root、all-five-true policy、`resolveParent` 和两个 create handler。对不存在的中间目录，mock 会在修改 Map 前抛 `ENTRY_NOT_FOUND`；无需第二套 fixture，也无需外部删除或 watcher 专用 seam。
- 当前 `app/services.ts` 显式选择 workbench override，却没有选择 notifications override；运行时因而保留 `StandaloneNotificationService`。首次失败探针已经证明 command/错误路径存在，也证明现状没有用户可见的 Workbench failure surface；该探针不是验收结果，临时 trace 已清理。

## 选定 Browser 场景

新增一个独立测试，严格串行执行两个 phase：

| phase | Explorer 动作                   | 输入                            | 预期唯一原生命令                                                                                  |
| ----- | ------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------- |
| 1     | 选中 primary root，New File     | `missing-file-parent/new.txt`   | `workspace_create_file { rootId: primary, relativePath: "missing-file-parent/new.txt" }`          |
| 2     | 选中 secondary root，New Folder | `missing-folder-parent/new-dir` | `workspace_create_directory { rootId: secondary, relativePath: "missing-folder-parent/new-dir" }` |

每个 phase 都等待对应原生命令完成，再检查一个 Error notification：文案必须包含固定 Plain FileService 的 `Unable to create the Plain workspace entry`，显示一个手动 `Retry`，不得包含 rootId、`ENTRY_NOT_FOUND`、绝对路径、用户名或 mock 原始消息。测试只清除 notification，不点击 Retry；下一 phase 和最终调用日志共同证明没有自动重试。

实现时先接入官方 notification override，并修正三个 detached progress observer；如果真实 `NotificationService` 仍不能显示上述 DOM toast，必须继续诊断组合生命周期，不能退回 console 断言、测试专用 notification shim 或静默失败。

## 精确证据

- `workspace_capabilities` 仍只调用一次；mutation call 顺序和数量精确为 `workspace_create_file`、`workspace_create_directory`，请求各自只有 `rootId` 与 `relativePath`。
- 两个调用之后都不存在目标 leaf，也不存在 `missing-file-parent`/`missing-folder-parent`；primary/secondary root 及各自原有 fixture 项仍在 Explorer。
- 不出现 `workspace_write_file`、rename、copy、move、delete 或额外 create；针对两个 missing target 不出现 `workspace_stat`、`workspace_read_file` 或 `workspace_read_dir` 预检。
- 失败不打开 `new.txt` editor，不选中虚构目标，不发布可见成功项。已知 `ENTRY_NOT_FOUND` 的 `rescan: false` 是当前合同，本项不制造 synthetic watcher refresh。
- 官方 NotificationService 在 Workbench render 后只挂载一套通知 UI；每个 phase 只有一个 Workbench Error notification，清除后最终 toast 为零。全程无 DOM/native confirmation dialog 或 `pageerror`；console error 精确为每个 phase 一条固定 BulkEdit diagnostic，不出现 standalone notification fallback、Vite unhandled-rejection log 或其他错误。
- 原始 IPC 只含 opaque UUID v4 rootId 和 workspace-relative path；Browser fixture 的失败只能证明 Workbench/patch/provider/bridge 组合，不替代 Rust capability 或真实磁盘证据。

## 排除项

- 不新增外部删除 seam；带 `/` 的 Explorer 输入已经能确定性制造缺失父目录，并直接证明 Plain 没有复制上游递归 mkdirp。
- 不点击 `Retry`，也不测试父目录随后恢复；那会把本项变成用户发起的第二次操作。
- 不覆盖 source missing、target exists、parent type mismatch、permission、query/fragment 或 overwrite；这些已有 unit/Harness 合同。
- 不覆盖 rename/copy/move 的 missing-parent Paste 文案。固定 Explorer 会把所有 Paste 失败包装成“source 已删除或移动”，该文案并不准确；若未来补 Browser 证据，应作为独立工作项裁决，不能顺带冻结为 Plain 产品合同。
- 不覆盖 move retained/partial/unknown、delete retained/partial/unknown、save conflict、watcher、DnD 或真实 Tauri；它们分别需要结构化终态、保守 root refresh、确认状态机或原生磁盘证据。

## 验收

```bash
pnpm check
pnpm exec playwright test tests/browser/workspace.spec.ts -g "shows missing-parent create failures for both workspace roots" --repeat-each=5 --retries=0
pnpm exec playwright test --retries=0
```

## 退出条件

本补充调研提交纠正通知 surface 和 detached Progress observer 的组合前提，并冻结同版本官方 override、三处分支级 patch、Harness allowlist、错误通道和禁用域边界。文档与 `progress.md` 通过格式/feature guard 并提交后，才在一个独立实现工作项中接入通知服务并完成 Browser fixture/test；只有实现提交通过聚焦重复、全量 Browser 和 `pnpm check`，本工作项才完成。
