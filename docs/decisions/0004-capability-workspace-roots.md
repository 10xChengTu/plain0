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
- 普通 rename 只允许同 root 且默认 no-clobber；跨 root move 是两个明确授权根之间的 copy + verified delete，并公开非原子失败状态。
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

F020 完成前必须证明：多 root/窗口隔离；absolute/traversal/平台路径拒绝；内部合法与外部/dangling/loop symlink 行为；不存在目标的父目录逃逸；递归删除不跟随链接；symlink swap 压测不触碰外部 sentinel；rename 不覆盖；watcher overflow/error/事件丢失后通过重扫收敛。

Windows reparse point/原子 no-replace 的完整真机矩阵、macOS security-scoped bookmark、网络盘 polling、10 万文件 watcher storm 和非 UTF-8 opaque handle 纳入 F120/F130；核心 root 隔离、traversal 与 symlink escape 防护不得延期。

## 结果

优点：文件权限由已打开的目录 handle 表达，跨 Linux、macOS 和 Windows 防御 traversal 与越界 symlink；WebView 始终只处理 opaque URI，Tauri capability 保持最小。

代价：需要自建窄文件 provider、原生 picker、根生命周期、平台文件身份和 rescan 逻辑；跨 root move 与非 UTF-8 名称必须有明确的降级语义。
