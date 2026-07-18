# Plain 产品范围

状态：已批准的初始范围
更新时间：2026-07-18

## 产品定义

Plain 是一个无 AI、无账号、无同步、无通用扩展生态的轻量代码编辑器。体验目标接近“未安装语言/工具扩展的 VS Code”，但保留用户明确要求的编辑、文件、搜索、终端、Git 增强和通用调试能力。

“基于 Tauri/Rust 重写”的含义是：应用生命周期、窗口、IPC、文件、搜索、PTY、Git、DAP、主题包和持久化等原生/受信任能力全部迁到 Rust；WebView UI 通过按需组合的 `@codingame/monaco-vscode-api` service packages 使用 Code OSS Workbench 与 Monaco。Tauri 官方本身就是 Rust 后端加系统 WebView，而不是纯 Rust 绘制框架。当前仓库的整套 `src/vs` 不作为长期产品分叉保留，只在迁移期间充当行为、资产和测试基线。

## 必须交付

### 编辑与文件

- 打开文件、文件夹和最近项目。
- 文件树：展开、折叠、新建、重命名、删除、复制、移动、刷新和外部变更同步。
- Monaco 编辑：多光标、选择、查找替换、撤销重做、折叠、括号、缩进、自动保存、脏文件恢复和编码基础能力。
- 编辑器标签、预览标签、固定、拆分、关闭保护和最近打开。
- 文本、图片和 Markdown 的基础预览；未知二进制文件安全降级。
- 本地设置、快捷键、布局和会话恢复。

### 搜索

- Quick Open 文件搜索。
- 工作区全文搜索，支持正则、大小写、全词、include/exclude 与 `.gitignore`。
- 流式结果、取消、结果预览、单项替换和批量替换。
- 大仓库不会阻塞 UI，结果数量和单文件大小有上限。

### 主题

- 内置经审计的默认主题和静态 TextMate grammar。
- 从本地 `.vsix`、解包目录和已安装 VS Code 扩展目录导入主题。
- 支持 `contributes.themes`，包括 JSONC、`include`、`colors`、`tokenColors`/`.tmTheme`、`semanticTokenColors` 的解析和保存。
- 支持 `iconThemes` 与 `productIconThemes` 的静态资源；未知图标 ID 安全回退。
- 主题包永不执行代码；无静态主题贡献的扩展不安装。
- 语义着色只有在存在语义 token provider 时生效；本产品不为此内置 LSP。

### 终端

- 基于 Rust PTY 的交互终端，前端使用 xterm.js。
- 多标签、拆分、resize、搜索、复制粘贴、shell/cwd/profile 选择、退出状态和清理。
- macOS/Linux PTY 与 Windows ConPTY 行为；终端链接和 OSC 指令受安全策略约束。

### Git 与本地 Git 增强

- 仓库发现、状态、diff、stage/unstage（文件和 hunk）、discard、commit/amend、fetch/pull/push。
- branches、tags、remotes、stashes、worktrees、reflog、contributors。
- commit log/graph、提交详情、文件历史、行历史、revision 导航、搜索与 compare。
- 编辑器 gutter 变化、当前行 blame、blame hover、文件 blame/age heatmap。
- cherry-pick、revert、merge、rebase、reset 等危险动作必须显示影响并二次确认。
- 凭据、签名、hooks、LFS、filters 和 SSH 行为交给用户现有的系统 Git。
- 打开未信任目录时只用文件系统识别 `.git`，不启动 Git/terminal/DAP；信任提示必须说明仓库配置可能触发 hooks、filters、fsmonitor、credential helper 或 SSH 命令。
- 信任后，后台状态/历史读取仍采用禁外部程序的 hardened mode；只有用户明确发起的 commit、fetch/pull/push 等动作才允许系统 Git 使用相应 hook/filter/credential/SSH 行为，网络和破坏性动作按影响再次确认。

### 调试

- 通用 Debug Adapter Protocol 客户端，兼容 stdio 与 TCP adapter。
- 读取 `.vscode/launch.json` 的通用字段，并透传 adapter-specific 配置。
- 断点、条件断点、continue/pause/step、threads、stack、scopes、variables、watch、evaluate、debug console。
- 支持 DAP `runInTerminal`，复用集成终端。
- adapter 必须由用户显式配置或确认；可发现系统已有工具，但不自动下载安装。

## 明确不做

- AI 聊天、Agent、Copilot、MCP、模型补全、AI commit message 或任何模型 SDK。
- 登录、注册、账号权益、云同步、云工作区、遥测和个性化服务。
- 通用 VS Code 扩展运行时、Extension Host、Marketplace 代码执行。
- 语言服务器、LSP、IntelliSense 项目语义、重构、格式化器、编译器、SDK、包管理器、任务和测试运行器。
- Notebook、远程开发、Tunnel、容器/SSH 工作区、Live Share、Settings Sync。
- GitKraken/GitLens 账号、品牌、Plus/Pro/Cloud/Launchpad/PR provider/AI 功能。

## 兼容声明

- 编辑行为以当前仓库的 Code OSS/Monaco 为基线，优先保持键盘操作、模型和数据防丢行为。
- 主题兼容是静态声明兼容，不等同于执行整个主题扩展；动态 JS 主题功能不支持。
- DAP 兼容不等同于捆绑所有语言 debugger。适配器不存在时必须给出可操作错误。
- “GitLens 类功能”表示独立实现同类本地 Git 工作流，不表示打包、授权或完整复刻 GitLens。

## 非功能目标

- 启动和空闲内存显著低于当前 Electron 版本；具体门槛在可测基线形成后固化。
- 所有工作区写操作可追踪、可取消，危险 Git/文件动作有确认。
- 单个损坏主题、终端或 adapter 不得拖垮主窗口。
- macOS、Windows、Linux 使用同一 IPC 合同；当前开发机先完成 macOS 实测，再由 CI 覆盖跨平台构建。
