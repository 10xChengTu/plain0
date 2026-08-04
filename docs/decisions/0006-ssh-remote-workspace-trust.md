# ADR 0006：SSH 远程工作区的信任与威胁模型

- 状态：接受
- 日期：2026-08-05

## 背景

产品范围此前把「容器/SSH 工作区」列为明确不做（product-scope.md 原第 70 行）。F220 把「Rust SSH remote workspace」重新纳入范围：Rust 拥有 SSH 认证、host-key 校验、远程文件系统、PTY、Git 与 DAP 传输；WebView 只拿到不透明 remote workspace capability。本 ADR 定义该能力的信任分层与威胁模型；capability 抽象本身见 ADR 0007。

现有事实约束：

- 仓库无任何 SSH 依赖或实现；Git over SSH 完全委托系统 Git + 系统 `ssh`（`git/exec.rs` 只透传 `PATH/HOME/SSH_AUTH_SOCK` 三变量），host-key 与凭据从未经过 Plain。
- Plain 全线遵循「无 ambient authority」：本地文件访问是 capability-relative（ADR 0004），进程 spawn 是逐文件审计的参数数组闭集，前端从不接收原生绝对路径。
- Plain 没有、也不引入凭据输入 UI（密码、passphrase、token 均不经手）。
- 上游 monaco-vscode-api 的 Remote Development 死代码（4 个 `remote` 类 bundle 残留）不是本能力的任何部分，前端继续保持其不可达。

## 决策

### 1. 传输由进程内 Rust SSH 实现拥有，不 spawn 系统 ssh

采用纯 Rust SSH 库（russh + russh-sftp，版本精确 pin）在 Plain 进程内建立与持有 SSH 会话。不选择「spawn 系统 `ssh` 二进制」路线：后者把认证与 host-key 决策外包给 OpenSSH 配置，Plain 无法在 UI 上如实呈现信任决定，也无法满足「Rust 拥有认证与 host-key 校验」的验收语义。系统 Git 的既有 SSH 委托（本地仓库网络操作）不受影响，两条路径互不混用。

### 2. 认证只走 ssh-agent，Plain 不经手秘密

- 唯一支持的认证方法是 ssh-agent 签名（经 `SSH_AUTH_SOCK` 的 agent 协议客户端）。无 agent、agent 无可用身份、或服务器拒绝所有身份时 fail closed 并给出准确、不含密钥内容的错误。
- 不实现密码认证、不读取磁盘私钥文件、不实现 passphrase 输入、不缓存任何凭据材料。agent 的选择与解锁属于用户系统职责。
- 连接目标（host/port/user）不是凭据，可经产品 UI 输入并保存于 recent 记录。

### 3. host-key 由 Plain 自有 pinned store 显式确认

- Plain 维护自有的版本化 known-hosts 存储（app-local-data，ADR 0005 的原子写纪律）：`(host, port) → 算法 + 公钥指纹`。
- 首次连接：向用户展示算法与全量指纹，显式确认后 pin；取消即零连接。确认对话走 Workbench DOM 对话框（不可被页面内容伪造）。
- 指纹变化：硬失败并展示新旧指纹，v1 不提供「仍然连接」旁路；用户只能在系统层面自行核实后删除 pin 条目再重连（删除是显式的产品命令，带确认）。
- 用户 `~/.ssh/known_hosts` 只读参考：命中一致可跳过首次确认提示中的「未知主机」措辞，但 Plain 不写入、不修改该文件。

### 4. 远程主机是不受信任的输入源

- 来自远程的一切字节（目录名、文件内容、stat、PTY 输出、Git 输出、DAP 消息）按既有 strict 解码纪律处理：有界、fail-closed、拒绝畸形；路径必须相对且经容器化校验，拒绝绝对路径/`..`/NUL/符号链接逃逸（SFTP realpath 重验）。
- 远程 workspace 默认未信任：与本地一致，未信任不启动远程 Git/PTY/DAP；信任按 workspace 显式授予、可撤销，信任记录含 host 指纹身份，指纹变化即失效。
- 不实现端口转发、X11 转发、agent 转发、SOCKS 代理或反向隧道；不把远程 shell 能力暴露给 WebView（终端仍走 Plain 的 PTY 域合同）。
- 不存在远程 extension host、远程 settings 同步或远程插件安装。

### 5. 生命周期 fail closed

- 连接建立、认证、每个通道打开都有独立超时与取消；取消语义对齐 Git 网络域（显式 key、不伪称回滚）。
- 连接断开：所有依赖该会话的 root/终端/调试会话立即标记不可用并停止接受操作（fail closed），脏编辑器留在内存并按 ADR 0007 的备份分区落盘；不做静默自动重连。
- 显式重连是新的信任决策：重新校验 host-key（指纹必须与 pin 一致）、重新验root 身份后才恢复能力。
- 窗口/应用关闭：会话与全部通道显式 shutdown，远程侧不留守护进程；Plain 不在远程安装任何常驻组件。

## 后果

- 新增 russh/russh-sftp 及其传递依赖需纳入第三方声明管线（cargo-about）与依赖审计；架构守卫新增「SSH 会话唯一拥有者模块」与「禁止其他模块直接建立 TCP/SSH」的闭集。
- agent-only 认证意味着无 agent 的环境不可用 Remote SSH——这是有意的范围裁剪，记录于 platformGaps，不以凭据 UI 换取覆盖面。
- 指纹变化无旁路会在主机重装场景增加一次显式删除操作——以此换取「变更即停」的抗中间人默认。
