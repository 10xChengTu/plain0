# ADR 0004：目录 capability 是工作区文件权限边界

- 状态：接受
- 日期：2026-07-18

## 背景

Plain 必须让用户打开任意本地目录并进行文件树 CRUD，同时 WebView 不能获得全局文件系统权限。常见的 `canonicalize(root.join(relative))`、字符串 `starts_with(root)`、再调用 `std::fs` 的方式会把安全检查和实际打开分离；攻击者或外部进程可以在两者之间交换 symlink，导致 TOCTOU 越界。

Tauri `plugin-fs` 的 scope 适合限制通用前端文件 API，但其核心仍是 glob/canonicalize，并不能替代编辑器所需的 handle-relative 权限模型。它也会扩大 capability 和前端绝对路径接口，与 Plain 的窄 command 边界冲突。

## 决策

- 每个 Tauri 窗口持有独立 `WorkspaceScope`；root 只能由 Rust 原生目录选择器授权，WebView 不得传入任意绝对路径创建授权。
- 每个授权 root 打开并持有独立 `cap_std::fs::Dir`，以随机 opaque `rootId` 暴露给前端。相同目录身份的重复授权复用 id；重叠 root 可以独立存在。
- IPC 文件路径固定为 `(rootId, relativePath)`。`relativePath` 使用 `/` wire format；解析器拒绝 absolute/prefix、`.`、`..`、空组件、NUL、反斜杠及 Windows drive/UNC/device/ADS 歧义，并设置长度与段数上限。
- 所有 stat、read、create、rename、copy、move 和 delete 都通过 root `Dir` 或从它打开的子目录 handle 执行。canonical path 只作为 Rust 私有的显示、文件身份去重和 watcher 元数据。
- 普通 rename 只允许同 root 且默认 no-clobber；跨 root move 只接受两个不同且明确授权的 rootId，并在同一次 mutation gate 内执行 copy + published receipt 验收 + verified delete。同 root 永远走原子 rename，不能退化为 copy/delete。
- copy 使用两个显式 rootId，并在同一窗口 mutation gate 内重验两个 lease；不接受 overwrite。普通文件先写目标父目录内由应用创建的高熵命名 staging，再以原子 no-replace 发布。目录 copy 必须先完成有界 manifest，symlink 按链接本身复制，特殊文件拒绝。内部 copy 返回不可序列化、一次性 `PublishedCopyReceipt`：普通 copy 直接丢弃，跨 root move 在释放 gate 前消费；receipt 同时绑定 source 的完整 pre-copy snapshot、两侧 parent/pathname/handle/identity，以及 publication 前由稳定 source 与 staged target 双侧确认的 file SHA-256 或完整 raw symlink payload，目录还绑定完整 manifest/member receipts。正式目标发布前失败仍是普通错误；发布后不得回滚目标，也不得再用普通错误隐藏磁盘事实。
- 跨 root move 删除 source 前必须完整重验 source 和 published target；目录只按 manifest 生成的有界逆序计划调用 capability-relative `remove_file/remove_dir`，禁止 `remove_dir_all`、walker、shell、ambient fs 或 tombstone 后台删除。零个成功 source remove 后失败报告 `targetPublishedSourceRetained`；至少一个成功后失败报告 `targetPublishedSourcePartiallyDeleted` 和有界计数；reason 固定为 `sourceChanged`、`targetChanged`、`sourceUnverifiable`、`targetUnverifiable` 或 `deleteFailed`。每轮 source/target 分别在 metadata before/after 间重算 SHA-256 并按 source-first 顺序匹配 publication 前 receipt；不以当前两端相等或 post-publication snapshot 代替内容基线。hardlink 在 preflight 严格验收，删除阶段按 identity 跟踪由 Plain 自己造成的 source nlink/ctime 变化，并继续比对 expected nlink、type/mode/size/mtime 与 file digest/raw payload。自身首次 unlink 后的 source ctime-only 外部变化、恢复原值的抵消变化和未纳入 receipt 的 owner/xattr/ACL 不可判别。source receipt 校验与 pathname 删除之间、target 最后验收与 source 删除之间都可能发生外部同 UID rename/swap，因为当前平台没有跨文件系统事务或 expected-inode conditional unlink；这些结果只描述 Plain 已观察和成功执行的操作，不能宣称跨进程原子。
- 通用永久删除采用 Plain 自有的 prepare/confirm/begin/逐项 commit 批量协调器，不接受 `confirmed: boolean`。一次 prepare 只允许 1..64 个无重复、无 ancestor/descendant 重叠的顶层 namespace entry，在 mutation gate 内建立并二次重验 Rust-only `DeleteBatchReceipt`；每项以 parent capability + requested basename 打开并绑定 pathname/handle identity，任意跨顶层相同 identity 首版 fail closed，同一目录 manifest 内的 hardlink aliases 才进入 identity group。外部 parent siblings 不为恢复 actual name而枚举。WebView 只收到窗口绑定、120 秒 idle TTL、一次性 batch token、每项 entryId 与 kind/count 摘要。UI 对整个选择集确认一次后，begin 必须在 Undo read/soft-revert/首个 provider delete 前重验全批；固定 Workbench patch 再把 token + entryId + root/path/recursive 作为调用级 authorization 从 `ResourceFileEdit` 透传到同一 Plain provider，缺少授权的 FileService delete fail closed。所有 batch 操作统一 `mutation gate → state`，单 in-flight、严格输入顺序；每项在自身删除前再重验。token 只绑定确认快照并防重放/错项，不能证明第一方 WebView 真的显示了对话框；确认是由唯一 Workbench coordinator、CSP、无 Extension Host 与 Harness 守住的产品不变量，文件授权安全仍由 Rust capability/gate/receipt 提供。
- 删除 batch 全局使用 10,000 descendants、256 层、1 KiB 单名、2 MiB 名称、4 KiB 单 link/2 MiB links 预算并拒绝特殊文件；但它不读取或 hash 普通文件，也不继承 copy 的 8 MiB/256 MiB 内容上限，因此任意大小普通文件仍可删除。receipt 绑定 parent/pathname/handle identity、type/mode/size/mtime/ctime/nlink 与 raw symlink payload。删除只消费固定 manifest，以 parent capability + basename 逆序调用 `remove_file/remove_dir`；每次成功 descendant unlink 通过 Rust-only journal 移除 residual member、递减 nlink，并立即从剩余 manifest alias/parent 重采 ctime/time 基线。顶层外部 parent 不枚举无界 siblings、不冻结 time/member set；根 remove 成功后无额外 fallible gap并直接返回 `deleted`，partial 只计最多 10,000 descendants。syscall 与重采样之间的同 UID 改动可能被吸收，是公开竞态；未知成员不删。禁止所有递归 helper、ambient path、walker、Trash、直接 unlink、shell 或 tombstone cleanup。零 descendant remove 后停止返回 `entryRetained`，一次以上返回 `entryPartiallyDeleted` 和 1..10,000 计数，reason 只允许 `entryChanged`、`entryUnverifiable` 或 `deleteFailed`。任一不完整项使 batch 余项失效且不得自动重试或建立 Undo；Plain permanent delete 不读取 Bulk Undo 内容，working copy 仅在对应 entry `deleted` 后 soft-revert。
- 首版不实现系统 Trash，也不声明 Workbench `Trash`/`FileAtomicDelete` capability。`useTrash: true` 或上游 `atomic` 在任何 plan/磁盘副作用前 fail closed；回收站失败不得静默降级为永久删除。系统 Trash 需要 root 外 ambient OS API、跨卷与逐项 partial 的独立平台威胁模型，不能借通用 crate 绕过 capability ADR。
- 目录 manifest header 单独记录 source 根；descendants 最多 10,000，根 depth 为 0、最大 256，单名 1 KiB、descendant 聚合名称 2 MiB，单 link 4 KiB、聚合 link 2 MiB，单文件 8 MiB、聚合逻辑文件字节 256 MiB。source 根和正式 target basename 不计聚合名称，但各自仍受 1 KiB 限制。所有累计使用 checked arithmetic；非 UTF-8/portable-invalid 名称失败，symlink 不跟随，特殊文件失败。
- 目录目标副作用只在 source manifest 完成并重验后开始。目标父目录 identity 不得命中 source 的任何目录；顶层 staging 目录为高熵、exclusive、初始 `0700`，完整 staged tree 与 source 在发布前再次核对，最后只复用既有 `NOREPLACE`。清理只按 identity/payload receipt 有界逆序删除，禁止 `remove_dir_all`；发现 replacement 或未知成员时宁可留下 artifact。
- 每窗口写操作与 root replace/remove/window close 共享 mutation gate，并统一按 `mutation gate -> workspace state` 获取锁。写操作拿到 gate 后必须重验 lease；不得复用读取的事后撤销校验，因为已经发生的磁盘副作用无法丢弃。
- existing 普通文件保存采用无服务端表的 `wv1:<sha256>` opaque version，绑定 rootId、规范化相对路径、allowlisted/read-write filesystem 和 Unix nofollow identity/size/mode/uid/gid/mtime/change-time/nlink；只有共享静态 writer eligibility可证明 effective uid/gid、target owner-write与同 owner parent write+execute/stage ownership时才签 token。普通 Explorer stat 不读取内容，也不维护“最近 stat”缓存；不满足签发条件的普通文件和 root 内 symlink仍可用 `PLR1 versionLen=0` 只读打开，provider固定映射 `ETAG_DISABLED + Readonly`。Rust `PLR1` read-with-stat 把 bytes 与同一稳定 handle 的 stat/version 一次返回；其Raw response在JS严格接受Tauri固定的ArrayBuffer channel或macOS/iOS/eval fallback dense number[]后立即复制，绝不拆成独立metadata IPC。固定 Workbench patch贯穿该 read receipt和私有 write receipt，避免首次并发 stat/read及保存后独立 resolve配错 token；两个 model 对权威 read/write receipt即使mtime回拨也整份接纳，对 preferredContents/MOVE/COPY任意 buffer则无条件换成 `plain-buffer-no-baseline`。缺失、旧值、tokenless、sentinel、force/overwrite boolean都不能授权覆盖。内容通过8 MiB `PLW1` raw frame进入 Rust；FileService对stream先做8 MiB+1有界收集。在 mutation gate内从 root重走 parent chain、两次重验 target、写并完整验证同目录 `0600 create_new` stage，最后只对重新确认的 parent capability下两个 basename调用覆盖式 `renameat`。rename前普通失败必须证明当前 old target和own stage均未发布；rename后再次从当前 root重走 parent再验 target，以带明确发布证据的正交 observation表达 `targetPublished`/`outcomeUnknown`。dispatch后未知 rejection同样保守归 unknown并触发root rescan；不得自动 retry、rollback、提供Retry/Overwrite动作或用普通错误隐藏磁盘事实。Linux/macOS没有 expected-inode conditional replace，最后 parent/stage/target验收到 rename间及postcheck到返回间，任何有 namespace或stage写权限的外部进程仍可竞争；parent capability只保证不越出 root。首版只支持 APFS和明确 allowlist 的 Linux本地文件系统、existing、单链接、普通 mode、同uid/gid的真实 regular file并保留普通POSIX mode；Windows、symlink、hardlink以及ACL/xattr/resource fork/flags的完整保留留给平台专项。
- symlink 可列出；只有能力解析确认仍在当前 root 内的相对链接可跟随。删除 symlink 删除链接自身，递归扫描/删除不跟随最终链接。
- 非 UTF-8 名称不做 lossy conversion。首版返回 `PATH_ENCODING_UNSUPPORTED`，以后可增加无损 opaque entry handle。
- 不安装或授权 Tauri 通用 fs/shell scope。目录选择只授予文件访问，与 Git、PTY、DAP 的 workspace trust 分离。

