# GitHub 现有方案调研

调研日期：2026-07-18
原则：先广后窄，版本、活跃度和许可证均按调研日页面核实。

## 结论

最合适的路线是：以当前 Code OSS 为行为/资产/测试基线，产品前端按需组合 `@codingame/monaco-vscode-api` 的 Workbench service packages，参考 SideX 的 Tauri 映射重写 Rust 原生服务。这样既不从 CodeMirror 重造编辑器，也不需要长期维护当前四千多个 Workbench 源文件或通用 Extension Host。

## 整机候选

| 项目                                                                | 现状与能力                                                                                                                                                                                                                                                   | 许可证           | 结论                                                                                          |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- | --------------------------------------------------------------------------------------------- |
| [SideX](https://github.com/Sidenai/sidex)                           | Tauri 2 + Rust + 直接移植的旧版 VS Code Workbench；来源未记录可靠 upstream commit，代码/产品标记约在 1.96–1.110 时代；文件、PTY、Git、search、theme、SQLite 已有，debug/extension host 仍在进行；v0.1.2，约 2.5k stars                                       | MIT              | 最接近的整机参考；只作 Rust donor/架构样本，不能无审计整仓替换                                |
| [monaco-vscode-api](https://github.com/CodinGame/monaco-vscode-api) | 把 Code OSS 1.128.0（commit `fc3def6774c76082adf699d366f31a557ce5573f`）能力拆成 Workbench/theme/TextMate/files/search/terminal/SCM/debug 等 service packages；调研日 npm 最新为 35.0.1（2026-07-15，git commit `d8367168c23c9d0a9ba5bc84b8034e5435e9eb93`） | MIT              | 推荐产品前端主体；只安装 allowlist packages，禁止 Extension Host 执行入口与 AI/Auth/Sync 等包 |
| [Terax](https://github.com/crynta/terax-ai)                         | Tauri 2、React、CodeMirror、portable-pty、xterm、文件树和 Git graph；AI 深度耦合，无通用 DAP/VSIX 主题                                                                                                                                                       | Apache-2.0       | 参考 PTY、Git graph 和打包，不作基座                                                          |
| [Athas](https://github.com/athasdev/athas)                          | Tauri 编辑器，Git/LSP/terminal/AI/协作能力广                                                                                                                                                                                                                 | AGPL-3.0         | 只参考产品行为，不搬代码                                                                      |
| [JulIDE](https://github.com/sinisterMage/JulIde)                    | Tauri + Monaco，Git2 能力较完整，但强绑定 Julia                                                                                                                                                                                                              | MIT              | 参考 Git UI/API，不作通用基座                                                                 |
| [Blink](https://github.com/bmarti44/blink)                          | Tauri + monaco-vscode-api full workbench POC，项目自称 buggy、无稳定 release                                                                                                                                                                                 | 复制前需再次核验 | 只参考接线，不作基座                                                                          |
| [montauri-editor](https://github.com/TimSusa/montauri-editor)       | 旧 Tauri + Monaco 极小原型，功能很少                                                                                                                                                                                                                         | MIT              | 排除                                                                                          |

SideX 的关键映射已由源码确认：Electron main → Tauri Rust，`ipcMain` → commands/events，Node fs/pty → Rust/portable-pty，renderer/Monaco/Workbench 继续在 WebView 运行。其当前仓库也包含 Extension Host、LSP、tasks、auth、update、remote、WASM 等大量 Plain 明确不要的模块，因此只能按域挑选并重新审计。

本地源码安全审计进一步排除了直接移植：SideX 路径校验允许绝对路径和 symlink 越界；搜索/监听未统一过安全层；Git config/run 暴露 hooks、credential helper、ssh command 等进程执行面；DAP transport 对 UTF-8/UTF-16 字节长度处理错误且缺少上限/超时；watch pattern 更新捕获旧值并使用无界队列；主题模型不兼容 VS Code 的 dotted color ids，也缺 VSIX/JSONC/include/semantic/tmTheme；当前 Tauri 配置为 `csp: null` 且 asset scope 覆盖 `$HOME/**`。这些实现只可用作失败模式和测试用例来源。

`monaco-vscode-api` 自身也不能照搬 demo：demo 同时展示 AI、Chat、Auth、Sync、Remote、Notebook、Testing、Gallery 和 Extension Host。35.0.1 API 会传递依赖 extensions service，`initialize()` 也会组合其默认 override；默认 worker host 关闭，因此可把这部分严格限定为静态 contribution registry。Plain 只直接安装明确允许的 service packages，并用架构检查扫描 direct dependencies、imports、host 配置和最终 worker 产物；主题不导入 `vscode/localExtensionHost`，不配置 `ExtensionHostKind`，不启用 worker host。

## 非 Tauri Rust 编辑器

| 项目                                                | 可参考点                                       | 许可边界                                    |
| --------------------------------------------------- | ---------------------------------------------- | ------------------------------------------- |
| [Lapce](https://github.com/lapce/lapce)             | Rust DAP 状态机、proxy/rope、文件/Git/terminal | Apache-2.0，可参考或经审计复用              |
| [Zed](https://github.com/zed-industries/zed)        | 成熟 debugger/Git/terminal 交互                | 多数 GPL-3.0；只参考行为，不能搬入 MIT 项目 |
| [Helix](https://github.com/helix-editor/helix)      | `helix-dap` transport/types、tree-sitter       | MPL-2.0 文件级 copyleft，慎用源码           |
| [Xi Editor](https://github.com/xi-editor/xi-editor) | rope 算法历史                                  | 已停止维护，不作基础                        |

## 主题兼容

官方定义三类主题：[Color Theme](https://code.visualstudio.com/api/extension-guides/color-theme)、[File Icon Theme](https://code.visualstudio.com/api/extension-guides/file-icon-theme)、Product Icon Theme；manifest contribution 见 [Contribution Points](https://code.visualstudio.com/api/references/contribution-points)。

推荐组合：

- [Monaco Editor](https://github.com/microsoft/monaco-editor) 0.55.1，MIT。
- [vscode-textmate](https://github.com/microsoft/vscode-textmate) 9.3.2，MIT。
- [vscode-oniguruma](https://github.com/microsoft/vscode-oniguruma) 2.1.0，MIT/WASM。
- 从当前 Code OSS 保留经过许可证审计的静态 grammar 和默认主题。

导入器只解析 `themes`、`iconThemes`、`productIconThemes`；支持 JSONC、`include`、TextMate `.tmTheme`、semantic colors 和相对资源。不会执行 extension entry、activation 或脚本。

第一阶段只支持本地 VSIX/目录/已安装 VS Code 主题。在线来源以后优先 [Open VSX](https://github.com/eclipse-openvsx/openvsx)，不直接依赖微软 Marketplace 的非公开下载接口，也不重新分发未审计的第三方主题。

## Git 与 GitLens 边界

[GitLens](https://github.com/gitkraken/vscode-gitlens) 在调研日最新为 v18.3.0。仓库不是整体 MIT：所有名为 `plus` 的目录受 `LICENSE.plus` 约束，其余文件才是 MIT。

Plain 不运行或打包 GitLens，而是独立实现通用 Git 能力：blame/hover/heatmap、file/line history、revision navigation、compare/search、refs/stash/worktree、graph 和常见写操作。明确排除 GitKraken 账号、Plus/Pro UI、Launchpad、Cloud Patches、PR provider、品牌素材、AI/MCP。

Git 后端首期统一调用系统 Git CLI，使用 porcelain v2/NUL 等机器格式，以保留用户现有 credentials、SSH、GPG、hooks、LFS、filters、attributes 和 worktree 行为。只有性能数据证明必要后，才考虑 [gix](https://github.com/GitoxideLabs/gitoxide) 做只读加速。

## 终端、搜索和文件监听

- PTY：[portable-pty](https://docs.rs/portable-pty/latest/portable_pty/) 0.9，MIT；阻塞读取必须隔离线程。
- 终端 UI：[xterm.js](https://github.com/xtermjs/xterm.js) 6.0。
- 搜索：[ripgrep](https://github.com/BurntSushi/ripgrep) 15.2 sidecar，解析 `--json`；文件遍历使用 `ignore`。
- 文件监听：[notify](https://github.com/notify-rs/notify) 8.2；事件丢失/合并时重扫。

## F020 工作区路径与文件树专项调研

专项审计排除了把 Tauri `plugin-fs` scope 直接当作编辑器安全边界：Tauri core 的 [fs scope](https://github.com/tauri-apps/tauri/blob/3f62c70d6b9a9eeeb7c302b010c858405a1bb761/crates/tauri/src/scope/fs.rs) 采用 glob、allow/deny 和 canonicalize，不存在目标会退回词法匹配；[plugin-fs commands](https://github.com/tauri-apps/plugins-workspace/blob/57ac98645324c04ab2b4c969538f5d55569bf43d/plugins/fs/src/commands.rs) 在 scope 检查后继续使用 ambient `std::fs`。这类检查/使用分离无法消除 symlink swap/TOCTOU，也会迫使 WebView 接触绝对路径或宽泛 scope。

采用 [cap-std](https://github.com/bytecodealliance/cap-std/blob/715e4ed607ae9a93c7446b0fa63296f7898831c2/README.md) 的目录 capability 模型：每个用户选择的 root 只在授权入口调用一次 `Dir::open_ambient_dir`，后续所有 [Dir CRUD](https://github.com/bytecodealliance/cap-std/blob/715e4ed607ae9a93c7446b0fa63296f7898831c2/cap-std/src/fs/dir.rs) 都相对已打开句柄执行。它明确拒绝 `..`、absolute path 和越界 symlink；Linux 使用 `openat2`/`RESOLVE_BENEATH`，其他支持平台逐组件解析。canonical path 因此只负责显示、去重和 watcher，不再承担权限证明。

[notify 的已知限制](https://github.com/notify-rs/notify/blob/bc257049798e17029051eed24bcf5ae8a0f8cb85/notify/src/lib.rs) 包括网络文件系统可能不发事件、编辑器保存事件形态不同、父目录删除/重命名差异、超大目录可能丢事件和 Linux watch 数量限制。[notify-debouncer-full](https://github.com/notify-rs/notify/blob/bc257049798e17029051eed24bcf5ae8a0f8cb85/notify-debouncer-full/src/lib.rs) 的 rename/file-id/`need_rescan` 处理可作参考，但首版不引入其递归 file-id cache。Plain 直接使用稳定版 `notify::RecommendedWatcher`，回调只设置 dirty/rescan 并尝试写入有界唤醒队列；worker 始终通过 root capability 重扫。

对应威胁合同包括：多 root 与多窗口隔离，POSIX/Windows/UNC/device/ADS/traversal 输入，中间与末端 symlink、dangling link 和 loop，不存在写目标的父目录逃逸，symlink swap 压测，非覆盖 rename，递归删除不跟随链接，以及 watcher overflow/error/乱序/丢失后的收敛。非 UTF-8 名称禁止 `to_string_lossy()` 后继续寻址；无损 opaque entry handle 延后但错误必须明确。

只读文件树接线继续固定到 `monaco-vscode-api` 35.0.1 的 commit `d8367168c23c9d0a9ba5bc84b8034e5435e9eb93`。官方 [files override](https://github.com/CodinGame/monaco-vscode-api/blob/d8367168c23c9d0a9ba5bc84b8034e5435e9eb93/src/service-override/files.ts) 暴露 `registerCustomProvider`，且要求在 Workbench 初始化前注册；官方 [explorer override](https://github.com/CodinGame/monaco-vscode-api/blob/d8367168c23c9d0a9ba5bc84b8034e5435e9eb93/src/service-override/explorer.ts) 可独立引入 Explorer service、命令和 contribution；[demo 接线](https://github.com/CodinGame/monaco-vscode-api/blob/d8367168c23c9d0a9ba5bc84b8034e5435e9eb93/demo/src/setup.common.ts) 证明 provider、workspace provider 和 Explorer override 可以组合。Plain 采用独立的 `plain-workspace:` provider，并通过 configuration override 的 `reinitializeWorkspace` 在原生 picker 返回后切换单目录 workspace；不把 `file:`、绝对路径或通用 Tauri fs 权限暴露给 WebView。

现有 Tauri 编辑器只能作为反例或交互参考。SideX 固定版本 `05d0710a2735d2a5d6d493f299381d5b6dd06a61` 的 provider 向 Rust 传递绝对路径，Rust 后端继续使用 ambient 文件 API；Terax 固定版本 `34b0a0b0ce2c950112d7c775e64f15000cb74ec5` 的前端树有可参考的懒加载状态机，但后端接收任意路径并静默跳过错误；JulIDE 固定版本 `d98ae7626005232765346623af6a1acc7df51491` 一次 IPC 递归整棵树，会跟随 symlink、吞掉错误并放大大仓库启动成本。Plain 因此只实现 Workbench 所需的单层 `stat`/`readDirectory`，设置条目数和 payload 上限，并把预览所需的有界 `readFile` 作为接入 Explorer 前的独立切片；不会复制这些仓库的文件实现。

### F020 CRUD 写语义补充调研

创建和重命名不能直接照搬 `std::fs` 或 Workbench 的乐观预检查。[cap-std 4.0.2 固定源码的 `Dir`](https://github.com/bytecodealliance/cap-std/blob/715e4ed607ae9a93c7446b0fa63296f7898831c2/cap-std/src/fs/dir.rs) 中，`create` 会截断已有文件，`rename` 也明确允许替换目标；空文件必须改用 [`OpenOptions::write(true).create_new(true)`](https://github.com/bytecodealliance/cap-std/blob/715e4ed607ae9a93c7446b0fa63296f7898831c2/cap-primitives/src/fs/open_options.rs)，目录则使用单级 `create_dir`。重命名必须先由 `cap_std` 安全打开源和目标父目录，再只把 basename 交给 [rustix 1.1.4 固定源码的 `renameat_with`](https://github.com/bytecodealliance/rustix/blob/c4caf5caaa7e93828a2e4a4cdba1dd0171e45717/src/fs/at.rs) 和 `NOREPLACE`；把多段路径直接传给原始 `renameat` 会重新暴露中间 symlink 逃逸。macOS/Linux 或文件系统不支持原子 no-replace 时必须安全失败；Windows 的 handle-relative exclusive rename 留给 F120/F130，期间不得退化为 `exists + rename`。

`monaco-vscode-api@35.0.1` 对应的 upstream Code OSS commit 中，[`openExplorerAndCreate`](https://github.com/microsoft/vscode/blob/fc3def6774c76082adf699d366f31a557ce5573f/src/vs/workbench/contrib/files/browser/fileActions.ts) 通过 `ResourceFileEdit` 进入 [`FileService`](https://github.com/microsoft/vscode/blob/fc3def6774c76082adf699d366f31a557ce5573f/src/vs/platform/files/common/fileService.ts)。`createFile` 的存在性检查和最终 provider `writeFile` 分离，而且后者会收到 `create: true, overwrite: true`；因此 Plain provider 不能把该 `overwrite` 当成覆盖授权，Rust 仍必须以 `create_new` 为最终权威。[`Readonly` provider capability](https://github.com/microsoft/vscode/blob/fc3def6774c76082adf699d366f31a557ce5573f/src/vs/platform/files/common/files.ts) 又是整个 scheme 的粗粒度开关，解除后会同时启用新建、重命名、剪切/粘贴和编辑器写入；[Explorer 菜单贡献](https://github.com/microsoft/vscode/blob/fc3def6774c76082adf699d366f31a557ce5573f/src/vs/workbench/contrib/files/browser/fileActions.contribution.ts) 甚至不能用它细分永久删除。保持 `Readonly` 只能保证 provider 拒绝写入并禁用部分动作，不能保证所有命令和菜单不可见。Plain 先分别完成 create、rename、其余 CRUD 与安全内容写入合同，最后才按原生能力单独激活写界面。

写操作也不能复用只读 lease 的“执行后再校验”模式。每个窗口新增一个 mutation gate；create/rename 与 root replace/remove/window close 都按 `mutation gate -> workspace state` 的统一锁序线性化。写线程取得 gate 后再次验证旧 lease，只有仍授权时才执行 syscall：撤销先发生则磁盘不变，写先发生则撤销等待。读操作仍保持锁外 I/O 和迟到结果丢弃。

## 调试

[Debug Adapter Protocol](https://microsoft.github.io/debug-adapter-protocol/) 当前规范 1.71。DAP 使用 `Content-Length` frame 和 JSON，但不是 JSON-RPC。

Rust 端使用 Tokio process/TCP、`tokio-util` 自定义 codec、Serde，并基于官方 [`debugAdapterProtocol.json`](https://github.com/microsoft/debug-adapter-protocol/blob/main/debugAdapterProtocol.json) 固定合同。用户提供本地 adapter 命令或 TCP 地址；Plain 不运行 VS Code debugger extension，也不自动安装 debugpy/delve/CodeLLDB。

## 采用/拒绝清单

采用：

- 当前 Code OSS 的行为合同、经审计的静态资源和测试场景。
- `monaco-vscode-api` 的显式 allowlist Workbench service packages。
- Tauri 2 + Rust 原生服务。
- SideX 的进程映射和经过逐文件审计的 MIT 实现思路。
- Monaco/TextMate/Oniguruma、portable-pty、xterm、notify、ripgrep、系统 Git CLI。

拒绝：

- 整仓引入任何 AI-first 编辑器。
- 直接维护当前完整 `src/vs` 分叉，或照搬 SideX 整仓。
- SideX 的 Extension Host、LSP、tasks、auth、remote、update、Marketplace proxy 及未经重写的高风险原生模块。
- `monaco-vscode-api` 的 AI、Chat、Auth、Sync、Gallery、Remote、Task、Testing 和 Notebook packages，以及任何 Extension Host 入口或启用配置；API 自带的惰性静态 contribution registry 除外。
- GitLens Plus/Pro/品牌代码或 Zed GPL 代码。
- 以“支持主题”为由开放任意扩展执行。
- 依赖 DAP/主题/Git 的模糊兼容声明而没有 fixture 合同。
