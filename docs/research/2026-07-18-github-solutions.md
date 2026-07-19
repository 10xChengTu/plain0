# GitHub 现有方案调研

调研日期：2026-07-18
原则：先广后窄，版本、活跃度和许可证均按调研日页面核实。

## 结论

最合适的路线是：把仓库内 Code OSS 1.130 只保留为旧源码行为/资产/测试迁移 oracle，产品前端按需组合固定在 Code OSS 1.128.1 的 `@codingame/monaco-vscode-api` Workbench service packages，参考 SideX 的 Tauri 映射重写 Rust 原生服务。这样既不从 CodeMirror 重造编辑器，也不需要长期维护当前四千多个 Workbench 源文件或通用 Extension Host。

## 整机候选

| 项目                                                                | 现状与能力                                                                                                                                                                                                                                                                                                                                                                         | 许可证           | 结论                                                                                          |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------- |
| [SideX](https://github.com/Sidenai/sidex)                           | Tauri 2 + Rust + 直接移植的旧版 VS Code Workbench；来源未记录可靠 upstream commit，代码/产品标记约在 1.96–1.110 时代；文件、PTY、Git、search、theme、SQLite 已有，debug/extension host 仍在进行；v0.1.2，约 2.5k stars                                                                                                                                                             | MIT              | 最接近的整机参考；只作 Rust donor/架构样本，不能无审计整仓替换                                |
| [monaco-vscode-api](https://github.com/CodinGame/monaco-vscode-api) | 把 [Code OSS 1.128.1（commit `5264f2156cbcd7aea5fd004d29eaa10209155d66`）](https://github.com/CodinGame/monaco-vscode-api/blob/d8367168c23c9d0a9ba5bc84b8034e5435e9eb93/package.json#L32-L37) 能力拆成 Workbench/theme/TextMate/files/search/terminal/SCM/debug 等 service packages；调研日 npm 最新为 35.0.1（2026-07-15，git commit `d8367168c23c9d0a9ba5bc84b8034e5435e9eb93`） | MIT              | 推荐产品前端主体；只安装 allowlist packages，禁止 Extension Host 执行入口与 AI/Auth/Sync 等包 |
| [Terax](https://github.com/crynta/terax-ai)                         | Tauri 2、React、CodeMirror、portable-pty、xterm、文件树和 Git graph；AI 深度耦合，无通用 DAP/VSIX 主题                                                                                                                                                                                                                                                                             | Apache-2.0       | 参考 PTY、Git graph 和打包，不作基座                                                          |
| [Athas](https://github.com/athasdev/athas)                          | Tauri 编辑器，Git/LSP/terminal/AI/协作能力广                                                                                                                                                                                                                                                                                                                                       | AGPL-3.0         | 只参考产品行为，不搬代码                                                                      |
| [JulIDE](https://github.com/sinisterMage/JulIde)                    | Tauri + Monaco，Git2 能力较完整，但强绑定 Julia                                                                                                                                                                                                                                                                                                                                    | MIT              | 参考 Git UI/API，不作通用基座                                                                 |
| [Blink](https://github.com/bmarti44/blink)                          | Tauri + monaco-vscode-api full workbench POC，项目自称 buggy、无稳定 release                                                                                                                                                                                                                                                                                                       | 复制前需再次核验 | 只参考接线，不作基座                                                                          |
| [montauri-editor](https://github.com/TimSusa/montauri-editor)       | 旧 Tauri + Monaco 极小原型，功能很少                                                                                                                                                                                                                                                                                                                                               | MIT              | 排除                                                                                          |

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

`monaco-vscode-api@35.0.1` 对应的 upstream Code OSS commit 中，[`openExplorerAndCreate`](https://github.com/microsoft/vscode/blob/5264f2156cbcd7aea5fd004d29eaa10209155d66/src/vs/workbench/contrib/files/browser/fileActions.ts) 通过 `ResourceFileEdit` 进入 [`FileService`](https://github.com/microsoft/vscode/blob/5264f2156cbcd7aea5fd004d29eaa10209155d66/src/vs/platform/files/common/fileService.ts)。`createFile` 的存在性检查和最终 provider `writeFile` 分离，而且后者会收到 `create: true, overwrite: true`；因此 Plain provider 不能把该 `overwrite` 当成覆盖授权，Rust 仍必须以 `create_new` 为最终权威。[`Readonly` provider capability](https://github.com/microsoft/vscode/blob/5264f2156cbcd7aea5fd004d29eaa10209155d66/src/vs/platform/files/common/files.ts) 又是整个 scheme 的粗粒度开关，解除后会同时启用新建、重命名、剪切/粘贴和编辑器写入；[Explorer 菜单贡献](https://github.com/microsoft/vscode/blob/5264f2156cbcd7aea5fd004d29eaa10209155d66/src/vs/workbench/contrib/files/browser/fileActions.contribution.ts) 甚至不能用它细分永久删除。保持 `Readonly` 只能保证 provider 拒绝写入并禁用部分动作，不能保证所有命令和菜单不可见。Plain 先分别完成 create、rename、其余 CRUD 与安全内容写入合同，最后才按原生能力单独激活写界面。

写操作也不能复用只读 lease 的“执行后再校验”模式。每个窗口新增一个 mutation gate；create/rename 与 root replace/remove/window close 都按 `mutation gate -> workspace state` 的统一锁序线性化。写线程取得 gate 后再次验证旧 lease，只有仍授权时才执行 syscall：撤销先发生则磁盘不变，写先发生则撤销等待。读操作仍保持锁外 I/O 和迟到结果丢弃。

### F020 有界复制补充调研

[cap-std 4.0.2 的 `Dir::copy`](https://github.com/bytecodealliance/cap-std/blob/715e4ed607ae9a93c7446b0fa63296f7898831c2/cap-std/src/fs/dir.rs#L214-L232) 不是 Plain 所需的 no-clobber copy：它只接受普通文件或解引用后得到的普通文件，末级 symlink 默认会被跟随；[Unix 底层实现](https://github.com/bytecodealliance/cap-std/blob/715e4ed607ae9a93c7446b0fa63296f7898831c2/cap-primitives/src/rustix/fs/copy_impl.rs) 对目标使用 `create + truncate`，Linux 快路径失败后会退到无界 `io::copy`，macOS 的 clone 在 `EEXIST` 等错误后会退到覆盖式 `fcopyfile`。这也意味着类型确认前可能打开 FIFO/设备，失败后可能留下已截断或部分目标。`std::fs::copy` 具有相同的覆盖与 symlink 解引用问题，二者都不能进入 Plain writer。

[`cap-fs-ext 4.0.2`](https://github.com/bytecodealliance/cap-std/blob/715e4ed607ae9a93c7446b0fa63296f7898831c2/cap-fs-ext/src/dir_ext.rs#L85-L89) 的 `DirExt::open_dir_nofollow` 负责目录末级 nofollow，[`OpenOptionsFollowExt`](https://github.com/bytecodealliance/cap-std/blob/715e4ed607ae9a93c7446b0fa63296f7898831c2/cap-fs-ext/src/open_options_follow_ext.rs) 和 [`OpenOptionsSyncExt::nonblock`](https://github.com/bytecodealliance/cap-std/blob/715e4ed607ae9a93c7446b0fa63296f7898831c2/cap-fs-ext/src/open_options_sync_ext.rs) 分别负责文件末级 nofollow 与非阻塞打开；现有固定版 `rustix` 继续只负责最终 `NOREPLACE` 发布。[`cap-tempfile` 固定源码](https://github.com/bytecodealliance/cap-std/blob/715e4ed607ae9a93c7446b0fa63296f7898831c2/cap-tempfile/src/tempfile.rs) 的随机 `create_new` 与 Drop 清理值得参考，但其 `replace()` 最终使用可覆盖的 `Dir::rename`，因此 Plain 只复用 RAII 思路，不直接引入。[systemd 的固定 copy 实现](https://github.com/systemd/systemd/blob/215ad044d337bf54c37b5d965773c2c5c038b32f/src/shared/copy.c) 验证了 `O_NOFOLLOW`、`O_EXCL`、handle-relative 递归、原样复制 symlink 和失败时只清理本次目标的组合，可作失败模式参考；其 ambient C API、2048 层安全网和 metadata 范围不直接移植。

Code OSS 的 `IFileSystemProvider.copy` 是由 `FileFolderCopy` capability 控制的可选整树操作；[FileService 路由](https://github.com/microsoft/vscode/blob/5264f2156cbcd7aea5fd004d29eaa10209155d66/src/vs/platform/files/common/fileService.ts#L803-L850) 会把同源同目标当成功 no-op，在 `overwrite=true` 时先递归删除目标，并在调用 native provider copy 前无条件 `mkdirp` 目标父目录；同 provider 缺少 native copy 时又会[先创建目录、再递归写入](https://github.com/microsoft/vscode/blob/5264f2156cbcd7aea5fd004d29eaa10209155d66/src/vs/platform/files/common/fileService.ts#L898-L954)，失败可留下半成品。Plain 的所有 root authority 共用一个 provider 实例，未来 root A 到 root B 会进入 provider copy；正式解除 `Readonly` 前必须同时实现 `FileFolderCopy`，并阻断 upstream 的同路径 no-op、预删除 overwrite、自动 `mkdirp` 与跨 scheme fallback，不能等 Rust 收到请求后才拒绝。

调研最终把 copy 拆成可单独验收的切片。第一项只复制不超过现有 8 MiB 上限的普通文件：wire request 从一开始携带 `sourceRootId/sourcePath/targetRootId/targetPath`，两端在同一 mutation gate 内重验；源以 nofollow/nonblocking 方式打开并在句柄上确认类型，在目标父目录写入高熵 `create_new` staging，完成有界复制、稳定性复核和基础权限设置后再用现有原子 `NOREPLACE` 发布。成功复制定义为已打开 source handle 上观察到的完整数据，basename 在打开后被替换不会把读取重定向到新文件；同一 inode 在复制期间的可检测变化则返回冲突。目录、symlink 和特殊文件在此切片稳定拒绝；provider 保持只读。后续先独立实现原样 symlink copy，再实现目录 manifest/staging：全树最多 10,000 条目、1 KiB 单名、2 MiB 聚合名称 payload、256 层相对深度、4 KiB 单 link payload、2 MiB 聚合 link payload、8 MiB 单文件和 256 MiB 总逻辑字节；拒绝 FIFO/socket/device，并在发布前重验 manifest。跨 root move 必须消费 copy receipt 并再次验证当前源路径；检测到变化时不删除，但 receipt 校验与路径删除之间仍存在外部 rename/swap 竞争，因此继续作为明确的非原子状态机和失败结果暴露，不能宣称条件删除是原子的。

### F020 有界目录复制方案冻结

目录切片继续以固定源码而不是第三方整包为依据。[`cap-fs-ext 4.0.2` 的 `open_dir_nofollow`](https://github.com/bytecodealliance/cap-std/blob/715e4ed607ae9a93c7446b0fa63296f7898831c2/cap-fs-ext/src/dir_ext.rs#L85-L89) 可以从已经授权的父目录 handle 打开真实子目录而拒绝末级 symlink，适合 manifest 的逐层遍历。[`cap-std 4.0.2` 的 `remove_dir_all` 与 `remove_open_dir_all`](https://github.com/bytecodealliance/cap-std/blob/715e4ed607ae9a93c7446b0fa63296f7898831c2/cap-std/src/fs/dir.rs#L340-L376) 虽然在 Unix 实现中以 nofollow 方式递归，但 API 自身无条目、深度或总量预算，也明确不保证与并发 rename 原子；它无法证明删除的仍是 Plain 创建的 staging 成员，因此不用于失败清理。

[systemd 固定版本的 `copy.c`](https://github.com/systemd/systemd/blob/215ad044d337bf54c37b5d965773c2c5c038b32f/src/shared/copy.c) 再次确认可参考的组合是：父目录 fd 相对遍历、目录 nofollow 打开、symlink payload 原样重建、特殊文件按策略拒绝、失败时清理本次目标。它同时支持设备、所有权、xattr、稀疏文件、reflink 和大量策略 flag，递归/删除合同也不是 Plain 的固定预算与 identity receipt，不能整体移植。Code OSS 固定版本的 [`FileService.copy`](https://github.com/microsoft/vscode/blob/5264f2156cbcd7aea5fd004d29eaa10209155d66/src/vs/platform/files/common/fileService.ts#L803-L954) 仍会在 provider 调用前处理 overwrite、`mkdirp`，缺少 native copy 时还会边遍历边创建目标；这证明 manifest/staged tree 必须完全留在 Rust command 内，不能复用前端 fallback。

最终方案不引入 `walkdir`、`jwalk`、`globwalk`、`fs_extra`、`dircpy` 或 `copy_dir`。source 根先以 nofollow handle 打开，显式有界 DFS 只收集无损、portable 的 UTF-8 basename；symlink 只读取已有 4 KiB + 1 raw probe，目录逐层 nofollow，普通文件只记录并复核既有安全 snapshot，特殊文件立即失败。manifest header 单独记录 source 根；10,000 条目预算只统计 descendants，根 depth 为 0、直接 child 为 1，2 MiB 聚合名称只计 descendant basename UTF-8 bytes 且不计分隔符。source 根和正式 target basename 不进入聚合值，但都单独受 1 KiB 限制，避免发布后父目录无法列出。hardlink 每条路径分别计条目与逻辑字节；每个 source/target 后代还必须满足完整 wire path 的 4 KiB/256 段上限。

目标写入只在 source manifest 完成并重验后开始。目标父目录 identity 若等于 source manifest 中任一目录 identity，则拒绝 lexical path 无法识别的同树/重叠 root/symlink alias descendant。顶层 staging 目录最多 16 次高熵 exclusive create，初始 mode 为 `0700`；内部目录单级创建并 nofollow 打开。每个 file/link 在产生自己的 staging 副作用前必须再次匹配 manifest snapshot/payload，实际传输还消费共享 checked 聚合预算，源并发增长不能把磁盘写入放大到 256 MiB/2 MiB 上限之外。发布前再次精确比较 source manifest、staging 成员集合、identity、文件 bytes 与 raw link payload；随后每个目录都经 nofollow handle 与 receipt identity 绑定后才能逆深度应用 `source mode & 0o777`，最后只调用既有 `NOREPLACE` 发布。失败清理禁止 `remove_dir_all`：恢复 `0700`、删除 leaf 或删除空目录前都必须 nofollow 打开/查询并匹配该成员 receipt；发现 replacement 或额外成员时宁可留下高熵 artifact，也不修改或删除未验证对象。

该设计承诺 capability 不逃逸、正式目标 no-clobber 且只完整出现或完全不存在；不承诺断电持久化，也无法消除同 UID 外部进程在最终 identity 检查与 rename/unlink 之间的竞争。首版不保留 hardlink 关系、稀疏洞、ACL、xattr、owner、时间戳、resource fork 或 ADS。macOS/Linux 继续使用固定 `NOREPLACE`；其他平台 fail closed，provider 在全部 CRUD 和版本化写入完成前继续 `Readonly`。

### F020 跨 root move receipt/verified delete 方案冻结

Code OSS 1.130.0 固定提交 `edcd2a25245005ea9a4c0a4361235c81575665dd` 只作为当前 upstream 行为对照：其 [`FileService.doMoveCopy`](https://github.com/microsoft/vscode/blob/edcd2a25245005ea9a4c0a4361235c81575665dd/src/vs/platform/files/common/fileService.ts#L817-L873) 对跨 provider move 只做普通 copy，随后直接 `del(source, { recursive: true })`。Plain 实际固定的 `monaco-vscode-api@35.0.1` 运行基线是 Code OSS 1.128.1 commit `5264f2156cbcd7aea5fd004d29eaa10209155d66`；该提交的 [`FileService.doMoveCopy`](https://github.com/microsoft/vscode/blob/5264f2156cbcd7aea5fd004d29eaa10209155d66/src/vs/platform/files/common/fileService.ts#L817-L873) 具有相同的 copy-then-delete、同路径成功 no-op、overwrite 预删除和无条件 `mkdirp` 语义，因此后续窄 patch 必须以 `5264f` 的真实依赖结构落地，而不是直接套用 1.130 行号。两版都没有 copy receipt，也不能在删除失败时区分“目标已存在、源完整保留”和“目标已存在、源已部分删除”。1.130 Node fallback 的 [`Promises.rename`](https://github.com/microsoft/vscode/blob/edcd2a25245005ea9a4c0a4361235c81575665dd/src/vs/base/node/pfs.ts#L490-L525) 在 `EXDEV` 或 source basename 以 `.` 结尾时使用 ambient copy 后 [`rimraf(MOVE)`](https://github.com/microsoft/vscode/blob/edcd2a25245005ea9a4c0a4361235c81575665dd/src/vs/base/node/pfs.ts#L35-L85)；后者会尝试把源改名到系统临时目录并后台递归删除，失败还可能被忽略。Plain 不继承这些 overwrite、自动建父目录、symlink 解引用、无界删除或隐藏中间状态的语义。

Plain 的多个 root 共用同一个 `plain-workspace:` scheme 和 provider 实例，因此 Workbench 实际会把 root A 到 root B 当作“同 provider rename”，而不会进入上述跨 provider fallback。真实 `5264f` 基线中的 Explorer 粘贴由 [`fileActions.ts`](https://github.com/microsoft/vscode/blob/5264f2156cbcd7aea5fd004d29eaa10209155d66/src/vs/workbench/contrib/files/browser/fileActions.ts#L1188-L1235) 产生可能带 overwrite 的 `ResourceFileEdit`，再由 [`workingCopyFileService.ts`](https://github.com/microsoft/vscode/blob/5264f2156cbcd7aea5fd004d29eaa10209155d66/src/vs/workbench/services/workingCopy/common/workingCopyFileService.ts#L390-L440) 调用 `FileService.move`。未来解除 `Readonly` 时，provider `rename(from, to)` 必须按 URI authority/rootId 分流：同 root 只进现有原子 `workspace_rename`，不同 root 只进新的 `workspace_move`，跨 scheme 失败；上游窄 patch 还必须在任何副作用前同时阻断 move/copy 的同路径 no-op、overwrite 预删除、自动 `mkdirp` 和 generic fallback。

GNU coreutils 9.11 固定提交 `c01fd163a47468a8296fb369f5233853bb551bb6` 提供两个可参考事实：普通文件 copy 会以 `O_NOFOLLOW` 打开并核对 stat 与 handle 的 dev/inode（[`copy.c`](https://github.com/coreutils/coreutils/blob/c01fd163a47468a8296fb369f5233853bb551bb6/src/copy.c#L749-L773)）；跨设备 move 只在 copy 成功后删除源，删除失败时保留目标并让整体失败（[`mv.c`](https://github.com/coreutils/coreutils/blob/c01fd163a47468a8296fb369f5233853bb551bb6/src/mv.c#L163-L243)）。但其 EXDEV 路径可以为模拟 rename [先删除目标](https://github.com/coreutils/coreutils/blob/c01fd163a47468a8296fb369f5233853bb551bb6/src/copy.c#L2145-L2285)，copy 后仍按 ambient source path 递归 `rm`，没有 source/target receipt、固定聚合预算或可区分 partial 的结果；GPL 实现仅作行为参考。systemd 固定 [`copy.c`](https://github.com/systemd/systemd/blob/215ad044d337bf54c37b5d965773c2c5c038b32f/src/shared/copy.c#L809-L901) 的 parent-fd、`O_NOFOLLOW`、`O_EXCL` 和失败时清理本次目标仍可参考，但 [`COPY_VERIFY_LINKED`](https://github.com/systemd/systemd/blob/215ad044d337bf54c37b5d965773c2c5c038b32f/src/basic/stat-util.c#L196-L211) 只证明打开 inode 还有链接，不能证明原 pathname 仍指向它；其 replace、特殊文件、边遍历边创建与无 receipt unlink 同样不适用。

固定 `cap-std 4.0.2` 的 [`Dir::remove_file`/`remove_dir`](https://github.com/bytecodealliance/cap-std/blob/715e4ed607ae9a93c7446b0fa63296f7898831c2/cap-std/src/fs/dir.rs#L336-L398) 和 `rustix 1.1.4` 的 [`unlinkat(parent_fd, basename, flags)`](https://github.com/bytecodealliance/rustix/blob/c4caf5caaa7e93828a2e4a4cdba1dd0171e45717/src/fs/at.rs#L233-L250) 足以把每次删除限制在已打开的授权父目录，但都没有“仅当 pathname 仍对应 expected dev/inode 才删除”的原子条件。`cap-std` 自己也明确说明 [`remove_open_dir(_all)`](https://github.com/bytecodealliance/cap-std/blob/715e4ed607ae9a93c7446b0fa63296f7898831c2/cap-std/src/fs/dir.rs#L355-L374) 不保证与并发 rename 原子。把源先改名到 tombstone 也不能修复这个缺口：检查与 rename 之间仍可换入 replacement，事后不一定能安全恢复。因此当前依赖只承诺 capability 不逃逸，不能承诺外部同 UID 竞争者永远不会在最后检查与 unlink 之间获胜。

仅凭 metadata snapshot 不能在 FAT/exFAT、部分 SMB/NFS 等粗时间戳文件系统上绑定发布时 bytes，也无法严格归因 source/target 的协调等长改写。Plain 因此采用 RustCrypto [`sha2 0.10.9`](https://github.com/RustCrypto/hashes/blob/82c36a428f8d6f05f3bfccdedb243e9d1f85359d/sha2/Cargo.toml#L1-L40) 固定 tag commit `82c36a428f8d6f05f3bfccdedb243e9d1f85359d`：它是 MIT OR Apache-2.0 的 pure-Rust 实现，并提供[流式 `Sha256`/`Digest` API](https://github.com/RustCrypto/hashes/blob/82c36a428f8d6f05f3bfccdedb243e9d1f85359d/sha2/src/lib.rs#L26-L54)。该 crate 已作为锁文件传递依赖存在；实现只新增唯一、未重命名、normal runtime、无 target、非 optional 的直接依赖 `sha2 = { version = "=0.10.9", default-features = false }`，直接 edge 的显式 feature 必须为空；解析后的 feature 只允许当前传递依赖已经启用的 `default/std`，不得新增任何实现可选 feature。每个普通文件在 publication 前由稳定 source 与 staged target 双侧流式复核同一 32-byte SHA-256 digest，receipt 只保存 digest；symlink payload 仍在既有 4 KiB 上限内完整保存。后续变化归因依赖 SHA-256 的 collision/second-preimage resistance，并继续用 pathname/handle identity 与 metadata before/after 关闭普通 swap 窗口；它不是签名，也不消除最后检查到 unlink 的外部竞态。

Plain 新增独立四字段 `workspace_move`，只接受不同的两个 rootId；同 root 始终走既有原子 no-clobber rename。它不能串联两个 IPC，而是在同一次 dual-root mutation gate 中执行 `copy_entry_with_receipt -> NOREPLACE publication -> source/target receipt revalidation -> bounded verified delete`。`PublishedCopyReceipt` 是 Rust 内部一次性 typestate，不实现 Serde、不进入 IPC，也不在 copy 与 delete 之间释放 gate；普通 `workspace_copy` 只丢弃它，`workspace_move` 消费它。receipt 的全部 handle、路径、identity、manifest 和 target 名称在正式发布前准备好；`NOREPLACE` 成功后到结构化状态转换之间不得再插入可能返回普通错误的后处理。

正式目标发布前的失败仍返回 `CommandError`，语义是 Plain 没有发布本次正式目标，源也未被 Plain 删除。正式目标一旦发布，后续绝不回滚、覆盖、改名或删除目标，且不再用普通 rejection 隐藏磁盘事实；wire 结果固定为 `moved`、`targetPublishedSourceRetained` 或 `targetPublishedSourcePartiallyDeleted`。后两者携带 `sourceChanged | targetChanged | sourceUnverifiable | targetUnverifiable | deleteFailed` reason，partial 另带 1..10,000 的 `removedEntries`。missing 或 receipt 字段不匹配属于对应 changed，permission/I/O/final-mode 导致无法验收属于对应 unverifiable，只有实际 remove syscall 失败属于 deleteFailed；每轮固定先 source 后 target，并保留首先观察到的 reason。`SourceRetained` 只表示 Plain 成功执行了零个 source remove syscall，不保证外部进程没有同时改变路径；partial 表示至少一个 receipt 成员已删。调用方不得自动重试，未来 provider 必须转成稳定 incomplete 错误并刷新两个 root，而不能上报 MOVE 成功或建立 undo。

删除前必须先重新从两个 root 打开 source/target parent 并匹配 copy 时的 parent identity，再完整重验当前 source 和已发布 target。普通文件在 source/target 双侧都执行 pathname/handle metadata before → 有界流式 SHA-256 → pathname/handle metadata after，并分别要求 digest 等于 publication 前 receipt；source 永远先验，digest 不同归 `sourceChanged`，source 通过后 target digest 不同才归 `targetChanged`。这不是仅比较两个当前 handle，也不会把 publication 后第一次观察到的 target 内容误收编为基线；协调改写成相同新 bytes 仍会同时偏离 receipt，并按 source-first 规则停止。symlink 同样比较独立两端 snapshot 与 before/raw payload/after；目录复用 source manifest 和 published staged receipts，比较完整成员集合、最终 mode、identity、每个 file digest 与 raw link payload。删除开始后 source 只放宽 Plain 自己 unlink 可解释的 ctime/nlink，但 digest 不放宽。若任一 published member 因最终 mode、未复制的 ACL/ownership 语义或 I/O 无法再次安全打开，move 必须保留源并返回 `targetUnverifiable`，不能凭“刚才验证过 staging”继续删除。单文件 8 MiB、整树 256 MiB 的既有预算约束每轮重新哈希；最后 metadata-after 与 source unlink 之间的替换仍按公开竞态处理。

目录源删除只消费 manifest 生成的显式有界计划：leaf 逆序、目录逆深度、根最后；每一步重新确认 source 顶层 basename、父目录链、当前 source leaf 与对应 target receipt，symlink 永不跟随，禁止 `remove_dir_all`、第三方 walker、shell 或 ambient fs。开始删除后，目录 mtime/ctime 会因 Plain 自己移除子项而合法变化，因此只再要求 identity、mode 和应为空的剩余成员。删除开始后插入的未知成员绝不由 Plain 删除；为保持线性预算，它最迟在包含目录执行 `remove_dir` 前被空集合检查发现，此时可能已经删除其他 receipt leaf 并返回 partial，而不会在每个 leaf 前 O(n²) 重扫整目录。hardlink 每个路径仍独立计预算；preflight 严格比较完整 snapshot，删除阶段按 identity 分组并跟踪由 Plain 已成功 unlink 导致的 expected nlink 递减，对后续 alias 忽略这部分可解释的 ctime 变化，但继续比较 expected nlink、identity/type/mode/size/mtime，以及 source/target 各自的 file digest 或 raw payload receipt。外部对这些可比较字段或未抵消 link count 的变化必须冲突；Plain 第一次成功 unlink 后发生的 ctime-only 变化、恢复原值的抵消操作，以及未纳入 receipt 的 owner/xattr/ACL 变化不可判别，属于公开竞态边界。

每个成功 source remove syscall 递增有界计数；零次后失败返回 retained，至少一次后失败返回 partial。目标已发布后不尝试恢复已删 source 成员，也不删除目标。外部进程也可能在最后一次 target 验收后、source unlink 前删除、替换或改写 target；即使未来存在 expected-inode conditional source unlink，也无法把两个文件系统合成事务。因此 `moved` 只描述 Plain 最后观察到的 receipt 和成功 syscall，不承诺 target/source 随后仍保持该状态。当前切片不增加取消：`spawn_blocking` 一旦拿到 mutation gate 就运行到可报告终态；root replace/remove/window close 若先拿 gate 则 move 无副作用，move 先拿 gate 则生命周期操作等待。通用“确认删除”仍是后续独立工作项，可以复用 Rust 内部 verified-delete 机制，但不得把 receipt 暴露给 WebView，也不得因此提前解除 provider `Readonly`。

### F020 确认删除与 Trash 补充调研

对 Code OSS 1.130.0 oracle 和 Plain 实际运行基线 1.128.1 的十个删除链关键文件逐一比较 Git blob 后，`fileActions.ts`、`fileActions.contribution.ts`、`explorerView.ts`、`bulkFileEdits.ts`、`workingCopyFileService.ts`、`fileService.ts`、`files.ts`、磁盘 provider/server 与 `pfs.ts` 内容完全相同；因此删除补丁必须按产品基线 commit `5264f2156cbcd7aea5fd004d29eaa10209155d66` 落地，但当前 1.130 oracle 不存在额外语义漂移。

固定源码中的 [`deleteFiles`](https://github.com/microsoft/vscode/blob/5264f2156cbcd7aea5fd004d29eaa10209155d66/src/vs/workbench/contrib/files/browser/fileActions.ts#L88-L253) 先处理 dirty/readonly，再受 `explorer.confirmDelete` 与 `skipConfirm` 控制，最后才产生 `ResourceFileEdit`；[`BulkFileEdits`](https://github.com/microsoft/vscode/blob/5264f2156cbcd7aea5fd004d29eaa10209155d66/src/vs/workbench/contrib/bulkEdit/browser/bulkFileEdits.ts#L216-L283) 又按当时的 provider `Trash` capability 和 `files.enableTrash` 重新计算 `useTrash`，并只为不超过 5 MB 的普通文件读取 Undo 内容。这样会产生三个 Plain 不能继承的结果：界面已经显示“移到废纸篓”后，实际 provider 调用仍可能静默变成永久删除；文件夹 Undo 只重建空目录；批量操作在第 k 项失败时，前 k-1 项已经生效。[`WorkingCopyFileService.delete`](https://github.com/microsoft/vscode/blob/5264f2156cbcd7aea5fd004d29eaa10209155d66/src/vs/workbench/services/workingCopy/common/workingCopyFileService.ts#L449-L490) 的实际删除阶段还不消费 cancellation token，而是按数组逐项调用 [`FileService.del`](https://github.com/microsoft/vscode/blob/5264f2156cbcd7aea5fd004d29eaa10209155d66/src/vs/platform/files/common/fileService.ts#L1033-L1108)；Explorer prompt 不是 provider 的安全边界，内部 `ResourceFileEdit` 或 FileService 路径都可绕过它。

上游 `atomic` 也不等于 Plain 所需的 expected-identity 删除。固定 [`IFileDeleteOptions`](https://github.com/microsoft/vscode/blob/5264f2156cbcd7aea5fd004d29eaa10209155d66/src/vs/platform/files/common/files.ts#L311-L345) 允许 provider 把原路径先改名到同目录 postfix，再执行删除；Node 磁盘实现默认还会通过 [`Promises.rm(..., MOVE)`](https://github.com/microsoft/vscode/blob/5264f2156cbcd7aea5fd004d29eaa10209155d66/src/vs/base/node/pfs.ts#L21-L85) 尝试移到系统临时目录并后台递归清理。它既不验证 pathname 仍是确认时的 inode，也不提供固定预算、精确 partial 或失败回滚。Plain 不向 IPC 暴露这个 `atomic`，也不把 tombstone/background cleanup 当作永久删除实现。

Rust 方案同样没有可直接采用的整包实现。固定 `cap-std 4.0.2` 的 [`Dir::remove_file/remove_dir`](https://github.com/bytecodealliance/cap-std/blob/715e4ed607ae9a93c7446b0fa63296f7898831c2/cap-std/src/fs/dir.rs#L336-L383) 与 `cap-fs-ext::open_dir_nofollow` 足以把单次验证和删除约束在已打开 parent capability 下；但 [`remove_dir_all/remove_open_dir_all`](https://github.com/bytecodealliance/cap-std/blob/715e4ed607ae9a93c7446b0fa63296f7898831c2/cap-std/src/fs/dir.rs#L340-L376) 没有条目、深度、名称或总量预算，无法表达已经删除多少成员，并且 open-dir 变体明确不保证与并发 rename 原子。固定 `rustix 1.1.4` 的 [`unlinkat`](https://github.com/bytecodealliance/rustix/blob/c4caf5caaa7e93828a2e4a4cdba1dd0171e45717/src/fs/at.rs#L233-L250) 也没有 expected dev/inode 条件；最后 identity 检查与 unlink 之间的同 UID swap 仍是公开竞态。

未采用的 `trash 5.2.6`（MIT，固定 commit `1dca80069ec9d91bf14143c9649e680741ee159a`）接收 ambient 路径并在入口 [canonicalize parent](https://github.com/Byron/trash-rs/blob/1dca80069ec9d91bf14143c9649e680741ee159a/src/lib.rs#L228-L258)：macOS 后端可启动 Finder/`osascript` 或使用绝对 URL，Windows 后端把绝对路径交给 `IFileOperation`，Freedesktop 跨盘路径会递归复制再 `std::fs::remove_dir_all`。这些后端都不能满足 root capability、nofollow manifest、固定预算和逐项 partial 合同；回收站可恢复也不能替代授权安全。[Freedesktop Trash 规范](https://specifications.freedesktop.org/trash/latest/) 还明确要求回收站失败时不能未经用户确认改为不可恢复删除。首版因此不增加 `trash` 依赖、不声明 Workbench `Trash` capability、不接受 `useTrash` 或上游 `atomic`，系统回收站留作独立的平台专项。

Plain 采用 prepare/确认/begin/逐项 commit 的批量永久删除计划。`workspace_prepare_delete({ entries })` 在 mutation gate 内为 1..64 个 distinct、非重叠顶层选择建立并二次重验 Rust-only batch receipt，只返回窗口绑定、短时有效、一次性 opaque `confirmationId`、每项随机 `entryId` 与有界安全摘要；UI 对完整选择集显示一次“永久且不可撤销”确认。取消显式丢弃整批；确认后 `workspace_begin_delete` 在 Bulk Undo read/soft-revert 和任何 provider delete 前零副作用重验整批并进入 executing。随后固定 Workbench patch 把 token/next entryId/精确 root/path/recursive 作为调用级 authorization 从 `ResourceFileEdit` 逐层透传到同一 Plain provider，任何无 authorization 的 FileService delete fail closed；Rust 统一按 `mutation gate → batch state` 锁序逐项消费 receipt，并只按固定计划逆序调用 parent-handle + basename 的 `remove_file/remove_dir`。Plain 永久删除不建立上游 Undo，dirty working copy 只在对应 entry 已返回 `deleted` 后 soft-revert。token 不是信任 WebView 的 `confirmed: true` 布尔值，也不把 manifest、identity、metadata 或原生路径交给 WebView；provider 激活时必须由 Plain 中央 coordinator 覆盖所有 Workbench 删除入口，`explorer.confirmDelete=false`、dirty/readonly 的 `skipConfirm` 和 Retry 都不能形成绕过。

删除 receipt 与 copy receipt 的资源合同不同。整个 batch 共享 10,000 descendants、256 层、1 KiB 单名、2 MiB 聚合名称、4 KiB 单 link 和 2 MiB 聚合 link payload 的 namespace 预算，symlink 保存 raw payload且永不跟随，特殊文件首版拒绝；但普通文件只绑定 pathname/handle identity、type、mode、size、mtime、ctime 与 nlink，不读取文件内容，也不继承 copy 的 8 MiB 单文件/256 MiB 总字节上限。这样大文件仍可 O(1) 删除，同时 confirmation gap 内可观察的同 inode 修改会改变冻结 metadata；begin 的 whole-batch revalidation 不通过时必须零副作用。跨顶层相同 pathname identity 首版拒绝；同一所选目录 manifest 内每次成功 descendant unlink 都写入 Rust-only mutation journal：移除 expected residual member、递减 hardlink nlink，并从一个剩余 alias/manifest parent 立即重采 ctime/parent time 基线。顶层外部 parent 只绑定 identity、requested basename 与实际解析的 entry identity，不为 actual name 枚举无界 siblings，也不冻结 parent time；根 remove 成功后无额外 fallible rebaseline，直接返回 `deleted`，partial 计数只含最多 10,000 descendants。外部同 UID 改动若恰落在 syscall 与重采样之间可能被吸收，这是公开竞态。未知新成员最迟在 manifest-owned directory 的 `remove_dir` 前停止且绝不被删除。

每项 commit 的严格终态是 `deleted`、`entryRetained(reason)` 或 `entryPartiallyDeleted(reason, removedEntries)`；reason 仅为 `entryChanged | entryUnverifiable | deleteFailed`。token/entry 缺失、过期、跨窗口、错 URI/options、已消费或 root 生命周期失效发生在删除前，走稳定普通错误；进入当前 entry verified delete 后，零次成功 remove 的异常归 retained，一次以上归 partial，`removedEntries` 为 1..10,000。成功删除根项才是 `deleted`，所以 partial 不会多计根。任一 retained/partial 或普通 mismatch 都使 batch 剩余 entries 失效；调用方不得自动重试、建立伪 Undo 或把 incomplete 当成功。未来 provider 必须先触发相关 root dirty/rescan，再抛稳定 incomplete 错误；多选整体预览、provider token binding 与停止未执行项是激活阶段必须同步完成的窄补丁，不能用上游普通循环掩盖跨项 partial。

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
