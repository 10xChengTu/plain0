# F070 Rust PTY 终端

日期：2026-07-24

## 目标与边界

`F070` 三条 acceptance：交互 shell 支持输入/resize/搜索/退出；多 tab 与拆分在窗口关闭时清理；背压与输出分片测试通过。PTY 由 Rust 实现；未信任 workspace 不得启动 PTY（AGENTS.md）；真实桌面场景登记交接清单。

## 调研结论（双路交叉，锚定 Code OSS `5264f`、CodinGame v35.0.1 = `d836716`）

- `@codingame/monaco-vscode-terminal-service-override@35.0.1` 存在：`getServiceOverride(backend?)` 的官方 seam 就是上游 `ITerminalBackendRegistry.registerTerminalBackend`；包内副作用引入终端面板/tabs/split/xterm 渲染贡献（同包，无独立 UI 包）；**无默认 backend**——必须自实现 `SimpleTerminalBackend`/`SimpleTerminalProcess` 子类（抽象基类已把持久化/latency/profile 噪音短路，demo 验证了子类化路径）。传递依赖仅 xterm@6.1.0-beta + 8 个渲染类 addon，无 node-pty/网络/auth 暗雷。`externalTerminal.contribution` 附带注册的两个外部终端命令因无 `IExternalTerminalService` 静默落空（良性收窄，排除面知会）。
- 上游协议：`ITerminalChildProcess`（start/input/resize/shutdown/sendSignal/clearBuffer/acknowledgeDataEvent + onProcessData/Ready/Exit）；**流控是真实的字符计数 ack 机制**（`FlowControlConstants`：high 100000 / low 5000 / ack 每 5000），node 端超高水位真的 pause pty 读取——传输层不背压，应用层必须显式 ack。spawn 是参数数组（node-pty API），cwd/env 经 `createProcess()` 显式逐层传入。
- shell integration（rc 注入 + OSC 133/633）与会话持久化/reconnect 明确排除首批（纯 UX 增强/复杂度高，验收不要求）。
- Rust 选型维持 `portable-pty = 0.9.0`（MIT，wezterm 生态；依赖面窄全宽松许可）：`openpty` + `pre_exec` 内 `setsid`/`TIOCSCTTY`/杂散 fd 清理（macOS/Linux 已知坑已被库解决）；`CommandBuilder` 原生支持 args 数组/cwd/env 白名单。`rustix::pty` 仅 4 个原语、无 ioctl/跨平台封装，排除。PTY 是设备文件，与 workspace capability 正交；安全点在 spawn 参数：cwd 必须落在已授权 root、env 白名单。
- 仓库现状：终端 UI/xterm/override 全为零；`ITerminalService` 是抛错桩；Panel 无任何 view container（`nopanel` 是上游布局状态类）。**Rust 侧 workspace trust 完全空白**（前端 `enableWorkspaceTrust: false` 只是关上游 UI 且被 Harness 锁定）——trust 门将被 F070/F080/F100 共用，必须建成通用模块；可复用 `stable_roots_identity` 做按 workspace 持久化身份。「子进程参数数组」目前是文字合同，需新建覆盖 terminal/git 域的机器 guard。
- IPC：终端输出是高频小包、延迟敏感——wake+pull 的轮询延迟在此首次不可接受；采用**事件携带 payload**（`plain://terminal-data`，`{sessionId, sequence, bytes}`，仓库首例、上游先例佐证）+ 显式 ack 背压（`terminal_ack{sessionId, byteCount}`，Rust 维护未确认计数、高水位停读低水位恢复，常量对齐上游量级）；读线程与 emit 之间垫小容量 `sync_channel` 作纵深防御（防 Tauri IPC 瞬时卡顿导致无界内存）。输入/resize/kill/shutdown 为普通命令。事件 payload 结构照 wake event 先例做逐字段 Harness 锁定。

## 技术方案

### 决策 1：通用 trust 模块（S1，先于 PTY 本体）

