# ADR 0007：远程工作区 capability 与本地 capability 平行

- 状态：接受
- 日期：2026-08-05

## 背景

ADR 0004 把工作区文件权限边界定义为 `cap_std::fs::Dir` 目录 capability + 不透明 `rootId`，并把 identity（device/inode）、watcher（`notify`）、备份分区（canonical path digest）等机制硬绑定在本地文件系统语义上。远程 root 没有本地 fd、没有 inode、没有 inotify，无法塞进同一结构。但 `rootId` + `(rootId, relativePath)` 寻址协议与 `plain-workspace://<rootId>/` 前端 provider 对 root 背后是什么完全无感——这一层是 F220 应当原样复用的边界。

## 决策

### 1. `rootId` 协议不变，root 后端成为封闭枚举

- `WorkspaceRoot` 重构为封闭后端枚举：`Local`（现有 `cap_std::fs::Dir` 语义逐字节不变）与 `RemoteSsh`（持有会话引用 + 远程规范化基路径）。所有对外 IPC、DTO、前端 provider、搜索/备份/Git/终端/调试对 root 的引用继续只见 `rootId`。
- 远程分支的每次路径解析都在 Rust 内完成：拼接 → SFTP `realpath` 重验 → 必须仍在基路径之下，拒绝符号链接逃逸；不存在「先检查后使用」的 ambient 路径组合。
- 授权入口独立：远程 root 由「连接会话 + 用户在远程目录选择器中显式选择」产生，绝不从文件路径字符串隐式创建；每窗口 root 总数上限与本地共享（256）。

### 2. identity 与去重

- 远程 root identity = `(host-key 指纹, canonical 远程路径)`；同一窗口内相同 identity 去重。指纹是 identity 的一部分：主机重装（指纹变化）后的同名路径是不同 root，旧 root 的信任与备份不迁移。
- `DirectoryIdentity` 的 device/inode 语义仅本地分支保留；远程分支不伪造 inode。

### 3. watcher 语义降级为显式 rescan

- 远程分支不提供实时 watcher。v1 语义：无自动文件事件；依赖操作后的显式失效（写入/删除/重命名后由 Rust 发出对应事件）+ 用户显式刷新命令。外部（他人/他进程）对远程文件的修改在下一次读取/刷新时可见。
- 这与 ADR 0004 watcher 的「队列满→rescanRequired」降级语义同构：远程等价于永久处于 rescan-on-demand 模式，如实呈现，不模拟事件流。

### 4. 备份与本地状态

- hot-exit 备份仍写本地 app-local-data，分区键从 canonical path digest 扩展为 identity digest（远程 = 指纹+路径），跨进程恢复按 identity 匹配；恢复要求先重建同 identity 的 root（重连 + 指纹一致）。
- Recent 记录远程 root 时只存展示名 + opaque id + 重连所需的 `(host, port, user, 远程路径)`；不存指纹之外的任何密钥材料。冷启动恢复远程 workspace 不自动连接——展示「需要重连」状态，用户显式触发。

### 5. 域能力逐个显式接入

搜索、Git、终端、调试各域对远程 root 的支持逐域显式声明与实现（远程 Git/PTY/DAP 走 SSH exec/pty 通道、复用各域既有 DTO 面），未接入的域对远程 root 返回明确的 `ROOT_BACKEND_UNSUPPORTED` 类错误，不静默降级、不半工作。每接入一个域，其架构守卫同步扩展远程分支合同。

## 后果

- `WorkspaceRoot` 枚举化是一次破坏性重构，本地行为必须由既有全量测试证明逐字节不变。
- 远程无实时 watcher 是明确的产品语义（记录于 platformGaps），换取不伪造事件流的诚实性。
- 备份 identity digest 变更需要一次本地备份分区迁移（沿用 F160 已建立的稳定 root 身份迁移机制）。
