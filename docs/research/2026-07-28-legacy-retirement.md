# F110 Legacy subsystem retirement

日期：2026-07-28

## 目标与边界

`F110` 五条 acceptance（`features.json`）：

1. Electron and Node native runtime paths are removed
2. AI, Agent, Chat, MCP and Copilot paths are removed
3. Authentication, accounts and sync paths are removed
4. General Extension Host and non-theme extensions are removed
5. Language environments, remote, notebook, tasks and testing are removed

`progress.md`「已知风险」明确点名了本次调研的起点：`monaco-vscode-api` 的 `missing-services.js` 仍让 bundle source-map 含 203 个 Chat/Agent/MCP/Auth/Sync/Extension Runtime 债务源；运行时 guard（`app/excluded-surface-policy.ts`/`app/excluded-surfaces.ts`）保证当前不可达，但 F110 必须把它们从「挡住」变成「物理清零」。`docs/bundle-baseline.json` 锁定 `debtSourceCount=203`、`categoryCounts`（`chatAgent:121`、`mcp:16`、`authAccount:11`、`syncEditSessions:8`、`extensionRuntime:47`）与 `debtSourceSha256` 三项逐字节零漂移，已跨 F010–F100 保持不变（`scripts/plain/check-bundle.mjs` 每次 `pnpm check` 都会重新计算并比对）。

本文档的调研方法论继承 F080/F090/F100 三份文档已确立的纪律：能实测就实测，不凭记忆断言。具体做法：

- 真实执行 `pnpm build:frontend`（`vite build`，产出 `dist/`，`sourcemap: true`），对产出的 `.js.map` 做与 `check-bundle.mjs` 完全相同的 source 归一化和分类，逐条列出 203 个债务源的真实路径（附录于本文档「实测证据」各节）。
- 直接阅读已安装的 `node_modules/.pnpm/@codingame+monaco-vscode-api@35.0.1.../services.js`、`missing-services.js`（9127 行）、`extensions-service-override` 的 `index.js` 等真实源码，而非只看 `.d.ts` 或包名猜测。
- 直接阅读仓库里已经存在的 9 个 `patches/*.patch`（`@codingame/monaco-vscode-api`、`extensions-service-override` 等已经被 `pnpm patch` 过），核实哪些债务代码的**行为**已被神经阻断、但**文件本身**为何仍留在 bundle 里。
- 用完之后已清理：`dist/`（研究用临时构建产物，未提交，已 `rm -rf`）。

调研结束后确认没有偏离 acceptance：本文档覆盖全部五条，而不是只覆盖 `check-bundle.mjs` 已经在追踪的那 5 类（下文「结论 6」会指出这是一个真实缺口）。

## 调研结论

### 结论 1（核心机制，决定性）：203 个债务源里，除 1 个例外，全部通过同一条硬编码链路进入 bundle

**实测**：`node scripts/plain/check-bundle.mjs --print` 在当前工作树上重新计算得到与 `docs/bundle-baseline.json` 逐字段一致的结果（`sourceCount:2208`、`debtSourceCount:203`、`categoryCounts` 与 `debtSourceSha256` 全部相符），确认基线未漂移、可以在此基础上做真实源码分析。

把 203 条 debt source 按包前缀分组（对 `dist/**/*.js.map` 的 `sources` 字段做与 `check-bundle.mjs` 相同的归一化后统计）：

| 来源包                                                          | 文件数 | 占比  |
| --------------------------------------------------------------- | ------ | ----- |
| `@codingame/monaco-vscode-api`（基础包自身的 `vscode/src/...`） | 190    | 93.6% |
| `@codingame/monaco-vscode-extensions-service-override`          | 13     | 6.4%  |

即：`chatAgent`（121）、`mcp`（16）、`authAccount`（11）、`syncEditSessions`（8）全部 100% 来自 `@codingame/monaco-vscode-api` 基础包；`extensionRuntime`（47）里 34 个来自基础包、13 个来自 `extensions-service-override`。**没有任何一条来自 Plain 自己 `package.json` 里显式依赖的其余 13 个 override 包**（`configuration`/`dialogs`/`explorer`/`files`/`model`/`multi-diff-editor`/`notifications`/`scm`/`search`/`textmate`/`theme(-defaults)`/`workbench`/`working-copy`）。

**实测根因**：`@codingame/monaco-vscode-api` 的 `package.json` `main`/`exports["."]` 都指向 `services.js`，其第 3 行是：

```js
import "./missing-services.js";
```

`missing-services.js`（9127 行）是该包自己的「兜底」文件——它顶部一次性 `import` 了几乎整棵 `vscode/src/vs/**` 树里「没有被任何已安装 override 包实现」的服务接口，并对每一个都 `registerSingleton(IFoo, FooNullOrDefaultImpl, ...)` 注册一个 Null/默认实现，目的是让「哪怕你什么 override 包都不装」这套 API 也能跑起来。这个文件本身**不区分**「这是 Plain 想要的无害兜底（如 `IHoverService`/`IUndoRedoService`/`IUriIdentityService`/`IKeyboardLayoutService`）」还是「这是 Plain 明确要移除的功能面（`IChatService`/`IMcpGalleryService`/`IUserDataSyncService`/`IAuthenticationService`）」——两者被同一份文件、同一种机制、无条件混在一起注册。

`services.js` 同时还硬编码了 `initialize()` 函数本身（`app/main.ts` 唯一使用的引导入口）：

```js
async function initialize(overrides, container = document.body, configuration = {}, env) {
    ...
    const instantiationService = StandaloneServices.initialize({
        [IProductService.toString()]: productService,
        ...getServiceOverride$6(),   // layout-service-override
        ...getServiceOverride$5(),   // environment-service-override
        ...getServiceOverride$4(),   // extensions-service-override  ← 关键
        ...getServiceOverride$3(),   // files-service-override
        ...getServiceOverride$2(),   // quickaccess-service-override
        ...getServiceOverride$1(),   // host-service-override
        ...getServiceOverride(),     // base-service-override
        ...overrides                 // Plain 自己的 createServiceOverrides()
    });
    ...
}
```

七个 `getServiceOverride$N()` 全部来自 `@codingame/monaco-vscode-api` 自己的 `package.json` `dependencies`（不是 Plain 的 `package.json`），其中 `extensions-service-override` **不是可选项**——它是 api 基础包自身的强制依赖，`app/` 从未显式 `import` 它，但只要调用 `initialize()` 就会被自动展开进服务表。这与 `AGENTS.md` 「不得由 `app/` 直接导入该 service override」的表述形成一个需要澄清的落差（见「结论 4」）：`app/` 确实没有直接 import，但 api 包自己的 `initialize()` 门面替 `app/` 做了这件事。

**关键的好消息（实测确认，决定了移除路径的可行性）**：`services.js`（对应 `"@codingame/monaco-vscode-api"` 裸包名或 `"@codingame/monaco-vscode-api/services"` 子路径）在整个 `app/` 里只被**一个文件**使用——

```
$ grep -rl 'from "@codingame/monaco-vscode-api"' app
app/main.ts
```

且 `getService`/`withReadyServices`/`createInstance`/`initialize` 四个 `services.js` 导出的调用点也全部集中在 `app/main.ts`（12 处，全部是 `getService(...)`）。`@codingame/monaco-vscode-api` 的其余子路径入口——`/monaco`（`monaco.js`）、`/workbench`（`workbench.js`）、`/lifecycle`（`lifecycle.js`）、`/css`（`css.js`）、`/vscode/*`（原始逐文件）——**均不** `import './missing-services.js'`（已逐一读取确认），且 `services.js` 自己的 `initialize()`/`registerCommands()`/`getService()` 内部实现本身都很薄（`registerCommands` 只在 `configuration.commands` 非空时才注册用户自定义命令，Plain 当前未传该字段，是 no-op；`getService`/`createInstance`/`withReadyServices` 只是 `await waitServicesReady()` 后代理到 `StandaloneServices.get()`），逐条读取过均可在 `app/` 内平价重写，不依赖 `services.js` 本身的黑盒逻辑。

