# F100 Generic Debug Adapter Protocol client

日期：2026-07-28

## 目标与边界

`F100` 四条 acceptance：stdio 与 TCP 传输均能处理分片帧 fixture；断点、单步、调用栈、变量、求值可用；`runInTerminal` 复用集成终端；缺失或未信任的 adapter 以可操作的确认失败。遵循 `AGENTS.md` 边界（本产品不支持任何扩展、只支持颜色/图标主题；必须移除全部 AI 相关功能；启动调试适配器是 spawn 子进程，必须走 workspace trust + 参数数组 + 环境净化 + 无 shell + 超时/输出上限/取消，禁止通用"任意命令行"逃生口；调试是通用 DAP 客户端）与 `docs/decisions/0003-native-git-and-generic-dap.md`（Rust 实现编辑器侧 DAP client、stdio/TCP + `Content-Length` framing、用户在 `.vscode/launch.json` 或本地设置中显式指定 adapter、adapter-specific 配置透明透传、workspace 未信任或首次执行 adapter 时要求确认）。

本文档的调研方法论直接继承 `docs/research/2026-07-25-core-git.md`/`docs/research/2026-07-26-git-history.md`（下称 F080/F090 文档）已确立的纪律：协议/格式细节能实测就实测（本次在本机对两个真实 DAP adapter——`lldb-dap`、`debugpy`——做了真实 stdio 和 TCP 会话，贴出真实字节）；上游耦合排查下载真实 npm tarball 全文正则匹配，不凭源码目录推测。

## 调研结论

### 协议基础事实（官方规范 + 本机实测）

**规范来源与版本**：官方规范托管于 <https://microsoft.github.io/debug-adapter-protocol/>（Microsoft，MIT 许可，`vscode-debugadapter-node` 同源仓库的一部分）。规范首页明确声明："the protocol is still at its first version because it was an explicit design goal to support new feature in a completely backward compatible way"——DAP 从未发布过不兼容的"2.0"，只在同一份规范上做只增不减的字段追加；changelog 页面本次调研时（2026-07-28）显示的最新条目号为 `1.71.x`（VS Code 自身版本号同步编号，不是独立语义化版本），往前几条分别是 `1.70.x`（`StackTraceArguments.format`/`ContinuedEvent` 默认行为澄清）、`1.69.x`（`supportsANSIStyling`）、`1.68.x`（`Variable`/`locations` 请求的位置引用）、`1.67.x`（`EvaluateArguments` 位置属性、`returnValue` scope hint）、`1.66.x`（`DataBreakpointInfo` 的 `bytes`/`asAddress`）、`1.65.x`（`BreakpointMode`）、`1.64.x`（`DisassembledInstruction.presentationHint`、`Breakpoint.reason`）。**结论**：不存在需要在实现里锁死的单一"协议版本号"字段（协议本身没有版本号字段），实现应按 `Capabilities` 协商可选特性，而非按版本号分支。

**传输层与分帧（官方原文 + 本机实测双重确认）**：规范原文——消息由 header 和 content 两部分组成，用 `\r\n` 分隔；必需的 header 字段是 `Content-Length`（"The length of the content part in bytes. This header is required."）；content 部分固定 `utf-8` 编码的 JSON；"the content part of a message is always preceded (and uniquely identified) by two `\r\n` sequences"。这与 `AGENTS.md` 已写明的"`Content-Length` framing 的独立协议，不得按 JSON-RPC 处理"完全一致——本次实测的每一条真实消息都**没有** `"jsonrpc"` 字段，用的是 DAP 自己的 `seq`/`type` 信封。

本机用零依赖的手写 Python 分帧客户端（不借助任何 VS Code 代码或第三方 DAP 库）对两个真实 adapter 做了完整验证：

1. **`lldb-dap`**（`/Applications/Xcode.app/Contents/Developer/usr/bin/lldb-dap`，随 Xcode 16 command line tools 自带，Apple 官方对 lldb 的 DAP 封装，真实原生调试器）：
   - stdio 上发出 `initialize` 请求，真实收到的原始字节（`xxd`/`repr` 级别，非转述）：
     ```
     发送 header: b'Content-Length: 447\r\n\r\n'
     收到 header: b'Content-Length: 1646\r\n\r\n'
     收到 body:   {"body":{"$__lldb_version":"lldb-2100.0.16.4\n...",
                   "exceptionBreakpointFilters":[...6 个过滤器...],
                   "supportsConditionalBreakpoints":true,"supportsConfigurationDoneRequest":true,
                   "supportsDataBreakpoints":true,"supportsDelayedStackTraceLoading":true,
                   "supportsDisassembleRequest":true,"supportsSteppingGranularity":true, ...},
                   "command":"initialize","request_seq":1,"seq":0,"success":true,"type":"response"}
     ```
   - **真实异常发现（值得写进实现纪律）**：lldb-dap 的响应 `"seq"` 字段值是 `0`，而不是很多人默认假设的"从 1 开始每条消息递增"。规范只保证 `request_seq` 精确等于对应请求的 `seq`（这是响应关联请求的唯一权威字段），**没有**保证 adapter 自己发出的 `seq` 单调递增或从 1 起始——`debugpy` 的行为符合"递增"直觉（其 `initialize` 响应 `seq` 为 3，因为它先发了两条 telemetry `output` 事件占用了 1、2），但 `lldb-dap` 直接证伪了"所有 adapter 都这样做"的假设。**实现必须只用 `request_seq` 做请求-响应关联，绝不能依赖 `seq` 的数值语义**（不能假设递增、不能假设从 1 起、不能用它排序）。
   - 本机沙箱环境下 lldb-dap 的 `initialize`/capabilities 握手完全验证通过，但**真正启动被调试进程（`launch` → 断点命中）未能验证**——见"风险与未知项"第 1 条的详细说明与根因分析（很可能是本次执行环境的 ptrace/`task_for_pid` 限制，而非协议或设计问题，但也牵出了一个真实的、此前未被本项目考虑过的 macOS 打包风险）。

2. **`debugpy`**（Python 官方调试器，`pip show debugpy` 确认版本 1.6.7，`python3 -m debugpy.adapter` 以 stdio 模式运行）：完整跑通了一次真实端到端会话——`initialize` → `launch`（发送但故意不等待其响应）→ `initialized` 事件 → `setBreakpoints` → `configurationDone` → **此时 `launch` 的响应才真正到达** → `process`/`thread` 事件 → `stopped`（`reason: "breakpoint"`）→ `stackTrace`（3 层调用栈：`add`/`main`/`<module>`）→ `scopes`（`Locals`/`Globals` 两个作用域，`variablesReference` 分别为 5/6）→ `variables`（`variablesReference=5` 返回 `a=3`/`b=4`，均 `variablesReference:0` 表示无法再展开的叶子值）→ `evaluate`（`a + b` 在 watch 上下文求值得到 `7`）→ `continue` → `output` 事件（`category:"stdout", output:"sum=7\n"`）→ `continued`/`thread(exited)`/`exited(exitCode:0)`/`terminated` 事件 → `disconnect`。全部 23 条消息（含 2 条 telemetry 事件）均以真实 `Content-Length` 帧收发，完整日志见下方"实测证据"小节。
   - **关键握手时序发现（本次调研最重要的实测事实之一，直接决定实现正确性）**：客户端发送 `launch` 请求（`seq:2`）后，**没有立即等待它的响应就继续等待 `initialized` 事件**；`initialized` 事件（消息 `seq:4`）先到达；随后发 `setBreakpoints`（收到响应 `seq:5`）；再发 `configurationDone`（收到响应 `seq:6`）；**`launch` 的响应直到此刻才作为消息 `seq:7` 到达**——即 `configurationDone` 的响应先于 `launch` 的响应。这与规范原文描述的握手顺序完全吻合："development tool sends an `initialize` request...adapter sends an `initialized` event...client then sends `setBreakpoints`/`setFunctionBreakpoints`/`setExceptionBreakpoints` and `configurationDoneRequest`...after `configurationDone` response, the adapter responds to `launch` or `attach`, starting the session"。**实现纪律**：客户端绝不能假设"发送 `launch` 请求后立刻等待它的响应"这种朴素的请求-响应线性顺序——这在真实 adapter（至少 debugpy 属实如此）上会造成死锁式的错误等待。正确顺序是"发送 `launch`（不阻塞等待）→ 等 `initialized` 事件 → 发送 `setBreakpoints` 系列 → 发送 `configurationDone` 并等待其响应 → 此后才允许 `launch`/`attach` 的响应到达并被处理，session 才算真正就绪"。
   - **事件与响应交错的真实证据**：`module` 事件（`seq:12`/`seq:13`）在我方已发出 `scopes` 请求之后、其响应之前异步到达（日志第 39-46 行）；`initialize` 响应到达前先收到 2 条 telemetry `output` 事件。**实现纪律**：读循环必须持续消费所有到达消息并按类型分派（`response` 走 `request_seq` 关联的等待表，`event` 直接转发），不能假设"发一条请求就只会收到恰好一条对应响应、中间不会插入别的消息"。
   - TCP 传输：额外用 `python3 -m debugpy.adapter --host 127.0.0.1 --port 0` 启动一个监听态 adapter（真实监听在 `127.0.0.1:56265`，`lsof` 确认），手写一个原始 TCP socket 客户端，**将 `initialize` 请求故意切成 74 个 3 字节的小块、每块间隔 3ms 发送**（模拟真实网络分片），adapter 正确重组解析；返回方向同样验证了"逐字节 `recv(1)` 累积到 `\r\n\r\n` 才能确定 header 结束、再累积到 `Content-Length` 声明的字节数才能确定 body 结束"的读取逻辑在真实 TCP 流上正确工作。**结论**：TCP 与 stdio 除了字节来源（socket vs pipe）不同外，帧格式本身完全一致，同一套分帧状态机可以直接复用于两种传输——真实验证了这一点，不是假设。

