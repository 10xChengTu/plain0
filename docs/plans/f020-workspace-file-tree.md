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
- 复制请求从第一版就携带 `{ sourceRootId, sourcePath, targetRootId, targetPath }`，显式允许两个已授权 root，不接收 `overwrite`、`recursive`、URI 或任意 scheme。两端 lease 在同一窗口 mutation gate 内重新验证；同 root 同路径返回 `ENTRY_ALREADY_EXISTS`，同 root 的严格后代关系返回 `WORKSPACE_CONFLICT`，目标父目录必须已存在。
- 普通文件 copy 是第一个独立切片：只接受末级 nofollow 后确认的普通文件，复用 8 MiB 上限；源以 nonblocking 方式打开，目标父目录中最多尝试 16 次高熵 `create_new`、初始模式 `0600` 的命名 staging。成功语义绑定到已打开的 source handle：basename 在打开后被替换不会重定向读取；同一 inode 在复制期间可由 size/mtime/ctime 检出的变化则返回 `WORKSPACE_CONFLICT`。复制仍按 `8 MiB + 1` 检查增长，完成后设置 `mode & 0o777`、`sync_all`。发布和清理前都重新解析 staging basename 并核对其 identity；匹配时才以已有 `NOREPLACE` syscall 发布或尝试删除，不匹配时宁可留下 artifact 并返回清洗错误。外部进程仍可在 identity 检查与 rename/unlink 之间竞争，这不构成 capability 逃逸，但不能伪装成跨进程事务。不支持 exclusive publish 的平台或文件系统 fail closed。原子只承诺可见性，不宣称目录项已达到断电持久化；崩溃/竞争残留 staging 的 journal/恢复是后续独立合同。
- symlink copy 在普通文件之后单独提交：只读取并重建原始 link payload，绝不解引用、规范化或重写；内部、外部、dangling 和 loop link 均只是数据。单 link payload 最大 4 KiB，整树聚合上限 2 MiB。
- 目录 copy 再作为独立切片：先以显式栈建立完整 manifest，再产生任何目标写入；10,000 条目、2 MiB 名称 payload 和 2 MiB link payload 都是整棵 manifest 的聚合上限，单名仍为 1 KiB，最大相对深度明确为 256，单文件 8 MiB、全树总逻辑字节 256 MiB。manifest 记录目录 identity，用于检测同 root 或重叠 root alias 下目标父目录落入源树，并在发布前重验成员关系。FIFO、socket、字符/块设备和未知类型使整次操作失败。首版不保留 hardlink 关系、稀疏洞、ACL、xattr、owner、resource fork 或 ADS。
- create/rename 的 Rust command、严格 codec、native bridge 和每实例隔离的 browser mock 先分别落地；provider 在此期间继续声明 `Readonly`，所有未支持写调用稳定拒绝，已有但不可用的 Workbench 命令不获得写权限。
- F020 在 provider 激活前增加有界内容写入、版本前置条件和临时文件原子替换切片，提前建立编辑器最小安全保存主链；F030 仍负责 preview/pin/split、外部冲突交互、热退出和恢复。这样 F020 不循环等待后续 feature，也不产生“可以编辑但不能安全保存”的中间态。
- create、rename、copy/move、delete 和安全内容写入全部可用后，独立提交移除 provider 的 `Readonly` capability/permission，接入精确文件事件与 Browser E2E。Rust 同时暴露可审计的平台写能力；缺少原子 no-replace rename 的 Windows/其他平台继续保持 provider 只读，直至 F120/F130 的安全实现与真机矩阵完成。
- `ENTRY_ALREADY_EXISTS` 映射为 Workbench `FileExists`。所有写错误不得包含绝对路径、用户名、原始 OS 错误或目标名称。

provider 激活使用显式能力合同：`workspace_capabilities() -> { create, renameNoReplace, copyMove, delete, versionedWrite }`。`main.ts` 必须在注册 provider 前经严格 codec 读取并冻结该 DTO，provider 构造时只有五项全为 `true` 才移除 `Readonly`；能力在一个窗口生命周期内不可升级。macOS/Linux 的安全实现可返回全 true，Windows 在 handle-relative exclusive rename 落地前返回 `renameNoReplace: false`，因此仍为只读。

激活 copy 还必须同时声明并真正实现 `FileFolderCopy`，确保同一 `plain-workspace:` provider 的跨 root copy 的唯一写副作用只进入一个 Rust `workspace_copy` command；前后的 stat/resolve 仍是只读调用。Plain 不接受 Workbench 同路径 no-op、`overwrite` 或自动创建目标父目录：激活工作项必须增加窄 patch，在任何写副作用前返回与 Rust 一致的错误，阻断预删除和 `mkdirp`。任何涉及 Plain 的跨 scheme copy 也必须阻断通用 `mkdir/writeFile` fallback，另走以后明确授权的 import/export 合同。仅在 provider 内拒绝这些选项已经太迟，因为 upstream 可能先删除或创建文件系统项。