这意味着「彻底不再触碰 `services.js`/`missing-services.js`」在技术上是可能的，但代价是必须自己重新提供 `missing-services.js` 目前兜底的**全部**其余合法服务（`IHoverService`/`IUndoRedoService`/`IUriIdentityService`/`IKeyboardLayoutService`/`ILanguageDetectionService`/`IDiagnosticsService`/`IPolicyService`/`ISignService`/`IEncryptionService`/`ITunnelService`/`IUpdateService`/`IWebContentExtractorService`/`IWorkspaceTrustRequestService`/`ICanonicalUriService`/`IRemoteAuthorityResolverService`/`IAccessibleViewService`/`IActionWidgetService`/`ICodeLensCache`/`IOutlineModelService`/`IMarkerNavigationService`/`ISymbolNavigationService`/`IInlayHintsCache`/`IPeekViewService`/`ISuggestMemoryService`/`ITreeSitterLibraryService`/`ITreeSitterThemeService`/`ISemanticTokensStylingService`/`ILanguageFeatureDebounceService`/`IInlineCompletionsService`/`IDiffProviderFactoryService`/`ILanguageConfigurationService` 等——粗略数了一下 `missing-services.js` 顶部 import 列表，共约 80+ 个服务令牌），任何一个漏掉都会在某个尚未测试到的路径上炸出「service not registered」的运行期错误，而不是编译期错误。**本文档不推荐这条路**（见「决策 1」），但它在技术上是可达的，值得记录以说明为何选择 patch 路线而非重写路线。

### 结论 2：五类各自的来源证据、既有神经阻断先例与「删了谁会炸」

#### `chatAgent`（121）、`mcp`（16）、`syncEditSessions`（8）

**实测**：三类合计 145 个文件**全部**位于 `@codingame/monaco-vscode-api/vscode/src/vs/{platform,workbench}/**`，路径样例：`workbench/contrib/chat/common/tools/languageModelToolsService.js`、`platform/mcp/common/mcpManagement.service.js`、`platform/userDataSync/common/userDataSync.js`。全部可在 `missing-services.js` 的 import 列表里找到对应引用（逐一 grep 确认，如 `chatEditingService.service.js`、`mcpGalleryManifest.service.js`、`userDataSyncAccount.service.js` 等）。

**排查「删了谁会炸」**：对 Plain 实际依赖的其余 13 个 override 包（`configuration`/`dialogs`/`explorer`/`files`/`model`/`multi-diff-editor`/`notifications`/`scm`/`search`/`textmate`/`theme(-defaults)`/`workbench`/`working-copy`）的已安装 `.js` 文件做全文 `grep -rlEi "/(chat|inlineChat|agentHost|mcp|authentication|accounts?|userDataSync|editSessions)/"`：

- 12 个包命中 0。
- 唯一命中：`scm-service-override` 的 `browser/scm.contribution.js`、`browser/quickDiffModel.js`、`browser/scmInput.js`——这正是 `app/services.ts` 模块注释里已经记录、F080 S2 就发现过的 `IChatEditingService` 硬依赖。**实测确认**这三个文件确实**不在**当前真实 `dist/` 的 source map 里（Plain 只 `import` 了 `scm-service-override` 的 `common/scmService.js` 精确子模块，而非其聚合 `index.js`/`browser/scm.contribution.js`），证明 `app/services.ts` 注释里「审计过、不会消费该文件」的说法与真实构建产物相符，不是过时的自我描述。

**结论**：这三类没有任何一个 Plain 当前依赖的 override 包在运行时真的需要它们；可以视为「纯粹的 missing-services.js 兜底噪音」，删除 `missing-services.js` 里对应的 import + class 定义 + `registerSingleton` 三段式，理论上应该能让这 145 个文件的 debt 计数精确归零，**且不会波及任何 Plain 当前依赖的服务**——但下面这条必须实测才能定论，不能只凭静态 grep：这 145 个文件里有一部分不是「服务令牌/空实现」，而是被空实现内部引用的「纯逻辑」子模块（例如 `promptFileParser.js`、`hookCompatibility.js`、`chatWidgetHistoryService.service.js` 等），需要逐一确认它们是否只被 chat 相关的空实现引用、还是被其他非 chat 逻辑意外复用（本次调研未发现任何证据表明后者成立，但样本量 145 没有逐一穷举到函数体级别，标注为待实施时用「删除后重新构建，diff debt 列表」的方式做真实回归确认，而不是静态假设）。

#### `authAccount`（11）

**实测**：10 个位于 `workbench/services/authentication/**`（纯 `missing-services.js` 兜底，与上面同构）；1 个例外——`workbench/browser/parts/globalCompositeBar.js`——路径完全不在 `authentication`/`accounts` 目录下,`check-bundle.mjs` 为它专门写了一条独立的文件名正则 `/(?:defaultAccount|globalCompositeBar)\.js$/i`。

**这个例外非常关键，值得单独说明**：`globalCompositeBar.js` 不是 `missing-services.js` 的兜底桩件，而是**真实 Workbench 布局的一部分**——`grep` 确认它被 `workbench/browser/parts/activitybar/activitybarPart.js`（真正构造 Activity Bar 的类）`import`，即它是 Activity Bar 底部「Accounts / Manage」两个复合按钮的真实实现，会随 Workbench 正常启动一起构造。

**已有的神经阻断先例（实测读取 `patches/@codingame__monaco-vscode-api@35.0.1.patch`）**：这个文件已经被现有 patch 改写过——`registerListeners()`、`toggleAccountsActivity()`、`getContextMenuActions()`、`accountsVisibilityPreference` 的 getter/setter 全部被替换成空实现或直接返回 `false`/`[]`，注释写着「Plain intentionally has no accounts surface」。也就是说：**账号相关的运行时行为早已被拔除**，用户点开这个按钮的右键菜单不会看到任何账号相关选项。但文件本身、`AccountsActivityActionViewItem`/`GlobalCompositeBar` 两个类、以及它们仍然导出的「Manage」（齿轮图标）逻辑**原样保留并仍被真实 import**，所以它仍然计入 debt。

**删了谁会炸 / 能否清零**：`check-bundle.mjs` 的分类是**按文件路径/文件名**，不是按文件内容——即使把 `AccountsActivityActionViewItem` 相关代码从 `globalCompositeBar.js` 里整段物理删除、只留下「Manage」齿轮菜单需要的部分，这个文件依旧会因为**文件名**匹配 `/globalCompositeBar\.js$/` 而继续计入 `authAccount` 债务。要让这一条真正归零，只有两条路：(a) 如果 Plain 决定连「Manage」齿轮图标本身也不需要（需要产品所有者确认，见「决策点」），可以再 patch `activitybarPart.js` 让它完全不 `import` `globalCompositeBar.js`，物理删除这个文件的引用；(b) 如果「Manage」齿轮图标要保留（打开设置、命令面板等入口都挂在它上面，这是一个用户可见的合法功能面，不是账号功能），那么合理的做法不是硬删这个文件，而是把「Manage」这部分逻辑整段搬到 `app/` 下 Plain 自己的一个新文件里（连带修改 `activitybarPart.js` 改为 import 这个新文件），从而让残留代码脱离 `check-bundle.mjs` 现有的路径匹配范围——这比其余四类的删除工作量都大，需要真正理解 `activitybarPart.js` 如何消费 `GlobalCompositeBar` 的构造参数与生命周期,不是一次简单的 patch 删减。**这一条大概率无法在「不改变现有 UI 功能」的前提下降到 0，需要产品所有者拍板选哪条路**（见「决策点 2」）。

#### `extensionRuntime`（47 = 34 基础包 + 13 override 包）

**这是五类里最复杂、也是本次调研投入实测最多的一类。**

**13 个 `extensions-service-override` 文件**：这些不是「不可达的兜底桩件」，而是**真实、被实例化、被 DI 容器持有的活对象**。`services.js` 的 `initialize()` 硬编码展开 `getServiceOverride$4()`（`extensions-service-override` 的默认导出），其函数体（实测读取 `index.js` 第 126-131 行）：

```js
function getServiceOverride() {
    return {
        [IExtensionService.toString()]: new SyncDescriptor(ExtensionServiceOverride, [false], false),
        ...
    };
}
```