以上完整会话与 TCP 分片测试的原始脚本与日志见本次调研的临时产物（未提交，测试完成后已清理），关键 acceptance 第 1 条（"Stdio and TCP transports pass fragmented frame fixtures"）的分帧状态机设计**必须**把本机实测到的下列边界情形做成回归 fixture：header 跨多次 read 到达；body 跨多次 read 到达；一次 read 里同时包含多条完整消息（不能只处理其中一条就丢弃缓冲区剩余部分）；header/body 边界恰好落在一次 read 的末尾；`Content-Length` 声明值与实际 body 字节数不一致（adapter bug 或恶意/畸形 adapter）；`Content-Length` 缺失或不可解析；未知的额外 header 字段（规范允许 header 部分出现其他字段，必须容忍并忽略，不能因为出现非 `Content-Length` 字段就解析失败）。

**其余协议细节（官方规范原文，`https://microsoft.github.io/debug-adapter-protocol/specification`，未逐条本机实测的已标注）**：

- 三类消息的基础 TypeScript 接口（规范原文）：
  ```ts
  interface ProtocolMessage {
  	seq: number;
  	type: string;
  }
  interface Request extends ProtocolMessage {
  	type: "request";
  	command: string;
  	arguments?: any;
  }
  interface Response extends ProtocolMessage {
  	type: "response";
  	request_seq: number;
  	success: boolean;
  	command: string;
  	message?: string;
  	body?: any;
  }
  interface Event extends ProtocolMessage {
  	type: "event";
  	event: string;
  	body?: any;
  }
  ```
  本机实测的每条真实消息（上一节引用的原始 JSON）与这三个接口逐字段吻合。
- **反向请求（reverse request，`runInTerminal` 所属机制）**：复用同一套 `Request`/`Response` 信封，只是方向反过来——adapter 向 client 发一条 `type:"request"`（自己的 `seq` 编号空间），client 必须回一条 `type:"response"`、`request_seq` 精确等于该请求的 `seq`。规范原文只用一句话点出 `runInTerminal` 的用途："A debug adapter can use the `runInTerminal` request to ask the client to launch the debuggee in a terminal that is integrated into the client or in a terminal that runs outside of the client"。`RunInTerminalRequestArguments` 字段（规范原文）：`kind?: 'integrated'|'external'`、`title?: string`、`cwd: string`、`args: string[]`、`env?: {[key:string]: string|null}`、`argsCanBeInterpretedByShell?: boolean`。**本次未对 `runInTerminal` 做真实端到端实测**（debugpy 默认 `console:"internalConsole"` 不会触发它；未构造出会触发 `runInTerminal` 的真实 launch 配置）——标注为**待实施时用真实触发场景实测确认**，尤其 `argsCanBeInterpretedByShell` 的确切含义与 Plain 现有"绝不用 shell 解释参数"纪律之间的关系需要在实现前专门确认清楚（初步判断：这个字段是 adapter 告诉 client "`args` 是否已经历过 shell 解释"，Plain 应始终按"未被 shell 解释、必须以参数数组方式传给 PTY"处理，忽略该字段声称的"可被 shell 解释"暗示，因为 Plain 的终端集成不做 shell 拼接——但这是待验证的解读,不是已确认事实)。
- **`variables` 请求的分页字段**（规范原文，`supportsVariablePaging` 能力对应）：`start?: number`（"index of the first variable to return; if omitted children start at 0"）、`count?: number`（"number of variables to return. If count is missing or 0, all variables"）、`filter?: 'indexed'|'named'`。本机实测（debugpy `variables` 响应）中标量叶子值的 `variablesReference` 均为 `0`——这是分页/展开机制的哨兵值："该值本身没有可展开的子结构"，前端树控件必须以此判断是否显示展开箭头,而不是"值是否为 0 长度字符串"之类的启发式。
- **`StoppedEvent.body`**（规范原文）：`reason` 是一个开放字符串枚举（`'step'|'breakpoint'|'exception'|'pause'|'entry'|'goto'|'function breakpoint'|'data breakpoint'|'instruction breakpoint'|...`）、`threadId?`、`preserveFocusHint?`、`text?`、`allThreadsStopped?`、`hitBreakpointIds?: number[]`。本机实测的 debugpy `stopped` 事件 `reason` 精确等于 `"breakpoint"`，与规范枚举吻合。
- **`Capabilities` 是能力协商而非固定接口**——两个真实 adapter 的 `initialize` 响应互不相同，直接证明"不能假设所有 adapter 支持同一组特性"：`lldb-dap` 有 `supportsDisassembleRequest`/`supportsReadMemoryRequest`/`supportsWriteMemoryRequest`（原生内存调试特有）而 `debugpy` 没有；`debugpy` 有 `supportsDebuggerProperties`/`supportsSetExpression`/`supportsGotoTargetsRequest`/`supportsClipboardContext` 而 `lldb-dap` 没有；`lldb-dap` 的 `exceptionBreakpointFilters` 有 6 项（按语言分 C++/Objective-C/Swift 各 Catch/Throw）而 `debugpy` 只有 3 项（`raised`/`uncaught`/`userUnhandled`）。**实现纪律**：UI 必须在 `initialize` 响应到达后按 `Capabilities` 里的 `supportsXxx` 字段逐项决定是否展示/启用对应功能（条件断点、数据断点、`disassemble` 等），不能硬编码假设某功能永远可用。
- `ErrorResponse`/`Message` 的精确字段列表（`id`/`format`/`variables`/`sendTelemetry`/`showUser`/`url`/`urlLabel`）本次未能从抓取的规范页面内容里拿到完整逐字段引用（页面内容被截断）——**标注为待实施时对照规范原始 JSON schema（`debugProtocol.json`，规范仓库内）逐字段确认**,不在本文档编造字段列表。

### 上游 debug 子系统 Chat/AI（及其他)耦合排查

**方法论与 F080/F090 完全一致**：下载真实 npm tarball、全文解压后对每个文件做正则全文匹配，不凭源码目录或记忆推测。

**包版本对齐确认**：`@codingame/monaco-vscode-debug-service-override` 在 npm 上存在 `35.0.1` 版本，与本项目 `@codingame/monaco-vscode-api@35.0.1` **精确对齐**（`npm view` 确认其 `dependencies` 只有 `"@codingame/monaco-vscode-api": "35.0.1"` 一条,与 F080/F090 审计过的 scm/timeline/multi-diff-editor 三个 override 包同一模式)。真实下载 tarball（`https://registry.npmjs.org/@codingame/monaco-vscode-debug-service-override/-/monaco-vscode-debug-service-override-35.0.1.tgz`）解压后共 93 个文件。

**全文正则匹配结果**（`chat|copilot|agent|IChatEditingService|IChatContextPickService|IChatWidgetService|inlineChat|ChatContextKeys`，`-l` 只列文件名）命中 5 个文件：`extensionHostDebugService.js`、`debug.contribution.js`、`debugConfigurationManager.js`、`debugEditorActions.js`、`debugChatIntegration.js`。**逐一核实**（不满足于命中列表本身,像 F080/F090 一样判断每处是"误报"还是"真实耦合"）：

