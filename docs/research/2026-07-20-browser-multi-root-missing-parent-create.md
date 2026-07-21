# Browser 双根缺失父目录新建失败调研与方案

日期：2026-07-20

## 目标与边界

本工作项只补 `F020` 的 Browser 可见失败证据：在真实 Chromium、真实 Workbench、Plain FileService patch、Plain provider、TypeScript bridge 与现有双根 Tauri IPC mock 的组合链路中，分别从 primary root 新建文件、从 secondary root 新建目录；两个目标都含一个不存在的父目录，最终必须单次失败、显示去敏错误且不递归创建父目录。

这正对应已冻结 multi-root 方案中的 `missing-parent create`。它不覆盖 save、rename、copy、move、delete、watcher 外部变化或真实磁盘；尤其不把尚未开始的 move retained/partial 和 delete retained/partial/unknown 状态机并入普通的发布前 create 失败。

## GitHub 固定源码调研

Plain 当前产品运行时固定为 Code OSS commit `5264f2156cbcd7aea5fd004d29eaa10209155d66`。以下事实都固定到该 commit，不依赖浮动的 `main`：

- 上游 [`createFile`/`writeFile`](https://github.com/microsoft/vscode/blob/5264f2156cbcd7aea5fd004d29eaa10209155d66/src/vs/platform/files/common/fileService.ts#L359-L431) 在目标不存在时先递归 `mkdirp(dirname(target))`，因此 `parent/new.txt` 会自动创建 `parent`。
- 上游 [`createFolder`](https://github.com/microsoft/vscode/blob/5264f2156cbcd7aea5fd004d29eaa10209155d66/src/vs/platform/files/common/fileService.ts#L970-L1025) 对完整目标执行递归 `mkdirp`；固定集成测试还明确把一次创建多层目录作为成功语义。[Code OSS disk FileService test](https://github.com/microsoft/vscode/blob/5264f2156cbcd7aea5fd004d29eaa10209155d66/src/vs/platform/files/test/node/diskFileService.integrationTest.ts#L195-L215)
- Explorer 的固定 [New File/New Folder action](https://github.com/microsoft/vscode/blob/5264f2156cbcd7aea5fd004d29eaa10209155d66/src/vs/workbench/contrib/files/browser/fileActions.ts#L893-L982) 会把输入与当前目录 join 后交给 bulk edit；内部路径分隔符是受支持的交互。失败由同一 action 显示 Error notification，并提供用户显式触发的 `Retry`。
- `FileNotFound` 会映射为 `FILE_NOT_FOUND`，WorkingCopy/BulkEdit 不把失败改写为成功。[provider error mapping](https://github.com/microsoft/vscode/blob/5264f2156cbcd7aea5fd004d29eaa10209155d66/src/vs/platform/files/common/files.ts#L896-L920)、[WorkingCopyFileService](https://github.com/microsoft/vscode/blob/5264f2156cbcd7aea5fd004d29eaa10209155d66/src/vs/workbench/services/workingCopy/common/workingCopyFileService.ts#L346-L446)

可复用的是 Explorer 的真实输入、bulk edit 和可见错误 surface；不能继承的是递归 `mkdirp`、目标 `exists` 预检、通用 write fallback 或失败后自动重试。Plain 继续保留上游手动 `Retry` action，但测试不点击它，并以唯一原生调用证明没有自动 replay。

相邻方案也不改变这一选择。Zed 固定实现会在 rename 的任意 `NotFound` 后创建 target parent 并重试，[这与 Plain 的 no-auto-mkdir/no-retry 合同冲突](https://github.com/zed-industries/zed/blob/ba1990441dc71e852216311ec7c4e873de710117/crates/project/src/worktree_store.rs#L654-L705)；Tauri 官方 plugin-fs 的直接 [`copy_file`](https://github.com/tauri-apps/plugins-workspace/blob/fs-v2.5.1/plugins/fs/src/commands.rs#L378-L410) / [`rename`](https://github.com/tauri-apps/plugins-workspace/blob/fs-v2.5.1/plugins/fs/src/commands.rs#L805-L839) 依赖 ambient path、非结构化底层错误和不同的覆盖语义，也不能替代 Plain 的 opaque root 与 capability-relative Rust command。现有整包方案因此都不适合直接接入。

## 当前仓库事实

- `src-tauri/src/workspace/writer.rs` 的 file/directory create 都只执行单级 no-clobber 创建；`writer/tests.rs` 已锁定缺失父目录返回 `ENTRY_NOT_FOUND` 且零副作用。
- `app/features/workspace/file-system-provider.ts` 把确定的 `ENTRY_NOT_FOUND` 映射为 `FileNotFound`、`rescan: false`；不发 `ADDED`，也不把已知发布前失败伪装成 root 状态未知。
- 固定 files-service patch 的 Plain create 分支只调用私有 `plainCreateFile`/`plainCreateDirectory`；两个 `mkdirp` 入口都有 tripwire，且失败前不做 target stat、write 或 generic fallback。
- `tests/unit/workbench-workspace-mutation-patch.test.mjs` 已证明 file/directory missing-parent 不产生 stat/write/mkdir 或 operation event；`tests/unit/workspace-file-system-provider.test.ts` 已证明 provider 的精确错误映射和零 file-change event。
- `installMultiRootNativeIpcMock(page, "supported")` 已有两个独立 root、all-five-true policy、`resolveParent` 和两个 create handler。对不存在的中间目录，mock 会在修改 Map 前抛 `ENTRY_NOT_FOUND`；无需第二套 fixture，也无需外部删除或 watcher 专用 seam。

## 选定 Browser 场景

新增一个独立测试，严格串行执行两个 phase：

| phase | Explorer 动作                   | 输入                            | 预期唯一原生命令                                                                                  |
| ----- | ------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------- |
| 1     | 选中 primary root，New File     | `missing-file-parent/new.txt`   | `workspace_create_file { rootId: primary, relativePath: "missing-file-parent/new.txt" }`          |
| 2     | 选中 secondary root，New Folder | `missing-folder-parent/new-dir` | `workspace_create_directory { rootId: secondary, relativePath: "missing-folder-parent/new-dir" }` |

每个 phase 都等待对应原生命令完成，再检查一个 Error notification：文案必须包含固定 Plain FileService 的 `Unable to create the Plain workspace entry`，显示一个手动 `Retry`，不得包含 rootId、`ENTRY_NOT_FOUND`、绝对路径、用户名或 mock 原始消息。测试只清除 notification，不点击 Retry；下一 phase 和最终调用日志共同证明没有自动重试。

## 精确证据

- `workspace_capabilities` 仍只调用一次；mutation call 顺序和数量精确为 `workspace_create_file`、`workspace_create_directory`，请求各自只有 `rootId` 与 `relativePath`。
- 两个调用之后都不存在目标 leaf，也不存在 `missing-file-parent`/`missing-folder-parent`；primary/secondary root 及各自原有 fixture 项仍在 Explorer。
- 不出现 `workspace_write_file`、rename、copy、move、delete 或额外 create；针对两个 missing target 不出现 `workspace_stat`、`workspace_read_file` 或 `workspace_read_dir` 预检。
- 失败不打开 `new.txt` editor，不选中虚构目标，不发布可见成功项。已知 `ENTRY_NOT_FOUND` 的 `rescan: false` 是当前合同，本项不制造 synthetic watcher refresh。
- 每个 phase 只有一个 Workbench Error notification；清除后最终 toast 为零。全程无 DOM/native confirmation dialog、`pageerror` 或 `console.error`。
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

本调研提交只冻结 GitHub 结论、现有实现事实、两个 create phase 和排除边界。文档与 `progress.md` 通过格式/feature guard 并提交后，才进入 Browser fixture/test 实现；只有另一个实现提交通过聚焦重复、全量 Browser 和 `pnpm check`，本工作项才完成。