`ExtensionServiceOverride extends ExtensionService`（`vscode/src/vs/workbench/services/extensions/browser/extensionService.js`，真实的浏览器扩展服务实现，本身也是 47 个债务文件之一）——即 `IExtensionService` 在 Plain 运行时绑定的**不是** `missing-services.js` 里的 `NullExtensionService`，而是这个真实类，只是构造参数 `enableWorkerExtensionHost=false`。这与 `AGENTS.md` 「禁止...`enableWorkerExtensionHost: true`」的措辞恰好对应——当前配置是 `false`，因此合规，但也说明「真实扩展服务类」而非「空实现」才是 Plain 当前实际运行时绑定的对象，只是被参数关掉了宿主创建。

**已有的深度神经阻断先例（实测读取 `patches/@codingame__monaco-vscode-extensions-service-override@35.0.1.patch`，430 行）**：这个包已经被大幅剥离过——

- 60+ 个 `mainThread*.js`（`mainThreadChatAgents2.js`/`mainThreadMcp.js`/`mainThreadAuthentication.js`/`mainThreadNotebook.js`/`mainThreadTask.js`/`mainThreadTesting.js` 等——即扩展宿主 RPC 协议的全部命令处理器）已被整批删除 import。
- `WebWorkerExtensionHost`、`RemoteExtensionHost`、`localExtensionHost` 机制、iframe 资源注册（`registerAssets`）、`BrowserExtensionHostFactory`/`BrowserExtensionHostKindPicker` 的真实实现已被替换为恒定返回 `null` 的 `DisabledExtensionHostFactory`/`DisabledExtensionHostKindPicker`。
- `ExtensionBisectService`/`ExtensionBisectUi`、`MeasureExtHostLatencyAction`、web 扩展安装引导 UI 已用 `PLAIN_EXTENSION_HOST_DISABLED = true` 常量整体短路。
- `getServiceOverride()` 不再注册 `IExtensionBisectService`。

即：**任何形式的宿主（本地/worker/remote/iframe）在当前代码里都已经不可能被创建**——这已经比「运行时 guard 拦截」更进一步，是真正的行为级删除。但文件本身（`extensionService.js`、`abstractExtensionService.js`、`extensionHostManager.js`、`rpcProtocol.js`、`proxyIdentifier.js`、`lazyPromise.js`、`extensionRunningLocationTracker.js`、`extensionsProposedApi.js`、`extensionsUtil.js`、`extensionDevOptions.js`、`webExtensionsScannerService.js`、`webWorkerFileSystemProvider.js`、`extensionHostKind.js`）仍然被 import、仍然构成一个「能创建 0 个宿主的、但结构完整的 RPC/生命周期管理框架」，因此仍计入 debt。

**34 个基础包文件**：`grep` 确认其中 `extensions.js`（`NullExtensionService` 定义处）、`extensions.service.js`（`IExtensionService` 令牌）等确实由 `missing-services.js` 直接 import；其余多数（`extensionManagement.service.js`、`extensionsScannerService.service.js`、`extensionGalleryManifest.service.js` 等）是这些文件的传递依赖或同一批服务令牌家族。

**能否清零 / 删了谁会炸**：

1. 若 patch `services.js` 删除 `import getServiceOverride$4 ...` 这一行及其在 `initialize()` 里的展开（同一份已经在改的文件，增量成本低），13 个 `extensions-service-override` 文件应能整体归零——前提是 Plain 自己在 `createServiceOverrides()`（`app/services.ts`）里提供一个新的、Plain 自建的 `IExtensionService` 空实现（否则 `IExtensionService` 完全无绑定，任何 `accessor.get(IExtensionService)` 都会在 DI 解析时报错——`globalCompositeBar.js`/`GlobalCompositeBar` 构造函数本身就有 `__param(6, IExtensionService)`，是一个已知的真实消费点）。
2. Plain 自建的空实现应该落在 `app/` 下（而不是继续用 `missing-services.js` 里那个已经存在的 `NullExtensionService`），因为 `NullExtensionService` 的定义文件 `extensions.js` 与令牌文件 `extensions.service.js` 本身仍会被匹配进 `extensionRuntime` 正则（`/extensions(?:\/|[A-Z])/i` 匹配路径里出现的 `extensions/` 目录，与文件内容是否「干净」无关）——**这是与 `authAccount`/`globalCompositeBar.js` 完全同构的分类器局限**：只要继续从 `@codingame/monaco-vscode-api/vscode/vs/.../extensions/...` 这条路径 import 任何东西（哪怕是 100% 无害的空实现),就永远会被计入 debt。要把这两个「令牌 + 空实现」文件也清零，必须让 `app/` 自己声明 `IExtensionService` 令牌（意味着 Plain 需要自己维护一份轻量的 DI token,不能继续复用上游的 `extensions.service.js` 导出),这是一次比其余四类都更深的架构改动,而不是一次 patch 删减。
3. 因此本文档判断：`extensionRuntime` **大概率无法精确降到 0**，比较现实的目标是「降到一个很小的、有明确理由的 floor（本文档预测 2-6 个文件，需要实施阶段用真实构建验证，不在此编造精确数字)」，除非追加决策点 3 所述的「自建 DI 令牌」这一更大改动。这是本文档最不确定、最需要实施阶段真实验证的一个数字。

### 结论 3：Electron/Node 遗留源码树（acceptance 第 1 条）——与其余四条性质完全不同，风险低得多

`ADR 0001` 已经写明：「当前 Code OSS 源码只在迁移期作为行为、静态资源和测试基线，最终删除。」`AGENTS.md`「目标架构地图」一节同样明确：`src/vs`、`extensions/` 等旧树「只作为行为/资产/测试参考，最终必须退役」。

**实测**：

```
src:        8957 个已跟踪文件
extensions: 6477
build:       381
test:        196
cli:          83
remote:        6
```

合计约 16,100 个文件（与 `progress.md`「约 16,555 个跟踪文件」的口径大体一致，差异来自统计口径，不影响结论）。另有顶层遗留文件：`.vscode-test.js`、`gulpfile.mjs`、`cglicenses.json`、`cgmanifest.json`、`ThirdPartyNotices.txt`、`scripts/generate-definitelytyped.sh`。

**实测确认这棵树已完全不在 Plain 真实构建路径内**：

- `tsconfig.json` 的 `exclude` 显式列出 `build`/`cli`/`extensions`/`remote`/`src`/`test`/`tests`/`src-tauri`——只 `include` `app/**/*.ts`。
- `vite.config.ts` 的 `root: "app"`——`vite build` 从 `app/` 开始解析,从未涉足这棵旧树。
- `src-tauri/Cargo.toml`/`cargo` 工作区与这棵树无关（纯 TS/Electron 遗产,不含 Rust）。
- 唯一引用这棵树路径的脚本是 `scripts/generate-definitelytyped.sh`（生成 `vscode.d.ts` 的历史工具脚本），未被任何 `package.json` script、`.github/workflows/plain-ci.yml` 或文档流程调用——是死代码。
- `.github/workflows/plain-ci.yml`、`docs/testing.md`、`CONTRIBUTING.md` 均未引用这棵树的路径。

**结论**：这条 acceptance 本质上是一次纯粹的仓库卫生删除（`git rm -r`），**不涉及运行时行为、不涉及 bundle 分析、风险级别远低于其余四条**，可以独立于 `missing-services.js` 手术并行/优先执行。唯一需要留意的边界：`cglicenses.json`/`cgmanifest.json`/`ThirdPartyNotices.txt` 描述的是**旧 Code OSS/Electron 的第三方依赖**,删除旧树后这三个文件立即变得与「Plain 实际打包了什么」不符——但它们的重新生成属于 `F120`「Third-party notices and SBOM match shipped code and assets」的范围,不是 F110 应该顺手做的事,本文档建议 F110 只删除旧源码树本身,把这三个 notice/manifest 文件的处理方式（清空 vs 保留占位 vs 立即按 Plain 真实依赖重写）留给 F120 拍板（见「决策点 6」),避免 F110 承担不属于自己 acceptance 的工作。

### 结论 4：`AGENTS.md` 现有措辞与实测行为之间的一处落差，需要在 F110 完成时一并修正

