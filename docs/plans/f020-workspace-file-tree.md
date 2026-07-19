# F020 Workspace 与文件树技术方案

状态：执行中

更新时间：2026-07-19

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

- `workspace_stat({ rootId, relativePath }) -> { kind, size, mtime, ctime, version }`
- `workspace_read_dir({ rootId, relativePath }) -> { entries: [{ name, kind }] }`
- `workspace_read_file({ rootId, relativePath }) -> PLR1 raw { stat/version, bytes }`

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

激活 copy/move 还必须同时声明并真正实现 `FileFolderCopy`，确保同一 `plain-workspace:` provider 的跨 root copy 只进入一个 Rust `workspace_copy` command；provider `rename(from, to)` 按 authority/rootId 分流，同 root 只进入 `workspace_rename`，不同 root 只进入 `workspace_move`。Plain 不接受 Workbench 同路径 no-op、`overwrite` 或自动创建目标父目录：激活工作项必须增加同时覆盖 copy/move 的窄 patch，在任何写副作用前返回与 Rust 一致的错误，阻断预删除、`mkdirp`、generic copy/delete 和 rename fallback。任何涉及 Plain 的跨 scheme copy/move 也必须阻断通用 `mkdir/writeFile` fallback，另走以后明确授权的 import/export 合同。move incomplete 必须先发布两个 root 的 dirty/rescan/file-event 提示，再向 Workbench 抛稳定且明确“target 已发布”的 `WORKSPACE_MOVE_INCOMPLETE`；不能上报 MOVE 成功、建立 undo、走 fallback 或被当作普通 rename 失败自动重试。仅在 provider 内拒绝 overwrite 已经太迟，因为 upstream 可能先删除或创建文件系统项。

### Plain copy/move/clone 路由守卫冻结合同

路由守卫先作为独立 patch 工作项落地，provider 在本工作项中仍严格保持 `FileReadWrite | Readonly`。这样先修复 Plain 作为只读 source 时已可到达的跨 scheme copy/clone 泄漏路径，再在后续提交原子接入 provider mutation 与能力激活。

单一无副作用 snapshot/classifier 必须作为 `doCanMoveCopy`、`move`、`copy` 和 `cloneFile` 的首个可执行动作：先各读取 source/target 的 scheme、authority、path、query、fragment 一次并建立冻结 URI，再只对该 snapshot 分类，整个过程位于 provider lookup、布尔强制转换及任何 stat 前；不得先分类原 URI 再重复读取字段生成 snapshot。`canMove/canCopy` 只是直接转发给已受守卫的 `doCanMoveCopy`，不再重复一份逻辑。`doMoveCopy` 对其直接调用者再执行同一套 snapshot/classifier，防止编译后普通 JS 方法或后续重构绕过。任一 snapshot 端为 `plain-workspace:` 时采用下列闭集：

| 输入                                                | 唯一结果                                                                                      |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 仅一端是 Plain                                      | 在 provider lookup 前拒绝；禁止 import/export fallback                                        |
| 任一 Plain URI 带 query 或 fragment                 | 在 provider lookup 前拒绝                                                                     |
| `overwrite` 不是严格 `undefined` 或 `false`         | 在 `!!overwrite` 前拒绝；`true`、`null`、`0`、空字符串和 Boolean object 都不是授权            |
| 两端 Plain 且 `scheme + authority + path` 完全相同  | 冲突；不得作为成功 no-op，也不得发布 COPY/MOVE event                                          |
| 两端 Plain、不同 URI、provider 实例不同             | 拒绝；scheme 相同不允许跨 provider fallback                                                   |
| Plain copy 缺少 `FileFolderCopy` 或 callable `copy` | 拒绝；不得进入 read/write 或递归目录 fallback                                                 |
| Plain move 缺少 callable `rename`                   | 拒绝；不得进入 copy/delete fallback                                                           |
| 合法 Plain copy                                     | `canCopy` 只校验路由/provider；actual 只调用一次 `provider.copy(..., { overwrite: false })`   |
| 合法 Plain move                                     | `canMove` 只校验路由/provider；actual 只调用一次 `provider.rename(..., { overwrite: false })` |
| clone 任一端是 Plain                                | 一律拒绝；Plain 不声明或模拟 `FileClone`                                                      |

Plain 专用 actual 分支必须位于上游同字符串成功 no-op、target `del`、`mkdirp` 和 generic 分流之前；分支内禁止 target `stat`/`exists`、`del`、`mkdirp`、`doCopyFile`、`doCopyFolder` 或递归 `doMoveCopy`。`doCopyFile`/`doCopyFolder` 还要在任一 URI 为 Plain 时作纵深拒绝。相同资源只按已经要求 query/fragment 为空后的精确 `scheme + authority + path` 判断，不使用 provider-wide ignore-case comparison key；target 是否存在、真实路径大小写与 alias 必须由 Rust root/path gate 和原子 no-clobber 最终裁决，不能由 Workbench 的 provider-wide 比较或 check-then-act 预检抢先判断。非 Plain 路径保持固定 upstream 行为。

后续 provider lookup/dispatch、target resolve 与 operation event 只使用由这次单次读取派生的冻结 snapshot；内部入口的重复 snapshot 也只能读取已经冻结的值。原 URI 的同步 accessor 顺序变化或 promise 运行期间修改，都不能让分类输入与 mutation 目标不一致。非 Plain 请求同样使用内容等价 snapshot，固定 upstream 的分支和结果保持不变。provider 激活后仍须在自身同步读取 scheme/authority/path/options 为不可变 primitive request，再进入 native bridge，FileService snapshot 只是纵深防御。

所有本地拒绝都返回不含路径的 `FileOperationError`：同 URI 使用 `FILE_MOVE_CONFLICT`，跨 scheme、非规范 URI、非严格 overwrite、clone、generic fallback 与 provider/capability/method 不匹配使用 `FILE_PERMISSION_DENIED`。`canCopy/canMove` 返回该 Error 值，真实 `copy/move/cloneFile` reject；失败路径不得发布任何 operation event。

本合同只封死 copy/move 自带的自动 `mkdirp`。`createFolder` 与导出的通用 `mkdirp` 在 provider 激活工作项中另行接入“单次 native mkdir、父目录必须已存在”的合同，不能把本提交描述成全局 mkdirp 已禁用。跨 root move 的 retained/partial 终态也由后续 provider 工作项消费：只有 `moved` 可返回成功，其余终态先同步触发两个 root rescan，再阻止 MOVE success event 与任何重试/fallback。

runtime 测试必须参数化覆盖入口前置拒绝、同 provider 实例注册到两个 scheme、target 存在/不存在的 overwrite、由 native no-clobber 返回的 target conflict、大小写仅有差异的路径、缺失父目录、同步 sequential getter/Proxy 与异步 URI mutation、native-only happy path、缺 capability/method、直接 generic helper、clone 与非 Plain 控制组；所有失败例同时断言 provider activation/stat/delete/mkdir/read/write/copy/rename 调用数和 operation event。patch Harness 除精确 SHA-256、hunk 与 lock graph 外，还要 hostile mutate：删除任一入口 guard、把双 Plain 改成 OR、恢复 same-URI no-op或 truthy overwrite、把 Plain 分支移到 `del/mkdirp` 后、恢复 target stat/exists 或 generic fallback、后移/删除 URI snapshot 或 clone guard、只检查 capability 不检查方法。

版本化写入是 F020 的底层传输合同，不是 F030 的冲突 UI。Rust stat 增加 opaque version token；`workspace_write_file` 必须同时接收期望 version 与有界 bytes，在 mutation gate 内重验版本、写同目录临时文件并原子替换。由于 upstream `FileService` 不把 `mtime/etag` 继续传给 provider，Plain 需要一份可审计的窄 pnpm patch，只在 `plain-workspace:` 私有分支把已用于 dirty-write 校验的期望版本直接交给 `plainWriteFile(resource, bytes, expectedVersion)`；不得修改公开 `IFileWriteOptions` 或扩展 API。provider 不维护全局“最近 stat”缓存，也不接受缺少期望版本的覆盖写。

### 版本化原子写入冻结合同

`WorkspaceEntryStat` 增加必备闭集字段 `version: string | null`。全局 `workspace_capabilities.versionedWrite` 只表示当前构建包含实现；每个普通文件还必须通过 handle-relative filesystem gate 和同一份保守 `writer_eligibility` 静态资格检查才签发 token。首版 allowlist 固定为 macOS `apfs`，以及 Linux ext-family、XFS、Btrfs、tmpfs 和 overlayfs；root/target/parent 每次 stat、read、write 都重新 `fstatfs`，并拒绝只读 mount。未知、FAT/exFAT、NFS、SMB/CIFS、FUSE 和不一致类型返回 `version: null`/`WORKSPACE_WRITE_UNSUPPORTED`。文件型 stat 的 `version: null` 在 provider 解除全局只读后映射 `FilePermission.Readonly`；目录的 null 是正常状态，不能因此禁止安全 CRUD。混合 root 不靠 provider-wide 平台布尔值虚构文件系统保证。