## Watcher 决策

- 每个 root 使用一个稳定版 `notify::RecommendedWatcher`。
- watcher absolute path 只是不可信提示，不能直接成为后续 I/O 参数，也不能发给 WebView。
- 回调只更新 dirty/need-rescan 状态并 `try_send` 到有界唤醒队列；单一 worker 节流后从 root capability 重扫并递增 generation。
- 队列满、notify error、root rename/delete、睡眠恢复和显式刷新都折叠为 `rescanRequired`。
- 首版不依赖 `notify-debouncer-full` 的递归 file-id cache；若以后需要细粒度 rename 动画，仍必须保留有界出口和 rescan fallback。

## 错误与验证合同

稳定错误至少区分 `ROOT_NOT_AUTHORIZED`、`ROOT_UNAVAILABLE`、`INVALID_RELATIVE_PATH`、`PATH_OUTSIDE_ROOT`、`PATH_ENCODING_UNSUPPORTED`、`ENTRY_NOT_FOUND`、`ENTRY_ALREADY_EXISTS`、`ENTRY_TYPE_MISMATCH`、`DIRECTORY_NOT_EMPTY`、`PERMISSION_DENIED`、`WORKSPACE_CONFLICT`、`WORKSPACE_DELETE_PLAN_INVALID`、`WORKSPACE_DELETE_BATCH_CHANGED`、`WORKSPACE_DELETE_BATCH_UNVERIFIABLE` 和 `IO_FAILED`。面向 WebView 的错误不得包含 canonical path、用户名或原始系统错误字符串。