`AGENTS.md` 第 71-73 行写道：「`@codingame/monaco-vscode-api` 会传递依赖 extensions service；只允许把它当作惰性的静态 contribution registry，不得由 `app/` 直接导入该 service override」。**实测确认** `app/` 确实从未 `import` `@codingame/monaco-vscode-extensions-service-override`——但 `services.js` 的 `initialize()` 会替 `app/` 间接完成这件事（结论 1、结论 2 已详述），运行时绑定的 `IExtensionService` 实现是真实的 `ExtensionServiceOverride`（`enableWorkerExtensionHost=false`），并非纯粹「惰性 registry」。这不是本次调研发现的一个 bug——现有 `enforceExcludedWorkbenchSurfaces()` 运行时 guard 和已有的深度 patch（结论 2）已经确保它实际不可能创建任何宿主——但 `AGENTS.md` 的措辞把「不直接导入」等同于「不会被引入」，实测证明这个等价关系不成立。F110 完成后（即结论 2 第 1/2 点的手术落地、`app/` 自己拥有 `IExtensionService` 的空实现），这句话才会变成字面真实；在此之前，本文档建议措辞更新为准确描述现状（`app/` 不直接导入，但 api 包自身的 `initialize()` 门面目前仍会展开真实实现，其宿主创建能力已通过既有 patch 完全禁用）。这项措辞修正本身不是代码变更，留给 F110 收口时一并处理。

### 结论 5：`pnpm patch` 不是一个新引入的、需要评估「是否值得」的手段——它已经是本仓库的既定做法

`pnpm-workspace.yaml` 的 `patchedDependencies` 当前已对 9 个包生效，其中就包括 `@codingame/monaco-vscode-api`（1889 行 diff）与 `@codingame/monaco-vscode-extensions-service-override`（430 行 diff）——恰好是本次调研定位到的两个关键文件（`services.js`/`missing-services.js` 与 `extensions-service-override/index.js`）已经在被打补丁的包之列。也就是说，F110 需要做的不是「决定要不要开始用 pnpm patch」，而是「在已经存在的 `@codingame/monaco-vscode-api@35.0.1.patch` 和 `@codingame/monaco-vscode-extensions-service-override@35.0.1.patch` 里追加更多 hunk」——增量成本，而非新增一整套机制的成本。

同时也确认了现有守卫已经把 patch 的完整性锁到了字节级别：`scripts/plain/workbench-patch-contracts.mjs` 为每一个 `patches/*.patch` 文件存了一份精确 `sha256`（例如 api 包当前是 `184ceed9...`），`scripts/plain/check-boundaries.mjs` 的 `requiredPatches` 额外要求每个 patch 文件包含一个特定「安全标记字符串」（例如 api 包要求包含 `"Plain intentionally has no accounts surface"`，`extensions-service-override` 要求包含 `"DisabledExtensionHostFactory"`）。**这意味着 F110 每对这两个文件追加一次 hunk，都必须同步更新 `workbench-patch-contracts.mjs` 里对应的 `sha256`**（否则 `pnpm check` 会因为 patch 内容漂移而失败）——这是已知机制的正常使用方式，不是新增复杂度，但必须在切片规划里显式列为一步，否则会在实施时被当成「测试莫名其妙红了」而困惑（历史上 F080/F090 已经踩过「不理解某个既有契约为何失败」的坑，见两份文档的教训条目）。

`monaco-vscode-api` 升级成本方面：由于现有 `services.js`/`missing-services.js` 补丁本身已经相当大（1889 行），未来升级 `@codingame/monaco-vscode-api` 版本时，这份 diff 需要人工 rebase 到新版本的文件结构上——这个成本在 F110 之前就已经存在（现有 patch 已经很大），F110 只是让这份成本进一步增加（新增几十到上百行 hunk），而不是从零引入。本文档认为这个边际成本可接受，但升级节奏本身（是否/何时升级 `monaco-vscode-api`）不是 F110 范围内的决策。

### 结论 6（真实缺口，此前未被记录）：`check-bundle.mjs` 的 5 个 category 没有覆盖 acceptance 第 5 条

**实测**：对真实 `dist/` 的完整 source 列表（不限定于已归类的 203 条debt，而是全部 2208 条 source）额外做 `notebook`/`tasks`/`testing`/`remote`/`languagePacks`/`languageDetection`/`treeSitter` 关键词匹配：

| 关键词              | 命中数 | 样例                                                   |
| ------------------- | ------ | ------------------------------------------------------ |
| `/notebook`         | 23     | —                                                      |
| `/tasks/`、`/task/` | 1      | `platform/tasks/common/taskService.service.js`         |
| `/testing/`         | 9      | `contrib/testing/common/testService.service.js` 等     |
| `/remote/`          | 10     | `platform/remote/common/remoteAuthorityResolver.js` 等 |
| `languagePacks`     | 2      | —                                                      |
| `languageDetection` | 2      | —                                                      |
| `treeSitter`        | 8      | —                                                      |

以上合计约 55 个文件，**全部路径前缀同样是 `@codingame/monaco-vscode-api/vscode/src/...`**（即同样通过 `missing-services.js` 进入 bundle，与结论 1 的机制完全一致），**但没有一个被 `docs/bundle-baseline.json` 的 5 个 `categoryCounts` 追踪**——它们既不在 203 的统计里，也没有独立的分类。

这与运行时 guard（`app/excluded-surface-policy.ts`）形成一个不对称：`excludedIdPatterns` 数组实际有 **6** 个类别（`"AI, Chat, Agent or MCP"`、`"authentication or accounts"`、`"settings sync or edit sessions"`、`"extensions, gallery or marketplace"`、`"remote development or tunnels"`、`"notebooks, tasks or testing"`），也就是说**运行时层面 Plain 已经在防「remote / notebook / tasks / testing」被真的注册成命令/视图/contribution**，但 bundle 债务计数层面完全没有对应条目——F110 acceptance 第 5 条（"Language environments, remote, notebook, tasks and testing are removed"）现状是「运行时挡住了，bundle 里还在，且没有被计入任何已知基线」，是三层里最薄弱的一层。

「language environments」的确切含义本文档判断对应 `docs/product-scope.md` 第 69 行「语言服务器、LSP、IntelliSense...编译器、SDK、包管理器、任务和测试运行器」——`@codingame/monaco-vscode-languages-service-override` 已经被 `check-boundaries.mjs` 的 `forbiddenLockPackages` 显式禁止且实测确认从未出现在 `pnpm-lock.yaml` 里（真正的 0），但 `languagePacks`（i18n 语言包下载，2 个文件）、`languageDetection`（自动语言检测，2 个文件）、`treeSitter`（语义高亮的替代技术路径，Plain 用静态 TextMate、不用 tree-sitter，8 个文件）是否也应该算进「language environments」需要产品所有者澄清（见「决策点 4」）。本文档的建议是：既然它们同样是 `missing-services.js` 兜底、同样可以用结论 1/2 的手法清理，不妨一并纳入新增的 category，成本增量很小。

## 主导会话裁定（六个决策点已全部拍板，实施方按此执行，不要再当作开放选项）

文末「需要拍板的决策点」一节列出的六处，已由主导会话逐条裁定如下。**下文正文保留原有推荐与论证以说明理由，结论以本节为准。**

**先说三条已由主导会话亲自复核的承重事实**（本节全部裁定建立在其上）：① `node_modules/@codingame/monaco-vscode-api/services.js` 确实无条件 `import './missing-services.js'`；② `app/main.ts` 是 `app/` 下**唯一**接触该 façade 的文件；③ 仓库 `patches/` 下**已有 9 个** `@codingame__*.patch`——patch 在本项目是**早已确立的既有机制**，不是本 feature 新引入的做法。

1. **走 patch 手术，不推翻 `services.js` façade。** 理由：façade 一次性注册 80+ 服务，自建替代等于把 F010–F100 全部建立在其上的装配重做一遍，风险与收益完全不成比例；而 patch 的两大代价在本项目其实都已被摊薄——依赖精确 pin 在 `35.0.1`（升级是**受控的、刻意的事件**而非持续摩擦），且已有 9 个同类 patch 在维护。**但追加一条硬性要求**：每个新 patch 必须配一条契约，在上游文件形状发生 patch 所假设之外的变化时**让构建失败**。否则一次版本升级会让 patch 静默失效、debt 悄悄涨回来而门依然全绿——这正是本项目已经吃过三次亏的"绿门掩盖失效"模式。