首版 token 还要求末级是真实普通文件、从 root 到 parent 的每段都不是 symlink、`nlink == 1`、无 `0o7000` 特殊 mode、完整 Unix identity/time 可用且 size 不超过 8 MiB。共享 `writer_eligibility` 进一步保守要求 target 与最终 parent 的 uid/gid 都等于进程 effective uid/gid，target 有 owner-write，parent 有 owner-write+execute 且无特殊 mode；这样 same-parent `create_new` stage 能保持 uid/gid。共享目录、ACL 才授权、setgid parent、只读 mount或任何无法无副作用证明的情况一律不签 token。写入时仍重新创建并验收 stage，token 不是权限授权。token 语法固定为 `wv1:<64 lowercase hex>`，是确定性磁盘 metadata 指纹，不是 secret、内容认证、文件权限或跨进程锁。唯一 production helper 按下表顺序做 SHA-256；除 path 外不加 padding，所有整数为 big-endian：

| 字段     | 精确编码                                                                                                   |
| -------- | ---------------------------------------------------------------------------------------------------------- |
| domain   | ASCII `plain.workspace.file-version.v1` 后跟单个 `00` byte                                                 |
| rootId   | 规范 UUID v4 的 16 raw bytes                                                                               |
| path     | `u32` byte length + 规范 wire relative path UTF-8 bytes，不含前导 `/`                                      |
| fs kind  | `u32`：APFS=1、ext=2、XFS=3、Btrfs=4、tmpfs=5、overlayfs=6                                                 |
| identity | `dev:u64, ino:u64, len:u64, mode:u32, uid:u32, gid:u32, rdev:u64`                                          |
| times    | `mtimeSec:i64, mtimeNsec:u32, ctimeSec:i64, ctimeNsec:u32`；秒为 two's-complement，纳秒必须 0..999,999,999 |
| links    | `nlink:u64`                                                                                                |

golden snapshot 固定为 root `00112233-4455-4677-8899-aabbccddeeff`、path `src/你好.rs`、APFS、dev `0x0102030405060708`、ino `0x1112131415161718`、len 5、mode `0o100644`、uid 501、gid 20、rdev 0、mtime `1700000000.123456789`、POSIX change-time `1700000001.987654321`、nlink 1，结果必须是 `wv1:dc1552695bf401f822d12397265943a7868008cad960c6ee11a9b1949ecdf800`。普通 Explorer stat 禁止读取/hash 内容，也不维护 Rust/TS token table、TTL、path→recent-version map 或 provider cache；否则 metadata resolve 会放大文件 I/O，或让无关 stat 挤出打开文档版本。

#### 版本与首次读取绑定

当前独立 `stat` 与 `readFile` 不能组成保存基线：固定 FileService 会并发执行两者，可产生 content(A)+token(B)。因此既有 `workspace_read_file` 在本切片演进为单次 versioned read，Rust 对同一个 opened target handle 执行 metadata-before → 0..8 MiB bounded read → metadata-after，再用 capability resolver receipt 从 root 重走并重验路径后，才返回同一快照的 bytes + stat/version。无 symlink parent 的直接普通文件比较 pathname/handle identity并可按资格签 token；经 root 内 `symlinkDirectory` 到达的普通文件仍返回 kind=file，但逐段重验 symlink lstat/raw payload与 resolved target handle identity，version为 null；final `symlinkFile` 分别重验 symlink 自身的 lstat/raw payload和解析后 target handle，不能把两者 inode误当相同。越 root、dangling、loop 或期间任一 receipt 字段变化仍返回清洗错误；所有经 symlink读取的内容只读。

Tauri response 使用 raw `PLR1` frame：

```text
PLR1 | kind:u8 | versionLen:u8 | reserved=0:u16 | contentLen:u32be
     | size:u64be | mtimeMs:u64be | ctimeMs:u64be | version:ascii | content:bytes
```

kind 首版只允许 file=1、symlinkFile=2；file 的 versionLen 只允许 0 或 68，symlinkFile 只能为 0。file=0 表示同 handle 内容可读但没有写基线，provider 必须映射 `FilePermission.Readonly` 并使用 `ETAG_DISABLED`，绝不能回退为 upstream `mtime+size` etag；因此 unknown filesystem、Windows、hardlink、只读 mode或 symlink parent 下的普通文件仍可只读打开，且每次读取真实 receipt。size 必须等于 contentLen，三个公开时间/大小数都要落在 JS safe integer，frame 精确结束且总内容不超过 8 MiB。PLR1 的 `ctimeMs` 是与现有 `WorkspaceEntryStat.ctime` 一致的 birth/created time；`wv1` 内部另取 POSIX metadata change-time sec+nsec，两者不得混用。provider 暴露不进入通用接口的 `plainReadFile(resource)`，返回 frozen `{ stat, value }`；标准 `readFile` 只作兼容 wrapper并复制 bytes。固定 FileService 的 Plain 专项 read 分支只调用 `plainReadFile`，用 receipt stat 生成高层 stat/etag并处理 etag、position、length、limit，不再启动独立 provider.stat。必须用确定性 A/B 时序测试证明旧内容不能与新 token 配对，也要证明 tokenless 文件被等长/同 mtime外部改写后不会误报 NotModified。

Rust command始终返回`InvokeResponseBody::Raw`，但固定Tauri 2.11.5的响应传输有两个真实JS形状：非Apple且response channel可用时得到`ArrayBuffer`；macOS/iOS或channel不可用时，`format_result`把同一`Vec<u8>`序列化为dense `number[]`。这不是Plain主动选择JSON bytes，也不能被用于request。生产decoder必须对两种形状分别做exact brand/own data descriptor/总长/逐byte检查并立即复制到同一私有snapshot；只接受无额外key的exact ArrayBuffer或无hole/无accessor/无额外key的exact Array，拒绝Uint8Array、其他view、SharedArrayBuffer、subclass、Proxy、detached buffer及超限。Browser/native tests必须分别覆盖两条response transport，且共同解码同一PLR1 golden。

#### 固定 Workbench patch

固定 patch 由 `pnpm-workspace.yaml`、lockfile patch hash、exact package/file/hunk validator 和 hostile mutation tests 共同锁定，不接受 marker-only 检查。`@codingame/monaco-vscode-files-service-override@35.0.1` 的 `fileService.js` 只允许五处 Plain 分支：

1. `toFileStat`：仅当 URI 记法为 `plain-workspace:`（运行时 `resource.scheme === "plain-workspace"`）且 provider实际返回的 stat自有私有`plainVersion`为合法token时复用高层`etag`；present-null的file/symlink file强制`ETAG_DISABLED + FilePermission.Readonly`，present-but-malformed fail closed，绝不产生通用mtime+size etag。`resolveMetadata=false`递归child的FileService partial `{ type }`没有该自有字段，不视为恶意malformed：partial file同样按无baseline readonly处理，partial directory保持目录语义。其他scheme保持upstream。
2. `doReadFileStream`：只对同一 scheme 调用上述私有 `plainReadFile` 并直接使用 receipt stat；禁止独立 stat/read 并发或读取后的第二次 stat。
3. `validateWriteFile`：此切片只允许 existing write。合法、非空、非 `ETAG_DISABLED` 的旧 token也必须遇到真实 existing stat且精确匹配；FileNotFound、token 缺失/null/malformed/force 都返回 `FILE_MODIFIED_SINCE`，permission/unavailable 等 stat error 原样传播。Plain 分支绝不返回 create intent、调用 `mkdirp` 或执行 upstream mtime/size/content弱比较。
4. `doWriteUnbufferedQueued`：只对同一scheme接收已经有界的VSBuffer，再次验byteLength后才交给provider私有`plainWriteFile(resource, bytes, expectedVersion)`，并把其严格result原样向上返回；标准`provider.writeFile`对Plain existing save继续fail closed，其他scheme保持原调用。Plain不声明`OpenReadWriteClose`，禁止buffered/append/unlock/force fallback。
5. `writeFile`：Plain在`validateWriteFile`通过后、任何upstream `peekBufferForWriting`前绕过peek并执行8 MiB有界collector。现成VSBuffer先验byteLength；ReadableStream逐chunk先验单chunk和checked累计，失败时destroy；ReadableBufferedStream先逐项计算既有`buffer`而不concat，再从其`stream`最多读到8 MiB+1并在失败时destroy；纯Readable逐次read但没有destroy能力，失败后停止继续read。三类都拒绝零长度无进展chunk，单个超大chunk在任何concat/copy前即失败。FILE_TOO_LARGE/contract error时`plainWriteFile/workspace_write_file`调用次数必须为零（前置`provider.stat`可有一次），禁止进入`peekStream`、`peekReadable`、`streamToBuffer`、`bufferedStreamToBuffer`或`readableToBuffer`。随后消费私有write result；只有`written`直接用Rust同次publication验收返回的完整provider stat调用`toFileStat`，且只有此分支能发布FileService WRITE success event，不得发起post-write`resolve/stat`。provider对Rust的结构化`targetPublished/outcomeUnknown`或dispatch后无法严格认证的rejection先发一个root `UPDATED`，再把frozen union返回；FileService将其构造成保留outcome的branded非冲突`FileOperationError`并抛出。它不能被catch降成普通“未写入”，也不能触发成功事件。非Plain仍走原peek/resolve。

