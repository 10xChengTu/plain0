# Browser 双根可写与跨根复制/移动调研及方案

日期：2026-07-20

## 目标与证据边界

本工作项补齐 `F020` 的下一条 Browser 证据：在真实 Chromium、真实 Workbench 和真实 Plain TypeScript bridge 中，把两个不同 Rust root snapshot 投影为两棵 Explorer root，并证明：

- 两个 root 中各有一个已打开文件可以经版本化保存写回自己的 root；
- Explorer 的 Copy/Paste 会把文件跨 root 复制，源文件保留；
- Explorer 的 Cut/Paste 会把文件跨 root 移动，源文件消失；
- bridge 发出的 `workspace_write_file`、`workspace_copy` 和 `workspace_move` 参数保持 opaque rootId 与相对路径合同；
- 整个场景没有原生 dialog、Workbench 错误通知、`pageerror` 或 `console.error`。

这仍是确定性 Tauri IPC mock 证据。它验证 WebView 内的 Workbench、FileService patch、Plain provider、codec、native bridge 和 topology projection 的组合行为，但不证明 Rust capability I/O、canonical filesystem root、系统 folder picker、WKWebView、FSEvents 或真实磁盘结果。真实双根 Tauri 验收继续是后续独立工作项。

## GitHub 固定源码调研

Plain 当前 `monaco-vscode-api@35.0.1` 对应 Code OSS commit `5264f2156cbcd7aea5fd004d29eaa10209155d66`。以下结论固定在该 commit，不依赖浮动的 `main`：