2. **`globalCompositeBar.js`：迁进 `app/`，不砍掉 Manage 齿轮。** 该文件是真实存在、已被既有 patch 行为性阉割的 Activity Bar 代码，分类器是**按文件名**而非内容命中它的。账号行为既已剥离，为满足一条文件名正则而删掉一个真实可用的设置入口，是在优化指标而不是优化目标。迁进 `app/` 后代码归我们所有、可审计，分类器也不再误伤。

3. **`extensionRuntime` 不要求归零，接受一个诚实的地板值。** 强行归零需要替换 `IExtensionService` 的 DI token，而几乎每个视图/服务都注入它，破坏整个 workbench 的风险很高，**收益却是零**——本产品没有扩展，该服务本就是被阉割的桩件。**但接受地板值有两个前提**：(a) evidence 必须**逐文件枚举**剩余项并说明各自为何不能去掉，不许只给一个总数；(b) 每个剩余文件必须有测试证明它**行为上确实是惰性的**（RPC handler / worker host / remote host 真的无法激活任何东西），而不是仅仅"我们打了 patch"。

4. **补齐缺失的 6 个 category：做，而且必须作为独立且靠前的切片先做完。** 调研发现 `check-bundle.mjs` 现有 5 类**完全没覆盖 acceptance #5**，另有约 55 个源（notebook 23 / testing 9 / remote 10 / tasks 1 / languagePacks·languageDetection·treeSitter 约 12）根本不在任何基线里。**必须先把基线补诚实，再开始动数字**——否则就是在 55 个未被追踪的源旁边把 203 降下去，属于粉饰指标。`languagePacks`/`languageDetection`/`treeSitter` 一并纳入（本产品用静态 TextMate、不用 tree-sitter，且清理手法与其余同源，成本增量很小）。

5. **`bundle-baseline.json` 最终形态：改为「棘轮」而非固定值。** 每个 category 记录一个**上界**，构建在任何 category **上升**时失败，下降则无需改基线即可通过。这比锁死一个精确数字更强：它既允许后续切片继续真实减少而不必每次编辑基线，又杜绝回涨。同时保留一份**显式枚举的地板清单**（第 3 条要求的逐文件说明），使"还剩什么、为什么"始终可读。

6. **`cgmanifest.json` / `cglicenses.json` / `ThirdPartyNotices.txt` 归 F120，不在 F110 做。** 但 F110 **必须产出一份事实性的删除清单**（实际移除了哪些第三方代码）作为 F120 的输入——F110 改变的是"实际发布了什么"，而这决定了"必须署名什么"，两者不能脱节。

## 技术方案

### 决策 1：移除路径选型——patch 手术 vs 抛弃 `services.js` 门面自建 bootstrap

**结论 1 已经给出了两条候选路径的证据**：

|                        | Patch `missing-services.js` + `services.js`（推荐）                                                       | 抛弃 `services.js`，改用 `/monaco`、`/workbench`、`/lifecycle` 等窄入口自建 bootstrap                                                                                                             |
| ---------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 影响面                 | 集中在已经被 patch 过的 2 个文件里追加 hunk                                                               | 需要重写 `app/main.ts` 的 `initialize`/`getService` 调用点（12 处，集中在 1 个文件，改造本身不大）                                                                                                |
| 遗留风险               | 低——只删除已确认无害的 debt 类别注册，其余 80+ 个合法兜底服务原样保留                                     | 高——必须手工重新提供 `missing-services.js` 目前兜底的**全部**其余合法服务，任一遗漏都是运行期而非编译期错误，且没有一份「这些服务的完整清单」文档，只能靠一次次真实运行时报错来发现，属于长尾风险 |
| 与既有基础设施的一致性 | 与已经存在的 9 个 patch、`workbench-patch-contracts.mjs` 的 sha256 锁完全同构，是「追加」而非「新增机制」 | 需要新建一套「Plain 自己的 bootstrap 契约」，且 `services.js` 未来升级时的 diff 经验完全作废                                                                                                      |
| 升级成本               | 现有 diff 已经很大，边际增量可控                                                                          | 每次升级都要重新核对「窄入口有没有偷偷变成也 import missing-services.js」，且要重新核对「兜底服务清单」有没有变化                                                                                 |

**推荐**：继续走 patch 路线,在已存在的 `patches/@codingame__monaco-vscode-api@35.0.1.patch` 里追加 hunk,删除 `missing-services.js` 里 `chatAgent`/`mcp`/`authAccount`/`syncEditSessions`（以及若决策点 4 通过,`notebook`/`tasks`/`testing`/`remote`/`languagePacks`/`languageDetection`）对应的 `import`/`class`/`registerSingleton` 三段式,同时删除 `services.js` `initialize()` 里 `getServiceOverride$4()`（`extensions-service-override`）这一行注册,并在 `app/services.ts` 的 `createServiceOverrides()` 里补一个 Plain 自建的 `IExtensionService` 空实现。**不推荐**抛弃 `services.js` 门面自建 bootstrap——它在技术上可行,但结论 1 已经指出的「80+ 个非债务服务必须逐一手工核实」这项长尾风险,在没有强烈理由（例如 patch 路线被证明走不通）之前不值得承担。

### 决策 2：五类的具体处理与验收标准