固定 API patch 在 `TextFileEditorModel` 与 `StoredFileWorkingCopy` 两个模型各增加三个来源闭集的 Plain baseline 分支，不能只修 save-success：

1. `resolveFromFile` 从同次 PLR1 receipt 应用内容时，以 `plainReadReceipt` 来源无条件接纳该 stat，即使 mtime 回拨；若 resolve generation 已过期则整份 receipt（内容和 stat）一起丢弃，不能只应用内容或只保留旧 token。
2. `resolveFromBuffer` 覆盖 preferredContents 和 MOVE/COPY snapshot restore。无论独立 stat 成功或失败，它只能用 stat 更新 readonly/orphan/display 信息，随后把 etag 无条件替换为唯一 sentinel `plain-buffer-no-baseline`，并以 `plainBufferNoBaseline` 来源强制替换旧 baseline；不能受 monotonic mtime guard保留旧 wv1。sentinel 永不进入 provider/Rust，下一次保存稳定返回 `FILE_MODIFIED_SINCE`，直到 F030 明确 reload/rebase/重新授权。
3. `handleSaveSuccess` 只对严格 `written.stat` 使用 `plainWriteReceipt` 来源，使合法新 `wv1` 即使 mtime 回拨也成为新基线。

`updateLastResolvedFileStat` 的私有来源闭集必须验证 scheme 与 etag：read receipt 只接受合法 wv1 或 tokenless `ETAG_DISABLED`，buffer 只接受精确 sentinel，write receipt只接受合法 wv1；其余普通 resolve、backup/迟到 stat 与非 Plain 继续 upstream monotonic guard。exact patch validator锁住两文件的来源定义和六个权威调用点。Workbench 的 model version/sequentializer 继续负责“异步保存期间内存是否又被编辑”，不得把它塞入 Rust disk token。

`ETAG_DISABLED`、`ignoreModifiedSince`、`files.saveConflictResolution=overwriteFileOnDisk`、原生 Overwrite 和任意 `force/confirmed` boolean 都不能授权覆盖。F020 保持 dirty/conflict并 fail closed；F030 用户确认覆盖时必须重新获取当前 version，再提交该精确快照。Rust 最终发现 stale token 时，Plain provider 必须抛清洗后的 `FileOperationError(FILE_MODIFIED_SINCE)`，不能通过不存在 ModifiedSince 的 provider error code退化为 OTHER/MOVE error。新目标的非空 save/create 留给激活工作项的 exclusive create 路由；本 raw write 没有 create 语义。

#### 有界 raw write 与原生发布

单次 `workspace_write_file` 只接受 Tauri `Request` 的 raw body。生产 bridge 只构造 exact `Uint8Array`，frame 固定为：

```text
PLW1 | rootIdLen:u16be | pathLen:u16be | versionLen:u16be | contentLen:u32be
     | rootId:utf8 | relativePath:utf8 | expectedVersion:ascii | content:bytes
```

rootId 恰为规范 UUID v4 的 36 bytes，path 为 1..4 KiB/最多 256 段，version 恰为 68 ASCII bytes，content 为 0..8 MiB，frame 精确结束。TS 通过捕获的 `%TypedArray%`/`ArrayBuffer` intrinsic 验证 exact `Uint8Array` view、buffer brand、byteOffset/byteLength和detached状态，再只把该 view 的字节同步复制到不再暴露的私有 snapshot并立即编码，而不是冻结 typed array。拒绝 SharedArrayBuffer、detached buffer、subclass、Proxy和超限；调用者附加的 JS 属性既不读取也不传输，统一由私有字节快照净化。不得为检查附加属性而枚举 TypedArray 的数百万个 integer-index own keys：本机 8 MiB 基准显示 `for...in`/`Reflect.ownKeys` 会把单次请求放大到约 421/728 MiB RSS，违背有界 collector 的目标；语义不能按内容大小分叉。冻结的只是外层 request/result/wrapper。Tauri 会把顶层 number[]、ArrayBuffer 和任意 view 都变成 `InvokeBody::Raw`，Rust无法反推 JS 原类型；Rust只验 magic、总长、checked offsets、UTF-8/ASCII、闭集 token和尾部零剩余，Harness则锁生产 bridge只传 exact Uint8Array。嵌套 JSON bytes、base64、headers、第二次 metadata IPC 和无界 Serde DTO 一律禁止。Tauri 在 command 前已经分配 raw `Vec<u8>`，8 MiB 是服务处理上限而非 renderer-compromise 下的 transport preallocation firewall。

Rust service 在 `mutation gate → workspace state` 下重新取得 lease并持有到明确终态。pre-publication 顺序固定：

1. 从 root 逐段 nofollow 打开并记录完整 parent identity chain；末级 nofollow/nonblock 打开 existing target，重验 allowlisted fs、真实普通、`nlink == 1`、无特殊 mode、owner可写、size和 expected token。
2. 同 parent 最多 16 次创建 UUID v4 高熵、`0600`、`create_new`、nofollow/nonblock 的 `.plain-write-*` stage；记录 handle/pathname identity，初建与每次最终验收都要求真实 regular、`nlink == 1`、uid/gid等于 target、mode等于当前阶段期望、size/content SHA-256和 pathname↔handle identity。
3. 写 0..8 MiB，设置 `target.mode & 0o777`，按 metadata-before → bounded read/hash → metadata-after 复核完整 bytes并同步 stage；不能在 target 上 truncate/write。
4. publication 前从当前 root重新走完整 nofollow parent chain并逐层匹配原 identity，使用重新取得的同一 parent handle再次重算 target token，并再次验收 stage全部字段。任一不匹配都保持旧 target并按 identity receipt有界清理；stage 名被替换时宁可遗留 artifact，也不删 replacement。
5. 只把重新确认的 parent capability 与两个 basename交给无 flags `rustix::fs::renameat`。禁止多段 `Dir::rename`、`std::fs`、backup/restore、copy/tombstone、shell、ambient path、`EXCHANGE/SWAP` rollback 或 no-replace+delete。

唯一 `publish_and_classify` typestate helper 消费 stage/old-target/parent receipts；调用 `renameat` 后禁止 `?`、`map_err` 或普通 `Result` 早退，也禁止第二次 rename/rollback。只有 syscall 报错，且从当前 root 重走的 parent chain仍匹配、target仍精确为 old receipt、stage仍精确为本次 receipt/content时，才可进入未发布证明；随后还必须紧贴 `unlink` 前重新验收 stage pathname，且只有无条件 `unlink` 成功、已打开的原 stage fd 已变为 `nlink == 0`，并最后一次从当前 root 确认 target 仍为 old receipt，才可返回 `notPublished(CommandError)`。POSIX 没有“仅当 pathname 仍指向期望 inode 时才 unlink”的原子操作；若外部在最后复验与 `unlink` 之间替换 stage pathname，新 replacement 可能被该 `unlink` 删除，原 stage fd 则保持 `nlink != 0`，结果必须降级为 unknown/published，绝不得返回普通 `notPublished`。post-publication target 验收也必须从当前 root 重新走完整 parent chain、逐层匹配，再在重新确认的 parent 下验证 target；只在旧 held parent fd中匹配不算 URI 当前状态。rename 成功后 parent rewalk mismatch归已发布但 unverifiable，不能返回 written：

