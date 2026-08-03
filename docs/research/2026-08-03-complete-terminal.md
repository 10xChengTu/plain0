# F190 完整终端工作流

日期：2026-08-03

## 事实基线

F070 已交付 Rust PTY、`libghostty-vt` 网格、DOM renderer、IME、trust、resize、16 会话上限、多 tab、单层双 pane split、10,000 行上限的按需 scrollback、退出/关窗清理与双层背压。F150 又把普通终端固定为显式 `rootId`，多根必须选择，tab 创建后冻结 root，split 继承活动 tab 的 root。真实 `E2E-007` 与 `E2E-016` 已证明 shell/cwd、resize、高吞吐、tab/split、多根冻结与零孤儿进程；这些能力不重做。

代码审计确认 F190 前仍有以下真实缺口：

- `PlainTerminalView` 只有 root 选择器；`TerminalStartRequest` 只有 `{rootId,cwd,cols,rows}`，但普通 pane 永远发送 `cwd:null`，Rust 永远启动环境 `$SHELL` 或固定 fallback。没有 profile 枚举、profile 选择、cwd 输入或持久化。
- `encodeTerminalKeyEvent` 在 Windows/Linux 会把 Ctrl+F 发给 PTY；macOS WKWebView 也没有可依赖的页内查找。DOM 可选中文本不等于终端查找。
- `TerminalTabsModel` 把每 tab 硬封顶为两个 pane，且没有活动 pane 身份；继续 split 只会静默 no-op，不能递归。
- scrollback 每次离开 live 只抓一份冻结快照；浏览期间的新输出只更新隐藏 live 网格，历史视图不会刷新。
- `libghostty-vt` 已解析 OSC 7、OSC 8 与 OSC 133，并暴露 `Terminal::pwd()`、cell hyperlink URI、cell semantic content；Plain 当前 DTO 丢掉了全部三类信息，renderer 因而无法消费 shell integration 或链接。
- `TerminalPaneController.onExit` 不展示退出状态；tab/session 布局不持久化，也没有向用户解释“进程型终端不可跨应用重启恢复”。
- Rust 环境白名单是 `PATH/HOME/USER/LOGNAME/SHELL/LANG/TMPDIR` + `LC_*`，明确不含 `SSH_AUTH_SOCK`，所以由 Finder/Dock 启动但继承到 agent socket 的 Plain 也不会把它传给 shell。

## 架构裁定

### 1. profile 与 cwd 只影响未来会话

Rust 新增有界 profile 快照：`systemDefault` 加当前平台存在的固定候选 shell。profile id 由 Rust 定义，WebView 不发送任意 executable 或参数；`terminal_start` 只接受本次快照可重验的 id。环境 `$SHELL` 可以作为 `systemDefault` 的权威来源，但空值仍走现有平台 fallback。

终端栏增加 profile 下拉框与 root-relative cwd 输入。cwd 只允许空值/`.` 或普通 workspace 相对路径，最终仍由 Rust 在已选 root 内 canonicalize 与 containment 重验；前端校验只提供即时反馈，不承担授权。两项 future-tab default 写入现有用户 `settings.json` 所承载的 `IConfigurationService`，键固定为 `plain.terminal.defaultProfile` 与 `plain.terminal.cwd`。已经运行的 tab/pane 不会被 selector 变化重定向。

### 2. 查找是有界 terminal-buffer 查找

Cmd/Ctrl+F 由活动 pane 打开自建 find widget，不再依赖浏览器 find。查询集合为最多 10,000 行 retained scrollback 加当前 viewport；普通字符串与大小写切换均在前端纯状态机中完成，结果数、上一项、下一项与关闭均可交互。任何查询、匹配数和高亮 DOM 都有硬上限，不能把 PTY 输出放大成无界节点。

### 3. shell integration 复用 Ghostty 权威状态

不再写第二套 OSC parser。Rust 从同一个 `VtSession` 投影：