版本化写入是 F020 的底层传输合同，不是 F030 的冲突 UI。Rust stat 增加 opaque version token；`workspace_write_file` 必须同时接收期望 version 与有界 bytes，在 mutation gate 内重验版本、写同目录临时文件并原子替换。由于 upstream `FileService` 不把 `mtime/etag` 继续传给 provider，Plain 需要一份可审计的窄 pnpm patch，把已经用于 dirty-write 校验的期望版本附加到 `IFileWriteOptions`；provider 不维护全局“最近 stat”缓存，也不接受缺少期望版本的覆盖写。

### 目录 manifest 与 staged tree 冻结合同

目录 copy 不增加 IPC 字段、命令或 provider 方法，继续复用四字段 `workspace_copy`、双 root mutation gate 和现有类型 dispatch。Rust 新增独立 `workspace/directory_copy.rs`；raw `readlinkat_raw`/`symlinkat`、leaf staged transfer 与两处 `renameat_with(NOREPLACE)` 继续集中在 `writer.rs`，目录模块只经窄 helper 复用，避免第二套安全实现。

manifest header 记录被复制根目录的 identity、`mode`、`mtime` 与 `ctime`，但根本身不计入 descendant 预算。所有计数先 `checked_add` 再比较：

- descendants 最多 10,000；每个目录、普通文件或 symlink 各计 1，hardlink 每个路径重复计数。
- 根 depth 为 0、直接 child 为 1，最大 depth 为 256。
- basename 必须无损 UTF-8、通过 portable segment policy，单名最多 1 KiB。2 MiB 聚合名称只计 descendant basename bytes，不计 `/`；source 根和正式 target basename 不计入 aggregate，但两者都单独受 1 KiB 限制。
- 单 symlink payload 最多 4 KiB，整树 payload 最多 2 MiB；payload 不做 UTF-8、绝对路径或目标存在性解释。
- 单普通文件最多 8 MiB，全树逻辑文件字节最多 256 MiB；hardlink 按路径重复累计，稀疏文件按 metadata logical length 计。
- source 与 target 的每个完整后代 wire path 仍必须满足 4 KiB、256 段，否则返回 `PATH_ENCODING_UNSUPPORTED`，不得创建不可再次寻址的节点。

单文件或单 link payload 超限返回 `FILE_TOO_LARGE`；条目、深度、聚合名称、聚合 link、聚合逻辑字节或 checked arithmetic 超限返回 `DIRECTORY_TOO_LARGE`；名称编码/portable policy 失败返回 `PATH_ENCODING_UNSUPPORTED`；发布前 source/stage 不一致返回 `WORKSPACE_CONFLICT`。这些错误继续使用清洗后的固定消息，不携带成员名称或绝对路径。

执行顺序固定为：

1. 从 source parent 对末级目录 lstat，再用 `open_dir_nofollow` 打开并比较 pathname/handle identity；显式 DFS frame 同时持有的目录 handle 不超过 depth + 1。
2. 在完全不触碰目标的前提下建立排序 manifest。目录逐层 nofollow；symlink 复用 raw 4 KiB + 1 probe；普通文件记录安全 snapshot；FIFO、socket、设备与未知类型立即 `ENTRY_TYPE_MISMATCH`。
3. 从已打开 source root 重建 manifest 并精确比较成员、类型、identity、mode、size/time 和 link payload；source 根 basename 也必须仍指向该 handle，否则 `WORKSPACE_CONFLICT`。
4. 打开 target parent 并比较 identity；它命中任一 source directory identity 时拒绝，覆盖 lexical descendant、内部 symlink alias 和重叠授权 root。
5. 最多 16 次在 target parent 里 exclusive 创建高熵顶层 staging directory，初始 mode `0700`；pathname 与 opened handle identity 必须一致。
6. 按 manifest 构建完全 detached 的 staging tree。每个 leaf 在产生自己的目标副作用前，都必须 nofollow 打开/读取 source 并精确匹配 manifest snapshot 或 raw payload；普通文件 transfer 和 symlink create 还消费共享 checked actual-byte accumulator，实际文件写入总量不得超过 256 MiB、实际 link payload 不得超过 2 MiB。内部目录只做单级 exclusive create 后 nofollow 打开；普通文件复用 8 MiB bounded transfer、双遍 source/stage byte verify、`mode & 0o777` 与 `sync_all`；symlink 复用 raw staged transfer。窄 helper 接收 expected snapshot/payload 与共享 budget，不能把独立 leaf 上限误当成整树上限。
7. 发布前再次重验 source 和 staging：实际成员集合不得缺失或多出，source file 重新 nofollow/nonblock 打开并与 staged file 有界逐字节比较，symlink 重读 raw payload，所有 receipt identity 必须匹配。
8. 验证完成后，每个 staged directory 都必须通过 pathname `open_dir_nofollow`，并让 opened handle metadata 精确匹配 receipt identity，才能逆深度把 mode 设为 `source mode & 0o777`，根最后处理；任何不匹配都停止且不得 chmod replacement。成功发布前不保留时间戳、owner、ACL 或 xattr。
9. 只用既有 `publish_no_replace` 把顶层 staging directory 原子改名到正式 basename；成功之后没有仍可能失败的后处理。