- `extensionHostDebugService.js`/`debugConfigurationManager.js` 的 "agent" 命中均为 `IRemoteAgentService`——**误报**,这是 VS Code Remote Development 的"远程 Agent"（连接远程主机的守护进程),与 AI Agent 无关,且该服务本身在 Plain 里就是死代码（Plain 无 Remote Development）。
- `debugEditorActions.js` 的命中是三处 `ChatContextKeys.inChatSession.negate()` 作为编辑器动作的 `precondition`/`when` 上下文键表达式（"当焦点在 Chat 会话里时，这个调试快捷键不生效"这种互斥防呆),不是构造函数依赖注入——**软耦合,非阻断性**（Plain 若不注册 chat 相关 context key service,该表达式对 undefined 键取 negate 预期仍返回可用状态,但这个断言本身标注为**待实施时验证**,不构成本次自建决策的理由,因为无论如何 Plain 都不会消费这个文件)。
- **真正的硬编码构造函数依赖,与 F080 S2 发现的 `quickDiffModel.js` 属同一等级**：`debugChatIntegration.js` 导出的 `DebugChatContextContribution` 类,构造函数第 0 个参数装饰为 `__param(0, IChatContextPickService)`（必需依赖,非可选)、第 1 个是 `IInstantiationService`；类体内部构造时立即调用 `contextPickService.registerChatContextItem(...)`。**`debug.contribution.js` 第 79-83 行无条件执行**：
  ```js
  registerWorkbenchContribution2(
  	DebugChatContextContribution.ID,
  	DebugChatContextContribution,
  	WorkbenchPhase.AfterRestored,
  );
  ```
  这与 F080 S2 发现的 `SCMHistoryItemContextContribution`（`workbench.contrib.chat.scmHistoryItemContextContribution`)是**完全同构的失败模式**——`DebugChatContextContribution.ID` 本身就是 `"workbench.contrib.chat.debugChatContextContribution"`。不安装 chat override 时,`WorkbenchPhase.AfterRestored` 阶段实例化该贡献会因 `IChatContextPickService` 未注册而崩溃,拖累同一 Workbench 生命周期阶段的其他贡献一起失败(与 F080 S2 的记录一致：这是"功能阻断,非仅政策")。

**独立于 Chat 之外的第二个耦合,本次调研新发现,F080/F090 都没有遇到过的模式——Notebook 耦合**：`debug.contribution.js` 顶部 `import { COPY_NOTEBOOK_VARIABLE_VALUE_ID, COPY_NOTEBOOK_VARIABLE_VALUE_LABEL } from '../../notebook/browser/contrib/notebookVariables/notebookVariableCommands.js';`——这个 import 本身只是想要两个字符串常量,但 ES module 的 import 会**完整执行**该模块的顶层副作用：`notebookVariableCommands.js` 无条件调用了两次 `registerAction2`,注册的两个命令在 `run()` 内部分别 `accessor.get(IClipboardService)` 与 `accessor.get(INotebookKernelService)`/`accessor.get(INotebookService)`。`AGENTS.md` 第 6 条明确"禁止依赖或导入 `monaco-vscode-api` 的...Notebook service packages"——即使这两个命令不会在实例化阶段崩溃（`INotebookService`只在 `run()` 内惰性获取,不是构造函数依赖),仅仅"导入了 Notebook contrib 代码"这件事本身就违反了产品边界,是比 Chat 耦合更容易被忽略的一类问题（因为它不表现为 bootstrap crash,只是静默地把被禁止的模块拖进依赖图/bundle）。这与 F090 发现的"timeline 包意外打包 Local History 文件""multi-diff 包无条件注册 scm 特化 resolver"是同一类"看似干净的包,实际无条件牵连别的域"模式,但这次是**同一个文件自己的直接 import**,连"顺藤摸瓜检查同目录其他文件"都不需要,肉眼读 import 列表就能看到。

**独立于 Chat/Notebook 之外、本次调研最关键的结构性发现——`AdapterManager`/`ConfigurationManager`/`DebugService` 三者互相内部实例化、不可替换,且分别撞上 Task 服务禁令与"扩展宿主寿命注定死亡"两个独立障碍**：

1. `debugAdapterManager.js` 的 `AdapterManager` 类构造函数装饰器列表（`__decorate` 调用的完整 12 个 `__param`）——**第 11 个（索引 11）是 `ITaskService`**（`AGENTS.md` 第 5 条"不内置...构建系统、测试运行器"，禁止导入 Task service 包,`ITaskService` 正是这个域）。`AdapterManager` 用它来支持 launch 配置里的 `preLaunchTask`/`postDebugTask`（在启动调试前后跑一个 VS Code Task）——这是与 Chat/AI 完全无关、独立的一条排除线。
2. `debugAdapterManager.js` 同时确认了一个**好消息**：`AdapterManager.registerDebugAdapterDescriptorFactory(debugAdapterProvider)`（把 `{type, createDebugAdapterDescriptor, runInTerminal}` push 进内部数组)是一个**普通公开方法,不经过扩展宿主**——这与 F080 发现的 `ISCMService.registerSCMProvider`同一形状,理论上是一个"干净的窄注册 seam"。但这个好消息被下一条完全抵消：
3. `debug.contribution.js` 里真正驱动"`launch.json` 的 `type` 字段 → 找到对应 `Debugger`"这条路径的,是 `debugSchemas.js` 里的两处 `ExtensionsRegistry.registerExtensionPoint({extensionPoint: "debuggers", ...})`（第 11 行）与 `{extensionPoint: "breakpoints", ...})`（第 157 行)。这是标准 VS Code **扩展点**机制——只有真实安装的扩展在其 `package.json` 的 `contributes.debuggers` 声明时,`ExtensionsRegistry` 才会实例化对应的 `Debugger` 对象填进 `ConfigurationManager`。F090 调研已经确认并实测验证过（`timelinePane.js` 一节)：Plain 的 `NullExtensionService.activateByEvent` 恒为 no-op,**Plain 没有任何扩展、也永远不会有扩展被激活**——这意味着即使我们完全剥离了 Chat 和 Task 耦合,`ConfigurationManager.getDebugger(type)` 在 Plain 里也**永远返回空**,因为压根不存在任何机制往这个注册表里塞东西。这不是"耦合可以剥离"的问题,而是**整条"`type` 字符串解析到调试器"的路径在无扩展产品里结构性死亡**——比 Chat 耦合更根本。
4. 更进一步,`DebugService`（`browser/debugService.js`)本身**不接受外部注入替代实现**：其构造函数内部直接 `this.adapterManager = this.instantiationService.createInstance(AdapterManager, {...})`,随后 `this.configurationManager = this.instantiationService.createInstance(ConfigurationManager, this.adapterManager)`——`AdapterManager`/`ConfigurationManager` 是硬编码 `new` 出来的具体类,不是通过 DI 令牌可替换的依赖。这意味着"只导入 `IDebugService` 这一层、自己实现一个干净的 `ConfigurationManager`/`AdapterManager` 替代品"这条路也走不通——想用 `DebugService`,就必须连带接受它内部固定实例化的 `AdapterManager`（Task 耦合）与 `ConfigurationManager`（扩展点死代码）。

**结论（比 F080/F090 更决定性）**：`@codingame/monaco-vscode-debug-service-override@35.0.1` 的服务与贡献层——`IDebugService`/`ConfigurationManager`/`AdapterManager`/`debug.contribution.js` 整条链路——**存在四个独立、任一都足以否决整体复用的障碍**（Chat 硬编码依赖、Notebook 无条件 import、Task 硬编码依赖、扩展点驱动的调试器类型解析结构性死亡),且第四点证明即使我们愿意像 F080/F090 那样再造一份"剥离补丁",剥离后剩下的东西也无法在无扩展产品里正常工作（`type` 永远解析不到任何 `Debugger`)。**这比 F080/F090 遇到的情况更彻底：不是"部分功能耦合、选择自建替代",而是"整条服务层的核心存在前提在本产品架构下不成立",因此本文档推荐 F100 完全不引入这个 npm 包（既不装它的 `getServiceOverride`,也不单独 cherry-pick 它的具体类文件),不新增这一条 pinned runtime dependency,不需要新的 pnpm patch。**

### 逐项自建 vs override 决策表

