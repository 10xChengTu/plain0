# F020 Workspace 与文件树技术方案

状态：执行中

更新时间：2026-07-18

## 目标与范围

F020 建立从原生目录选择到 Workbench Explorer 的完整文件树能力：每个窗口持有独立 workspace，每个 root 只有 opaque id，WebView 只提交 `(rootId, relativePath)`。本阶段包含目录读取、文件树 CRUD、watcher 收敛，以及安全激活可写 provider 所必需的版本化原子写入传输。F030 仍负责编辑器 preview/pin/split、冲突选择界面、热退出与恢复；F020 不实现这些编辑状态和交互。

为了避免 Explorer 出现“节点可见但点击必然失败”的半成品，F020 先提供有界 `readFile`，并在写能力激活前补齐基础编辑所需的版本化安全保存；F030 再负责 preview/pin/split、冲突选择界面、热退出与恢复等编辑状态交互。

## 固定架构

```mermaid
flowchart LR
    Explorer["Workbench Explorer"] --> Provider["plain-workspace IFileSystemProvider"]
    Provider --> Bridge["typed Tauri bridge"]
    Bridge --> Commands["workspace commands"]
    Commands --> Service["per-window WorkspaceService"]
    Service --> Root["cap_std Dir capability"]
```

- `@codingame/monaco-vscode-files-service-override@35.0.1` 注册 `plain-workspace:` provider；`@codingame/monaco-vscode-explorer-service-override@35.0.1` 只贡献文件树相关 service、命令和视图。
- provider 必须在 Workbench `initialize()` 前注册。原生 picker 完成后用 configuration override 的 `reinitializeWorkspace` 切换单目录 workspace，不刷新窗口、不创建 Extension Host。
- 当前只投影一个 folder workspace。多 root 已在 Rust capability 层成立；等新增/移除根的 Workbench UI 与回滚合同完整后，再投影 multi-root workspace，避免提前暴露不可用的 Save/Remove Workspace 动作。
- Rust I/O 只能使用已授权的 `cap_std::fs::Dir`。canonical path 只允许用于 root 身份和 watcher 元数据，不能成为 stat/read/CRUD 的操作参数。

## 只读 IPC 合同

所有请求均为 `deny_unknown_fields` 的 owned DTO：

- `workspace_stat({ rootId, relativePath }) -> { kind, size, mtime, ctime }`
- `workspace_read_dir({ rootId, relativePath }) -> { entries: [{ name, kind }] }`
- `workspace_read_file({ rootId, relativePath }) -> bytes`

`kind` 是闭集：`file`、`directory`、`symlink`、`symlinkFile`、`symlinkDirectory`、`other`，分别映射 Workbench `FileType`。目录读取只列一层并按 UTF-8 字节稳定排序；目录优先、自然排序和 `files.exclude` 留给 Workbench。

安全与资源上限：

- 相对路径继续使用 4 KiB、256 段上限；目录项名称额外限制为 1 KiB。
- 单目录最多 10,000 个条目，名称 payload 最多 2 MiB；超限整次返回 `DIRECTORY_TOO_LARGE`，不得伪装成截断目录。
- 首版文件读取最多 8 MiB，并在分配前检查 metadata、读取时再以 `limit + 1` 验证；超限返回 `FILE_TOO_LARGE`。
- Unix 文件 handle 通过 capability-relative `O_NONBLOCK` 打开，再二次检查 handle metadata，避免 metadata/open 竞态把普通文件换成 FIFO 后永久阻塞；`libc` 版本由 Harness 精确固定。Windows reparse/special-file swap 纳入 F120/F130 真机矩阵。
- 非 UTF-8 或不能通过 portable segment policy 的名称使整次目录读取返回 `PATH_ENCODING_UNSUPPORTED`；不得 lossy、静默跳过或返回绝对路径。
- symlink 自身可以列出。只有 capability 确认仍在 root 内的目标可投影为 `symlinkFile`/`symlinkDirectory` 并读取；外部、dangling、loop 或不可访问目标保持裸 `symlink`，后续跟随操作返回清洗后的边界错误。
- `size`、时间戳都必须是非负 JS safe integer；不可用时间为 `0`，不得泄露原始 OS 错误或路径。

## 生命周期与错误

service 在窗口 mutex 内验证窗口/root 并 clone `Dir` lease，释放锁后进入 `spawn_blocking`。操作完成后重新验证窗口仍存在且 root 仍授权；replace、remove 或窗口关闭后的迟到结果必须丢弃。阻塞中的单次网络文件系统 syscall 无法强制取消，但结果不得重新获得授权。

只读 lease 的事后校验不得用于写操作，因为磁盘修改不能像读取结果一样丢弃。每个 `WindowWorkspace` 使用独立 mutation gate，create/rename 与 root replace、remove、window close 全部遵循 `mutation gate -> workspace state` 锁序。写操作可先短暂取得 lease，但进入阻塞线程并拿到 gate 后必须再次验证 window/root；撤销先拿 gate 时写入不发生，写入先拿 gate 时撤销等待。成功 syscall 不得在 gate 外再做可能把成功改写成“已撤销”错误的校验。

稳定错误至少覆盖：`ROOT_NOT_AUTHORIZED`、`WORKSPACE_WINDOW_CLOSED`、`INVALID_RELATIVE_PATH`、`PATH_OUTSIDE_ROOT`、`PATH_ENCODING_UNSUPPORTED`、`ENTRY_NOT_FOUND`、`ENTRY_ALREADY_EXISTS`、`ENTRY_TYPE_MISMATCH`、`PERMISSION_DENIED`、`DIRECTORY_TOO_LARGE`、`FILE_TOO_LARGE` 和 `IO_FAILED`。前端只把这些错误映射为 Workbench 的 `FileNotFound`、`FileExists`、`FileNotADirectory`、`NoPermissions` 或 `Unavailable`。