- `{ status: "written", stat }`：rename reported success，parent directory sync 成功，current-root parent rewalk和target postcheck精确匹配本次 stage content/identity，`stat` 与新 version来自这次同一验收。
- `{ status: "targetPublished", publicationEvidence: "renameReportedSuccess" | "targetObservedWritten", rename: "reportedSuccess" | "reportedFailure", directorySync: "synced" | "failed", target: "matchesWritten" | "changed" | "unverifiable" }`：有证据证明target namespace已被本次rename影响，但至少一个publication观察不是完整普通成功。`renameReportedSuccess`只证明rename syscall报告已替换namespace，不声称所请求bytes曾发布；只有current-root target identity/content明确匹配本次stage才能使用`targetObservedWritten`。闭集组合进一步固定：`reportedSuccess+targetObservedWritten`只能是`failed+matchesWritten`，`reportedSuccess+changed/unverifiable`只能使用`renameReportedSuccess`；`reportedFailure`只能使用`targetObservedWritten`，即使后续观察变成changed/unverifiable也保留该证据。`reportedSuccess+synced+matchesWritten`只能编码为written；无上述证据的failure不得冒充targetPublished。
- `{ status: "outcomeUnknown", observation: "native", rename: "reportedFailure", directorySync: "notAttempted", target: "ambiguous" }`：Rust已观察rename failure，但当前证据既不能证明未发布，也不能证明target保持旧值；因为尚无已发布证据，Rust不会尝试directory sync。
- `{ status: "outcomeUnknown", observation: "responseUnavailable", rename: "unobserved", directorySync: "unobserved", target: "ambiguous" }`：invoke已dispatch但response/rejection无法严格认证，前端没有资格伪造任何native rename/sync观察。

Rust/TS/Browser strict decoder必须拒绝 full-success伪 incomplete、reportedFailure却无 targetObservedWritten证据的 published、非法 evidence/rename组合、native/responseUnavailable交叉字段和unknown的任何额外状态。provider本切片新增可测的有界rescan seam：`onDidChangeFile`不再是`Event.None`。Rust结构化后两类由provider发一个root URI `UPDATED`后返回frozen union；FileService随后抛branded非冲突错误。raw invoke一旦dispatch，只有严格解码且位于Rust pre-publication闭集的`CommandError`才可作为普通失败；该闭集精确为`ROOT_NOT_AUTHORIZED`、`ROOT_UNAVAILABLE`、`PERMISSION_DENIED`、`FILE_TOO_LARGE`、`INVALID_WORKSPACE_WRITE_REQUEST`、`WORKSPACE_CONFLICT`、`WORKSPACE_FILE_MODIFIED`、`WORKSPACE_WRITE_UNSUPPORTED`、`WORKSPACE_WINDOW_CLOSED`和`IO_FAILED`。response丢失、Promise未知rejection、Rust writer panic/`JoinError`、Browser rename observation exception、success/incomplete payload解码失败都必须经非白名单 `WORKSPACE_WRITE_RESPONSE_UNAVAILABLE` rejection或本地分类，保守转成`observation:"responseUnavailable"`的outcomeUnknown，不能伪造成Rust已观察的native rename failure。随后发同一个root UPDATED并返回union。本地codec在invoke前失败才可直接ordinary error。不得上报WRITE成功、自动retry、rollback或依赖旧token一定冲突；unknown可能最终仍是旧target。正常stale token才映射`FILE_MODIFIED_SINCE`。stage cleanup使用自己的identity receipt做最后 pathname 复验与 fd `nlink` 后验，但必须承认上述 verify→unlink 竞态可以删除外部 replacement；published target永不自动删除或回滚。

两个 model 的 save error handler还必须识别 branded incomplete/unknown：保持 dirty，禁止 generic Retry、Overwrite、自动 save或旧 token重放；只允许不会盲写同一路径的 Reload/Save As/Details 类人工动作。root UPDATED不会自动替换 dirty model baseline。本 provider capabilities 在三个版本化写子工作项中始终严格保持 `FileReadWrite | Readonly`，直到下一激活工作项完成全部 CRUD、root/fs能力激活与 E2E。

此合同仍有公开外部竞态：系统没有从已验收 source fd 对 expected target做条件 rename。最后一次 root→parent rewalk、stage/target pathname/content验收到 `renameat` 之间，任何能修改 parent directory entry或stage inode的进程（通常同 UID，也可能是共享目录中的其他 UID或特权进程）仍可替换 ancestor、stage、target或修改stage bytes；错误内容可能短暂发布，postcheck只能分类而不能撤销。post-publication current-root rewalk/target check到返回 renderer之间仍可能再次变化，结果只描述该次观察。parent capability保证不越出已授权 root，但不能虚构 CAS。metadata token也不直接保护 ACL、xattr、resource fork和flags；新 inode可能丢失旧值或继承 parent default ACL，首版只承诺普通 POSIX mode与相同 uid/gid的受限源码文件保存，完整 metadata-preserving save另立平台工作项。Windows保持 `versionedWrite: false`。

#### Harness 与验收落点

实现必须新增单一共享 fixture（计划路径 `tests/fixtures/workspace-version-v1.json`），由 Rust token/parser、TS encoder/decoder、Browser mock共同读取。除上述 wv1 golden外，`PLW1` fixture 使用同 root/path/version和 bytes `00 41 ff 0a`，完整 hex 固定为：

```text
504c57310024000d00440000000430303131323233332d343435352d343637372d383839392d6161626263636464656566667372632fe4bda0e5a5bd2e72737776313a646331353532363935626634303166383232643132333937323635393433613738363830303863616439363063366565313161396231393439656364663830300041ff0a
```

`PLR1` file fixture 是独立的 len=4 stable-read snapshot：除 len 和公开 birth/created time外复用上述 metadata，size=4、mtimeMs=1700000000123，公开 `ctimeMs=1699999999000`，token内部仍使用POSIX change-time `1700000001.987654321`，因此token为`wv1:a5a3ace16ca7f42ef7702ed0d3c877891d3f937343041adc490869cde1de1feb`。它不冒充PLW1 staged rename后的inode/time；PLW1 fixture只是“以len5旧token提交四字节新内容”的独立request。完整hex固定为：

```text
504c5231014400000000000400000000000000040000018bcfe5687b0000018bcfe564187776313a613561336163653136636137663432656637373032656430643363383737383931643366393337333433303431616463343930383639636465316465316665620041ff0a
```

Harness 锁唯一 token/eligibility helper、raw command/registration/service/private-provider路由、read/write receipt贯穿、无 post-read/post-write stat、tokenless `ETAG_DISABLED+Readonly`、三个 model baseline来源、`PLW1/PLR1` exact codec、PLR1 ArrayBuffer/number[]双response transport、8 MiB+1 bounded collector、files-service/API/error-handler patch exact hunks、manifest/lock hashes；实现同时把 Cargo.toml 的 direct Tauri pin 改为 `version = "=2.11.5"`，并校验 resolved direct tauri恰为2.11.5、JS API恰为2.11.1。provider继续 Readonly且不声明 OpenReadWriteClose/append/unlock/force/create fallback。Rust只允许受审计 writer 的 parent+basename覆盖 `renameat`；publish helper在 rename后禁止普通 error传播。hostile tests必须覆盖缓存/content-read/ambient/truncate/backup/递归/process、alias/UFCS/模板/动态属性等绕路。

最小验证映射为：Rust `workspace::version/reader/writer/service` tests；`tests/unit/workspace-data-codec.test.ts`、`workspace-bridge.test.ts`、`workspace-file-system-provider.test.ts`、`native-bridge.test.ts`；`scripts/plain/check-boundaries.mjs` 的 mutation fixtures；fixed patched-package runtime tests。至少覆盖 A/B read竞态、resolved model PLR1 reload mtime回拨、已解析 future-mtime模型的 preferredContents stat failure、MOVE/COPY snapshot restore、连续两次 save与 mtime回拨、tokenless unknown-fs/Windows/hardlink/symlink-parent/0444只读和同size同mtime改写、0/8 MiB/8 MiB+1、Readable/ReadableStream/ReadableBufferedStream各自单个超大chunk与无限/零进展输入在8 MiB+1停止（禁止peek/concat且write invoke=0，stat可为1）、production native invoke顶层exact Uint8Array且无request wrapper/header/JSON、non-zero byteOffset view、token malformed/null/stale/replay/cross-root/path、allowlist/unknown fs、等长改写、inode/ancestor/symlink/FIFO/device swap、target/stage chmod/chown/nlink/hardlink、16次 collision、stage replacement、sync/rename/parent-sync/postcheck组合、rename reported error但发布、unknown实际未发布、后端已写但invoke rejection/坏response、非法 result cross-field、无Retry/Overwrite UI、root lifecycle gate两种顺序，以及最终 parent/stage/target残余竞态的 deterministic hooks。格式/类型/Harness失败时不得继续后续验收。

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

### 跨 root move receipt 与 verified delete 冻结合同

