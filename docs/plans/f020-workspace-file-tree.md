# F020 Workspace 与文件树技术方案

状态：执行中

更新时间：2026-07-18

## 目标与范围

F020 建立从原生目录选择到 Workbench Explorer 的完整文件树能力：每个窗口持有独立 workspace，每个 root 只有 opaque id，WebView 只提交 `(rootId, relativePath)`。本阶段包含目录读取、文件树 CRUD 和 watcher 收敛；编辑器模型、保存、热退出和多种预览仍由 F030 完成。

为了避免 Explorer 出现“节点可见但点击必然失败”的半成品，F020 会先提供有界只读 `readFile` 数据面，让普通文本文件可以由 Workbench 打开；F030 再负责预览固定、编辑保存、冲突和恢复语义。

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

稳定错误至少覆盖：`ROOT_NOT_AUTHORIZED`、`WORKSPACE_WINDOW_CLOSED`、`INVALID_RELATIVE_PATH`、`PATH_OUTSIDE_ROOT`、`PATH_ENCODING_UNSUPPORTED`、`ENTRY_NOT_FOUND`、`ENTRY_TYPE_MISMATCH`、`PERMISSION_DENIED`、`DIRECTORY_TOO_LARGE`、`FILE_TOO_LARGE` 和 `IO_FAILED`。前端只把这些错误映射为 Workbench 的 `FileNotFound`、`FileNotADirectory`、`NoPermissions` 或 `Unavailable`。

## 提交级落地顺序

每项完成最小验证后立即提交，WIP 始终保持为 F020：

1. Rust `stat`/`readDirectory` capability reader、严格 DTO、错误映射与边界测试。
2. Rust 有界 `readFile` command 与二进制 payload 测试。
3. TypeScript 严格 codec、原生 bridge 和 browser mock 文件数据面。
4. files/explorer service overrides、只读 provider、workspace 投影和浏览器 E2E。
5. 新建、重命名、复制/移动、确认删除；每种可独立回滚的写语义单独提交。
6. watcher 的有界 dirty/rescan 状态机、浏览器 mock 收敛测试与真实 Tauri 文件树验收。

## 验收矩阵

- 普通文件/目录、隐藏项、稳定排序、空目录和多窗口/rootId 隔离。
- traversal、绝对路径、Windows/UNC/device/ADS 歧义拒绝。
- 内部、外部、dangling、loop 和 swap-race symlink；外部 sentinel 永远不可读。
- 非 UTF-8、portable-invalid 名称、条目数/名称 payload/文件大小边界。
- 读取期间 root replace/remove、窗口关闭和目标删除/重命名只产生成功快照或清洗错误，不 panic、不泄露路径。
- Browser mock 验证 Explorer 展开、文本打开和排除 surface；真实 Tauri 验证原生 picker、文件树展开、取消和外部变化收敛。