- `FileService.move` 与 `FileService.copy` 都进入 `doMoveCopy`，成功后分别发送 MOVE/COPY operation event；provider 与 FileService 路由是 Browser 场景应实际穿过的主链。来源：[Code OSS file service](https://github.com/microsoft/vscode/blob/5264f2156cbcd7aea5fd004d29eaa10209155d66/src/vs/platform/files/common/fileService.ts#L789-L873)。
- Explorer 的 Copy、Cut、Paste 分别由 `copyFileHandler`、`cutFileHandler`、`pasteFileHandler` 承接。Paste 会把选中的目录或所选文件的父目录作为目标，先计算合法目标；Copy 构造 `{ copy: true }` 的 `ResourceFileEdit`，Cut 构造 move edit，然后交给 Explorer bulk edit。成功后会清理 cut state，并选中或打开目标。来源：[Code OSS Explorer file actions](https://github.com/microsoft/vscode/blob/5264f2156cbcd7aea5fd004d29eaa10209155d66/src/vs/workbench/contrib/files/browser/fileActions.ts#L1055-L1305)。
- Explorer drag-and-drop 最终也会进入 copy/move bulk edit，但它依赖平台修饰键、拖拽 hover/target 计算和浏览器原生 DnD 时序。来源：[Code OSS Explorer drag-and-drop](https://github.com/microsoft/vscode/blob/5264f2156cbcd7aea5fd004d29eaa10209155d66/src/vs/workbench/contrib/files/browser/views/explorerViewer.ts#L1571-L1985)。本项不使用 DnD 作为首条跨根证据。

当前 Plain provider 已与固定上游语义相接：`copy` 唯一调用 `workspaceCopy(sourceRootId, sourcePath, targetRootId, targetPath)`；`rename` 在不同 rootId 时唯一调用 `workspaceMove(...)`。单根 all-true Browser 场景已验证版本化保存和同根 Copy/Paste，但不能证明跨 root authority 与路径映射。

## 方案选择

### 复用现有双根 IPC mock

扩展 `installMultiRootNativeIpcMock`，增加显式 `readonly | supported` 模式，默认继续为 `readonly`。这样已提交的 remove-root 生命周期场景保持原有全 false capability，不会因为新测试而扩大其行为面；新场景显式选择 `supported` 并返回五项全 true capability。

不复制第二套双根 topology/watcher fixture，也不改生产代码或新增测试专用生产 API。Harness 只允许测试 fixture 承担以下确定性能力：

- 每个文件保存独立的可变 bytes 和 `wv1:<64 hex>` version；
- `workspace_read_file` 返回带精确 version 的有界 PLR1 frame；
- `workspace_write_file` 只接受一个原始 PLW1 frame，核对 root、relative path 和 expected version 后更新 bytes/version，并返回同次写入 receipt；
- `workspace_copy` 只接受 exact 四字段、两个已授权 root、普通文件 source 和不存在的 target，复制 bytes 并生成新 target version；
- `workspace_move` 施加相同的 exact/no-overwrite 约束，只允许不同 root，先发布 target、再删除 source，返回 exact `{ status: "moved" }`；
- `supported` 宣告的 create、rename-no-replace 与 delete commands 也保留确定性 handler，避免 fixture 声称 all-true 却用 unknown-command 冒充平台实现；新场景本身不把未调用的 handler 算作 Browser 证据。

fixture 的 `ENTRY_*`/`ROOT_NOT_AUTHORIZED` 仅是测试自身的确定性不变量，不能作为 Rust 安全证据。前端主动 mutation 不触发 mock watcher wake：FileService 已发送对应事件，额外 wake 只会引入与本项无关的重复刷新时序。

### 场景与路径

使用两个固定 UUID v4 root，并让名称、源位置和目标位置互不混淆：

| 动作        | source                      | target                               | 预期原生命令                             |
| ----------- | --------------------------- | ------------------------------------ | ---------------------------------------- |
| 保存主 root | `primary/README.md`         | 原路径                               | `workspace_write_file`，primary rootId   |
| 保存次 root | `secondary/notes.txt`       | 原路径                               | `workspace_write_file`，secondary rootId |
| 跨根复制    | `primary/copy-source.txt`   | `secondary/packages/copy-source.txt` | `workspace_copy`                         |
| 跨根移动    | `secondary/move-source.txt` | `primary/src/move-source.txt`        | `workspace_move`                         |

场景先经 Open Folder 从 EMPTY 选中 primary，再经 Add Folder 投影 secondary。两次保存都通过真实 Monaco editor 修改并使用 `ControlOrMeta+S`；跨根操作通过 Explorer 已有的 `ControlOrMeta+C` / `ControlOrMeta+X` / `ControlOrMeta+V` command route 完成。该键盘路径已被现有单根 Browser 场景使用，且固定源码显示它与菜单动作共享上述 handlers；不读取或断言操作系统剪贴板内容。

目标目录展开后使用 Explorer 层级形成 UI 证据：复制后同名文件应同时存在于 level 2 source 和 level 3 target；移动后只允许 level 3 target 存在。最终再读取原始 Tauri call log，核对两次 write 的不同 rootId、相对路径、`wv1` expectedVersion 与内容 bytes，以及 copy/move 的 exact 四字段对象。

## 验收矩阵

| 层级                 | 必须证明                                                                                             | 明确不声称                                                 |
| -------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Workbench UI         | 两棵 root、两个文件分别编辑并清除 dirty、copy source/target 同时可见、move source 消失且 target 可见 | DnD、overwrite prompt、目录或 symlink copy/move            |
| FileService/provider | 保存走版本 receipt；跨根 copy 走 `copy`；跨根 rename 走 `workspaceMove`                              | retained/partial/unknown move 的可见失败 UI                |
| TypeScript bridge    | 原始 PLW1 被解码；copy/move request 保持四字段与 opaque rootId                                       | Rust command implementation 或 capability-relative syscall |
| Browser fixture      | no-overwrite、source/target 树和 deterministic version mutation                                      | canonical path、真实 inode/metadata、磁盘原子性            |
| 负面可见性           | 无 dialog、toast、pageerror、console error                                                           | 无限期 timer、WKWebView/FSEvents                           |

最小验证顺序：

1. Prettier、TypeScript 类型检查和 lint；
2. 新增 Browser 场景聚焦重复运行，排除一次性时序成功；
3. 完整 `tests/browser/workspace.spec.ts`；
4. 完整 `pnpm check` 作为提交前回归。

## 排除与后续拆分

- 不用 drag-and-drop 作为首条证据；它增加浏览器手势时序，却不增加 IPC 合同覆盖。
- 不在本项制造 missing-parent、overwrite、retained、partial 或 response-unknown；这些终态需要各自的 UI 断言和 mock state machine，属于后续失败矩阵提交。
- 不把本项合并进已提交的 remove-root 场景；可写主链与撤权/watcher 主链应能独立失败、验证和回滚。
- 不在本项覆盖每个 root 的即时 wake 与丢 wake timer；这仍是下一独立 watcher 场景。
- 不更新 `features.json` 的 F020 complete/evidence；只有 Browser 失败矩阵和真实双根 Tauri 验收都完成后才能闭环 F020。

## 退出条件

本调研提交只冻结实现与验收边界。文档、`progress.md` 与固定 GitHub 链接通过格式检查并提交后，才进入 Browser fixture/test 实现；功能完成必须另有通过验证的实现提交。
