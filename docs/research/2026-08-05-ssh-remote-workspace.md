# F220 Rust SSH 远程工作区

日期：2026-08-05

## 事实基线

代码层从零开始：Cargo 无任何 SSH/加密网络依赖；Git over SSH 完全委托系统 Git（`git/exec.rs` 网络模式仅透传 `PATH/HOME/SSH_AUTH_SOCK`）；终端域仅把 `SSH_AUTH_SOCK` 透传给用户 shell；无远程 FS/PTY/Git/DAP 传输、无 host-key 信任存储。文档层此前只有一行排除声明（product-scope.md「容器/SSH 工作区」）。

可复用的是三类设计范式而非实现：

- DAP 的 transport-agnostic `Content-Length` framing（`debug/framing.rs`）——远程 DAP 只需新 read/write 端。
- opaque `rootId` + `(rootId, relativePath)` 寻址 + `plain-workspace://` provider 接线（ADR 0004 / `file-system-provider.ts`）——前端对 root 后端无感。
- 有界事件流/背压/显式取消协议（`terminal/flow.rs`、`git/network.rs`、watcher 的 bounded wake queue）。

唯一需要破坏性重构的既有抽象：`WorkspaceRoot`（`workspace/mod.rs`）硬绑定 `cap_std::fs::Dir` + inode identity + `notify` watcher。

信任/威胁模型与 capability 抽象已冻结为 ADR 0006（russh 进程内传输、agent-only 认证、Plain 自有 pinned known-hosts 显式确认、远程字节不受信任、无转发/无远程 extension host、断连 fail closed + 显式重连）与 ADR 0007（后端封闭枚举、指纹+路径 identity、rescan-on-demand watcher 语义、备份 identity digest、逐域显式接入）。

## 架构裁定（实现层补充）

### 1. 依赖与守卫

russh + russh-sftp 精确 pin；新增架构守卫：SSH 会话建立/持有唯一归属新 `src-tauri/src/remote/` 域（其余模块禁止 import russh 或建立出站 TCP），agent 协议客户端唯一实现，known-hosts store 沿用 ADR 0005 原子写纪律。第三方声明经既有 cargo-about 管线再生成，`check:notices` 全绿。

### 2. 会话是显式资源

`remote_session_connect/disconnect/state` 窄 IPC：connect 输入 `(host, port, user)`，流程 = TCP（仅显式地址，超时/取消有界）→ host-key 校验（ADR 0006 §3 的 pin/确认/变更即停）→ agent 认证 → 会话登记 `(window, sessionId)`。会话状态事件（connected/disconnected）经有界事件流下发。所有远程 root/通道都挂在会话上；会话断开即全部 fail closed。hermetic 测试用 russh 的 server 端在本地起受控 sshd fixture（loopback，不依赖外部主机）。

### 3. 远程 FS 经 SFTP 通道

`RemoteSsh` root 后端实现 stat/read/readdir/write/mkdir/rename/delete 的既有工作区 DTO 面（复用现有 workspace IPC，不新增前端协议）；每操作 SFTP realpath 容器化重验；读写沿用现有大小上限与版本化写入合同（PLW1/PLR1 语义按后端等价实现——远程无本地 staged rename，用 SFTP 临时名 + rename 近似原子并如实记录差异）。搜索 v1 不接远程（`ROOT_BACKEND_UNSUPPORTED`，platformGaps 记录）。

### 4. 远程 PTY/Git/DAP 走通道复用既有域合同

- PTY：session channel `pty-req + shell`，接入既有终端 DTO/背压/生命周期（profile 语义收窄为远程默认 shell，v1 不做远程 profile 枚举）。
- Git：远程仓库操作 = SSH exec 通道上以参数数组运行远程 `git`，复用既有 Git DTO 的核心读子集（status/log/diff）+ stage/commit；网络/凭据类操作（fetch/push）v1 不做（远程主机自己的 agent 语境复杂，明确 fail closed 并记录）。
- DAP：exec 通道启动远程 adapter，`framing.rs` 直接架在通道流上；`runInTerminal` 反向请求路由到同会话的远程终端。

### 5. 真实远程 E2E 登记暂缓

自动化两层：Rust hermetic sshd fixture 全覆盖 + Browser mock（远程后端 mock 走既有 bridge mock 模式）。真实远程主机矩阵登记为 `E2E-028`（待执行，与 E2E-025/026/027 攒批；可用本机 `sshd` localhost 或局域网主机执行，写清前置）。

## 垂直切片

1. **S1 会话与信任底座**：russh 依赖 pin、`remote/` 域、connect/disconnect/state IPC、agent 认证、pinned known-hosts store + 确认/变更即停 UI、hermetic sshd fixture 测试。
2. **S2 root 后端枚举化**：`WorkspaceRoot` → Local/RemoteSsh 封闭枚举重构（本地行为全量测试证明不变）、identity/去重/上限、`ROOT_BACKEND_UNSUPPORTED` 兜底。
3. **S3 远程 FS**：SFTP stat/read/readdir → write/CRUD、realpath 容器化、远程目录选择器与 root 授权流、Explorer/编辑器端到端。
4. **S4 生命周期**：断连 fail closed、显式重连、Recent/冷启动「需要重连」、备份 identity digest 与恢复。
5. **S5 远程终端**：pty-req/shell 通道接入终端域。
6. **S6 远程 Git 核心子集**：exec 通道 status/log/diff/stage/commit。
7. **S7 远程 DAP**：exec 通道 adapter + framing + runInTerminal 路由。
8. **S8 收口**：`E2E-028` 登记（暂缓）、product-scope/architecture 修订收尾、例外收账、完整门禁。

每个切片先通过自己的最小验证并独立提交，再开始下一项；F220 关闭前不切换 F230。