`StagedTree` 维护平行 receipt。普通失败先确认顶层 pathname identity；包括嵌套目录在内，每个目录都必须逐层 `open_dir_nofollow` 并匹配 receipt identity 后，才可按前序恢复 `0700`。随后逆序删除已验证 leaf/空目录，每次删除前都重验类型与 identity，symlink 还重验 payload。未知成员、replacement、非空目录或任何身份不确定都升级为安全 cleanup error 并留下 artifact；禁止 `remove_dir_all`、第三方 walker 和跟随 symlink 的递归 helper。显式 `Drop` 仅 best effort，不能把清理失败伪装成原错误。

Browser mock 同样先做完整有界预检与 detached clone，最后只执行一次 target map publication；symlink 类型仍按新位置动态解析。测试 observer 只能收到 frozen、detached manifest summary，observer 抛错不得留下目标。provider 继续精确 `Readonly`，不声明 `FileFolderCopy`，直到 move/delete/versioned write 与上游防绕过 patch 全部完成。

验收必须同时覆盖 exact/+1 预算、同/跨 root mixed tree、空目录、raw symlink、非 UTF-8 名称、嵌套特殊文件、同树 alias、source/stage/parent swap、未知 stage 成员、目标竞争和双 root 撤销。大预算用可注入小 limits 与纯 accumulator 证明，不在常规测试实际生成 256 MiB；产品常量由 Harness 锁定，manifest/stage 行为由真实 Rust 测试证明。

## 提交级落地顺序

每项完成最小验证后立即提交，WIP 始终保持为 F020：

1. Rust `stat`/`readDirectory` capability reader、严格 DTO、错误映射与边界测试。
2. Rust 有界 `readFile` command 与二进制 payload 测试。
3. TypeScript 严格 codec、原生 bridge 和 browser mock 文件数据面。
4. files/explorer service overrides、只读 provider、workspace 投影和浏览器 E2E。
5. 原子空文件/单级目录创建：Rust command、mutation gate、严格 bridge/browser mock 合同；provider 保持只读。
6. 同 root 原子 no-clobber 重命名：父目录 capability、目标平台系统调用与严格 bridge/browser mock 合同；不支持平台安全失败。
7. 双 root、8 MiB、普通文件 staged copy：nofollow source、双 lease mutation、严格 bridge/browser mock 合同；目录/symlink 稳定拒绝，provider 保持只读。
8. 原样 symlink staged copy：link payload 有界且不解引用；内部、外部、dangling 和 loop 行为单独提交。
9. 有界目录 manifest 与 staged tree：聚合预算、特殊文件拒绝、失败清理与 source 变化重验单独提交。
10. 跨 root move receipt/verified delete 与确认删除各自单独提交；检测到源变化时不删，并公开外部 TOCTOU 下的非原子结果；不能借 Workbench 的 overwrite 预删除绕过 no-clobber。
11. 有界内容写入、opaque version、上游期望版本透传 patch 与临时文件原子替换单独提交，形成 provider 所需的安全写传输。
12. 增加严格 `workspace_capabilities` DTO、copy 同路径/overwrite/mkdirp/cross-scheme 窄 patch，并按 Rust 平台能力激活 provider 写能力、精确文件事件与 Explorer Browser E2E；不支持安全 rename 的平台继续只读。
13. watcher 的有界 dirty/rescan 状态机、浏览器 mock 收敛测试与真实 Tauri 文件树验收。

## 验收矩阵

- 普通文件/目录、隐藏项、稳定排序、空目录和多窗口/rootId 隔离。
- traversal、绝对路径、Windows/UNC/device/ADS 歧义拒绝。
- 内部、外部、dangling、loop 和 swap-race symlink；外部 sentinel 永远不可读。
- 非 UTF-8、portable-invalid 名称、条目数/名称 payload/文件大小边界。
- 读取期间 root replace/remove、窗口关闭和目标删除/重命名只产生成功快照或清洗错误，不 panic、不泄露路径。
- 同名文件/目录/symlink 创建不覆盖；并发同名创建恰好一个成功；外部/dangling/loop symlink 父目录和 swap race 不触碰外部 sentinel。
- 文件、目录和 symlink 的同 root rename 不覆盖任何既有目标；并发竞争最多一个成功；父目录 capability 与 mutation/revoke 两种线性顺序均有测试。
- 普通文件 copy 覆盖同 root/双 root、exact 8 MiB/增长一字节、打开后 basename 替换仍复制原 handle、同 inode 增长/截断冲突、最终 symlink/FIFO/special file、目标各种既有类型、source/target parent swap、staging identity/清理竞争和并发单胜者；正式目标只完整出现或完全不存在。
- symlink 与目录 manifest 覆盖全树聚合条目/名称/link payload/深度/总逻辑字节、稀疏大文件、内部/外部/dangling/loop link、重叠 root alias 后代、源树并发增删改和特殊文件；失败不得发布 staging。
- Browser mock 验证 Explorer 展开、文本打开和排除 surface；真实 Tauri 验证原生 picker、文件树展开、取消和外部变化收敛。