## CRUD 写入合同

- 新建和重命名是两个独立提交。`workspace_create_file` 与 `workspace_create_directory` 只提供空文件与单级目录：文件使用 `write(true).create_new(true)`，目录使用 capability-relative `create_dir`；root 空路径、缺失父目录、类型冲突和任何已存在目标都返回稳定清洗错误。
- 重命名请求只携带一个 `rootId`，从 wire contract 上禁止跨 root；不提供 `overwrite`。源与目标父目录必须先经 `cap_std::Dir::open_dir` 取得 capability，再对 basename 执行原子 no-replace。Linux/macOS 固定 `rustix 1.1.4`；不支持的平台或文件系统 fail closed，不做预检查加普通 rename 的 fallback。
- create/rename 的 Rust command、严格 codec、native bridge 和每实例隔离的 browser mock 先分别落地；provider 在此期间继续声明 `Readonly`，所有未支持写调用稳定拒绝，已有但不可用的 Workbench 命令不获得写权限。
- F020 在 provider 激活前增加有界内容写入、版本前置条件和临时文件原子替换切片，提前建立编辑器最小安全保存主链；F030 仍负责 preview/pin/split、外部冲突交互、热退出和恢复。这样 F020 不循环等待后续 feature，也不产生“可以编辑但不能安全保存”的中间态。
- create、rename、copy/move、delete 和安全内容写入全部可用后，独立提交移除 provider 的 `Readonly` capability/permission，接入精确文件事件与 Browser E2E。Rust 同时暴露可审计的平台写能力；缺少原子 no-replace rename 的 Windows/其他平台继续保持 provider 只读，直至 F120/F130 的安全实现与真机矩阵完成。
- `ENTRY_ALREADY_EXISTS` 映射为 Workbench `FileExists`。所有写错误不得包含绝对路径、用户名、原始 OS 错误或目标名称。

provider 激活使用显式能力合同：`workspace_capabilities() -> { create, renameNoReplace, copyMove, delete, versionedWrite }`。`main.ts` 必须在注册 provider 前经严格 codec 读取并冻结该 DTO，provider 构造时只有五项全为 `true` 才移除 `Readonly`；能力在一个窗口生命周期内不可升级。macOS/Linux 的安全实现可返回全 true，Windows 在 handle-relative exclusive rename 落地前返回 `renameNoReplace: false`，因此仍为只读。

版本化写入是 F020 的底层传输合同，不是 F030 的冲突 UI。Rust stat 增加 opaque version token；`workspace_write_file` 必须同时接收期望 version 与有界 bytes，在 mutation gate 内重验版本、写同目录临时文件并原子替换。由于 upstream `FileService` 不把 `mtime/etag` 继续传给 provider，Plain 需要一份可审计的窄 pnpm patch，把已经用于 dirty-write 校验的期望版本附加到 `IFileWriteOptions`；provider 不维护全局“最近 stat”缓存，也不接受缺少期望版本的覆盖写。

## 提交级落地顺序

每项完成最小验证后立即提交，WIP 始终保持为 F020：

1. Rust `stat`/`readDirectory` capability reader、严格 DTO、错误映射与边界测试。
2. Rust 有界 `readFile` command 与二进制 payload 测试。
3. TypeScript 严格 codec、原生 bridge 和 browser mock 文件数据面。
4. files/explorer service overrides、只读 provider、workspace 投影和浏览器 E2E。
5. 原子空文件/单级目录创建：Rust command、mutation gate、严格 bridge/browser mock 合同；provider 保持只读。
6. 同 root 原子 no-clobber 重命名：父目录 capability、目标平台系统调用与严格 bridge/browser mock 合同；不支持平台安全失败。
7. 复制/移动与确认删除各自单独提交；不能借 Workbench 的 overwrite 预删除绕过 no-clobber。
8. 有界内容写入、opaque version、上游期望版本透传 patch 与临时文件原子替换单独提交，形成 provider 所需的安全写传输。
9. 增加严格 `workspace_capabilities` DTO，并按 Rust 平台能力激活 provider 写能力、精确文件事件与 Explorer Browser E2E；不支持安全 rename 的平台继续只读。
10. watcher 的有界 dirty/rescan 状态机、浏览器 mock 收敛测试与真实 Tauri 文件树验收。

## 验收矩阵

- 普通文件/目录、隐藏项、稳定排序、空目录和多窗口/rootId 隔离。
- traversal、绝对路径、Windows/UNC/device/ADS 歧义拒绝。
- 内部、外部、dangling、loop 和 swap-race symlink；外部 sentinel 永远不可读。
- 非 UTF-8、portable-invalid 名称、条目数/名称 payload/文件大小边界。
- 读取期间 root replace/remove、窗口关闭和目标删除/重命名只产生成功快照或清洗错误，不 panic、不泄露路径。
- 同名文件/目录/symlink 创建不覆盖；并发同名创建恰好一个成功；外部/dangling/loop symlink 父目录和 swap race 不触碰外部 sentinel。
- 文件、目录和 symlink 的同 root rename 不覆盖任何既有目标；并发竞争最多一个成功；父目录 capability 与 mutation/revoke 两种线性顺序均有测试。
- Browser mock 验证 Explorer 展开、文本打开和排除 surface；真实 Tauri 验证原生 picker、文件树展开、取消和外部变化收敛。
