# F210 完整通用调试工作流

日期：2026-08-04

## 事实基线

F100 已交付 Rust 拥有的通用 DAP 客户端：`Content-Length` 严格分帧（64 MiB 消息/8 KiB 头上限）、`request_seq` 唯一关联、debugpy 实测握手时序（`initialize` → 发送 `launch/attach` 不立即等待 → `initialized` → `setBreakpoints` → `configurationDone` → 才等 launch 响应）、30s 请求/300s launch 双超时、`runInTerminal` 反向请求直连 TerminalService、64 事件/1 MiB 合并的 output 背压、trust→root→confirm 三重门与窗口销毁并发清理。F150 已把 `rootId` 贯穿全部调试 IPC 并有真实双根桌面证据（E2E-017）。E2E-010 已用真实 debugpy 完整验证全链路（含 1204 帧调用栈、5 万元素分页、输出洪峰与零残留）。这些能力不重做。

代码审计确认 F210 前的真实缺口：

- `plain-debug-commands.ts` 硬编码 `parsedLaunch.value[0]`（模块文档自陈范围收窄）；解析层 `parseLaunchConfigurations` 与装配层 `prepareDebugAdapterLaunch(configurationName)` 本就支持多配置按名选择，仅缺选择器。
- Watch 视图对 `variablesReference !== 0` 的结果只显示扁平 `result`/`type`（模块文档自陈不复用 Variables 树机制）；Variables 视图已有完整递归展开 + 100/页分页实现。
- 断点仅有行/条件/日志点：`DebugBreakpointDescriptor` 与 Rust `LineBreakpointRequest` 均无 `hitCondition`，全仓库零命中；能力门控无 `supportsHitConditionalBreakpoints`。
- `debug_step_in` 从不发送 `targetId`；`supportsStepInTargetsRequest` 从未被消费；无 `stepInTargets` 请求路径。
- Disassembly 彻底未实现（仅能力解析测试夹具引用），F100 调研明确排除于 v1，本 feature 首次纳入。
- spawn-then-connect 只有死原语 `spawn_adapter_as_tcp_companion`（守卫已锁 `Tcp` 确认主体），缺：`SessionTransportRequest` 第三变体与前端配置面、带重试的有界 connect-after-spawn 循环（裸 connect 在端口就绪前立即 `ECONNREFUSED`）、同时持有进程句柄与 TCP 流的双通道 teardown。
- 真实桌面矩阵：debugpy 半边已由 E2E-010 覆盖；原生 `lldb-dap` 半边从未真实验证，阻塞于 `com.apple.security.cs.debugger` 签名 entitlement（F120 发布范畴，本非发布阶段明确除外）。

## 架构裁定

### 1. launch configuration 选择复用根选择器模式

多配置时用 `IQuickInputService.pick` 显式选择（模式照抄同文件 `selectPlainDebugRoot`），单配置自动选中不弹框，取消即零副作用（零读取之外的零 spawn/零确认）。选中的 `name` 传给既有 `prepareDebugAdapterLaunch`，不改装配层。选择器展示 name 与 type，不展示绝对路径。

### 2. 嵌套 Watch 复用 Variables 树机制

把 Variables 视图的递归节点渲染/展开/分页机制提取为两视图共享的实现（提取或组合由实现取最小改动，但禁止复制粘贴第二套树逻辑），Watch 的每条表达式结果按其 `variablesReference` 接入同一套展开与 100/页分页；表达式刷新时折叠状态按表达式文本保持。既有 DI 装饰器完整性契约（F090/F100 两次真实事故换来的）必须继续通过。

### 3. hit-count 断点是三层薄片

`DebugBreakpointDescriptor`/store/断点 popup 增加 `hitCondition`，Rust `LineBreakpointRequest::to_arguments` 透传 `hitCondition` 字符串（DAP 语义由 adapter 解释，Plain 不解析表达式）；UI 输入框按 `supportsHitConditionalBreakpoints` 能力门控（模式照抄现有 condition/logMessage 门控）。strict codec/mock/守卫全链同步。

### 4. step-in targets 按能力门控的显式目标选择

新增 Rust 命令 `debug_step_in_targets`（对当前 stopped frame 发 `stepInTargets` 请求）；`debug_step_in` DTO 增加可选 `targetId`。前端新增 `Plain: Step Into Target…` 命令（仅 stopped 且 `supportsStepInTargetsRequest` 时可用）：拉取目标列表 → QuickPick 选择 → 携带 `targetId` 的 stepIn。既有 Step Into 按钮行为完全不变。目标列表长度设硬上限，超限截断并可见。

### 5. disassembly 是只读有界视图