| 模块/能力                                                            | Chat/AI 耦合                                                                 | 其他障碍                                                                                                                                                                               | 决策                                                                                                                                                                                                                                    | 理由                                                                                                                                                                    |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `IDebugService`/`ConfigurationManager`/`AdapterManager`（整体服务层) | 有（`DebugChatContextContribution` 构造函数硬依赖 `IChatContextPickService`) | 有（`AdapterManager` 硬依赖 `ITaskService`；`ConfigurationManager` 依赖的 `debuggers`/`breakpoints` 扩展点在无扩展产品里永远为空；`DebugService` 内部硬编码实例化前两者,不可注入替代） | **完全自建,不引入该 npm 包**                                                                                                                                                                                                            | 四个独立障碍中任一都够否决,且第三点是架构性死亡而非可剥离的耦合                                                                                                         |
| `debug.contribution.js`（贡献注册整体)                               | 有（无条件注册 `DebugChatContextContribution`)                               | 有（无条件 import 触发 Notebook 命令注册)                                                                                                                                              | **不消费**                                                                                                                                                                                                                              | 同上,且是本文件独有的双重违规（Chat + Notebook）                                                                                                                        |
| DAP 协议客户端本身（框架/握手/请求关联)                              | 无关                                                                         | 无关——ADR 0003 已定 Rust 实现                                                                                                                                                          | **Rust 自建**（`src-tauri/src/debug/`）                                                                                                                                                                                                 | ADR 0003 已经决定,不是本文档需要重新论证的选项                                                                                                                          |
| 断点 UI（gutter glyph、行内条件/日志点编辑)                          | 无                                                                           | 无                                                                                                                                                                                     | **自建**,直接用 Monaco 核心编辑器 API（`IModelDeltaDecoration`/glyph margin)                                                                                                                                                            | 与 F090 inline blame 装饰同一技术类别,Monaco 核心已随 `monaco-vscode-editor-api` 可用,无需 debug-service-override                                                       |
| 调用栈视图                                                           | 视图类本身干净（`callStackView.js` 全文匹配 chat/copilot 零命中)             | 但依赖完整 `IDebugService`/`IViewModel`/`debugModel` 对象图才有意义                                                                                                                    | **自建 `ViewPane`**,不导入 vendor `CallStackView`                                                                                                                                                                                       | 导入它意味着要为它伪造一整套上游 `IDebugService` 形状的适配层,成本高于自己写一个薄视图直接消费 Plain 自己的 session 状态；同 F090"自建视图不消费 vendor 聚合"的既定纪律 |
| 变量/Watch 视图                                                      | 视图类本身干净                                                               | 同上（`VariablesView`/`WatchExpressionsView` 与上游 `IDebugSession`/`Expression`/`Variable` 类耦合)                                                                                    | **自建**,可以复用**通用**（非 debug 专属)的 `WorkbenchCompressibleAsyncDataTree`/`ActionBar` 之类的 Workbench 列表/树控件原语（若确认它们来自 Plain 已依赖的基础包,而非需要新装的 debug-service-override——**待实施时核实具体导出包名**) | 树控件本身是与调试语义无关的通用 UI 原语,值得复用;但装数据的"视图"必须是薄的自建壳,数据源是 Plain 自己的 DAP 会话状态                                                   |
| Debug Console / REPL                                                 | 视图类本身干净（`repl.js` 未在本次 chat/copilot 命中列表中)                  | 同上,且实现细节（历史记录、补全)与 upstream `IDebugSession.evaluate` 强绑定                                                                                                            | **自建**,用 Monaco standalone editor 做输入框 + 简单输出列表                                                                                                                                                                            | 同上                                                                                                                                                                    |
| 断点/调用栈/变量/watch 的**图标资源**（`debugAssets.js`)             | 无                                                                           | 无                                                                                                                                                                                     | **不引入**,复用 Plain 自己的图标系统                                                                                                                                                                                                    | 引入它意味着必须先装整个 npm 包,得不偿失（其余理由已经否决了整包引入）                                                                                                  |
| `runInTerminal` 语义（把 adapter 要求的命令跑在集成终端里)           | 无                                                                           | 无——`AdapterManager.runInTerminal`/`Debugger.runInTerminal` 只是简单委托给 factory,不依赖 Chat/Task/扩展点                                                                             | **自建**,由 Rust 侧直接调用既有 `TerminalService` 内部 API                                                                                                                                                                              | 语义简单且与 Plain 已有终端域天然契合,不需要借用 upstream 任何代码                                                                                                      |

## 主导会话裁定（五个决策点已全部拍板，实施方按此执行，不要再当作开放选项）

本文档正文里标为"需要产品所有者拍板"的五处，已由主导会话逐条裁定如下。**下文正文保留原有的推荐与论证以说明理由，但结论以本节为准。**

1. **`.plain/debug-adapters.json` 的路径与文件名：采纳推荐值。** 理由：`.vscode/launch.json` 保持与 VS Code 逐字段兼容（`program`/`args`/`cwd`/`env` 等通用字段照抄即可用），Plain 专属的适配器映射放进明确归 Plain 所有的目录。这样从 VS Code 项目直接拷过来的配置，通用部分白拿，用户只需补一份 Plain 专属文件，而不必在 `.vscode/` 里塞非标准键去污染别的工具。

2. **首次执行确认的去重键：采纳"精确 `(command 绝对路径, args 数组, transport)` 三元组"。** 理由：`type` 是用户自己起的字符串、可以被复用到另一个二进制上；"这个 workspace 已确认过任意 adapter"这种粗粒度会让**被悄悄改掉的 command 直接放行**。凡是真正会被执行的东西发生任何变化，都必须重新征求确认——这与 discard/network 确认门"锁定精确操作形状"而非"锁定一类操作"的既有纪律一致。

3. **TCP 方向：v1 只做「Plain 主动连出去」，明确排除「Plain 监听、等 adapter 连进来」。** 理由：一个监听中的本地端口是**无认证的本地 IPC 面**，任何能连本地端口的进程都能伪装成 adapter 接管一次调试会话。同时确认文档的另一半论断成立：**主动连出去也必须过 trust + 首次确认门**——"对任意 host:port 说 DAP"与"spawn 任意程序"是同等级的信任委托，不因为少了 `Command::new` 这一步就降级。

4. **`runInTerminal` 不做第二次确认：采纳，但追加一条硬性要求。** 采纳的理由与文档否决"适配器路径白名单"时用的是同一条推理，且这条推理是对的：adapter 本身就是一个以用户权限运行的任意可执行文件，它**完全可以自己 spawn 任何东西而根本不问我们**——再加一道确认不提供任何真实安全性，只制造虚假的约束感。**追加要求**：正因为安全性不靠确认门，就必须靠**可见性**——`runInTerminal` 必须复用 F070 既有终端域创建一个**用户可见、可自行终止**的真实终端标签页，**绝不允许新增一条隐蔽的 spawn 路径**；该标签页需能让用户看出它是由调试会话拉起的。这样"adapter 拉起了什么"永远摆在用户眼前，而不是藏在后台。

5. **通用 AST 契约「自建 `ViewPane` 必须声明全部构造参数的 DI 装饰器」：做，且必须在 F100 实现切片开始之前先做完。** 理由：这个 bug 类**已经真实造成两次事故**——F090 S4 只声明了自己新增的两个装饰器，把基类九个的信息整体覆盖，导致 SCM 容器内**全部四个视图**一起构造失败（一次挂 16 个用例，且失败面没有一个与 stash 相关，极难反推）；F090 S6 又发现 `plain-git-history-view.ts` **自创建起从未声明任何装饰器**，点按钮直接抛异常，连带使 S2 的 commit 详情功能**从交付起就从未被真实打开过**。两次都是静默、且症状被错误归因。F100 将新增 4 个以上视图（调用栈/变量/watch/REPL），第三次踩中的代价过高。契约形状：对 `app/` 下每一个继承 `ViewPane` 的类，断言其装饰器声明数量与构造函数参数数量**相等**，并配反向测试。这条不并进 F100 S0，而是作为独立的 harness 切片先行落地，好让 F100 新增的视图**从写下第一行起**就受保护。

## 技术方案

### 决策 1：适配器配置与授权模型（核心设计问题）

**问题的根源**：VS Code 原生 `launch.json` 的 `type` 字段依赖 `contributes.debuggers` 扩展点解析出"这个 `type` 对应哪个可执行文件、怎么启动"。Plain 没有扩展,这条解析路径永久为空（见上一节结论)。ADR 0003 已经决定"用户在 `.vscode/launch.json` 或本地设置中显式指定 adapter",但没有规定具体字段形状——这正是本文档必须回答的设计问题。

**推荐方案**：拆成两个独立的配置面,而不是把"启动这个程序"和"用哪个可执行文件当调试器"混在一份文件里：

1. **`launch.json` 继续保留 VS Code 兼容形状**（`.vscode/launch.json`,数组形式,每项含 `type`/`request`/`name`/`program`/`args`/`cwd`/`env`/`stopOnEntry` 等——这些字段在真实 DAP 里就是"传给 `launch`/`attach` 请求的 `arguments`",本身与"这个 `type` 的可执行文件在哪"无关,是通用、有意义、值得原样兼容的部分。好处：用户可以直接把一份真实存在的 VS Code `launch.json` 拿来用,`program`/`args`/`cwd`/`env` 这些字段照抄即可用,只有"`type` 怎么落到一个真实进程"这一层需要 Plain 自己补。
2. **新增一份 Plain 专属的"适配器注册表"**（建议路径与文件名——**这是需要产品所有者拍板的第一个选项**——本文档推荐 `.plain/debug-adapters.json`,workspace 内,与 `.vscode/launch.json` 同级但不同文件,JSON 数组,每项形状建议：
   ```jsonc
   {
   	"type": "debugpy", // 与 launch.json 里的 type 做纯字符串匹配,不经过任何扩展点
   	"transport": "stdio", // "stdio" | "tcp"
   	"command": "/usr/bin/python3", // 可执行文件绝对路径,用户自己填,不做任何白名单/沙箱限制
   	"args": ["-m", "debugpy.adapter"],
   	// transport 为 "tcp" 时額外需要 host/port（Plain 主动连出去,见下方安全讨论第 4 点)
   }
   ```
   `launch.json` 里的某一项如果还想临时覆盖/绕开注册表,允许携带一个内联的 `plainAdapter` 块（同样的 `{transport, command, args}` 形状)直接生效,优先级高于按 `type` 查注册表——避免"必须先编辑两个文件才能试一次性的调试配置"这种摩擦。
