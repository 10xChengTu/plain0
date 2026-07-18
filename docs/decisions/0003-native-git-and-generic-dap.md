# ADR 0003：系统 Git 原生增强 + 通用 DAP 客户端

- 状态：接受
- 日期：2026-07-18

## 背景

当前 Code OSS 的 Git 和 debugger 多依赖扩展宿主。目标又明确不支持非主题扩展，因此这两项必须成为应用核心能力。GitLens 仓库混合 MIT 与 `LICENSE.plus`，产品也不能引入其账号、Pro、Cloud 和 AI 体系。

## Git 决策

- Rust service 使用系统 Git CLI 作为唯一写操作权威。
- 使用 porcelain v2、NUL 分隔和稳定 format string，把输出转换成自有 DTO。
- 独立实现 status/diff/stage/commit/refs/stash/worktree 以及 blame/history/compare/graph 等本地增强。
- 不复制 GitLens Plus/Pro、品牌、UI 素材或云能力；功能名称采用通用 Git 术语。
- 只有基准证明 CLI 读取成为瓶颈后，才允许 `gix` 只读缓存，并用差分测试保证结果一致。

原因：系统 Git 最能兼容现有 credentials、SSH/GPG、hooks、LFS、filters、attributes、submodule 和 worktree。全押 libgit2 会产生行为差异。

### Workspace trust 与外部执行

- 未信任 workspace 不启动 Git 子进程，只通过文件系统识别仓库标记。
- 首次信任明确告知：仓库或用户 Git 配置可能触发 hooks、fsmonitor、filters/textconv、credential helper、SSH/GPG 等外部程序；授权按 workspace 保存并可撤销。
- 自动后台读取使用 hardened mode，固定子命令并禁用 hooks、fsmonitor、external diff/textconv 和 credential prompt；设置超时、输出上限和取消。
- 用户发起的 commit 等本地写操作可使用相应 hooks/filters；fetch/pull/push 和所有破坏性动作在显示目标/影响后确认。不得提供通用命令或 fail-open 回退。
- fixture 必须用恶意 `core.fsmonitor`、`diff.external`、textconv/filter、hooks、credential helper 和 `core.sshCommand` 证明未信任与后台读取不会执行它们。

## DAP 决策

- Rust 实现编辑器侧 DAP client，而不是运行 VS Code debugger extension。
- 支持 stdio/TCP、`Content-Length` framing、标准 request/response/event、capabilities 和 `runInTerminal`。
- 用户在 `.vscode/launch.json` 或本地设置中显式指定 adapter；应用可发现但不会自动安装工具。
- adapter-specific 配置透明透传，核心 UI 只依赖标准 DAP。
- workspace 未信任或首次执行 adapter 时要求确认。

## 结果

Git 与调试不再依赖通用扩展宿主，同时保留跨语言的协议能力。代价是需要自建可靠 parser/transport、完整 fixture 和更明确的“适配器由用户提供”错误体验。