新增 Rust 命令 `debug_disassemble`（`supportsDisassembleRequest` 门控）：以当前 stopped frame 的 `instructionPointerReference` 为锚，一次请求固定窗口（≤200 条指令，前后偏移有界），严格 DTO 校验。前端自建只读 `ViewPane`（遵循 F100 自建纪律与 DI 装饰器契约）：展示地址/字节/指令三列与当前指令高亮，仅在 stopped 且能力可用时经命令打开，滚动翻页复用同一有界请求。明确排除：instruction breakpoints、内联 source 混排、执行/写入能力——只读展示，不扩大进程能力。

### 6. spawn-then-connect 是受确认门保护的有界编排

`SessionTransportRequest` 新增第三变体（spawn 描述符 + connect 端口），前端 `AdapterDescriptor` 对应配置面；确认主体沿用守卫锁定的 `Tcp` 变体语义（spawn 的 command/args 进入确认三元组）。编排：先 `spawn_adapter_as_tcp_companion`（复用既有 200ms 早崩溃宽限），随后带退避的重试 connect 循环，总预算沿用 `DEBUG_ADAPTER_TCP_CONNECT_TIMEOUT`（5s）且进程提前退出立即失败；成功后会话同时持有进程句柄与 TCP 流，任何终止路径（disconnect/窗口销毁/超时）先 shutdown 流再 kill+join 进程，两通道都不得泄漏。若 connect 预算耗尽，kill 已 spawn 的进程并返回明确错误。

### 7. 真实桌面验收登记暂缓

按用户 2026-08-04 指示，真实桌面矩阵登记为 `E2E-027` 待执行（与 E2E-025/026 攒批）：debugpy 侧覆盖多配置选择、hit-count、嵌套 Watch、step-in targets 与 spawn-then-connect（debugpy 支持 `--listen` 模式，是 spawn-then-connect 的真实验收对象）；`lldb-dap` 原生半边如实记录双重阻塞（桌面验收暂缓 + F120 签名 entitlement 前提），不伪称可执行。disassembly 的真实验收依赖支持该请求的 adapter（`lldb-dap`），同样如实登记依赖。

## 垂直切片

1. **S1 launch 配置选择器**：QuickPick 多配置选择、单配置直通、取消零副作用；Browser 覆盖。
2. **S2 嵌套 Watch**：共享树机制提取与 Watch 接入、折叠状态保持；Browser 覆盖。
3. **S3 hit-count 断点**：DTO/store/popup/能力门控全链；Rust/Browser 覆盖。
4. **S4 step-in targets**：`debug_step_in_targets` 命令 + `targetId` 透传 + QuickPick 命令；Rust/Browser 覆盖。
5. **S5 disassembly 视图**：`debug_disassemble` + 只读 ViewPane + 有界翻页；Rust/Browser 覆盖。
6. **S6 spawn-then-connect**：第三传输变体、配置面、有界重试与双通道生命周期；Rust/Browser 覆盖。
7. **S7 收口**：`E2E-027` 登记（暂缓）、progress/features 例外收账、完整门禁与全量 Browser 回归。

每个切片先通过自己的最小验证并独立提交，再开始下一项；F210 关闭前不切换 F220。

## F270 实施补记：DAP threads 缺口闭合（2026-08-24）

F230 完成度审计发现 `docs/product-scope.md:60` 的 `threads` 从未进入生产路径；F100 只从 stopped/thread-started 事件保存一个 id，Call Stack 因此是假定单线程。F270 的裁定是补齐标准 DAP 请求和线程 UI，不引入 vendor debug service：

- Rust 新增 `debug_threads`，只发送固定 `threads` command 和空 arguments。`parse_threads_response` 要求每项有唯一整数 id 与字符串 name，最多返回 4096 项并以 `truncated` 明示截断；Tauri handler 的 command literal、空 arguments、parser 和唯一注册由 architecture hostile mutation 锁定。
- TypeScript wire decoder要求精确 own-data keys，拒绝 accessor、Proxy、重复 id 与超限数组；native/browser bridge 只接收 sessionId。`DebugSessionController.threads()` 仅对 live session 可用，thread started/exited 修正 pause target 并驱动视图刷新。
- 自建 Call Stack 在 stopped 时先取 thread snapshot，默认选择 stopped event 指定的线程，只为当前选中线程请求 stackTrace；用户点击其他线程只切换浏览栈，不改写执行控制目标。continued、terminated 与 session-ended 清空线程/帧/frame selection，避免旧 session 或运行态残留。

明确排除：线程冻结/单线程 stepping 的 `singleThread` 变体、线程排序/分组策略、跨停止点缓存所有线程的 stackTrace。当前实现保留 adapter 顺序并对选中线程惰性读取，满足 product-scope 的基础 threads 能力且维持有界预算。