move 新增独立 `workspace_move` command，但 request 继续只拥有 `sourceRootId/sourcePath/targetRootId/targetPath` 四个字段，不接受 `overwrite`、`recursive`、`force`、`confirmed`、URI、scheme 或前端 receipt。Rust DTO、TypeScript request codec 和 writer 都必须在副作用前要求两个 rootId 不同；同 root 永远使用现有 `workspace_rename`。`WorkspaceService::move_entry` 复用同一个 `run_dual_root_mutation`，mutation gate 从 copy 前一直持有到 move 结构化终态，期间不重新获取 lease、不拆 IPC，也不提供中途取消。

native response 是严格判别联合：

```ts
type WorkspaceMoveResult =
	| { readonly status: "moved" }
	| {
			readonly status: "targetPublishedSourceRetained";
			readonly reason:
				| "sourceChanged"
				| "targetChanged"
				| "sourceUnverifiable"
				| "targetUnverifiable"
				| "deleteFailed";
	  }
	| {
			readonly status: "targetPublishedSourcePartiallyDeleted";
			readonly reason:
				| "sourceChanged"
				| "targetChanged"
				| "sourceUnverifiable"
				| "targetUnverifiable"
				| "deleteFailed";
			readonly removedEntries: number;
	  };
```

`removedEntries` 是本次成功执行的 source `remove_file/remove_dir` 数，partial 时范围为 1..10,000；它不含路径或名称。`SourceRetained` 的精确定义是 Plain 成功删除了零个 receipt 成员，不承诺外部进程没有改变或移走 source。只有正式目标尚未由本次操作发布时才允许返回 `CommandError`；从 `NOREPLACE` 成功开始，任何 source/target 验证或删除问题都必须折叠为上述结果，不能让调用方误以为什么都没发生。正式目标发布后永不自动回滚，incomplete 状态不得自动重试或建立 undo。

reason 判定顺序同样冻结：每轮永远先验证 source、再验证 target；pathname missing、identity/type/content/member-set 或已冻结 metadata 字段不匹配，分别映射 `sourceChanged`/`targetChanged`。permission、I/O、最终 mode/ACL/ownership 语义导致某一端无法完成 receipt 验证，分别映射 `sourceUnverifiable`/`targetUnverifiable`；只有实际 remove syscall 失败映射 `deleteFailed`。两端同时异常时 source 先胜；删除阶段保留首先观察到的 reason。普通文件不能只比较两个当前 handle 或依赖 post-publication metadata：receipt 在 publication 前保存由稳定 source 与 staged target 双侧确认的 SHA-256 digest；每轮先独立重哈希 source，匹配后再独立重哈希 target，哪一端首先偏离 digest 就归对应 changed。协调改写成相同新 bytes 仍会偏离 receipt；开始删除后 source 可放宽的 ctime/nlink 仅限 Plain 已成功 unlink 可解释的变化，digest 永不放宽。symlink 使用完整 raw payload 作等价基线。最后 metadata-after 与 source unlink 之间仍属于已公开竞态。Rust、browser mock 和严格 codec 测试不得对相同注入点采用不同优先级。

内部新增不实现 `Serialize`/`Deserialize` 的 `PublishedCopyReceipt`。推荐由 `workspace/move_entry.rs` 消费，现有 `copy_entry` 改为调用内部 `copy_entry_with_receipt` 后直接丢弃 receipt。receipt 必须在发布前完成全部可能失败的 handle clone、路径/manifest/receipt 分配和 target 名称准备；只有原子 publication 成功才能进入 published typestate。按类型持有：

- 普通文件：source/target parent handle 与 identity、basename、source nofollow file handle 与完整 pre-copy snapshot、在 publication 前由稳定 source/staged target 双侧确认的 32-byte SHA-256 digest，以及 published target handle/identity 与 staged receipt；digest 不是从 publication 后第一次观察到的 target 生成。
- symlink：两端 parent identity、basename、symlink identity/metadata 与 raw payload；任何阶段都不解析 payload。
- 目录：`OpenSourceRoot`、完整 `DirectoryManifest`、source/target 顶层 parent identity，以及发布后的 `StagedTree` root handle、member receipts 和正式 target basename；不持有最多 10,000 个目录 FD。

执行顺序固定为：

1. 校验 different-root、四字段路径、双 lease 与现有 copy 冲突规则；copy 失败沿用“源未由 Plain 修改、正式目标未由本次发布”的合同。
2. 完成现有 file/symlink/directory source-first staged copy，所有 source/stage 最终验收、目录 mode 应用和 `NOREPLACE` 保持不变。每个 file 在 publication 前以 metadata before/after 括住流式 SHA-256：source 与对应 staged target 必须独立产生相同 digest，再把 32-byte 值写入 prepared receipt；目录成员逐个复用同一规则。成功 syscall 以无额外 fallible gap 的方式激活 `PublishedCopyReceipt`。
3. 从 source/target root capability 重新打开请求路径的 parent，并匹配 receipt 记录的 parent identity；只持有旧 parent handle 而当前 root-relative 路径已经跳到别处时，不允许删源。
4. 在零个 source 删除副作用下完整重验 source。file 比 pathname/handle snapshot，并在 before/after 间流式重算 SHA-256、匹配 receipt；symlink 比 before/raw payload/after；目录重建完整 manifest 并逐文件匹配 digest。
5. 完整重验已发布 target。file 的 pathname/handle 必须匹配 published identity/type/len/final mode，并在 before/after 间流式重算 SHA-256、匹配同一 receipt digest；symlink 比 target identity/metadata 与 receipt raw payload；目录从 published root/receipts 验证成员集合、目录最终 mode、每个 pathname/handle identity、file digest 和 raw link。任何 missing、replacement、未知成员或 target metadata/content/mode 改写都保留 source 并返回 `targetChanged`；任一 published member 因最终 mode、未复制的 ACL/ownership 语义或 I/O 而无法重新打开，则保留 source 并返回 `targetUnverifiable`。
6. target 验收期间同时逐项复核 source，结束后再次重验 source 顶层与完整 manifest，避免较早检查过的 source 成员在较晚 target 检查期间变化。
7. 对 file/symlink，立即再做一次两端 paired receipt 验证后只调用 source parent 的 capability-relative `remove_file`；成功即 `moved`，失败为 retained。
8. 对目录，消费 manifest 生成的 bounded delete plan：manifest entries 逆序删除 leaf/空目录，最后删除根。每个 source leaf 删除前重验 source 顶层 basename、identity/type 与对应 published target；文件两端分别重算并匹配 receipt digest，symlink 两端再比 receipt raw payload。每个目录删除时逐层 nofollow 打开、匹配 receipt identity/mode，并确认其 receipt child 已全部删除且当前集合为空；`remove_dir` 失败即停止。
9. 删除完全部 source 后返回 `moved`；任何中途问题按已成功 remove 数返回 retained 或 partial。不得删除/修改 target，不得恢复 source，不得为了收尾遍历未知成员。

file verifier 和 symlink 一样必须括住整个比较窗口：source 与 target 分别取得 pathname/handle metadata before，在各自窗口内完成有界流式 SHA-256，再取得各自 pathname/handle metadata after；before/after 必须匹配当前允许的 metadata 基线，两个 digest 必须分别匹配 publication 前 receipt。不能只在读取前看一次 identity，不能把 source 的 after 当成 target 的 after，也不能仅凭“当前两端相等”替代各自 receipt 验收。

删除开始后插入的未知成员绝不由 Plain 删除；为保持线性预算，不在每个 leaf 前重扫整个 parent。它最迟在包含目录执行 `remove_dir` 前由空集合检查发现，因此可能在其他 receipt leaf 已删后返回 partial。该延迟发现是冻结合同，不宣称“未知成员出现即立即停止”。

目录 deletion verifier 不能继续机械比较原始完整 `DirectorySnapshot`：移除 child 会合法改变 parent 的 mtime/ctime，移除同 inode hardlink 会改变其余 alias 的 ctime/nlink。任何 source 删除前仍做一次完整严格 preflight；开始后目录只比较 identity、mode 和应为空的剩余集合。普通文件与 symlink 按 identity 分组，source snapshot 增加 `nlink`，并维护 `original_nlink - Plain 已成功移除的同 identity alias 数`；后续 source alias 允许由该已知 unlink 导致的 ctime 变化，但仍要求 expected nlink、identity/type/mode/size/mtime，file SHA-256 与 receipt 相同，raw payload 与 receipt 相同。对应 target 也必须独立匹配同一 digest/payload，不能把当前 source 当 target 的内容基线。外部对这些可比较字段或 link count 的可观测、未抵消变化必须停止；Plain 第一次成功 unlink 后发生的外部 source ctime-only touch、恢复原值的抵消变化，以及未纳入 receipt 的 owner/xattr/ACL 变化不可判别，属于已公开的同 UID 竞态边界。