跨 root move 的正式 target 一旦发布，后续状态不再进入上述普通 error 通道；严格结果只允许 `moved`、`targetPublishedSourceRetained`、`targetPublishedSourcePartiallyDeleted`，并以固定 reason/安全计数说明 source/target 变化、不可验收或删除失败。调用方必须把 incomplete 当作需要双 root rescan 和用户提示的非原子终态，不能自动重试。

永久删除 batch 在首项 remove 前的 token/整批 preflight 失败仍可走稳定普通 error 且保证零 remove；进入单项 verified-delete 后，该项不再用普通 error 隐藏可能已经发生的磁盘变化，只允许 `deleted`、`entryRetained` 或 `entryPartiallyDeleted`。后两者必须取消剩余 entries、触发相关 root rescan 并向用户报告，不得由上游 Retry/ignore-if-missing 自动继续。

F020 完成前必须证明：多 root/窗口隔离；absolute/traversal/平台路径拒绝；内部合法与外部/dangling/loop symlink 行为；不存在目标的父目录逃逸；递归删除不跟随链接；symlink swap 压测不触碰外部 sentinel；rename/copy 不覆盖；copy 的大小、条目、深度和 staging 失败受界且不发布半成品；跨 root move 在发布后 source/target 变化、零删除与部分删除时返回精确非原子状态且不回滚 target；永久删除 batch 的确认 token、整批/逐项重验、大文件、跨顶层 identity 冲突、manifest 内 hardlink journal、取消/replay、零删除/partial 与剩余项停止均符合合同；watcher overflow/error/事件丢失后通过重扫收敛。

Windows reparse point/原子 no-replace 的完整真机矩阵、macOS security-scoped bookmark、网络盘 polling、10 万文件 watcher storm 和非 UTF-8 opaque handle 纳入 F120/F130；核心 root 隔离、traversal 与 symlink escape 防护不得延期。

## 结果

优点：文件权限由已打开的目录 handle 表达，跨 Linux、macOS 和 Windows 防御 traversal 与越界 symlink；WebView 始终只处理 opaque URI，Tauri capability 保持最小。

代价：需要自建窄文件 provider、原生 picker、根生命周期、平台文件身份和 rescan 逻辑；跨 root move 与非 UTF-8 名称必须有明确的降级语义。