| 类别               | 当前数 | 处理手段                                                                                                                                                                     | 预期结果                                                                                | 确定性                                                                                                                                                                              |
| ------------------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mcp`              | 16     | 删除 `missing-services.js` 里 mcp 相关三段式                                                                                                                                 | 0                                                                                       | 高——已确认无任何 override 包依赖                                                                                                                                                    |
| `syncEditSessions` | 8      | 同上                                                                                                                                                                         | 0                                                                                       | 高——同上                                                                                                                                                                            |
| `chatAgent`        | 121    | 同上（体量最大但同质）                                                                                                                                                       | 0                                                                                       | 中高——已确认 12/13 个 override 包干净,`scm-service-override` 里唯一相关的文件已确认不在 bundle 里；但 121 个文件未逐一做到函数体级别核实,标注为「预期 0，需实施时真实构建回归确认」 |
| `authAccount`      | 11     | 10 个（`authentication/**`）同上处理；`globalCompositeBar.js` 需要决策点 2                                                                                                   | 10 → 0；`globalCompositeBar.js` 视决策点 2 结果决定 0 或 1                              | 高（10 个）/ 需拍板（1 个）                                                                                                                                                         |
| `extensionRuntime` | 47     | patch `services.js` 去掉 `getServiceOverride$4`（去掉 13 个）+ patch `missing-services.js` 里 extension 相关注册（去掉大部分 34 个）+ `app/` 自建 `IExtensionService` 空实现 | 预期降到个位数 floor（本文档不编造精确数字，需要实施时真实验证）；精确到 0 需要决策点 3 | 低——本类是全篇最不确定的一类                                                                                                                                                        |

### 决策 3：`extensionRuntime` 的 `IExtensionService` 替身设计

`app/services.ts` 的 `createServiceOverrides()` 需要新增一项：

```ts
[IExtensionService.toString()]: new SyncDescriptor(PlainNullExtensionService, [], true),
```

`PlainNullExtensionService` 应该是 Plain 自己在 `app/services/` 下新写的一个类,实现 `IExtensionService` 接口的最小面（`whenInstalledExtensionsRegistered()` resolve 一个空快照、`activateByEvent()` no-op、`getExtensions()` 返回空数组等——F090 调研已经验证过 `NullExtensionService.activateByEvent` 恒为 no-op 是安全的既定行为,这里只是把「谁提供这个空实现」从 vendor 挪到 Plain 自己）。

**这里天然带出决策点 3**：`IExtensionService` 这个 DI 令牌本身（`extensions.service.js`）目前是从 `@codingame/monaco-vscode-api/vscode/vs/workbench/services/extensions/common/extensions.service` import 的——只要继续复用这个 vendor 令牌,`extensions.service.js` 这个文件路径永远会被 `extensionRuntime` 正则匹配,归零不可能达成。要做到真正的 0,必须让 `app/` 自己声明一份新的 `IExtensionService` 等价令牌（例如 `createDecorator<IPlainExtensionService>("plainExtensionService")`),但这意味着**所有**仍然通过 DI 注入 `IExtensionService` 的既有 vendor 代码（`globalCompositeBar.js` 等）都需要改注入 Plain 自己的令牌——而这些 vendor 代码本身不受 Plain 控制,只能继续 patch。这是一次比其余四类都深的架构改动,本文档判断性价比存疑（结论 2 已给出理由）,建议**接受个位数 floor,不做令牌替换**,除非产品所有者认为「extensionRuntime 必须精确为 0」是不可妥协的要求。

### 决策 4：守卫升级路径

**`scripts/plain/check-bundle.mjs`**：

1. 若决策点 4 采纳,新增 `notebook`/`tasks`/`testing`/`remote`/`languagePacks`/`languageDetection` 六个（或合并为更少个)新 category,先只做「测量,不做清零」的一次提交,让基线诚实反映 acceptance 第 5 条当前的真实状态（本文档结论 6 已给出实测的初始计数）。
2. 每类清理完成后,`docs/bundle-baseline.json` 里对应的 `categoryCounts` 数字应降到实施阶段真实确认的最终值（大多数类别预期是 0；`authAccount`/`extensionRuntime` 视决策点 2/3 的结果可能保留一个已知、有文档解释的非零 floor）。
3. `check-bundle.mjs` 已经内置的「F110 complete 时校验不再有 `missing-services.js` 残留」逻辑（第 172-183 行）应该保留,并且是 F110 收口时的最终防线之一——它不依赖具体数字,只断言「一旦 `features.json` 把 F110 标记为 complete,bundle 里就不能再有任何一个 source 路径以 `/missing-services.js` 结尾」,这比任何数字断言都更直接地回答「是否真的没有了」。
4. `debtSourceSha256` 这个字段在数字大幅变化后本身失去「逐字节防漂移」的意义（因为预期值本来就要变),F110 完成后应该考虑这个字段是否还需要保留——本文档建议保留但语义改为「锁定收口后的最终 debt 列表,防止未来又不知不觉引入新的债务源」,而不是删除整个字段。

**`scripts/plain/check-boundaries.mjs`**：

1. `requiredPatches` 里 `@codingame/monaco-vscode-api@35.0.1` 与 `@codingame/monaco-vscode-extensions-service-override@35.0.1` 两条的 `marker` 字符串,应该在追加 hunk 后新增/替换成能证明「debt 注册已被删除」的标记（例如新增一行注释 `// Plain: chat/mcp/sync/auth stub registrations removed for F110` 并把它设为新 marker）,而不是只依赖已有的 `"Plain intentionally has no accounts surface"`/`"DisabledExtensionHostFactory"`（那两个证明的是「行为已阻断」,不是「文件已物理清理」,两者在 F110 之前一直是等价的,F110 之后不再等价,需要新的标记把两件事分开断言)。
2. `forbiddenLockPackages` 已经包含 `@codingame/monaco-vscode-languages-service-override@` 等一批禁止包——建议在 F110 收口时复核一遍这份列表,确认没有遗漏任何与本次五类相关、理论上可能被误装的包名（例如 `@codingame/monaco-vscode-user-data-sync-service-override`、`@codingame/monaco-vscode-authentication-service-override` 若确实存在于 npm 上,应该加入禁止列表,即使当前没有被依赖,也值得作为「未来防误装」的一道线——本文档未逐一核实这些包名在 npm 上是否真实存在,标注为待实施时确认)。

**`scripts/plain/workbench-patch-contracts.mjs`**：每次修改 `patches/@codingame__monaco-vscode-api@35.0.1.patch`/`.../extensions-service-override@35.0.1.patch` 后,必须同步更新对应的 `sha256` 常量——这是机械步骤但极易遗漏（`pnpm check` 会失败但报错信息是「hash mismatch」,不直接提示「去改 workbench-patch-contracts.mjs」,历史上类似的「不理解为何某个既有契约失败」已经在别的 feature 里发生过,值得在切片描述里显式提醒）。

**`app/excluded-surface-policy.ts`/`app/excluded-surfaces.ts`**：F110 完成后,这层 guard 从「唯一防线」变成「纵深防御的第二层」——理论上如果 bundle 债务真的清零,这层 guard 应该永远不会触发（因为对应的 command/view/contribution 根本不存在,不只是「存在但被政策挡住」）。本文档建议**保留**这层 guard,不因为 bundle 层已经清零就删除它——原因：(a) 它捕获的是「命令/视图/贡献 id」这个运行时表面,和 bundle debt 的「source 文件是否存在」是两个独立维度,理论上可能出现「bundle 里没有对应源文件,但某个我们没预料到的注册路径又长出一个同名 id」这种未来回归；(b) `docs/e2e-handover.md` 与既有测试已经围绕它建立了回归覆盖,删除它意味着这部分测试价值归零,收益不明显但确定性地损失了一层防御纵深。

### 决策 5：Electron/Node 遗留源码树的删除步骤

结论 3 已经确认这是低风险、独立的一次仓库卫生操作：

1. `git rm -r src extensions build test cli remote`（或按 `.gitignore`/CI 需要分批提交，本文档不强制要求单次提交完成）。
2. `git rm .vscode-test.js gulpfile.mjs scripts/generate-definitelytyped.sh`。
3. `cglicenses.json`/`cgmanifest.json`/`ThirdPartyNotices.txt` 三个文件的处理方式留给决策点 6。
4. 删除后重新跑一次 `pnpm check` 全量验收（`format:check`/`typecheck`/`lint`/`test:unit`/`build:frontend`/`check:architecture`/`check:bundle`/`rust:fmt`/`rust:clippy`/`rust:test`）,确认没有任何脚本、CI 步骤、`.eslint-ignore`/`.eslint-allowed-javascript-files` 里的路径引用因为目录消失而报错（本文档已用 grep 排查过 `.github/workflows/plain-ci.yml`/`CONTRIBUTING.md`/`docs/testing.md` 无引用,但 `.eslint-ignore`/`.eslint-allowed-javascript-files` 体量很大,本次未逐行核对,标注为待实施时用真实 `pnpm check` 跑一遍确认,而非静态假设一定通过)。

## 需要新增/改造的 AST 契约与守卫清单

1. **`docs/bundle-baseline.json` 结构性改造**：从「五个固定 category、锁定 203」变成「若干 category（视决策点 4 结果可能扩到 11 个）、每个 category 锁定各自实施后的最终数字（多数应为 0）」。
2. **`scripts/plain/check-bundle.mjs` 新增 category 定义**（`notebook`/`tasks`/`testing`/`remote`/`languagePacks`/`languageDetection`,视决策点 4 的范围裁剪),复用现有 `categories` 对象的形状,不需要新的机制,只是新增正则条目。
3. **`scripts/plain/check-boundaries.mjs` `requiredPatches`** 里 api 包与 extensions-service-override 包的 `marker` 字符串更新（见「决策 4」第 1 点）。
4. **`scripts/plain/workbench-patch-contracts.mjs`** 里两个受影响包的 `sha256` 更新——每次修改对应 `.patch` 文件后必须同步做,建议作为每个切片收尾的固定步骤写进切片描述,而不是留到最后才发现。
5. **`app/services.ts` 新增 `PlainNullExtensionService`**（决策 3）,以及对应的单元测试（确认它满足 `IExtensionService` 接口的最小可用面,且不做任何真实宿主创建）。
6. **`forbiddenLockPackages`（`check-boundaries.mjs`）复核**——按决策 4 第 2 点核实是否需要新增未来可能被误装的包名。
7. **可选**：为「`missing-services.js` 不应再包含指定 debt 类别的 import」这件事本身写一条独立的静态契约（例如在 `check-bundle.mjs` 或新脚本里，对已解压/已 patch 的 `missing-services.js` 源码做正则断言，确认它不再 `import` 特定路径),作为「即使有人手滑改错 patch,也能在 `check:boundaries` 阶段就发现,而不必等到 `check:bundle` 真的跑一次完整构建」的更早防线——是否值得新增这一层,取决于团队对「多一层机制」和「多一处要维护的正则」之间的取舍,本文档不强制建议。

## 切片拆分（参考 F080/F090/F100 粒度，每片可独立验收、独立提交）

1. **S0 债务可见性扩容（纯测量,不做任何删除)**：`check-bundle.mjs` 新增决策点 4 范围内的 category 定义；`docs/bundle-baseline.json` 记录扩容后的真实初始计数（结论 6 已给出预期数字,实施时以真实构建为准）。这一步不改变任何运行时行为,只是让 acceptance 第 5 条第一次被纳入可验证的基线,风险最低,适合最先做。
2. **S1 遗留 Electron/Node 源码树删除（acceptance 第 1 条,独立于其余四条)**：`git rm` 决策 5 列出的目录与文件；`cglicenses.json`/`cgmanifest.json`/`ThirdPartyNotices.txt` 按决策点 6 处理；全量 `pnpm check` 回归。可以与 S0 并行,也可以整个 F110 期间随时插入,不依赖其余切片的完成状态。
3. **S2 `mcp` + `syncEditSessions` + `authAccount`（10/11 个,不含 `globalCompositeBar.js`）清零**：在既有 `patches/@codingame__monaco-vscode-api@35.0.1.patch` 里追加删除 `missing-services.js` 对应三段式的 hunk；更新 `workbench-patch-contracts.mjs` 的 sha256；更新 `check-bundle.mjs`/`docs/bundle-baseline.json` 对应 category 归零；真实 `pnpm build:frontend` + `check:bundle` 回归确认数字真的降了、且没有新的运行时错误（需要至少跑一次 Browser E2E,确认删除这些 stub 后 Workbench 仍能正常 bootstrap——`missing-services.js` 里这些类被删除后,如果有任何遗漏的隐藏消费点,应该会在 bootstrap 阶段就报错,而不是静默通过）。
4. **S3 `chatAgent` 清零（121 个，体量最大但手法与 S2 相同)**：同样是在既有 patch 里追加 hunk；由于体量大,建议拆成「先删除、跑一次真实构建、核对新 debt 列表与预期是否一致」这个循环,而不是一次性改完再验证——如果发现某个子模块被其他非 chat 逻辑意外引用（结论 2 已标注这是未逐一穷举确认的风险点),能更早发现、更容易定位是哪一段 hunk 引入的问题。
5. **S4 `globalCompositeBar.js` 处理（依赖决策点 2 的裁决)**：若决定保留「Manage」齿轮图标,把相关逻辑迁移到 `app/` 自建文件、patch `activitybarPart.js` 改指向新文件；若决定连「Manage」也不需要,直接 patch `activitybarPart.js` 去掉对 `globalCompositeBar.js` 的 import。这一片依赖产品所有者先拍板,建议排在 S2/S3 之后、S5 之前,给决策留出时间窗口。
6. **S5 `extensionRuntime` 深度手术（47 个,最难的一类)**：patch `services.js` 删除 `getServiceOverride$4` 展开；`app/services.ts` 新增 `PlainNullExtensionService`；patch `missing-services.js` 里 extension 相关的三段式（保留结论 2 判断需要保留的 floor 部分)；真实构建 + Browser E2E 回归,重点验证「没有任何地方还在期待一个真正的 `ExtensionService`」（例如任何 `whenInstalledExtensionsRegistered()`/`activateByEvent()` 调用点在新空实现下行为是否与旧的 `ExtensionServiceOverride`/`NullExtensionService` 一致)。
7. **S6 决策点 4 范围内的 `notebook`/`tasks`/`testing`/`remote`/`languagePacks`/`languageDetection` 清零**：手法与 S2/S3 相同（同样是 `missing-services.js` 三段式删除),体量不大（结论 6 统计约 55 个),可以合并到 S2/S3 一起做,也可以单独一片——本文档倾向单独一片,因为它是「此前完全没被追踪过」的新面,单独验收更容易在评审时看清楚这一片具体清掉了什么。
8. **S7 收口**：跨切片 evidence 闭环；`docs/bundle-baseline.json` 最终形态确认（含每个非零 floor 的书面理由）；`AGENTS.md` 第 71-73 行措辞修正（结论 4）；`docs/e2e-handover.md` 新增条目（见「验收如何证明真的没有了」）；`features.json` F110 转 `complete`（均由主导会话操作)。

## ⚠ 跨切片必读：`check-bundle.mjs` 的 category 归零不能只靠数字下降来判断成功

删除 `missing-services.js` 里的 `registerSingleton`/`class`/`import` 三段式后，**必须重新跑一次真实 `pnpm build:frontend`**，而不是假设「删了源码,debt 计数就一定按预期下降」——Rolldown/Vite 的 tree-shaking 行为取决于是否还有其他任何路径引用同一个符号；F080/F090/F100 三份文档累计记录过 18 处「凭记忆写方案后被实测推翻」的教训，本次也已经在结论 2 里标注了至少两处「未逐一穷举确认」的风险点（`chatAgent` 121 个文件里的纯逻辑子模块是否被其他非 chat 代码意外复用；`extensionRuntime` 34 个基础包文件删除后的真实 floor 数字）。**每个切片的验收标准都应该是「真实重新构建 + 真实重新跑 `check:bundle` --print + 人工核对新的 debt 列表与预期逐条相符」，而不是「patch 看起来应该对，直接改 baseline 数字」。**

## 风险与未知项清单

1. **`chatAgent`（121 个)是否存在被非 chat 逻辑意外复用的纯工具函数**——本次调研确认了「12/13 个 override 包对 chat/mcp/auth/sync 路径的引用为 0」这个包级别的结论,但没有对 121 个文件逐一做函数体级别的引用分析（体量过大,不在本次调研的合理产出比范围内),标注为**必须在 S3 实施时用「真实删除 + 真实构建 + 观察是否报错」的方式验证**,而非视为已经证明。
2. **`extensionRuntime` 清理后的真实 floor 数字未知**——本文档判断大概率不是 0,但拒绝编造一个精确数字（预测「个位数」是基于对 `missing-services.js` import 密度的粗略观察,不是逐一删除后的真实计数),**必须在 S5 实施时用真实构建得到**,如果发现的数字明显偏离预期（例如仍有二三十个),需要重新评估决策 3 里「是否值得做令牌替换」这个判断。
3. **`globalCompositeBar.js`/`activitybarPart.js` 的耦合深度未实测**——本文档只确认了「谁 import 了 globalCompositeBar.js」这一层,没有深入核实 `activitybarPart.js` 内部对 `GlobalCompositeBar` 构造参数、生命周期钩子的依赖细节,S4 实施时如果发现耦合比预期深（例如 `activitybarPart.js` 还依赖 `GlobalCompositeBar` 暴露的其他方法/事件),决策点 2 两条路径的实际工作量都可能比本文档估计的更大。
4. **`notebook`/`tasks`/`testing`/`remote`/`languagePacks`/`languageDetection`（结论 6，约 55 个)未做过与 `chatAgent`/`mcp` 同等深度的「其余 13 个 override 包是否依赖」排查**——本文档只做了存在性统计,没有重复结论 2 对 chat/mcp/sync 做过的「12/13 包 grep 为 0」这一步核实,标注为 S6 实施前必须先补做,不能想当然套用「结论应该一样」的假设。
5. **`patches/@codingame__monaco-vscode-api@35.0.1.patch` 已经是 1889 行的大 diff,继续追加 hunk 后是否会与本次要删除的代码段产生 diff context 冲突**（例如同一段代码附近既有旧 hunk 的上下文,又要插入新的删除),本次调研没有预演真正的 patch 编辑过程,只读取了现状,标注为纯实施细节风险,预期可控但未实测。
6. **`.eslint-ignore`/`.eslint-allowed-javascript-files` 两个文件体量很大（分别约 2.6KB/8.3KB),本次未逐行核实是否有对旧 Code OSS 树路径的引用**——S1 实施时如果发现有残留引用,删除对应行本身工作量很小,但需要先跑一次真实 `pnpm check` 才能发现,不能只凭静态读取判断「一定没有」。
7. **`AGENTS.md` 措辞修正（结论 4）的具体行文**未在本文档给出最终文字,只给出了修正方向,具体表述留给 F110 收口时再定,避免本文档对不属于自己产出范围的文件做过度具体的建议。

## 与 F120（品牌打包）/ F130（最终验收）的边界

- F110 只负责清理 `monaco-vscode-api` 生态自身的 bundle 债务与旧 Code OSS 源码树；`cglicenses.json`/`cgmanifest.json`/`ThirdPartyNotices.txt` 的重新生成（对齐 Plain 真实最终依赖树）属于 F120「Third-party notices and SBOM match shipped code and assets」，F110 不应该顺手改写它们的内容（见决策点 6）。
- F110 不涉及 Windows/Linux 打包、品牌（bundle id、协议、数据目录、UI 品牌）——那是 F120 的范围；F110 完成后 `docs/bundle-baseline.json`/`check-bundle.mjs` 的最终形态是 F120 打包验证的前置输入之一（F120 的 SBOM 审计理应能引用 F110 收口后的干净依赖树）。
- **F130「Browser and native end-to-end acceptance」的「No excluded product surface is reachable」这条 acceptance，在 F110 完成后含义应该增强**：F110 之前，「不可达」主要靠 `enforceExcludedWorkbenchSurfaces()` 运行时 guard 证明；F110 之后，还应该能够从「bundle 里物理不存在对应源码」的角度提供第二重证据（见下一节）。F130 的桌面 E2E 矩阵应该包含一次「F110 收口后的最终 `check:bundle` 输出」作为验收材料之一，而不是只依赖运行时 guard。
- 本文档不改动 `features.json`/`progress.md`（按纪律由主导会话操作），也未执行任何 git commit。

## 验收如何证明「真的没有了」——不能只看 `debtSourceCount` 归零

单一数字（`debtSourceCount === 0` 或降到某个 floor）容易被「巧合地凑对了」或「分类器本身有漏洞」误导（结论 6 已经证明分类器曾经有过整整一类的盲区）。本文档建议 F110 收口验收时至少包含以下几项，每项能证伪的对象不同：

1. **`check-bundle.mjs` 现有的「F110 complete ⇒ 不得再有 `/missing-services.js` 结尾的 source」断言**（已存在，见结论 5）——证伪对象：F110 声称完成，但 `missing-services.js` 这个文件本身仍在 bundle 里（说明 `services.js` 的 `import './missing-services.js'` 那一行根本没删，只是删了里面的一部分内容——两者证明力不同，这条断言专门盯住「文件本身是否还在」）。
2. **对最终 `dist/**/*.js`（而非 source map）做内容级关键字扫描**（`chat`/`copilot`/`mcp`/`userDataSync`/`editSessions`/`authentication` 等关键词在压缩后的产物字符串里的出现次数）——证伪对象：即使 source map 层面归类正确，字符串本身可能因为压缩/内联被换了个不含这些路径名但仍含相关字符串字面量的形态残留（例如某个错误消息文案里硬编码了 "chat" 这个词，与债务无关但会造成误报，需要人工甄别，不能全自动化断言为失败，但应作为人工复核的输入）。`check-bundle.mjs` 现有的 `forbiddenCommandIds`/`forbiddenDialogFileSources` 已经是这个思路的先例，应该在 F110 收口时扩展这份清单，加入 F110 新确认要移除的具体 command id（例如若发现任何 chat/mcp/sync/account 相关的 command id 字符串）。
3. **真实 Browser E2E：在页面里断言特定符号不可达**——例如在 DEV-only 诊断钩子里尝试 `await getService(IChatService)`（或等价探针）并断言它要么抛出「未注册」错误、要么整个类型在 TypeScript 编译期就已经不存在（无法 import）——证伪对象：即使 bundle 层面文件消失，如果 `app/` 里某处仍然意外持有一个可以拿到这个服务的引用，说明清理不彻底。
4. **`scripts/plain/check-boundaries.mjs` 的 `forbiddenLockPackages` 扩展检查**——证伪对象：`pnpm-lock.yaml` 是否在未来某次依赖变更中悄悄引入了本文档点名的、此前从未存在过的债务相关包（`languages-service-override`、假设存在的 `authentication-service-override`/`user-data-sync-service-override` 等）。
5. **真实桌面 Tauri E2E（复用 `docs/e2e-handover.md` 既有交接模式）**——由 Codex 在真实 `Plain.app` 里确认：命令面板搜索 "chat"/"copilot"/"account"/"sync" 等关键词不返回任何结果；Activity Bar 底部不出现账号相关 UI（`globalCompositeBar.js` 处理结果的真实呈现）；这一项证伪的是「运行时 guard 和 bundle 分析都通过，但真实 UI 层面仍然可以被用户操作到某个残留入口」这种两层静态分析都无法覆盖的可能性。

## 需要拍板的决策点（汇总）

1. **移除路径**：采纳「patch `missing-services.js`/`services.js` 追加 hunk」（本文档推荐），还是「抛弃 `services.js` 门面、自建 bootstrap」（本文档不推荐，因需重建 80+ 个非债务服务的兜底实现，长尾风险高）？
2. **`globalCompositeBar.js`（`authAccount` 唯一无法简单归零的文件）**：Activity Bar 底部的「Manage」齿轮图标是否要保留？
   - 保留 → 需要把该逻辑迁移到 `app/` 自建文件并 patch `activitybarPart.js` 改指向新文件（工作量较大，但能让 `authAccount` 真正归零）。
   - 不保留 → 直接 patch `activitybarPart.js` 去掉对 `globalCompositeBar.js` 的 import（工作量小，`authAccount` 归零，但少了一个当前存在、非账号性质的合法 UI 入口——需要确认「打开设置」「命令面板」等功能在别处仍有等价入口）。
3. **`extensionRuntime` 是否必须精确为 0**：本文档评估「个位数 floor + 书面理由」是更合理的目标（自建 `IExtensionService` 空实现即可，成本可控）；若要精确到 0，需要额外做「`app/` 自建 DI 令牌替换 vendor 的 `IExtensionService` 令牌」这一更深的架构改动（所有仍注入该令牌的 vendor 代码都要 patch），本文档建议不做，除非产品所有者认为这是不可妥协的要求。
4. **`check-bundle.mjs` 是否新增 `notebook`/`tasks`/`testing`/`remote`/`languagePacks`/`languageDetection` 六个新 category**（本文档强烈建议做，否则 acceptance 第 5 条永远没有可验证的基线覆盖）；以及「language environments」的范围认定是否包含 `languagePacks`/`languageDetection`/`treeSitter`（本文档倾向包含，因为清理手法相同、成本很低，但这是一次语义扩张，需要确认）。
5. **`docs/bundle-baseline.json` 完成后的最终形态**：保留该文件、把断言语义从「锁定 203」改为「锁定收口后的最终值（多数为 0，个别有书面 floor 理由）」（本文档推荐），还是认为「债务基线」这个概念本身在 F110 后不再必要、可以整体简化/移除？
6. **`cglicenses.json`/`cgmanifest.json`/`ThirdPartyNotices.txt` 三个文件在删除旧 Code OSS 源码树时如何处理**：随 F110 一起清空/占位，还是原样保留、完全留给 F120 处理（本文档倾向后者，理由见结论 3 末尾）？

## 排除项

本文档不涉及：`monaco-vscode-api` 版本升级本身（升级节奏与是否升级不是 F110 的决策范围，只是指出现有 patch 体量会让未来升级的 rebase 成本更高）；F120 的品牌/打包/签名/SBOM 工作；F130 的完整验收矩阵设计（只在「边界」一节指出 F130 应该增强哪条 acceptance 的证据来源）；对 `chatAgent`/`extensionRuntime` 两类给出的「预期数字」不是承诺值，本文档已反复标注这两个数字需要实施阶段真实构建验证，不作为验收契约本身的准确来源——验收契约应该以「实施后真实测得的数字 + 书面理由」为准，不应该提前把本文档的预测数字直接写死进 `docs/bundle-baseline.json`。