所有 source 删除继续使用 `cap_std::Dir::remove_file/remove_dir` 的 parent-handle + basename 形式；没有 conditional unlink 原语，因此最后一次 identity 检查与 syscall 之间的同 UID rename/swap 竞态仍是公开边界。target 也可能在最后验收后、source unlink 前被外部删除、替换或改写，所以 `moved` 只描述最后观察和成功 syscall，不构成跨文件系统事务。禁止 `remove_dir_all`、`remove_open_dir`、`remove_open_dir_all`、ambient `std::fs`、直接 `unlink/unlinkat`、shell/`std::process`、walker、follow-capable directory open 和“先移到 tombstone 再后台删”。单次目录 move 最多成功执行 descendants + 1 个删除 syscall；每轮文件比较受 8 MiB/256 MiB 逻辑字节预算，link 比较受 4 KiB/2 MiB 预算，名称、深度和成员仍受原 manifest 上限。

Browser mock 使用同一 detached copy 先发布 target，再消费不可伪造的内存 receipt；新增 after-publication/before-delete/after-delete-entry 测试 seam，模拟 source/target replacement 与第 N 项失败，并返回冻结的同构结果。Harness 必须锁定唯一 command/registration/service route、different-root request、receipt 不跨 Serde/IPC、发布后不再普通 error、target 不回滚，且 file receipt 必须在 publication 前形成。SHA-256 依赖合同必须从 `cargo metadata` 同时核对：direct edge 唯一、未重命名、normal runtime、无 target、非 optional、精确 `=0.10.9`、`uses_default_features=false`、显式 `features=[]`；resolved `sha2@0.10.9` 只允许现有传递依赖带来的 `default/std`，禁止任何额外 feature，并为每个字段提供负例。source `remove_file/remove_dir` 只允许出现在受审计 move 模块且参数必须是已打开 parent handle 下的 basename，现有 writer/directory staging cleanup 保持精确 allowlist。另须禁止 `remove_open_dir(_all)`、`remove_dir_all`、直接 unlink、目录 follow、walker、ambient fs 与 process/shell 绕过。当前工作项不修改 provider capability 或 pnpm patch；provider 继续 `Readonly`。

实现验收至少覆盖：file、raw symlink、空目录、可重新验证 mode 的 mixed tree 正常 move；same-root、未授权、非法路径、特殊文件、超限、缺失 parent 和既有 target 的零副作用；publication 后 source/target basename swap、missing、同 inode 等长改写、恢复时间戳的等长改写、source/target 协调改成相同新 bytes、chmod、link payload 与目录成员变化；任一嵌套 target 因最终 mode/ACL/ownership 语义不可重新打开时 source 零删除并返回 retained/targetUnverifiable；删除前变化必须零 source remove，删除中第 N 项变化/权限失败必须给出精确 partial count；hardlink alias 正常完成且外部 nlink 变化失败；只读 source 不擅自 chmod；外部/dangling/loop link 不触碰 sentinel；双 root 撤销、window close 和并发目标竞争均保持 mutation gate/no-clobber 合同。TypeScript 另覆盖 strict request/result codec、unknown key/enum/prototype 拒绝和所有完整 bridge stub。

### 确认删除的批量永久删除冻结合同

首版只实现永久删除，不增加系统 Trash。Plain provider 不声明 `Trash` 或 `FileAtomicDelete`，其 adapter 收到 `useTrash: true` 或非 false `atomic` 必须在任何 plan/磁盘副作用前 fail closed；回收站失败也绝不能自动降级为永久删除。Workbench 原始 Delete、Shift+Delete、Bulk Edit、WorkingCopy 与 FileService 的确认/重试/程序化入口不能分别拥有删除权威，未来解除 `Readonly` 时必须统一进入 Plain 自有 delete coordinator。

wire 拆成四个严格 command：

```ts
type WorkspacePrepareDeleteRequest = {
	readonly entries: readonly {
		readonly rootId: string;
		readonly relativePath: string;
		readonly recursive: boolean;
	}[];
};

type WorkspaceDeleteBatchPlan = {
	readonly confirmationId: string;
	readonly entries: readonly {
		readonly entryId: string;
		readonly kind: "file" | "directory" | "symlink";
		readonly descendantEntries: number;
	}[];
};

type WorkspaceDeleteBatchRequest = {
	readonly confirmationId: string;
};

type WorkspaceCommitDeleteEntryRequest = {
	readonly confirmationId: string;
	readonly entryId: string;
	readonly rootId: string;
	readonly relativePath: string;
	readonly recursive: boolean;
};
```

- `workspace_prepare_delete(request) -> WorkspaceDeleteBatchPlan`：`entries` 必须有 1..64 项；每个 `relativePath` 不能为空、不能代表 workspace root，且同一批次不得重复或存在 ancestor/descendant 重叠。同 root 相同 wire path 先直接判 duplicate；随后每个顶层 pathname 都以 parent capability + requested basename 打开/查询并绑定 handle identity，任意两个顶层若解析到相同 file/symlink/directory identity 都返回 `WORKSPACE_CONFLICT`，因此大小写/Unicode normalization alias 与真实不同名称 hardlink 都 fail closed。ancestor overlap 另以所选 directory identity 是否包含在另一项 parent chain/manifest 判定，覆盖嵌套授权 root。hardlink journal 只处理同一所选目录 manifest 内的 aliases，避免一个顶层已完整删除后还需用不可表达的 batch 状态报告余项 rebaseline 失败。禁止为了恢复 actual name 枚举可能无界的外部 parent siblings；单个请求使用文件系统实际解析到且由 receipt 绑定的 pathname identity。`recursive: false` 遇到非空目录返回稳定 `DIRECTORY_NOT_EMPTY`。普通文件、空目录和 symlink 的 `descendantEntries` 为 0；全批次共享 10,000 descendants 预算。response 顺序与输入完全一致，但只返回随机 `entryId`、kind 与计数，不返回 rootId、basename、相对/绝对路径、manifest、identity、metadata、raw link 或 receipt；UI 按 index 与已有 Explorer URI 构造显示名，不能把 Rust 清洗错误当作路径回传通道。
- `workspace_cancel_delete({ confirmationId }) -> null`：只允许丢弃同窗口仍处于 prepared 状态或尚未执行的剩余 batch；不存在、过期、跨窗口、已完成或已取消 token 返回相同的 `WORKSPACE_DELETE_PLAN_INVALID`，不暴露 token 是否属于其他窗口。首项删除前取消绝无文件副作用；执行开始后的取消只丢弃尚未开始的 entries，不能中断已经进入 verified-delete 的单项。
- `workspace_begin_delete({ confirmationId }) -> null`：只在 UI 已确认后调用；在同一 mutation gate 内取得 prepared batch，按输入顺序对全部 entry 做零副作用 revalidation，成功才把 phase 从 prepared 改为 executing。任一项变化或不可验收分别返回 `WORKSPACE_DELETE_BATCH_CHANGED`/`WORKSPACE_DELETE_BATCH_UNVERIFIABLE`，失效整批且不返回 failed entryId；不能把 entryId 塞入可解析的错误 message。begin 必须发生在 Bulk Edit 读取 Undo 内容、WorkingCopy participants/soft-revert 和任何 provider delete 之前。
- `workspace_commit_delete_entry(request) -> WorkspaceDeleteResult`：`confirmationId + entryId + rootId + relativePath + recursive` 必须全部匹配 executing batch，且 entryId 必须是输入顺序中的 next pending entry；跳项、并发不同项和重排一律无副作用返回 `WORKSPACE_DELETE_PLAN_INVALID`。所有 batch 操作统一先取得 mutation gate，再短暂锁 batch state；commit 在 gate 内验证 token/phase/revision/next entry 后才把当前 receipt 标记为唯一 in-flight，释放 state lock但始终持有 gate执行 verified-delete，终态后再锁 state 更新或销毁。cancel/过期/root 生命周期操作等待同一 gate，因此不能抢走 in-flight receipt。token/entry 在参数 codec、窗口检查、过期检查或标记 in-flight 前失败时走普通 `CommandError`；一旦当前 entry 进入 verified-delete，所有可能已产生该 entry 删除副作用的终态只能使用下述严格结果。

