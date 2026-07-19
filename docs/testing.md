# Plain 测试与验收策略

状态：初始合同
更新时间：2026-07-19

## 目标

测试同时回答三个问题：

1. 新 Tauri/Rust 服务是否正确、安全、可取消。
2. 裁剪后是否仍保留用户要求的 Code OSS 编辑行为。
3. 浏览器 mock 环境通过的场景是否在真实系统 WebView、PTY、Git 和 DAP 上成立。

## 分层

### Rust 单元/合同测试

必须覆盖：

- path canonicalization、symlink escape、workspace scope。
- VSIX zip-slip、zip bomb 上限、JSONC/include cycle、资源越界。
- `rg --json`、Git porcelain v2/NUL、diff/log/blame parser。
- Git workspace trust gate 和 hardened background mode；恶意 helper/hook fixture 不得产生 marker。
- PTY session 生命周期、resize/kill/exit 和事件序号。
- DAP header/body fragmentation、多个 frame、错误长度、timeout/cancel。
- settings schema、版本迁移和错误 DTO 稳定性。
- workspace watcher 必须覆盖 inactive prepare/atomic activate、root epoch 撤销、window 隔离、capacity-one queue storm、queue full/error/root rename/resume 的 rescan、sticky generation/exact ack、scan/close 竞态与 path/error 不出 native 状态机。

### TypeScript 单元测试

- Tauri bridge 请求/错误映射。
- provider bootstrap 必须证明能力 DTO 在注册前恰好读取一次、窗口生命周期不可升级；五项全真与任一 false 分别产生唯一 writable/readonly capability 集合，畸形或读取失败不能回退为可写。
- 编辑器模型和脏状态/恢复状态机。
- 搜索结果批次、取消、替换 plan。
- theme color/token/icon 映射。
- Git/DAP view model 在乱序或缺失事件下的行为。
- 固定 FileService patch 对 Plain copy/move/clone 的 provider-lookup 前拒绝、native-only 合法路径和零副作用失败矩阵；非 Plain 控制组必须保持 upstream 行为。
- Plain create/createFolder 必须各只调用一次私有 native create seam，并由同一次 IPC 返回严格 `WorkspaceEntryStat` 创建回执；不得 create 前 target `stat/exists`、create 后第二次 `workspace_stat/resolve`、非空 create、overwrite、递归 mkdirp、公共 `writeFile/mkdir` 或通用 fallback。测试必须区分已认证 syscall 前错误的零事件与畸形回执/未知响应的一次冻结 root `UPDATED`，两者都不得发成功事件。copy/rename/move/delete provider adapters 必须覆盖严格 options、唯一 bridge 路由、成功事件闭集，以及 partial/unknown 只 rescan、不发成功事件。
- confirmed-delete 测试必须覆盖一次 prepare/confirm/begin、调用级 token+entry+URI/options 绑定、逐项 commit、无授权/replay/错项拒绝，以及禁止 Trash、Bulk Undo、成功前 soft-revert 和 retained/partial 后继续执行。
- watcher bridge/manager 必须拒绝额外字段、Proxy/accessor、重复 root、零 generation、workspace/root 混淆与畸形 wake；单 listener、单 timer、单 in-flight sync 在即时 wake、丢 wake、listener 释放、窗口销毁和 exact ack 后都必须有确定状态。

### 架构与供应链检查

- `app/` import、`package.json` 和 lockfile 只能出现 ADR 允许的 Workbench service packages；`monaco-vscode-api` 对 extensions service 的精确传递依赖只作静态 registry 使用。
- 拒绝 AI、Chat、MCP、Authentication、Sync、Gallery、Remote、Task、Testing、Notebook，以及 local/worker/WASM/remote Extension Host 入口或启用配置。
- 检查最终 bundle 不含 Electron、Node PTY、模型 SDK、账号/同步字符串和通用扩展执行 worker。
- 检查 Tauri CSP/capabilities 没有 `csp: null`、`$HOME/**`、宽泛 shell/fs scope。
- 记录依赖许可证、bundle size 和第三方 notices 差异。
- pnpm patch 以精确 SHA-256、文件/hunk 形状和 lock graph 锁定；mutation tests 必须证明删除或后移任一 Plain copy/move/clone guard、恢复 overwrite/mkdirp/generic fallback 都会失败。
- provider 激活 Harness 必须从“全局禁止写”原子演进为闭集：最终只允许 `FileReadWrite | FileFolderCopy` 或 `FileReadWrite | Readonly`，且只有前置 capability DTO、create、copy/move、confirmed delete 和 versioned write 的全部 guard 同时存在时才接受前者。