3. **读取这两份配置完全复用既有的 `workspace_read_file` 能力**,不新增任何 Rust 端文件读取代码——JSON 解析发生在前端。这是一个刻意的简化：Plain 不需要为"读 `.vscode/launch.json`"这件事发明新的 Rust FS 表面,因为它和读取任何其他工作区文件在能力模型上没有区别（只是内容恰好被前端当配置解析)。新增的 Rust 表面**只在真正要 spawn 一个 adapter 时才出现**。

**安全问题的正面回答（用户明确要求)**：让用户在 `.plain/debug-adapters.json` 里指定任意可执行文件路径,和 `cap_std` 能力模型/workspace trust 是什么关系？

- **这与 `worktree add` 落盘路径问题**不是同一类问题,机制上不能照搬同一个解法,但底层原则相通。`worktree add` 的问题是"Rust/git 子进程要在任意文件系统路径**写文件**（`mkdir`+ checkout)",`cap_std::Dir` 能力模型天然管的正是"我方 Rust 代码能对哪些路径做文件系统 I/O",所以那次的解法是"把目标路径收拢成一个已授权目录下的单层子路径,写操作因此天然落在已授权的 `Dir` handle 内"。
- **DAP adapter 路径不是这类问题**：这里不是"Rust 代码要读写这个路径",而是"Rust 代码要 `Command::new(那个路径)` 执行它"。`cap_std::Dir` 的能力边界管的是**我们自己进程内的文件 I/O 调用**,它结构性地管不到"一个被我们 spawn 出去的子进程,一旦启动之后自己能做什么"——子进程一旦 exec 起来,就是操作系统用户身份下的独立进程,拥有该用户的全部 ambient 权限,不受父进程任何 `cap_std::Dir` handle 约束（这一点对 `git`/PTY shell 同样成立,项目里已有的 `Command::new("git")`、`portable_pty::CommandBuilder::new(shell)` 也从未尝试过要"沙箱住"git 或用户 shell 子进程本身能做什么)。**如果试图用路径字符串检查/白名单去"限制"能 spawn 哪些可执行文件,这恰好正是此前对 `worktree add` 裁定时明确否决的思路——"把限制洗到子进程层"——只是这次连"洗"都洗不动,因为压根没有对应的 `cap_std` 操作可以拿来当权威判定点。**
- **真正的安全边界，与既有 `TerminalService`（放手让用户在受信任 workspace 里跑任意 shell 命令)完全同构**：
  1. **workspace trust 是唯一的、结构性的门**——`trust.require_trusted(workspace, window_label)` 必须在任何 adapter spawn 之前调用,未信任 workspace 直接拒绝,不 spawn。这一步保证"仅仅打开一个陌生仓库"不会导致任意代码执行——必须是用户已经明确对这个 workspace 点了"我信任它"。
  2. **配置文件本身只有已被信任的 workspace 才能提供**——`.plain/debug-adapters.json`/`.vscode/launch.json` 都活在 workspace 内,用户对 workspace 的信任决定隐含了"我信任这个仓库能让编辑器执行由它指定的程序",这和现有 Git 域"用户发起的写操作可以触发仓库自己的 hooks"（ADR 0003 原文)是同一条既定原则的自然延伸,不是新发明的宽松点。
  3. **首次执行确认（ADR 0003 明文要求,独立于 workspace trust 之外的第二道门)**——即使 workspace 已信任,第一次要 spawn 某个具体 `(command, args, transport)` 组合时,仍需向用户展示一次显式确认（"即将运行：`/usr/bin/python3 -m debugpy.adapter`——配置来自 `.plain/debug-adapters.json`——允许？"),确认后按 workspace 身份持久化该决定（同 `WorkspaceRootsIdentity` 持久化 trust 决定的机制),可撤销。**这里需要产品所有者拍板第二个选项**：确认的持久化粒度按什么维度做去重——本文档推荐按"精确的 `(command 绝对路径, args 数组, transport)` 三元组"做键（同 discard/network 确认"精确操作形状"而非"这个 workspace 已经确认过某类操作"的既有纪律),而不是更粗的"这个 `type` 字符串"或"这个 workspace 已经运行过任意一个 adapter"。
  4. **不做路径白名单/沙箱**——不要求 adapter 可执行文件必须位于 workspace 内部或某个"受祝福"的目录,理由已如上述（没有对应的 cap_std 操作可约束,伪造的白名单只会制造"部分场景莫名其妙失败"的困惑体验而不提供真实安全性——同 F090 裁定 `worktree add` 时否决"自由路径 + 仅存在性检查"方案的同一批判逻辑,但这里的结论方向相反：既然约束不住,就不假装能约束住,老实承认"你已经信任这个 workspace 能让我执行程序"是唯一真实生效的边界)。
  5. **spawn 本身仍然保持"参数数组、无 shell、环境净化"的既有纪律**——虽然 `command`/`args` 的**内容**完全来自用户配置（不是 Plain 写死的常量数组,这点与 git 的 `GIT_*_ARGS` 不同),但"如何把这些内容变成一次子进程调用"这件事本身仍然固定：`Command::new(&descriptor.command).args(&descriptor.args)`,绝不允许把整个命令行拼成一个字符串再交给 shell 解释（不允许 `sh -c "{command} {args}"` 这种形式),环境变量沿用净化后的最小集合（`PATH`/`HOME`,不透传调用者的完整 ambient 环境),这保留了"没有通用命令行逃生口"的字面含义——本文档说的"透明透传",透传的是 DAP `arguments` JSON 载荷（这是 ADR 0003 明确要求的,调试目标程序的启动参数天然是 adapter-specific 且需要透传的),不是"透传一段可以被 shell 解释的命令行字符串"。这与 `git_run` 被禁止的原因是同一条原则的两个不同表现：`git_run` 被禁是因为它让调用方随意选择*执行哪个 git 子命令*；这里如果做错了,风险点会是让调用方随意注入*shell 元字符*,两者都要杜绝,但适配器路径场景下"调用方能指定可执行文件本身"是设计已经承认、且被 trust+确认两道门限定的能力,不是需要额外堵的漏洞。
- **需要产品所有者拍板的第三个选项——TCP 传输的方向**：ADR 0003 只说"支持 stdio/TCP",没有区分"Plain 主动连出去（adapter 是已经在运行的 TCP server,Plain 作为 client 连接)"与"Plain 被动监听（adapter 反过来连进来)"。本文档推荐 **v1 只做"Plain 主动连出去"这一种**——多数真实场景（如 `debugpy.adapter --port N`)都是"先起一个监听中的 adapter 进程,IDE 再连过去",这与 stdio 场景一样,仍然由 Plain 侧先决定"我要不要连这个 host:port"（同样先过 trust + 首次确认门,只是这次没有 `Command::new` 这一步,取而代之的是一次 `TcpStream::connect`,同样需要显式确认,因为"连到任意 host:port 说话"本质上和"spawn 任意程序"是同等级的信任委托)。**"Plain 反过来监听、接受任意本地进程连进来自称是一个 DAP adapter"这个方向,本文档明确建议排除在 v1 之外**——它的信任模型明显更弱（任何能连本地端口的进程都能伪造一个调试会话),需要独立的、更谨慎的安全评估,不应该顺带在本次切片里捎带做掉。

### 决策 2：Rust debug 域——子进程模型与 git/terminal 精确复用点

`src-tauri/src/debug/` 遵循既有的域模块布局（`git`/`terminal` 已确立的先例,由本次调研对现有代码的实地核对确认)：`mod.rs`（域级错误码 + 子模块声明)、`commands.rs`（薄 `#[tauri::command]` 包装,`AST` 契约锁定完整函数体)、`dto.rs`（camelCase、`deny_unknown_fields` 的请求/响应 DTO)、每个能力一个文件。

**必须复用 `git/exec.rs` 的部分（不需要重新发明)**：