每个窗口最多存在一个 active batch，默认 120 秒单调时钟 idle TTL；有未过期 batch 时再次 prepare 返回 `WORKSPACE_CONFLICT`，UI 必须先 cancel。`workspace_begin_delete` 成功后进入 executing phase，每个正常 entry 终态刷新 idle deadline，避免大批次因前一项执行时间自然过期；retained/partial、取消或普通 entry mismatch 立即丢弃全部剩余 receipt。显式 cancel、root replace/remove、picker 成功替换/新增授权和 window close 都在 `mutation gate → batch/workspace state` 锁序下使 batch 失效；expired batch 在下一次 prepare/cancel/begin/commit 时于同一锁序清除。batch token 与每个 entryId 都是独立 128-bit UUID v4，绑定窗口、创建时 workspace revision、严格有序的 rootId/path/recursive 选择和 Rust-only `DeleteBatchReceipt`。receipt 不实现 `Serialize`/`Deserialize`，不跨 IPC，不跨窗口，不持久化，也不在确认期间保留目录 handle；确认 gap 后必须从各自当前 root capability 重新打开全部 parent chain。

UI coordinator 的顺序固定为：对 `distinctParents` 后的完整选择集一次 prepare → 根据 batch plan 与当前 Explorer 选择显示一次“永久且不可撤销”确认 → confirm 后立即 begin 整批 preflight → 为每项创建带调用级删除授权的 `ResourceFileEdit` → Workbench 按项调用 provider 时逐项 commit；cancel/关闭对话框后 cancel。它不能传 `confirmed: boolean`、不能自行构造 token、不能跳过 prepare/begin。provider.delete 必须从当前调用 options 收到并同时匹配 batch token、entryId、URI/root/path、`recursive` 与永久删除模式，不能从全局 active context 仅凭同 URI/options 取“下一项”；任何没有授权 metadata 的 FileService/provider delete 都 fail closed。

调用级授权需要在固定 `5264f` 基线上做窄 patch：Plain coordinator 把私有 authorization 写入 `ResourceFileEdit` options；`BulkFileEdits` 只透传到 `IDeleteOperation`，`WorkingCopyFileService` 只透传到 `FileService.del`，`FileService` 最后只传给同一 `plain-workspace:` provider 的 `IFileDeleteOptions`。authorization 不能进入通用扩展 API、undo/redo 序列化、日志或其他 scheme；非 Plain provider 看到它必须拒绝。这样另一条相同 URI/options 的程序化 FileService 调用没有调用级 capability，不能抢先消费 entry。

Plain 永久删除不读取 Bulk Edit 的 <=5 MB Undo 内容、不为文件或目录创建上游 CreateEdit/Undo，并把 working-copy soft revert 从“全批删除前”改为“对应 provider entry 已返回 `deleted` 后”。participants/will-event 可以在 begin 后运行，但它们或外部进程造成的变化仍由每项 commit 重验；retained/partial/普通 mismatch 时当前和未执行项的 dirty working copies 保持原状。首个原生 remove 前 Workbench cancellation 可以 cancel 整批；某项进入 verified-delete 后必须运行到明确终态，取消只阻止剩余项。`explorer.confirmDelete=false` 不适用于 Plain 永久删除；dirty/readonly prompt 设置的 `skipConfirm`、上游 Retry 与任何无 authorization 的 `ResourceFileEdit`/FileService 入口也不得绕过 coordinator。provider 激活补丁还必须把 Plain 的普通 Delete 明确路由为 permanent，不能先展示 Trash 文案再由 Bulk Edit 静默改为永久。

opaque batch token 绑定的是“用户一次看到的完整选择集”与“最终逐项重验的磁盘对象”，避免自由布尔值、重放、错 URI/options 和确认期间 TOCTOU；它本身不能密码学证明 WebView 真的渲染并点击了对话框。这里的确认是产品 UX 不变量，文件授权安全仍由 Rust root capability、mutation gate 与 verified-delete 提供。选择 Workbench 内的中央 coordinator 而不是在单项 Rust command 内弹原生 blocking dialog，是因为 provider delete 需要正确表达取消、dirty working copy、多选整体预览和按项 partial；原生单项弹窗会在上游已经 soft-revert 后才出现，取消只能被误报为 provider 成功或普通失败，并对多选重复弹窗。Harness 必须用唯一调用路径、CSP、无通用 Extension Host 和运行时排除面守住 coordinator；若未来把恶意 WebView 纳入“必须强制人类点击”的威胁模型，必须另立 native confirmation capability，不能宣称当前 token 已解决该问题。

#### Rust-only delete receipt 与资源预算

delete 不复用 copy 的内容预算或 SHA-256 receipt。普通文件可以大于 8 MiB，目录逻辑文件字节可以大于 256 MiB；prepare/commit 都不得读取普通文件内容。receipt 只冻结 capability-relative namespace 与当前 entry 身份：每层 parent identity，basename，pathname/handle identity，kind、mode、size、mtime、ctime、nlink；symlink 另存完整 raw payload。普通文件内容写入会产生可观察 ctime 变化；同 UID 无法把 ctime 恢复为旧值的当前平台上据此停止。特权进程、无法表达的 owner/xattr/ACL 变化和最后检查到 unlink 之间的 swap 继续是公开竞态，不把 metadata receipt 宣称为内容级或跨进程事务。

目录 receipt 使用独立 source-only manifest：每个顶层根 header 不计 descendants；全批次 descendants 最多 10,000，每个根 depth 0/最大 256，单名 1 KiB、全批次 descendant 名称总量 2 MiB，单 raw link 4 KiB、全批次 raw link 2 MiB，所有累计 checked arithmetic。目录逐层 `open_dir_nofollow`；symlink 永不解析；FIFO、socket、设备和未知类型首版返回 `ENTRY_TYPE_MISMATCH`，不得删除部分可识别成员后才发现特殊项。同一顶层目录 manifest 内的 file/symlink identity 纳入 hardlink group，跨顶层 identity 冲突已在 prepare 拒绝；prepare 完成全部 manifest 后必须在零副作用下从各 root 重建并精确比较整个 batch 一次，才可注册 plan；超限分别返回既有 `DIRECTORY_TOO_LARGE`、`FILE_TOO_LARGE` 或 `PATH_ENCODING_UNSUPPORTED`。

prepare receipt 记录普通文件/目录/symlink identity 与各顶层目录 manifest 内的 hardlink groups，但不跨确认 gap 保留打开 handle。它只允许为同窗口 active batch 占用一份有界 manifest，TTL/取消/生命周期失效都释放内存。Browser mock 保存 detached、冻结且不可伪造的等价 receipt，observer 只能收到冻结安全摘要；不能把前端可修改 plan 对象当作删除权威。

#### Commit 与结构化终态

begin 与每个 entry commit 的执行顺序固定为：

1. begin 取得 mutation gate，验证 window、prepared phase/revision 与全部 entry 的 root 授权，重新从各 root 打开 parent chain并做一次完整 input-order preflight；root 空路径永远拒绝。失败返回 `WORKSPACE_DELETE_BATCH_CHANGED` 或 `WORKSPACE_DELETE_BATCH_UNVERIFIABLE`、失效整批且零 remove，成功只把 phase 标为 executing。每个 commit 随后在同一锁序验证 next entry，并再次完整重验当前 entry，防止 participants、前项执行或外部进程造成的变化。
2. 在当前 entry 零 remove syscall 下完整重建并比较 prepare receipt：pathname/handle identity、kind、mode、size、mtime、ctime、nlink、目录成员集合与 symlink raw payload 都必须匹配。每个 entry 不可暂停/恢复，因此 mutation journal 只在随后当前 entry 的删除循环内生效；`recursive: false` 再次验证目录为空。
3. 把当前 entry manifest 变成 leaf 逆序、directory 逆深度、根最后的固定 bounded plan；每个节点都只携带已验证 parent-relative path 与 receipt，不接受运行时 walker 新发现的成员。
4. 每次删除前从当前 root 逐层 nofollow 打开 parent，重新确认顶层与当前 entry。file/symlink 均只调用已打开 parent 的 `remove_file(basename)`，目录只调用 `remove_dir(basename)`；symlink 不跟随，特殊文件在 prepare 已拒绝。禁止 `remove_dir_all`、`remove_open_dir(_all)`、ambient `std::fs`、直接 `unlink/unlinkat`、walker、shell/`std::process`、Trash/OS URL 和 tombstone/background cleanup。
5. 对所选顶层目录 manifest 内的 descendant，每个成功 remove syscall 递增 `removedEntries` 并追加 Rust-only mutation journal：从对应 manifest-owned parent 的 expected residual member set 精确移除该 namespace entry；affected hardlink group 的 expected nlink 减一。若仍有 manifest alias，立即从一个仍存在的已知 alias nofollow 重开并验证 identity/type/mode/size/mtime/expected nlink，再把 observed ctime 设为全组新基线；manifest-owned parent 同样立即重开、验证 identity/mode，再把 observed mtime/ctime 设为新基线。下一步只接受该 journal 后的 residual set/nlink/基线，不能继续比较原始完整 manifest，也不能笼统忽略 ctime。
6. 顶层 entry 的外部 parent 不属于 receipt-owned manifest：只冻结 parent identity、requested basename 与该 pathname 实际解析到的 entry identity，不枚举或冻结其可能无界的其他 siblings、portable name、special type、member set 或 mtime/ctime。顶层 file/symlink/empty-directory 或递归目录根成功 remove 后，当前 entry 已完整删除，必须无额外 fallible rebaseline gap 地返回 `deleted`；其 root remove 不计入 partial `removedEntries`。因此 partial 上界仍是 descendants 10,000，而不是 10,001。
7. descendant mutation journal 的 rebaseline 发生在 unlink 之后，若验证失败已经属于 retained/partial；外部同 UID 改动若恰好落在成功 syscall 与立即重采样之间，可能被吸收为新基线，这是明确公开的窄竞态。未知或 replacement 成员仍绝不删除；为保持线性预算，不在每个 leaf 后枚举完整 parent，而在自然遍历与 manifest-owned directory 最终 residual/empty 检查时发现，最迟在 `remove_dir` 前停止。
8. 当前根项成功删除后，post-root batch state 更新必须使用不可失败的 poison recovery/typestate：即使不能安全继续下一项，也只能返回 `deleted` 并失效余项，不能把已经完整删除的 entry 改写为 partial/普通 error。此前任何停止都按 descendant remove 计数返回 retained/partial并立即丢弃剩余 entries。不得自动恢复已删除成员、重试剩余计划、注册 Undo。最后一个 entry 完成后销毁 batch。