### 浏览器 E2E

浏览器模式用 deterministic mock IPC 驱动 Workbench，验证 UI 和数据状态，不伪装原生能力：

- 打开 fixture、文件树 CRUD、标签/预览/拆分、编辑保存和冲突提示。
- 文件树 CRUD 必须分别在 all-true 能力下真实调用 mock native，在任一 false 时保持整 provider 只读且 native mutation 调用数为零；create 缺失父目录、move partial 和 delete retained/partial 必须显示失败且不产生成功事件。
- Quick Open、全文搜索、替换、取消。
- 颜色/文件图标主题导入和切换。
- 终端/Git/DAP 使用录制事件测试 UI 状态机。
- 未信任 workspace 的终端、Git、DAP 操作保持禁用并显示准确风险说明。
- 无 AI、账号、同步、通用扩展入口。
- 外部目录变化必须通过 mock native watcher 触发精确 root `UPDATED` 和 Explorer deep refresh；同一场景还要丢弃 wake，证明定时 sync 最终收敛，且不得伪造 root `DELETED`。

### 真实 Tauri E2E

统一使用 `pnpm tauri:dev:e2e` 启动验收窗口。该命令通过 Tauri 官方 `--config` flavor 合并 `src-tauri/tauri.e2e.conf.json`，只把完整主窗口替换为 `incognito: true` 版本；WKWebView 因而使用进程级非持久 data store，不读取或污染用户的生产 Workbench 布局、Local Storage、IndexedDB、cookie 与 cache。生产 `pnpm tauri:dev` 必须继续使用持久 data store；Harness 同时锁定启动命令、overlay 闭集及两份窗口配置除 `incognito` 外完全一致。

使用电脑控制操作实际应用，至少覆盖：

1. 系统目录选择器打开 fixture。
2. 新建文件、编辑、保存、关闭重开和热退出恢复。
3. 外部修改后冲突处理。
4. 全文搜索与批量替换。
5. 导入本地测试 VSIX，验证 workbench 与 token/icon 变化。
6. PTY 中执行交互命令、resize、拆分和退出。
7. Git 修改、stage、commit、blame、file history、compare、branch、stash、worktree。
8. mock DAP adapter 的断点、step、variables、evaluate、stop；再连接一个本机真实 adapter。
9. 界面不存在 AI、登录、同步和非主题扩展入口。

macOS 上不能把普通浏览器结果当成 WKWebView/Tauri 结果；两层必须分别记录。

## 预期统一命令

Tauri 骨架完成后，根脚本应提供：

```bash
pnpm format:check
pnpm typecheck
pnpm lint
pnpm test
pnpm test:e2e:browser
pnpm rust:fmt
pnpm rust:clippy
pnpm rust:test
pnpm check
```

`pnpm check` 顺序执行静态检查、单元和架构边界；真实 Tauri E2E 单独运行，避免在无桌面 CI 中伪通过。

## Fixture

- `workspace-basic`：多种文本、图片、Markdown、二进制和深层目录。
- `workspace-large`：可重复生成的大文件/大目录，不提交生成结果。
- `git-history`：固定作者、分支、merge、rename、stash/worktree 场景。
- `git-untrusted`：恶意 fsmonitor、hook、external diff/textconv、filter、credential helper 和 sshCommand，使用 marker 文件证明未被执行。
- `theme-valid`：JSONC/include/token/icon/font。
- `theme-malicious`：zip-slip、symlink、SVG script、超大资源。
- `dap-mock`：可编排的标准 adapter，覆盖 fragmented frame 和错误响应。

## 完成证据

每个 `features.json` 条目必须记录：

- 自动测试命令和结果。
- 若涉及 UI/原生能力，浏览器或电脑控制场景名称。
- 已知平台缺口。
- 对应提交可由 Git 历史查询；不在文件中写自引用 commit hash。

## 基线迁移

当前 Code OSS smoke/integration 中优先保留并重写为合同的场景：

- workbench 数据防丢、启动/重开、多根目录和 preferences。
- search 主链。
- terminal input/tabs/split/profile/persistence/shell integration。

新增完整 Git、主题导入、文件树和 DAP E2E。AI、Agent、Extension Host、Notebook、Remote 和账号套件随功能退役。
