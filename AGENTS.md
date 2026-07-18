# Plain

Plain 是一个基于 Tauri 2 的轻量代码编辑器。它通过可裁剪的 Code OSS/Monaco Workbench service packages 保留编辑体验，把原生能力迁移到 Rust，并明确移除 AI、账号、同步、通用扩展宿主和语言集成环境。

## 当前阶段

这是一个长周期迁移。开始工作前必须先阅读：

1. `progress.md`：当前唯一在制工作项和下一步。
2. `features.json`：功能状态与验收条件。
3. `docs/architecture.md`：边界、模块和数据流。
4. 对应的 `docs/decisions/` ADR。

不得凭对话记忆推断进度；仓库文件和 Git 历史才是事实来源。

## 快速开始

Tauri 骨架完成后统一使用以下入口：

```bash
pnpm install
pnpm check
pnpm tauri dev
```

Rust 单独校验：

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

骨架完成前，以 `progress.md` 中列出的命令为准。

## 目标架构地图

以下目录从 `F010` 起逐步创建；当前真实工作树仍以旧 Code OSS 的 `src/`、`extensions/`、`build/` 和 `test/` 为主。不要把尚未创建的目标路径当成已存在实现。

- `app/`：Plain 的 TypeScript WebView 入口、Workbench 组合、视图贡献和 Tauri bridge。
- `@codingame/monaco-vscode-*`：按需安装的 Workbench/Monaco service packages；禁止整包导入所有功能。
- `src-tauri/src/`：Tauri 应用和所有受信任原生服务。
- `src-tauri/src/{workspace,search,terminal,git,debug,theme}`：按能力划分的 Rust 域。
- `app/platform/tauri`：TypeScript 到 Tauri command/event 的窄适配层。
- `resources/`：经许可证审计的内置主题、TextMate grammar、图标和应用资源。
- `tests/`：Rust 合同测试、浏览器 IPC mock E2E 和真实 Tauri 验收。
- `docs/`：架构、范围、测试与 ADR 的系统记录。
- 迁移期间的 `src/vs/`、`extensions/` 等旧 Code OSS 树只作为行为/资产/测试参考，最终必须退役。

详细说明见 `docs/architecture.md`。

## 不可破坏的产品边界

1. 不得加入 AI、聊天、Agent、MCP、补全模型或模型 SDK。
2. 不得加入登录、注册、云账号、设置同步、遥测或云工作区。
3. 不得恢复通用 VS Code 扩展宿主、Marketplace 执行能力或任意扩展代码执行。
4. 主题包只允许声明式读取 `themes`、`iconThemes`、`productIconThemes` 及其静态资源；绝不执行 `main`、`browser`、`activationEvents` 或脚本。
5. 不内置 LSP、语言服务器、编译器、构建系统、测试运行器或语言运行环境。内置 TextMate grammar 只负责静态语法着色。
6. 调试是通用 DAP 客户端；适配器由用户显式配置或连接，不自动下载安装。
7. Git 增强是独立实现的本地功能，不复制 GitLens Plus/Pro、品牌、账号、云或 AI 功能。

## 原生服务规则

- 文件、搜索、PTY、Git、DAP、主题解包和持久化必须由 Rust 实现；前端不得直接取得宽泛 shell/fs 权限。
- 所有工作区路径先 canonicalize，再验证仍位于允许根目录；符号链接、归档解包和重命名同样适用。
- 启动子进程必须使用参数数组，禁止拼接 shell 字符串。Git 写操作以系统 Git CLI 为权威。
- 未信任 workspace 不得启动 Git、PTY 或 DAP 子进程；Git 后台读取还必须禁用 hooks、fsmonitor、external diff/textconv、credential prompt 等外部执行入口。
- PTY、搜索、文件监听和 DAP 使用有界事件流，必须处理取消、退出、背压和窗口销毁。
- DAP 是 `Content-Length` framing 的独立协议，不得按 JSON-RPC 处理。
- Tauri capability 采用最小权限；新增权限必须同时添加威胁说明和测试。
- 禁止依赖或导入 `monaco-vscode-api` 的 AI、Chat、Auth、Sync、Gallery、Remote、Task、Testing 或 Notebook service packages。
- `@codingame/monaco-vscode-api` 会传递依赖 extensions service；只允许把它当作惰性的静态 contribution registry，不得由 `app/` 直接导入该 service override，也不得创建 local、worker、WASM、remote 或 sidecar Extension Host。
- 禁止 `vscode/localExtensionHost`、`extensionHost.worker`、`ExtensionHostKind`、`setLocalExtensionHost` 和 `enableWorkerExtensionHost: true` 等宿主入口或配置。

## 工作方式

- WIP 上限始终为 1：完成并验证一个垂直切片后再开始下一个；工作项切换间允许短暂为 0。
- 每个工作项先更新 `features.json`/`progress.md`，再实现、校验、清理临时文件并提交。
- 每个工作项自动创建 Git 提交，提交信息使用 `type(scope): description`。
- 任务复杂、耗时较长，或同一问题被再次反馈时，必须亲自检查代码并运行真实验收，不能只采信执行者自述。
- 删除旧 Code OSS 文件属于本迁移的明确范围，但只能按 ADR 中的退役门执行；删除范围外的人工数据或生产配置必须先征得确认。
- 临时文件放在仓库内并使用 `tmp-`/`temp-` 前缀；提交前全部清理。不得提交截图、构建产物、临时克隆、日志或本机配置。
- 所有面向用户的回复使用中文。

## 校验顺序

1. 格式和静态类型。
2. 架构/边界检查。
3. Rust 与前端单元测试。
4. 相关集成测试。
5. 涉及 UI 或原生行为时，执行 `docs/testing.md` 中对应的浏览器或真实 Tauri 场景。

编译或类型检查失败时，不得继续运行后续测试并宣称完成。

## 文档索引

- 产品范围：`docs/product-scope.md`
- 总体架构：`docs/architecture.md`
- 实施计划：`docs/implementation-plan.md`
- 测试策略：`docs/testing.md`
- GitHub 调研：`docs/research/2026-07-18-github-solutions.md`
- 架构决策：`docs/decisions/`
- 当前进度：`progress.md`
- 机器可读功能清单：`features.json`