- `pwd`：OSC 7/9/1337 后的当前值，只作显示和下一次受 Rust 重验的 split cwd 候选，不成为文件系统 capability；
- hyperlink：每 cell 的 OSC 8 URI，设严格字节上限；
- semantic content：OSC 133 的 prompt/input/output 分类。

renderer 只把 `http:`/`https:` 链接变成带提示的显式 Cmd/Ctrl+Click 操作，其他 scheme 保持普通文本；绝不因终端输出自动导航、执行或授予文件权限。语义类别只用于 CSS/命令导航，不扩大进程能力。profile 启动仍保持用户真实 shell，不用 `shell -c` 包裹；Plain 设置 `TERM_PROGRAM`/版本标识并提供审计过的 zsh/bash/fish 启动注入，在注入失败或未知 shell 时明确降级为“支持外部程序主动发 OSC，但不篡改用户启动文件”。

### 4. recursive split 使用有界二叉布局树

每 tab 由二叉 split tree 描述布局，叶子是 pane；split 只替换当前活动叶子并继承其 root、profile 与最后可信 cwd。最多 8 个 pane/tab，超过上限显示准确状态而非静默失败。点击/focus 更新 active pane，方向可在每个内部节点独立保存，DOM 按树递归挂载，不再用一个 tab 级 `flex-direction` 假装嵌套布局。

### 5. live scrollback 保持 anchor 并合并刷新

用户停在 history 时，新 frame 继续更新隐藏 live model，同时把一次 scrollback refresh 标脏。pane 同时最多一个 fetch；fetch 期间到达的更多 frame 合并成一次后续 refresh，保持当前 offset anchor，不强制跳底。输入会显式回 live。10,000 行原生上限、单 in-flight fetch 与 frame ack 顺序均保持不变。

### 6. 跨进程不伪造 session restore

PTY 子进程只属于创建它的窗口/应用进程，不把 PID/session id 写成可重连凭据。Workbench storage 只记录“上次有 N 个不可恢复终端”的机器态 marker；异常 reload/crash 后新 view 显示一次“上次终端已结束，不能恢复”的可见说明并清除 marker。正常显式关闭继续 kill+join，退出 banner 显示真实 exit code。这样满足“恢复或明确不可恢复”，且不会为了看似恢复而孤立旧 shell 或静默重启命令。

### 7. SSH agent 是环境白名单的单项扩展

只新增 `SSH_AUTH_SOCK`，不放宽成 `SSH_*` 前缀，也不传 `SSH_AGENT_PID`、credential/token 或任意 ambient env。值仍由父 Plain 进程继承，Plain 不寻找、不启动、不保存 agent；真实 E2E 用 `ssh-add -l`/socket 可见性证明同一 shell 能访问既有 agent，并在退出后检查零残留。

## 垂直切片

1. **S1 profile/cwd 与 audited env authority**：Rust profile list + strict start id、cwd/profile DTO/codec/native/mock、`SSH_AUTH_SOCK`/`TERM_PROGRAM` 环境合同与测试。
2. **S2 future-tab defaults UI**：configuration schema、profile/root/cwd controls、持久化、按 tab/pane 冻结、准确启动/退出状态；Browser 覆盖。
3. **S3 recursive split tree**：活动 pane、8-pane 二叉布局、split 继承与完整生命周期；Browser 覆盖。
4. **S4 Ghostty metadata and links**：pwd/hyperlink/semantic DTO、严格 URI policy、renderer、shell integration 注入与命令导航；Rust/Browser 覆盖。
5. **S5 find and live scrollback**：有界 buffer 查找、find widget、实时 history refresh/anchor/输入回 live；Browser 覆盖。
6. **S6 explicit non-restorable lifecycle and双层收口**：storage marker、真实 exit banner、完整 `pnpm check`、完整 Browser 与真实 Tauri `E2E-025`，覆盖 profile/cwd 冷启动持久化、OSC/link/find、递归 split、live scrollback、agent 继承和所有进程清理。

每个切片先通过自己的最小验证并独立提交，再开始下一项；F190 关闭前不切换 F200。