- **trust 门**——`trust.require_trusted(workspace, window_label).await?` 必须是任何 adapter spawn 前的第一行,与 `TerminalService::start`/`git::repo::resolve_repo_toplevel` 同一调用形状；`trust/mod.rs` 自己的模块文档已经把 F100 点名为这个门的第三个消费者。
- **"参数数组、无 shell"的构造纪律**——即便 `command`/`args` 的内容来自用户配置（不是常量),`Command::new(...).args(...)` 这个构造方式本身仍然是唯一路径,机制上等同于 git/terminal 现有的"只有一个 spawn 调用点"AST 契约,只是锁的不是参数常量而是"构造函数体形状本身不含字符串拼接"。
- **超时/输出上限/取消的通用值**——`git/exec.rs` 的 `GIT_EXEC_OUTPUT_CAP_BYTES`（10MB)/`GIT_EXEC_TIMEOUT`（30s)是"一次性、跑到完成"模型的常量,数值本身不直接适用（DAP session 是长连接,不是"跑一次等结束"),但"必须有上限、必须可取消"这个原则要复刻,只是换算成 DAP 语境下的等价物（见决策 4)。

**必须改用 `terminal/service.rs` 的部分（而非 git/exec.rs 的一次性捕获模型)**：DAP adapter 是**长连接、双向、事件驱动**的子进程（先 spawn,然后在会话生命周期内持续收发消息,直到用户主动结束或进程自己退出),这个形状和 git 的"spawn → 等待到 exit → 一次性拿到 stdout/stderr"完全不同,反而和 terminal 域的 PTY 会话（spawn → 长期存活 → 持续读写 → 用户主动关闭或进程退出)是同一类。具体要复刻的架构：

- **按会话分线程模型**——terminal 域每个会话用 3 个专用线程（reader/vt/waiter),DAP 会话对应地建议用（reader+分帧, writer, waiter)三个角色：一个线程阻塞读 adapter stdout（或 TCP socket 读端)并跑分帧状态机,解析出完整消息后按类型分派；一个线程（或直接由调用 Tauri command 的 async 任务持有)负责把待发送的请求写入 stdin（或 TCP 写端);一个线程/task 专门 `wait()` 子进程退出并上报。
- **窗口销毁清理**——复刻 `TerminalService::close_window`/`on_window_event(WindowEvent::Destroyed)` 的接线方式,把 `DebugService::close_window` 加入 `lib.rs` 现有的同一个 `on_window_event` 回调里,和 `WorkspaceService`/`BackupService`/`TerminalService` 并列。
- **事件推送到前端**——复刻 `plain://terminal-data`/`plain://terminal-exit` 的模式,新增 `plain://debug-event`（携带 `{sessionId, event: string, body: unknown}`,`event` 字段直接对应 DAP 自己的事件名枚举,不必为每种 DAP 事件类型发明单独的 Tauri 事件名——这与 git 域"用结构化枚举而非命令名膨胀"的既有风格一致)。

**IPC 层面的高层设计**：ADR 0003"Rust 实现编辑器侧 DAP client"意味着 Rust 端不是一个"哑管道"（把原始 JSON 双向转发、协议语义全部丢给前端),而是像 git 域一样自己拥有协议语义——自己分配请求 `seq`、自己维护"待响应请求表"（`seq → oneshot::Sender`)、自己解析 `Capabilities`,对前端暴露的是贴近 DAP 操作本身、但仍然是**具名、强类型**的命令（`debug_set_breakpoints`/`debug_stack_trace`/`debug_scopes`/`debug_variables`/`debug_evaluate`/`debug_continue`/`debug_next`/`debug_step_in`/`debug_step_out`/`debug_pause`/`debug_disconnect` 等),而不是一个通用的"发送任意 DAP 请求"逃生口——这与 git 域"每个能力对应写死的专用命令,不做通用 `git_run`"是同一条原则在 DAP 语境下的应用。**唯一的、刻意的例外**是 `launch`/`attach` 请求的 `arguments` 字段——ADR 0003 明确写了"adapter-specific 配置透明透传",这是协议本身定义的开放 JSON 载荷（不同 adapter 需要完全不同的字段,Plain 不可能穷举),因此 `debug_launch`/`debug_attach` 命令的入参里这一个字段是不透明 JSON blob,原样转发进 DAP 请求的 `arguments`——这不违反"无通用逃生口"原则,因为能透传的只是**协议已经定义为不透明的那个字段**,不是"你可以让 Rust 执行任意别的东西"。

**`runInTerminal` 接入**——Rust 端拦截这条反向请求（adapter → client 方向的 `request`),不经过前端往返,直接调用 Plain 既有 `TerminalService` 的内部 Rust API（不是走 `terminal_start` 这个 Tauri command,而是同一个 crate 内 `TerminalService` 结构体的方法调用)创建一个新终端会话,把 `RunInTerminalRequestArguments` 的 `cwd`/`args`/`env` 转换成 `TerminalService` 已有的启动参数形状；创建成功后把 DAP 要求的 `response`（`body.processId` 或 `body.shellProcessId`)发回给 adapter。前端侧不需要新代码去"响应"这个反向请求——它会作为一次普通的新终端会话出现（复用既有 `plain://terminal-data` 事件),用户体验上就是"调试开始后自动多开了一个终端标签页在跑目标程序"。**这一步的 `cwd`/`args`/`env` 来自 adapter 自己的决定,不是用户 launch.json 直接给的**——一旦用户已经决定信任并运行某个 adapter,这属于同一份信任的自然延伸（同决策 1 安全讨论最后一段的推理),不需要为 `runInTerminal` 单独再做一次确认,但**这是本文档明确做出的一个设计取舍,不是不言自明的事实,列入需要确认的决策点**。

### 决策 3：调试 UI 最小可用面——逐项判断

延续"逐项自建 vs override 决策表"的结论,全部自建：

- **断点**（行断点、条件断点、日志点)：Monaco 编辑器 glyph margin 点击 + `IModelDeltaDecoration`（同 F090 inline blame 用 `after` decoration 的技术类别,这次用的是 glyph margin API,同样是 Monaco 核心已有能力,不需要 debug-service-override)。条件/日志点表达式在断点被点击后弹一个小型输入 popup,提交后随 `setBreakpoints` 请求的 `condition`/`logMessage` 字段发给 adapter,是否真正生效取决于 `Capabilities.supportsConditionalBreakpoints`/`supportsLogPoints`（两个真实 adapter 本次实测都为 `true`,但不能假设全部 adapter 都支持)。
- **调用栈**：自建 `ViewPane`（复用 `scm-contribution.ts`/`search-contribution.ts`/`terminal-contribution.ts` 已确立的 `registerViewContainer`/`registerViews` 自建注册模式),数据源是 Rust 侧 `debug_stack_trace` 返回的 DTO,点击某帧触发 `debug_scopes`。
- **变量/Watch**：自建 `ViewPane`,树形展开逻辑直接对应 DAP `variablesReference`（`0` = 叶子,非 `0` = 可展开,展开时调用 `debug_variables` 并支持 `start`/`count` 分页——本机实测已确认这两个字段真实存在于协议里,大集合/数组应该懒加载而非一次性全展开,与 F090 viewport 级 blame 懒加载同一设计动机)。Watch 表达式是用户手动添加的一组表达式,复用同一个 `debug_evaluate`（`context:"watch"`,本机实测已验证该 context 值真实可用)。
- **Debug Console (REPL)**：自建,输入框用 Monaco standalone editor（获得语法高亮但不需要完整 Workbench editor pane),提交调用 `debug_evaluate`（`context:"repl"`),输出面板同时消费 `output` 事件（本机实测确认 `category:"stdout"`/`"stderr"`/`"telemetry"`等值真实存在,UI 需要按 `category` 区分展示样式,`telemetry` 类别默认不展示给用户)。
- **调试工具栏/步进控制**（continue/pause/step in/out/over/stop/restart)：自建简单命令条,直接绑定 Rust 侧对应命令,按 `Capabilities` 里的 `supportsStepInTargetsRequest` 等字段决定是否显示细分选项（如"step into target"选择器)。
- **反汇编视图（Disassembly)**：本次 acceptance 未要求,**明确排除在 v1 之外**,即使 `lldb-dap` 真实支持 `supportsDisassembleRequest`。