- 新建 `src-tauri/src/trust/`：按 `stable_roots_identity` 持久化「执行信任」状态（`<app_local_data_dir>/trust/trust.plain.json` 或每身份文件，staged 原子写）；API：`is_trusted(identity)`、`grant(identity)`、`revoke(identity)`；EMPTY workspace 恒不信任。命令：`workspace_trust_state {}`、`workspace_trust_grant {}`（当前 workspace）、`workspace_trust_revoke {}`。
- 消费合同：PTY（本 feature）、Git（F080）、DAP（F100）的 spawn 入口前置检查，未信任返回结构化错误（如 `WORKSPACE_NOT_TRUSTED`），**检查在 Rust 命令入口，前端 UI 只是提示层**。
- 前端：首次打开终端且未信任 → DOM 确认对话框（准确风险说明：将允许在此 workspace 启动进程）→ 同意则 grant 并继续，拒绝则不启动且显示禁用说明（testing.md 要求的可见风险文案）。

### 决策 2：Rust PTY 域（S1/S2）

- `src-tauri/src/terminal/`：`portable-pty =0.9.0` 精确锁定；每会话：`openpty` → `CommandBuilder`（shell 探测 `getDefaultSystemShell` 语义在 Rust 侧实现：`$SHELL` 回退 `/bin/zsh`(macOS)/`/bin/bash`；args 数组；cwd = 指定的已授权 root canonical 路径（校验属于当前 workspace roots）；env 白名单（`PATH/HOME/USER/SHELL/LANG/LC_*/TERM=xterm-256color/COLORTERM` 等，报告精确清单并 Harness 锁定））→ spawn；专用阻塞读线程（`plain-terminal-<id>` 命名，对齐 text_search 范式）→ 有界 `sync_channel` → emit `{sessionId, sequence, bytes}`（bytes 原样传输不做 lossy UTF-8——architecture.md 明确）；未确认字节计数高/低水位控制读取暂停/恢复；resize=`MasterPty::resize`；kill/shutdown/退出状态机（`Child::wait` 独立监听，exit 事件 `plain://terminal-exit` 或并入 data 事件流的终止帧——实现选择并报告）；会话上限（如每窗口 16）；窗口销毁 `close_window` 接线（lib.rs 第三个清理点）。
- 命令闭集：`terminal_start { cwd?, cols, rows }`（trust 门 + 返回 sessionId）、`terminal_input { sessionId, data }`、`terminal_resize { sessionId, cols, rows }`、`terminal_ack { sessionId, byteCount }`、`terminal_kill { sessionId, immediate }`。
- 新 Harness：terminal/git 域「子进程必须 CommandBuilder/参数数组、禁 shell -c 拼接字符串」guard；事件 payload 逐字段锁定；流控常量锁定。

### 决策 3：前端接线（S3）

- 新增 terminal override 依赖（bundle 集差审计——xterm addon 家族会新增较多 source，债务面必须零漂移）；`getTerminalServiceOverride(new PlainTerminalBackend())` 进 services 组合；`PlainTerminalProcess extends SimpleTerminalProcess` 桥接命令/事件（onProcessData 按 sequence 排序去重、acknowledgeDataEvent → terminal_ack 透传）；`getDefaultSystemShell` 走 Rust。cwd 默认当前 workspace 首根。
- trust 确认 UX（决策 1）；多 tab/split 用上游 UI 原生能力；Browser mock 实现确定性假 PTY（echo 语义 + 可注入输出脚本）供 E2E。

### 切片

1. **S1 trust 模块 + Rust PTY 核心域**：trust 三命令 + PTY 会话管理（spawn/读线程/背压原语/resize/kill/退出/会话上限/close_window），纯 Rust 测试（含 echo 子进程真实往返、背压水位、并发会话、销毁清理）；新 Harness guard。
2. **S2 IPC 桥接**：五命令 + data/exit 事件 + 严格 codec + browser mock 假 PTY；单元全套。
3. **S3 前端接线**：override 依赖 + backend 子类 + trust UX + Panel 终端可用；Browser E2E（打开终端、输入回显、resize、多 tab、split、关闭清理、未信任禁用文案）。
4. **S4 压测与收口**：高吞吐（`yes` 类 mock 脚本）背压/分片证据、E2E-007 登记（真实 shell 交互/resize/拆分/退出）、evidence 闭环切 F080。

## 排除项

shell integration、会话持久化/重连、终端 profile 管理、外部终端命令激活、Windows ConPTY（留 F120 评估）。
