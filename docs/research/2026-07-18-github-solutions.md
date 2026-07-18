# GitHub 现有方案调研

调研日期：2026-07-18
原则：先广后窄，版本、活跃度和许可证均按调研日页面核实。

## 结论

最合适的路线是：以当前 Code OSS 为行为/资产/测试基线，产品前端按需组合 `@codingame/monaco-vscode-api` 的 Workbench service packages，参考 SideX 的 Tauri 映射重写 Rust 原生服务。这样既不从 CodeMirror 重造编辑器，也不需要长期维护当前四千多个 Workbench 源文件或通用 Extension Host。

## 整机候选

| 项目 | 现状与能力 | 许可证 | 结论 |
|---|---|---|---|
| [SideX](https://github.com/Sidenai/sidex) | Tauri 2 + Rust + 直接移植的旧版 VS Code Workbench；来源未记录可靠 upstream commit，代码/产品标记约在 1.96–1.110 时代；文件、PTY、Git、search、theme、SQLite 已有，debug/extension host 仍在进行；v0.1.2，约 2.5k stars | MIT | 最接近的整机参考；只作 Rust donor/架构样本，不能无审计整仓替换 |
| [monaco-vscode-api](https://github.com/CodinGame/monaco-vscode-api) | 把 Code OSS 1.128.0（commit `fc3def6774c76082adf699d366f31a557ce5573f`）能力拆成 Workbench/theme/TextMate/files/search/terminal/SCM/debug 等 service packages，版本活跃 | MIT | 推荐产品前端主体；只安装 allowlist packages，禁止 extension host 与 AI/Auth/Sync 等包 |
| [Terax](https://github.com/crynta/terax-ai) | Tauri 2、React、CodeMirror、portable-pty、xterm、文件树和 Git graph；AI 深度耦合，无通用 DAP/VSIX 主题 | Apache-2.0 | 参考 PTY、Git graph 和打包，不作基座 |
| [Athas](https://github.com/athasdev/athas) | Tauri 编辑器，Git/LSP/terminal/AI/协作能力广 | AGPL-3.0 | 只参考产品行为，不搬代码 |
| [JulIDE](https://github.com/sinisterMage/JulIde) | Tauri + Monaco，Git2 能力较完整，但强绑定 Julia | MIT | 参考 Git UI/API，不作通用基座 |
| [Blink](https://github.com/bmarti44/blink) | Tauri + monaco-vscode-api full workbench POC，项目自称 buggy、无稳定 release | 复制前需再次核验 | 只参考接线，不作基座 |
| [montauri-editor](https://github.com/TimSusa/montauri-editor) | 旧 Tauri + Monaco 极小原型，功能很少 | MIT | 排除 |

SideX 的关键映射已由源码确认：Electron main → Tauri Rust，`ipcMain` → commands/events，Node fs/pty → Rust/portable-pty，renderer/Monaco/Workbench 继续在 WebView 运行。其当前仓库也包含 Extension Host、LSP、tasks、auth、update、remote、WASM 等大量 Plain 明确不要的模块，因此只能按域挑选并重新审计。

本地源码安全审计进一步排除了直接移植：SideX 路径校验允许绝对路径和 symlink 越界；搜索/监听未统一过安全层；Git config/run 暴露 hooks、credential helper、ssh command 等进程执行面；DAP transport 对 UTF-8/UTF-16 字节长度处理错误且缺少上限/超时；watch pattern 更新捕获旧值并使用无界队列；主题模型不兼容 VS Code 的 dotted color ids，也缺 VSIX/JSONC/include/semantic/tmTheme；当前 Tauri 配置为 `csp: null` 且 asset scope 覆盖 `$HOME/**`。这些实现只可用作失败模式和测试用例来源。

`monaco-vscode-api` 自身也不能整包导入：其 demo 同时展示 AI、Chat、Auth、Sync、Remote、Notebook、Testing、Gallery 和 Extension Host。Plain 必须只导入明确允许的 service packages，并用架构检查扫描 imports、manifest 和 lockfile；主题只走静态 contribution registry，不导入 `vscode/localExtensionHost`。

## 非 Tauri Rust 编辑器

| 项目 | 可参考点 | 许可边界 |
|---|---|---|
| [Lapce](https://github.com/lapce/lapce) | Rust DAP 状态机、proxy/rope、文件/Git/terminal | Apache-2.0，可参考或经审计复用 |
| [Zed](https://github.com/zed-industries/zed) | 成熟 debugger/Git/terminal 交互 | 多数 GPL-3.0；只参考行为，不能搬入 MIT 项目 |
| [Helix](https://github.com/helix-editor/helix) | `helix-dap` transport/types、tree-sitter | MPL-2.0 文件级 copyleft，慎用源码 |
| [Xi Editor](https://github.com/xi-editor/xi-editor) | rope 算法历史 | 已停止维护，不作基础 |

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
- `monaco-vscode-api` 的 AI、Chat、Auth、Sync、Gallery、Remote、Task、Testing、Notebook 和 Extension Host packages。
- GitLens Plus/Pro/品牌代码或 Zed GPL 代码。
- 以“支持主题”为由开放任意扩展执行。
- 依赖 DAP/主题/Git 的模糊兼容声明而没有 fixture 合同。