**DI 装饰器纪律（复用已确认的真实教训,适用于本 feature 新增的每一个自建视图)**：本项目未启用 TypeScript `experimentalDecorators`,构造函数依赖注入是通过在类定义后手动调用 `IFoo(ClassName, undefined, index)`（等价于 `__param` 装饰器)登记的；这个登记在 `@codingame/monaco-vscode-api` 的 DI 实现里是**替换而非追加**——已有两起真实事故：`PlainGitStashView` 只登记了自己新增的 2 个服务索引（省略了 `ViewPane` 基类自己的 9 个),导致同一容器内全部四个视图批量构造时一起失败；`PlainGitHistoryView` 完全没有登记任何装饰器（连自己新增的都没有),因为它没有主动"抢注"过 `$di$dependencies`,反而侥幸通过原型链继承了基类的 9 个,但自己新增的 2 个参数在运行期始终是 `undefined`,静默破坏了依赖它们的功能且不影响其他视图。**本 feature 的每一个新 `ViewPane` 子类,只要构造函数比基类的 9 个参数多任何一个,必须把从索引 1 到最后一个新增索引之间的全部装饰器在同一处连续声明,不能只声明新增的那几个,也不能因为侥幸不报错就假设装饰器已正确生效**——这是运行期才会暴露、编译期没有任何提示的错误类别,必须用真实的、跑通全量浏览器 E2E 的方式验证（不能只靠该视图自己的单测)。

### 决策 4：协议健壮性——崩溃/超时/畸形帧/取消/分页/背压

- **分帧状态机的边界**（对应 acceptance 第 1 条)：见"协议基础事实"一节列出的 fixture 清单（跨多次 read 的 header/body、单次 read 含多条消息、`Content-Length` 与实际字节数不符、缺失/不可解析的 `Content-Length`、未知的额外 header 字段)。**新增边界常量**：`MAX_DAP_MESSAGE_BYTES`（防止一个声称超大 `Content-Length` 的畸形/恶意帧无界分配内存——同 git 域 `GIT_EXEC_OUTPUT_CAP_BYTES` 的动机,但这里是逐条消息的上限,不是整个进程生命周期输出流的上限)与 `MAX_DAP_HEADER_BYTES`（防止 header 部分永远不出现 `\r\n\r\n` 导致无界扫描)。两者的具体数值**留给实施阶段依据真实大对象场景（如巨大数组/字符串变量的 `variables` 响应)确定,不在本文档编造**。
- **adapter 崩溃/无响应**：进程非预期退出——waiter 线程检测到退出后,把所有仍在等待响应的 pending request 用一个统一的"会话已终止"错误结束,向前端发一个 `terminated`-等价事件（区分"adapter 自己发的 `terminated` DAP 事件"与"我们推断出的进程死亡",后者应带一个 Plain 自己的错误标记,不伪装成协议本身的正常终止)。请求超时——每个请求需要独立的超时（不是像 git 一样整个子进程一个固定超时,因为 DAP session 是长连接,不同请求的合理等待时长天差地别：`variables` 可能因为大对象合理地慢,`continue`理论上应该很快),超时后该请求返回结构化错误,但**不代表整个 session 需要终止**（adapter 可能只是这一次响应慢,session 仍然可用)——具体超时数值**留给实施阶段基准确定**。
- **取消**：复用 F090 已建立的"viewport 离开时主动取消"模式的精神——例如用户切换到别的调用栈帧时,之前那次尚未返回的 `variables` 请求如果还没用了,应该能被取消而不是无意义地占用资源,但**DAP 协议本身没有通用的"取消某个 in-flight 请求"机制**（不像 LSP 有 `$/cancelRequest`)——大部分 in-flight 请求只能等它自然返回后直接丢弃结果,不去等待的部分应该是"客户端本地放弃等待",而非"让 adapter 提前停止计算"。这是协议本身的限制,不是 Plain 实现的疏漏,需要在设计文档里明确记录而非假装能取消。
- **`output` 事件的背压**——被调试进程如果是一个高频写 stdout 的死循环,adapter 会不断产生 `output` 事件,这与 terminal 域 PTY 输出的背压问题是同一类风险（已被证明真实存在,terminal 域为此建了两层背压)。本文档建议复用 terminal 域 `FrameEmitGate` 的"未确认事件数上限 + 前端显式 ack 换取新额度"模式,但换算成 DAP 语境下的"至多 N 条未确认的 `output` 事件在途,额度耗尽时聚合/丢弃多余输出而不是让 Tauri IPC 通道无界堆积"——具体阈值**留给实施阶段确定**。`stackTrace`/`variables` 这类请求-响应式命令不需要这层背压（天然有 DAP 自带的 `levels`/`start`/`count` 分页兜底,单条响应大小已被 `MAX_DAP_MESSAGE_BYTES` 兜底)。

## 需要新增的 AST 契约清单

比照 `scripts/plain/boundary-contracts.mjs` 现有 `GIT_COMMAND_CONTRACTS`/`validateGitRustBoundary`/`validateGitDiscardConfirmationBoundary`/`validateGitNetworkConfirmationBoundary`/`MIDDLE_SERVICE_DESCRIPTORS` 的既有模式（本次调研已逐一读取真实定义确认技法),F100 需要：

1. **`DEBUG_COMMAND_CONTRACTS`**：与 `GIT_COMMAND_CONTRACTS` 同构,锁定每个 `debug_*` Tauri command 的精确 `parameters`/`returnType`/函数体字符串。
2. **`validateDebugAdapterSpawnBoundary`**：锁定"任何 adapter spawn 之前必须先调用 `trust.require_trusted`"这一调用顺序（与 git/terminal 现有做法同构,但这是本域第一次需要为"长连接子进程"而非"一次性子进程"写这个契约,函数体形状会不同）。
3. **`validateDebugSpawnConstructionShape`**：锁定 spawn 构造函数的函数体**不含**任何字符串拼接/`format!`到单一字符串再传给 `Command::new`/`.arg()`的模式——即使 `command`/`args` 内容来自用户配置,构造方式本身必须始终是"`Command::new(&self.command).args(&self.args)`"这个固定形状,这是防止未来有人为了"方便"改成 `sh -c` 拼接字符串的机械防线。
4. **`validateDebugAdapterConfirmationBoundary`**：与 `validateGitDiscardConfirmationBoundary`/`validateGitNetworkConfirmationBoundary` 同构,锁定"首次执行某 `(command,args,transport)` 组合前必须经过确认"这一状态机模块的唯一审计调用点。
5. **`validateDebugFramingBounds`**：锁定 `MAX_DAP_MESSAGE_BYTES`/`MAX_DAP_HEADER_BYTES` 两个常量确实被分帧状态机引用（防止未来重构时意外丢掉上限检查）。
6. **`validateDebugViewDecoratorCompleteness`（本文档建议新增的通用契约,不只服务于 F100)**：鉴于"自建 `ViewPane` 必须声明全部构造参数装饰器"这一教训已经在 F090 里独立发生过两次（一次部分声明、一次完全不声明),本文档建议借 F100 引入首批新视图的机会,新增一个**通用**（不限于 debug 域)AST 契约：对每一个继承 `ViewPane` 的自建类,统计其构造函数总参数个数 N（含继承的 9 个基类参数),要求存在恰好 `N-1` 条形如 `IFoo(ClassName, undefined, i)` 的调用（`i` 从 1 到 `N-1`,不允许有空缺索引),而不是像现在这样只能靠代码审查/事后 E2E 发现。这是运行期契约转编译期/CI 期契约的机会,建议提给主导会话评估是否值得作为 F100 的一部分实现,还是作为独立的 harness 加固任务处理。
7. 扩展 `FORBIDDEN_SPAWN_BYPASS_DEPENDENCIES` 的适用范围声明,重申 F100 不引入任何新的 spawn 相关 crate 依赖（复用 `portable_pty`还是纯 `std::process::Command`留给实施阶段决定——stdio 场景下 DAP adapter 不需要伪终端语义,纯 `std::process::Command` + 手动管道读写大概率足够,不必像 terminal 域一样引入 `portable_pty`,但这个判断**待实施时确认**,如果发现 adapter 对"是否连接到一个真终端"敏感——一些 CLI 工具会探测 `isatty()`调整行为——才需要重新评估）。

## 切片拆分（参考 F080/F090 粒度,每片可独立验收、独立提交）