严格结果为：

```ts
type WorkspaceDeleteResult =
	| { readonly status: "deleted" }
	| {
			readonly status: "entryRetained";
			readonly reason: "entryChanged" | "entryUnverifiable" | "deleteFailed";
	  }
	| {
			readonly status: "entryPartiallyDeleted";
			readonly reason: "entryChanged" | "entryUnverifiable" | "deleteFailed";
			readonly removedEntries: number;
	  };
```

pathname missing、identity/type/metadata/member-set/raw payload 不匹配归 `entryChanged`；permission/I/O 导致不能完成 receipt 验证归 `entryUnverifiable`；只有实际 `remove_file/remove_dir` syscall 失败归 `deleteFailed`。第一次成功 remove 前失败返回 `entryRetained`；至少一次后失败返回 `entryPartiallyDeleted`，`removedEntries` 必须是 1..10,000。retained 只表示 Plain 成功执行了零个 remove，不保证外部进程没有同时改变路径。最终 entry identity 检查和 remove syscall 之间仍没有 expected-inode conditional unlink，必须继续公开这一同 UID 竞态。

provider 遇 retained/partial 必须先发布 root dirty/rescan/file-event 提示，再丢弃 batch 剩余 entries；Plain coordinator 保存严格 `WorkspaceDeleteResult` 用于品牌化错误提示，而 provider 对 Workbench 只映射到标准 `FileSystemProviderErrorCode.Unavailable`，不虚构上游不存在的自定义 provider code。不得上报 DELETE 成功、建立 Undo、自动 retry 或启用上游 `ignoreIfNotExists`。coordinator 对多选先整体 prepare/显示一次确认，再按 plan 输入顺序让 provider 消费精确 entryId，并记录每项结构化结果。任一项 ordinary mismatch 或 incomplete 后停止未执行项并刷新所有涉及 root，不能照搬 Workbench 普通数组循环和“忽略已不存在后整批重试”。

Harness 必须锁定：四个 command/registration/service 唯一路由；prepare batch/request、begin phase、调用级 authorization、entry binding 与 plan/result 严格闭集；receipt 无 Serde/IPC；1..64 顶层、单 active batch、120 秒 idle TTL、窗口/revision/有序 root/path/options/一次性 token+entry 绑定；统一 `mutation gate → state`、单 in-flight；begin whole-batch preflight 与每项 remove 前完整 preflight；Plain Bulk 不读 Undo 内容且只在 deleted 后 soft-revert；普通文件不读取/hash 且不受 copy byte budget；全批次目录仍受 namespace/link 预算；只允许受审计 delete 模块中的 parent-handle `remove_file/remove_dir`；禁止所有递归/ambient/Trash/process 绕路；生产 TS 中 begin/commit 只能从 delete coordinator → fixed-patch authorization → provider 路径可达；provider 当前继续 `Readonly` 且无 `Trash`/`FileAtomicDelete` capability。每一条必须有对应负例，不能只搜索正例字符串。

实现验收至少覆盖：单项和 64 项 batch 的 prepare/cancel/begin/逐项 commit，正常 file、空目录、raw symlink、mixed tree 与跨 root 选择；duplicate namespace/ancestor overlap、大小写/Unicode normalization alias、跨顶层相同 identity 拒绝，但同一目录 manifest 内不同真实名称的 hardlink 允许；大于 8 MiB 文件和逻辑字节大于 256 MiB 目录可 prepare；全批次 exact/+1 条目、深度、名称与 link 预算；root 空路径、non-recursive 非空目录、特殊文件、非法/未授权路径零副作用；token/entry unknown、expired、replay、错 URI/options、无调用级 authorization、cross-window、第二 batch、root replace/remove/window close；begin whole-batch preflight 能在 Undo read/soft-revert/首个 remove 前发现末项变化，相关调用计数为零且 dirty 内容不变；确认期间 source/parent basename swap、missing、同 inode内容/metadata变化、chmod、manifest 内 hardlink 外部 nlink、link payload、目录增删改；删除前变化零 remove，删除中第 N 项 change/unverifiable/remove failure 返回精确 partial并取消余项；mutation journal 的 residual set、parent time 与 hardlink rebaseline 正常且采样窗口边界有测试；顶层外部 parent 的超大/特殊/非 portable siblings 不进入 receipt且不阻塞；第 10,000 个 descendant remove 后失败仍可编码，root remove 后无 fallible gap；未知成员和外部/dangling/loop link不触碰 sentinel；并发两个相同 entry commit 至多一个消费，跳项/不同 entry 并发无副作用拒绝。TypeScript codec 必须用冻结 prepare request 验证 response entries 长度严格相等、entryId 全局唯一、count 为安全整数且总和 ≤10,000，并覆盖 accessor/Proxy TOCTOU、prototype/unknown key/enum 拒绝、冻结 batch plan/result、cancel finally、observer exception 与完整 bridge stub。Browser mock 新增 delete 专用共享 inode/metadata 节点、parent version、mutation journal 与可注入单调 clock；两个 manifest 目录项可引用同 inode，observer 只能变异模型而不能直接指定终态，Rust/browser 的 begin/reason 优先级、hardlink accounting 和 removed count 必须完全同构。

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
11. `wv1`/静态 writer eligibility、`PLR1` 同 handle read、tokenless readonly、FileService read receipt和两个 model 的 read/buffer baseline patch，完成对应 Rust/TS/package/Harness验证后立即独立提交；provider保持只读。
12. `PLW1` raw codec、Rust staged writer、post-rename typestate、严格 bridge/Browser mock合同，完成原生命令与故障矩阵验证后立即独立提交；尚无 Workbench 写 consumer，provider保持只读。
13. FileService bounded collector/write receipt、provider result/rescan seam、dispatch 后 unknown分类和两个 save error handler的无 Retry/Overwrite UI，完成 package/runtime/Harness验证后立即独立提交；provider仍保持只读。
14. 增加严格 `workspace_capabilities` DTO、copy/move 同路径/overwrite/mkdirp/generic fallback/cross-scheme 窄 patch，并按 Rust 平台能力激活 provider 写能力、精确文件事件与 Explorer Browser E2E；不支持安全 rename 的平台继续只读。
15. watcher 的有界 dirty/rescan 状态机、浏览器 mock 收敛测试与真实 Tauri 文件树验收。

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
- 版本化写覆盖 `PLR1/PLW1` raw frame、tokenless readonly、0/8 MiB/8 MiB+1与无界 stream、opaque token 缺失/旧值/重放、任意 buffer baseline失效、等长外部改写、mtime 回拨、target/stage identity swap、symlink/hardlink/special mode 拒绝、sync/rename/parent-sync/current-root post-publish故障、IPC outcome unknown、无盲目 Retry UI、root 生命周期 gate，以及 fixed FileService/model patch 对 Plain/非 Plain、force/autosave 和 buffered fallback 的正负路径。
- Browser mock 验证 Explorer 展开、文本打开和排除 surface；真实 Tauri 验证原生 picker、文件树展开、取消和外部变化收敛。
