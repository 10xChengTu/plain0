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
- 目录 manifest header 单独记录 source 根；descendants 最多 10,000，根 depth 为 0、最大 256，单名 1 KiB、descendant 聚合名称 2 MiB，单 link 4 KiB、聚合 link 2 MiB，单文件 8 MiB、聚合逻辑文件字节 256 MiB。source 根和正式 target basename 不计聚合名称，但各自仍受 1 KiB 限制。所有累计使用 checked arithmetic；非 UTF-8/portable-invalid 名称失败，symlink 不跟随，特殊文件失败。
- 目录目标副作用只在 source manifest 完成并重验后开始。目标父目录 identity 不得命中 source 的任何目录；顶层 staging 目录为高熵、exclusive、初始 `0700`，完整 staged tree 与 source 在发布前再次核对，最后只复用既有 `NOREPLACE`。清理只按 identity/payload receipt 有界逆序删除，禁止 `remove_dir_all`；发现 replacement 或未知成员时宁可留下 artifact。
- 每窗口写操作与 root replace/remove/window close 共享 mutation gate，并统一按 `mutation gate -> workspace state` 获取锁。写操作拿到 gate 后必须重验 lease；不得复用读取的事后撤销校验，因为已经发生的磁盘副作用无法丢弃。
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

稳定错误至少区分 `ROOT_NOT_AUTHORIZED`、`ROOT_UNAVAILABLE`、`INVALID_RELATIVE_PATH`、`PATH_OUTSIDE_ROOT`、`PATH_ENCODING_UNSUPPORTED`、`ENTRY_NOT_FOUND`、`ENTRY_ALREADY_EXISTS`、`ENTRY_TYPE_MISMATCH`、`PERMISSION_DENIED`、`WORKSPACE_CONFLICT` 和 `IO_FAILED`。面向 WebView 的错误不得包含 canonical path、用户名或原始系统错误字符串。

跨 root move 的正式 target 一旦发布，后续状态不再进入上述普通 error 通道；严格结果只允许 `moved`、`targetPublishedSourceRetained`、`targetPublishedSourcePartiallyDeleted`，并以固定 reason/安全计数说明 source/target 变化、不可验收或删除失败。调用方必须把 incomplete 当作需要双 root rescan 和用户提示的非原子终态，不能自动重试。

F020 完成前必须证明：多 root/窗口隔离；absolute/traversal/平台路径拒绝；内部合法与外部/dangling/loop symlink 行为；不存在目标的父目录逃逸；递归删除不跟随链接；symlink swap 压测不触碰外部 sentinel；rename/copy 不覆盖；copy 的大小、条目、深度和 staging 失败受界且不发布半成品；跨 root move 在发布后 source/target 变化、零删除与部分删除时返回精确非原子状态且不回滚 target；watcher overflow/error/事件丢失后通过重扫收敛。

Windows reparse point/原子 no-replace 的完整真机矩阵、macOS security-scoped bookmark、网络盘 polling、10 万文件 watcher storm 和非 UTF-8 opaque handle 纳入 F120/F130；核心 root 隔离、traversal 与 symlink escape 防护不得延期。

## 结果

优点：文件权限由已打开的目录 handle 表达，跨 Linux、macOS 和 Windows 防御 traversal 与越界 symlink；WebView 始终只处理 opaque URI，Tauri capability 保持最小。

代价：需要自建窄文件 provider、原生 picker、根生命周期、平台文件身份和 rescan 逻辑；跨 root move 与非 UTF-8 名称必须有明确的降级语义。