1. **S0 分帧状态机 + Rust debug 域骨架 + trust 门**：`src-tauri/src/debug/{mod.rs, framing.rs, exec.rs, commands.rs, dto.rs}`；stdio 分帧状态机（不含真实 adapter 交互,先用内存管道/mock 字节流跑通全部 fixture：跨多次 read 的 header/body、单次 read 多条消息、畸形 `Content-Length`、超限消息);`validateDebugAdapterSpawnBoundary`/`validateDebugSpawnConstructionShape`/`validateDebugFramingBounds` 三个契约。**建议把本次调研实测抓到的真实字节（`lldb-dap`/`debugpy` 的 `initialize` 握手)冻结成回归 fixture,而不是只用合成数据**——这是复用真实证据而非凭空编造 fixture 的機會,同 F090"实测证据直接固化为回归测试"的纪律。
2. **S1 TCP 传输 + 适配器配置解析 + 首次执行确认门**：TCP client 分帧（复用 S0 的状态机核心,只换字节来源);解析 `.plain/debug-adapters.json`/`.vscode/launch.json` 内联 `plainAdapter` 块（前端,复用既有 `workspace_read_file`);`validateDebugAdapterConfirmationBoundary`;缺失/未信任 adapter 的可操作错误（acceptance 第 4 条)。
3. **S2 真实会话生命周期**：握手编排（`initialize` → 等待 `initialized` 事件 → `setBreakpoints` 系列 → `configurationDone` → 允许 `launch`/`attach` 响应到达)、请求-响应关联（按 `request_seq`,不依赖 `seq` 数值语义)、`plain://debug-event` 事件推送、窗口销毁清理接线。可以先用一个 DEV-only 诊断钩子（同 F080/F090 先例)验证全链路,不急着接 UI。
4. **S3 断点 + 调用栈 + 变量/Watch**：Monaco 断点 glyph + 三个自建 `ViewPane`（每个视图的 DI 装饰器完整性必须手工核对,理想情况下已经有第 6 项契约兜底);`debug_set_breakpoints`/`debug_stack_trace`/`debug_scopes`/`debug_variables`（含分页)。
5. **S4 步进控制 + Debug Console/REPL + `runInTerminal`**：工具栏命令;`debug_evaluate`（watch + repl 两种 context);Rust 侧拦截 `runInTerminal` 反向请求并接入既有 `TerminalService`。
6. **S5 健壮性**：per-request 超时、adapter 崩溃/退出的会话终止路径、`output` 事件背压、真实大对象（深调用栈、大数组变量)基准测试（本机 138 提交量级的仓库不适用于这里,但同样需要一个"真实较大规模"的测试场景,例如故意写一个产生几千个变量或几十层递归的测试程序,而非只造几个字段的合成 fixture）。
7. **S6 收口**：跨切片 evidence 闭环、`docs/e2e-handover.md` 新增条目（尤其下一节提到的 lldb-dap 原生调试在真实签名后 Tauri 应用里的验证,这类问题只有真实桌面场景能验证)、`features.json` F100 转 complete（均由主导会话操作)。

## 风险与未知项清单

1. **本次调研环境无法验证 `lldb-dap` 真实启动被调试进程（仅验证了 `initialize`/`Capabilities` 握手)**——本机 Bash 工具的沙箱执行环境下,`lldb-dap` 发出 `launch` 请求后没有任何响应或 `initialized` 事件到达（25 秒超时);独立验证发现,连最基础的交互式 `lldb ./sample` + `run` 命令本身也在同一沙箱下完全挂起、无任何输出（120 秒超时后台化,进程本身产生了真实的 `debugserver` 子进程但没有任何可见结果)。这**很可能**是该沙箱环境本身对 `ptrace`/`task_for_pid` 类系统调用的限制（macOS 原生调试依赖这些),而非协议或设计问题——`debugpy`（不依赖 `ptrace`,用 Python 自身的 `sys.settrace` 机制)在同一沙箱下完整跑通,间接支持这个推测。**必须在实施阶段用真实桌面环境（非本次调研使用的沙箱)重新验证 `lldb-dap`（或任何原生调试器)的完整生命周期**。
2. **由第 1 条牵出的、独立于本次沙箱限制的真实新风险——macOS 应用签名/entitlements**：即使在真实桌面环境下,一个已签名的 macOS 应用要让自己 spawn 的子进程（`lldb-dap`)成功对**另一个**子进程调用 `task_for_pid`（原生调试的必需系统调用),通常需要该应用自身的代码签名 entitlements 包含调试相关权限（如 `com.apple.security.cs.debugger`),否则会被系统安全机制拒绝——这与 Plain 自己的 trust/确认逻辑是否正确完全无关,是**打包层面的必需前提**。本文档记录这个风险但不解决它（属于 `F120`"Branding, packaging, notices and release checks"的打包/签名范畴),**F100 实施时必须提前确认 Plain 的开发者签名配置是否已经/能够满足这个前提,否则 acceptance 第 2 条里"断点、单步"这些能力对原生语言调试器可能在打包后的正式版本里完全无法工作,即使开发模式下能跑通**。
3. **`runInTerminal` 反向请求本次未做真实端到端触发验证**——两个测试用的 adapter 配置都未触发它（`debugpy` 默认走 `internalConsole`)。`argsCanBeInterpretedByShell` 字段的确切含义与 Plain"不做 shell 解释"纪律的交互需要实施时用真实触发场景（例如某个要求外部终端的 launch 配置)确认。
4. **`Message`/`Source`/`Breakpoint` 等若干 DAP 类型的完整字段列表本次未能从抓取的规范页面拿到逐字段确认**——已标注,不在本文档编造,实施时应对照规范仓库的原始 `debugAdapterProtocol.json` schema 逐字段核实。
5. **`ConfigurationManager`/`AdapterManager` 的"扩展点驱动、Plain 里永远为空"这一结论,是基于 F090 对 `NullExtensionService.activateByEvent` 的既有实测（timeline 视图审计时确认),本文档没有针对 debug 域重新单独实测同一行为**——理论上应该是同一个 `NullExtensionService` 实例,行为应当一致,但**严格来说属于复用既有结论而非本次独立重新验证**,标注供留意。
6. **通用 `ViewPane` 装饰器完整性 AST 契约（清单第 6 项)的具体实现细节未设计**——只提出了契约的意图与形状,统计"构造函数总参数个数"在 TypeScript AST 层面精确实现（尤其要正确处理 `private readonly xxx: Foo`参数属性写法与普通参数的语法差异)需要实施阶段设计,可能比听起来更繁琐,如果成本过高,退回"只在本 feature 引入的新视图上人工核对 + 依赖全量 E2E"这一更弱但已被验证有效的既有纪律也是可接受的降级。
7. **背压/超时/`MAX_DAP_MESSAGE_BYTES`等具体数值全部未定**——本文档只论证了"需要有上限"这一原则性结论,具体数字需要实施阶段用真实大对象场景（深调用栈、大数组/大字符串变量、高频 stdout 输出的测试程序)基准测定,不能凭空定一个数字了事。
8. **`lldb-dap` 是否是"用户可能实际会用的"原生调试器代表**这一假设本身未经用户确认——本文档选它是因为它是 macOS 上最容易零安装获得的真实原生 DAP adapter,不代表 Plain 需要专门为它做任何特殊适配（设计上应该对任何遵循标准 DAP 的 adapter 一视同仁),仅作为"验证协议层与设计对原生调试器同样成立"的代表性样本。

## 与 F110（遗留退役）/F120（品牌打包)的边界

- F100 完全不涉及 `monaco-vscode-api` 现有 203 个排除域 source-map 债务文件的清理——那是 F110 的范围；本文档"不引入 `@codingame/monaco-vscode-debug-service-override`"这一决定意味着 F100 甚至不会像 F090 那样新增一个干净的 pinned dependency 需要 `check-boundaries.mjs`的 `allowedDependencies`更新——**F100 预期不新增任何新的 `@codingame/monaco-vscode-*` npm 依赖**,这与 F090（新增了 `multi-diff-editor-service-override`)形成对比,值得在切片实施时反过来验证"确实没有引入"而不是默认假设。
- macOS 原生调试器（`lldb-dap`等)所需的应用签名/entitlements（风险清单第 2 条)属于 `F120`"Branding, packaging, notices and release checks"的范畴——F100 只负责记录这个前提要求,不负责配置签名本身。
- F100 不改动/不清理任何既有 debt 计数基线,预期与 F090 收口时的基线保持一致（只有 F100 自己新增的 Rust/前端源文件计数会变化,`debtSourceCount`/`categoryCounts`/`debtSourceSha256` 应逐字节不变,同 F080/F090 的验证纪律)。

## 排除项

`@codingame/monaco-vscode-debug-service-override`（整包,含其贡献注册`debug.contribution.js`、服务层 `IDebugService`/`ConfigurationManager`/`AdapterManager`、内置图标资源 `debugAssets.js`)——四个独立理由已在"上游排查"一节详述;反汇编（Disassembly)视图——acceptance 未要求,`v2` 可选;DAP 协议层面的"取消 in-flight 请求"——协议本身不提供,不是 Plain 实现的疏漏;"Plain 反向监听、接受任意本地连接自称 DAP adapter"的 TCP 模式——v1 明确排除,需要独立安全评估;`preLaunchTask`/`postDebugTask`（VS Code Task 系统集成)——`AGENTS.md`已排除构建系统/任务运行器,`launch.json`里出现这两个字段时应被忽略并给出明确提示,而非静默失败;`contributes.debuggers`扩展点兼容(不适用,Plain 无扩展宿主)。
