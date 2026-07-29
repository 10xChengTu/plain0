# F120 Branding, packaging, notices and release checks

日期：2026-07-29

## 目标与边界

`F120` 三条 acceptance（`features.json`）：

1. Bundle id, protocol, data directory and UI use Plain branding
2. Third-party notices and SBOM match shipped code and assets
3. macOS, Windows and Linux packages build in CI

事实输入：

- `docs/f110-s1-legacy-source-removal-manifest.md`：`F110` S1 物理删除了旧 Code OSS/Electron 源码树（`src/`、`extensions/`、`build/`、`test/`、`cli/`、`remote/web` 六目录三文件，16,103 个跟踪文件、5,128,731 行），随之移除 13 个第三方 LICENSE/NOTICE 文件，并对顶层 `cgmanifest.json` 现存 14 条注册与本次删除的关系做了观察（非结论）。这是本文档重写声明文件的事实起点。
- `docs/research/2026-07-28-generic-dap.md`：F100 调研阶段实测发现本机沙箱下 `lldb`/`lldb-dap` 的 `launch`/`run` 完全挂起，推测是 `ptrace`/`task_for_pid` 限制，并记录「原生调试器需要应用签名带 `com.apple.security.cs.debugger`」这一假设，明确划给 F120 承接、不由 F100 解决。本文档第「结论 4」对这一假设做了技术复核。
- `features.json` F110 evidence 的 `platformGaps`：明确点名顶层 `resources/`（旧 Electron 打包资源）和一批孤立工具配置文件被 S1 确认未被 `app/`/`src-tauri/` 引用，但判定超出 F110 授权范围，留给 F120 处理。

方法论：延续 F080/F090/F100/F110 已确立的纪律——能实测就实测，不凭记忆断言。本次实际执行并验证过的动作：

- `pnpm build:frontend`（真实 `vite build`，产出 `dist/`）与对 `dist/assets/*.js`/`*.js.map` 的真实字符串/内容检索。
- `pnpm tauri:build:e2e`（真实 debug 打包），并对产出的 `src-tauri/target/debug/bundle/macos/Plain.app` 执行 `codesign -dv`、`codesign -d --entitlements`、`spctl -a -vv`，逐一读取真实 `Info.plist`。
- 启动真实 `pnpm dev` + Chromium（Claude Browser 工具）打开 Plain，读取真实 `document.title`，并尝试命令面板巡检（见「结论 2」中对该尝试的如实记录，含未能完成的部分）。
- `pnpm licenses list --prod`（pnpm 内置命令，真实解析生产依赖树的 34 个包）与对 21 个 Rust 直接依赖逐一发起真实 `crates.io` API 查询。
- 通过 `gh api repos/<owner>/<repo>/license` 真实抓取 `CodinGame/monaco-vscode-api`、`microsoft/vscode-codicons` 两个上游仓库的权威 LICENSE 内容/SPDX 标识。
- 真实检索 `node_modules` 中各 `@codingame/monaco-vscode-*` 包与 `.ghostty-vendor/`（既有会话已 clone 的真实 vendor checkout）里的实际 LICENSE 文件内容。
- WebSearch 对 macOS entitlement/hardened runtime/公证与 Tauri 签名机制的现行文档做交叉核实（非凭记忆）。

已清理：研究用临时产物 `dist/`、`src-tauri/target/`、`test-results/`（均未提交），本次打开的 `pnpm dev` 预览进程已关闭。本文档不改 `app/`、`src-tauri/` 任何一行代码，不改 `features.json`/`progress.md`，未执行任何 `git commit`。

## 调研结论

### 结论 1：acceptance 现状总览（逐条真实差距）

| acceptance                                                    | 现状（实测）                                                                                                                                                                                                                                                                                                                                                  | 缺口                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bundle id, protocol, data directory and UI use Plain branding | `tauri.conf.json` 的 `identifier: "com.plain.editor"`、`productName: "Plain"` 已是 Plain 品牌，真实打包出的 `Info.plist` 的 `CFBundleIdentifier`/`CFBundleName`/`CFBundleDisplayName` 也确认是 `com.plain.editor`/`Plain`/`Plain`；`app/main.ts` 的 `initialize()` 把 `nameShort`/`nameLong` 覆盖为 `"Plain"`，真实 `document.title` 已实测确认为 `"Plain"`。 | 顶层 `product.json`（未接入真实构建）与 vendor 内嵌的 `product.json.js`（**真实生效**）里 `applicationName`/`dataFolderName`/`urlProtocol`/`reportIssueUrl`/`licenseUrl`/`serverApplicationName` 等字段仍是 `code-oss`/`.vscode-oss`/微软 URL；顶层 `resources/`、`LICENSE.txt`、`README.md` 等仍是旧品牌；真实打包出的 `.app` **完全没有图标**（无 `Contents/Resources/`，`Info.plist` 无 `CFBundleIconFile`）；`bundle` 段无 `copyright` 字段。 |
| Third-party notices and SBOM match shipped code and assets    | `cgmanifest.json`/`cglicenses.json`/`ThirdPartyNotices.txt` 三个文件自仓库创建以来未被 F110 触碰（按既定裁决），仍描述已删除的 Electron/Node 旧树依赖。                                                                                                                                                                                                       | 至少一个真实、当前仍在生产 bundle 里的 LGPL-2.1+ 依赖（`jschardet`）完全没有出现在 `ThirdPartyNotices.txt` 里（大小写不敏感全文检索 0 命中）——这不是 F110 造成的新问题，是重写前就已存在的真实缺口，但正是 F120 acceptance 第 2 条要修的东西。`cgmanifest.json` 现有 14 条注册里至少 1 条（`vscode-codicons`）经核实**仍然对应真实、当前发布的资产**，不能整体清空。                                                                              |
| macOS, Windows and Linux packages build in CI                 | `pnpm tauri:build:e2e` 在本机可以真实产出 `Plain.app`（已验证）。                                                                                                                                                                                                                                                                                             | `.github/workflows/plain-ci.yml` 只有一个 `ubuntu-latest` job，只跑 `pnpm check` 与浏览器 E2E，**没有任何 `tauri build` 步骤，没有 macOS/Windows runner**。`tauri.conf.json` 的 `bundle.targets` 硬编码为 `["app", "dmg"]`——这两个 target 都是 macOS 专属格式；即使现在就给 CI 加上 Windows/Linux runner，当前配置也不会产出任何 `.msi`/`.nsis`/`.deb`/`.appimage`，因为配置里根本没有请求这些 target。                                           |

### 结论 2：品牌面完整清单（实测）

#### 2.1 `product.json` 存在两条独立链路，只有一条真正生效，且只覆盖了两个字段

顶层 `product.json`（仓库根目录，7,782 字节）整份还是原始 Code OSS 内容：

```json
{
	"nameShort": "Code - OSS",
	"nameLong": "Code - OSS",
	"applicationName": "code-oss",
	"dataFolderName": ".vscode-oss",
	...
	"urlProtocol": "code-oss",
	"darwinBundleIdentifier": "com.visualstudio.code.oss",
	...
}
```

**实测确认这个文件与 `app/`、`src-tauri/` 完全没有引用关系**（`grep -rn "product\.json" app/ src-tauri/` 零命中）——它是一个死文件，从未被当前构建管线读取。

真正生效的是 `node_modules/@codingame/monaco-vscode-api` **自带、独立打包**的 `vscode/product.json.js`（6,483 字节，与顶层文件同源但物理独立），经 `vs/platform/product/common/product.js` 包装：

```js
import productJson from "../../../../../product.json.js";
var product = {
	...productJson,
	quality: "stable",
	version: "1.128.1",
	commit: "5264f...",
	date: "...",
	...(globalThis._VSCODE_PRODUCT_JSON ?? {}),
};
```

而 `app/main.ts` 唯一使用的引导入口 `initialize()`（`node_modules/@codingame/monaco-vscode-api/services.js:371`）：

```js
const productService = mixin({ _serviceBrand: undefined, ...product }, configuration.productConfiguration);
const instantiationService = StandaloneServices.initialize({
    [IProductService.toString()]: productService,
    ...
});
```

`app/main.ts` 第 193-197 行传入的 `configuration.productConfiguration` **只覆盖了两个字段**：

```ts
await initialize(createServiceOverrides(), container, {
    productConfiguration: {
        nameShort: "Plain",
        nameLong: "Plain",
    },
    ...
```

**实测证据（真实 `pnpm dev` + Chromium）**：`document.title` 确认为 `"Plain"`，证明这条覆盖链路真实生效，不是死代码。但由于 `mixin()` 只是浅合并，`applicationName`/`dataFolderName`/`sharedDataFolderName`/`urlProtocol`/`reportIssueUrl`/`licenseUrl`/`serverApplicationName`/`win32*`/`darwinBundleIdentifier`/`defaultChatAgent`（含 GitHub Copilot 全套字段）/`onboardingThemes`/`onboardingKeymaps` 等**其余全部字段仍是原始 Code OSS 值**，且是当前**真实、活的** `IProductService` 单例对象的字段值——不是躺在一个未使用文件里的死数据。

真实构建产物 `dist/assets/index-BkJKk7o9.js` 逐项检索命中（`grep -rl`，均为真实命中，非推断）：`"Code - OSS"`、`"code-oss"`、`"vscodeoss"`、`"com.visualstudio.code.oss"`、`"GitHub.copilot"`、`".vscode-oss"`、`"nameShort"`/`"nameLong"` 属性名、`"win32AppUserModelId"`。

**一处需要一并处理的残留**：`missing-services.js` 自己还独立注册了第二个、完全不同的 `ProductService` 类（`registerSingleton(IProductService, ProductService, InstantiationType.Eager)`），其构造函数硬编码 `nameShort = nameLong = "Code - OSS Dev"`、`applicationName = "code-oss"` 等。真实构建实测证实这段代码字符串确实进入 `dist/**/*.js`（`grep -rl "Code - OSS Dev"` 命中 `missing-services.js` 本身），但**这个注册当前不生效**——`initialize()` 通过 `StandaloneServices.initialize({[IProductService.toString()]: productService, ...})` 显式提供了一个具体实例，该实例覆盖了 `missing-services.js` 里的 `registerSingleton` 声明式注册（已用真实 `document.title === "Plain"` 而非 `"Code - OSS Dev"` 证实覆盖关系）。它目前只是**未被使用但仍在产物字符串里的死代码**，但 F120 若要做「产物里不得出现 Code OSS 品牌字符串」的机器化检查（见「需要新增的 AST 契约」），必须把这个类也一并 patch 掉，否则字符串扫描类检查会永远失败。

**可达性核实（如实记录一次未完成的验证尝试）**：本次调研尝试通过命令面板巡检 `reportIssueUrl`/`licenseUrl` 是否有真实可达的 UI 入口（如 Help: Report Issue / About），但 Claude Browser 工具对 Quick Input 组件的合成键盘/点击事件未能稳定聚焦（复现了本项目已记录过的「合成输入遇到自动化边界」类问题），未能完成人工交互验证。改用真实构建产物内容级检索作为替代证据：`grep -c "openIssueReporter\|OpenIssueReporterAction\|AboutAction\|actions\.about\b"` 与 `"Report Issue"` 文案在 `dist/assets/index-BkJKk7o9.js` 里**均为 0 命中**——即当前 Workbench 组合根本没有把 Help/About/Report Issue 相关 action 注册进真实 bundle，`reportIssueUrl`/`licenseUrl` 目前没有已知可达的 UI 消费点。这是一个真实的负面证据（降低风险），但只覆盖了「命令面板可搜索的 action」这一层，不能排除某个尚未发现的其他消费路径；标注为**需人工确认**，建议 F120 收口前用真实桌面 E2E 补一次穷尽巡检（可并入既有 `docs/e2e-handover.md` 的巡检模式）。

`darwinBundleIdentifier`/`win32*` 字段**实测确认在整个已安装 `vs/` 源码树里零引用**（`grep -rn "product\.darwinBundleIdentifier\|product\.win32" node_modules/@codingame/*/vscode/src/vs` 零命中）——这些是 Electron 主进程/安装器专属字段，在当前纯浏览器/WKWebView Workbench 架构里已确认死亡，不需要作为运行时风险处理，但仍会以字符串形式躺在 bundle 里（同一份 `product.json.js` blob 的其余字段）。`onboardingThemes`/`onboardingKeymaps` 同样零引用，判断死亡。

#### 2.2 `dataFolderName`/`urlProtocol` 的真实用途核实

`dataFolderName`（`.vscode-oss`）常见的 Electron 用途——本地用户数据目录命名——在浏览器架构下的等价物是 IndexedDB/localStorage 键名；本次检索真实产物未发现 `indexedDB.open(...)` 直接引用该字段（`grep -o 'indexedDB.open(...)' dist/assets/index-BkJKk7o9.js` 零命中），但不能排除通过变量间接引用；Plain 自己的持久化（workspace backup 等）是 Rust 后端实现，不依赖这个字段。`urlProtocol`（`code-oss`）在 Tauri 配置里没有任何自定义 URL scheme 注册（`tauri.conf.json`/`capabilities/` 均未见 deep-link 插件或 `CFBundleURLTypes` 等价配置），判断当前无实际消费路径。两者均标注**需人工确认**而非直接下死亡结论，因为本次未做全量运行时动态追踪。

#### 2.3 顶层 `resources/` 目录——完整的旧 Electron 打包资源树，未随 F110 清理

`git ls-files resources/ | wc -l` = **115** 个跟踪文件，`du -sh resources/` = **11M**。内容：`resources/darwin/`（`code.icns` 等 21 个按语言分类的 `.icns` 文件）、`resources/win32/`（`code.ico`、Inno Setup 安装向导 `.bmp` 素材、`VisualElementsManifest.xml`、appx 清单等）、`resources/linux/`（`code.desktop`、`code-url-handler.desktop`、`.rpm`/`.deb`/snap 打包脚本）、`resources/server/`（`code-192.png`、`manifest.json`）、`resources/completions/`（bash/zsh 的 `code` 命令补全脚本）。

**已确认这棵树与当前构建完全无关**（`grep -rn "resources/" --include="*.json" --include="*.mjs" --include="*.ts" --include="*.toml" .` 排除 `resources/` 自身后零命中）——这正是 `features.json` F110 evidence 里 `platformGaps` 记录的观察：「S1 期间已确认与 `app/`/`src-tauri/` 无引用关系，但判定超出 F110 授权范围，留作既有观察未删除」。F120 需要自己决定：整体删除（多数文件与 Tauri 打包无关）、还是从中挑出仍有价值的部分（例如 `resources/darwin/code.icns` 可以作为「已有的按语言着色文件图标」的参考基线，如果 Plain 未来想做文件类型图标）。

#### 2.4 `src-tauri/icons/` 已经是 Plain 专属图标，但从未接入 `tauri.conf.json` 的 `bundle.icon`

`src-tauri/icons/`（`icon.png`/`icon.icns`/`icon.ico`/`128x128.png`/`128x128@2x.png`/`32x32.png`/`plain.svg`）经真实读取确认是一枚自定义的「折角文档」图标（深色圆角背景 + 白色文档 + 蓝绿色折角 + 三条深色文本线 + 一条青绿色高亮线），与旧 `resources/darwin/code.icns`（MD5 不同：`6905c312...` vs `7963bea9...`）是完全独立的资产，**不是**遗留 Code OSS 图标，已经是 Plain 品牌。

**但真实打包证实这套图标目前完全没有生效**：`pnpm tauri:build:e2e` 产出的 `Plain.app` 里：

```
$ find Plain.app/Contents -maxdepth 2
Plain.app/Contents/Info.plist
Plain.app/Contents/MacOS/plain
```

**没有 `Contents/Resources/` 目录**，`Info.plist` 里没有 `CFBundleIconFile`/`CFBundleIconName` 任何一个键。构建日志逐行检索无任何 icon 相关警告或错误——Tauri 打包器只是静默地按 `tauri.conf.json` 的 `bundle` 段没有 `icon` 字段处理，完全没有把 `src-tauri/icons/*` 复制进产物。真实打出来的 `Plain.app` 在 Finder/Dock 里会显示系统默认的通用应用图标，不是 `plain.svg` 里那个已经画好的图标。这是一个纯配置缺口（`bundle.icon` 数组字段缺失），修复成本很低。

#### 2.5 macOS 应用签名现状（真实打包 + `codesign`/`spctl` 实测）

```
$ codesign -dv Plain.app
CodeDirectory v=20400 size=533839 flags=0x20002(adhoc,linker-signed) hashes=16679+0 location=embedded
TeamIdentifier=not set
Sealed Resources=none

$ codesign -d --entitlements :- Plain.app
（空，无任何 entitlement）

$ spctl -a -vv Plain.app
Plain.app: code has no resources but signature indicates they must be present
```

真实证据：当前 debug 打包只有 Rust/Cargo 工具链自动附加的 **ad-hoc 签名**（无 Team ID、无开发者证书、零 entitlements），且 `spctl` 报出一条真实的一致性警告（签名声称应该有资源目录但实际没有——与「2.4」的零图标发现是同一根因）。这与「结论 4」的公证/签名要求是完全空白的起点，不是「已经部分配置、还差一点」。

#### 2.6 其余品牌残留（未机器化追踪，纯文本层面）

- `LICENSE.txt`（仓库根）：完整内容仍是 `Copyright (c) 2015 - present Microsoft Corporation` 的 MIT 声明，未做任何修改——而 `package.json` 的 `"license": "MIT"` 字段并未说明这是谁的版权。这是一个需要产品/法务决策的问题（见「需要拍板的决策点」），不是本文档能替 F120 决定的事。
- `README.md`：文件顶部已经有自我标注——「以下内容是迁移前的上游 Code OSS 说明，在完成产品重品牌和旧体系退役前暂时保留」——说明这是已知、已披露的临时占位，而非疏漏。真实检索命中 `visual studio code|vscode|code oss|microsoft`（大小写不敏感）**80 处**。
- `CONTRIBUTING.md`：同类命中 **18 处**；`SECURITY.md`：**4 处**。
- 这三个文件不影响真实 bundle 内容或 `pnpm check` 的任何一步（纯文档），优先级低于 `product.json.js`/图标/签名，但属于 acceptance 第 1 条「UI use Plain branding」的合理外延（至少 README 是用户看到的第一个仓库入口）。

### 结论 3：声明文件重写的事实依据

#### 3.1 `F110` S1 已确认删除的内容（复述关键事实，完整版见 `docs/f110-s1-legacy-source-removal-manifest.md`）

- 16,103 个跟踪文件、5,128,731 行，六个目录三个文件（`src/`、`extensions/`、`build/`、`test/`、`cli/`、`remote/web` + `.vscode-test.js`/`gulpfile.mjs`/`scripts/generate-definitelytyped.sh`）。
- 随之物理消失的 13 个第三方 LICENSE/NOTICE 文件：`build/monaco/{LICENSE,ThirdPartyNotices.txt}`（Monaco 打包脚本 MIT + nodejs path/markedjs 声明）、`cli/ThirdPartyNotices.txt`（13,933 行，旧 Rust CLI 的完整 crate 许可证清单，与 `src-tauri/` 的 `Cargo.lock` 从未共享）、`extensions/copilot/{LICENSE.txt,chat-lib/LICENSE.txt}`、`extensions/mermaid-markdown-features/ThirdPartyNotices.txt`（`elkjs`，EPL-2.0）、`extensions/terminal-suggest/ThirdPartyNotices.txt`（`withfig/autocomplete`，MIT）、`extensions/theme-seti/ThirdPartyNotices.txt`（`jesseweed/seti-ui`，MIT）、以及若干 Copilot 测试 fixture 内嵌 LICENSE/许可协议文案文件。
- 顶层 `cgmanifest.json` 现存 14 条注册（`chromium`、`ffmpeg`、`H.264/AVC Video Standard`、`nodejs`、`electron`、`inno setup`、`spdlog`、`vscode-codicons`、`mdn-data`、`@mdn/browser-compat-data`、`ripgrep`、`vscode-win32-app-container-tokens`、`@iktakahiro/markdown-it-katex`、`cacheable-request`）：F110 S1 已核实这 14 个名字**没有一个**出现在 Plain 自己的 `package.json` 依赖里，说明它们对应的代码此前只存在于已删除的树中——但明确标注为**观察，非结论**，要求 F120 逐条核实是否有替代路径仍在引用同一上游项目。

#### 3.2 本次新增核实：14 条里至少 1 条（`vscode-codicons`）经证实仍然真实适用，不能整体清空

真实构建产物含 `dist/assets/codicon-Brq4_Ui5.ttf`（140.95 kB）。追踪其真实来源：

```
$ find node_modules -iname "codicon*.ttf"
node_modules/.pnpm_patches/@codingame/monaco-vscode-api@35.0.1/vscode/src/vs/base/browser/ui/codicons/codicon/codicon.ttf
```

即当前图标字体确认来自 `@codingame/monaco-vscode-api` 自己内嵌的 `codicon.ttf`（与已删除的 `build/monaco`/旧 `src/vs/base/browser/ui/codicons` 是两条独立分发渠道，`F110` S1 已指出这一点但未下结论）。用 `gh api repos/microsoft/vscode-codicons/license` 真实查询上游仓库许可证：

```
license: {"key": "cc-by-4.0", "name": "Creative Commons Attribution 4.0 International", "spdx_id": "CC-BY-4.0"}
```

即 codicons 字体本身是 **CC-BY-4.0**（要求署名），不是简单的 MIT。**真实核实当前 `cgmanifest.json` 里 `vscode-codicons` 那条注册本身内容已经是准确的**：

```json
{
	"component": {
		"git": {
			"name": "vscode-codicons",
			"repositoryUrl": "https://github.com/microsoft/vscode-codicons",
			"commitHash": "906a02039f..."
		}
	},
	"license": "MIT and Creative Commons Attribution 4.0",
	"version": "0.0.46-0"
}
```

**结论**：这条注册不应被 F120 当作「旧 Electron 遗产」整体清空，而应该**保留并核实版本号/commit 是否与 `@codingame/monaco-vscode-api` 35.0.1 实际内嵌的 codicon 字体版本一致**（本次未做逐字节版本比对，标注为待实施时核实）。这说明 F110 S1 文档里「14 条观察，非结论」的审慎表述是对的——不能假设「不在 `package.json` 依赖里」就等于「可以删除」，`vscode-codicons` 恰恰是反例（它通过一个已安装 npm 包的**内嵌资源文件**、而不是一条独立 `package.json` 依赖，进入真实 bundle）。其余 13 条本文档未逐一重复这一深度核实，标注为 F120 实施时的必需工作，参考本条目已验证的方法（追踪真实构建产物里的资源文件 → 反查其物理来源 → 用 `gh api`/`crates.io` 等权威渠道核实上游许可证），而不是仅凭包名字符串判断。

#### 3.3 JS 生产依赖许可证真实审计（`pnpm licenses list --prod`）

真实执行的 pnpm 内置命令（非手工枚举），完整解析生产依赖树后去重得到 **34 个包**：30 个 `@codingame/monaco-vscode-*` 系列（含 `editor-api`，即 `monaco-editor` 的别名包）+ `@tauri-apps/api` + `@types/trusted-types` + `@vscode/diff` + `@vscode/iconv-lite-umd` + `marked` 全部 **MIT**；另有两个例外：

| 包          | 许可证                    | 备注                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dompurify` | `(MPL-2.0 OR Apache-2.0)` | 真实确认存在于 `dist/assets/index-BkJKk7o9.js`（`grep -l "purify\|DOMPurify"` 命中），选择 Apache-2.0 分支合规最简单                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `jschardet` | `LGPL-2.1+`               | **真实确认是当前生产 bundle 里一个独立、~333 KB 的 Vite chunk**（`dist/assets/jschardet-DWOAzB8d.js`），用于文件编码检测；`ThirdPartyNotices.txt` 全文大小写不敏感检索 **`jschardet` 零命中**——即这个真实、当前正在发布的 LGPL-2.1+ 依赖完全没有出现在现有第三方声明文件里。`cglicenses.json` 里确实有一条 `jschardet` 的 `prependLicenseText`（补充作者信息），但那只是对某个假定已存在的许可证正文的前缀补充，本身不构成许可证正文，且现有 `ThirdPartyNotices.txt` 里根本没有对应正文可供补充——这是一个真实、独立于本次重写、pnpm licenses list 才能揭示的既有合规缺口，F120 acceptance 第 2 条「match shipped code and assets」明确要求修。**LGPL-2.1+ 的合规义务需要人工确认**：至少需要在 `ThirdPartyNotices.txt` 里补上完整许可证正文和署名；是否需要额外满足「允许用户替换该库」这类 LGPL 动态链接豁免条件，取决于该依赖在最终产物里是否被视为「动态链接」（一个压缩后的独立 JS chunk 在浏览器/WebView 环境下如何对应 LGPL 的「链接」概念本身是有争议的灰色地带）——本文档不给出法律结论，标注为需要人工/法务确认。 |

#### 3.4 Rust 依赖许可证真实审计（`Cargo.toml` 21 个直接依赖，逐一 `crates.io` API 查询）

`src-tauri/Cargo.lock` 里共 **483** 个 `name = ` 记录（真实计数，含全部传递依赖）——体量远超可手工逐条列举的合理产出比，F120 应引入自动化工具（例如 `cargo-license`/`cargo-about`）而不是手工维护。本次对 21 个**直接**依赖做了真实 `crates.io` API 查询（非凭记忆），结果：

| crate                                                                                                            | 许可证（真实查询结果）                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `cap-fs-ext` / `cap-std` / `rustix`                                                                              | `Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT`                                                                           |
| `globset` / `grep-matcher` / `grep-regex` / `grep-searcher` / `ignore`                                           | `Unlicense OR MIT`                                                                                                              |
| `jsonc-parser` / `portable-pty` / `zip`                                                                          | `MIT`                                                                                                                           |
| `libghostty-vt`                                                                                                  | `MIT OR Apache-2.0`                                                                                                             |
| `notify`                                                                                                         | **`CC0-1.0`**（公共领域声明，不是常见的 MIT/Apache 组合——真实查询结果，与凭记忆的预期不符，特此记录避免下一次调研重犯同类假设） |
| `serde` / `serde_json` / `sha2` / `libc` / `tempfile` / `uuid` / `tauri` / `tauri-build` / `tauri-plugin-dialog` | `MIT OR Apache-2.0`（或 `Apache-2.0 OR MIT`，顺序不同但等价）                                                                   |

**关于 `libghostty-vt` 的重要澄清**：任务交办材料预设「libghostty 是 MIT」——真实查询证实这只对**被 vendor 的 Ghostty C 源码本身**成立（`.ghostty-vendor/ghostty/LICENSE` 真实内容：`MIT License, Copyright (c) 2024 Mitchell Hashimoto, Ghostty contributors`），但 Plain 直接依赖的 Rust **crate**（`libghostty-vt`，来自 `github.com/uzaaft/libghostty-rs`，与官方 Ghostty 项目是不同仓库）实际是 **`MIT OR Apache-2.0`** 双许可——这是一个需要在通知文件里正确区分的、真实存在的两层许可证结构（wrapper crate 一层 + 它在构建时拉取的 vendor C 源码另一层）。`.ghostty-vendor/ghostty/vendor/nerd-fonts/LICENSE` 还显示 Ghostty 自身的构建树里含一份 Nerd Fonts 依赖（SIL OFL 1.1 + MIT 混合）——**这份字体资源是否真的被静态链接进最终 `libghostty-vt` 产物、还是只服务于 Ghostty 完整终端应用自己的字体渲染（与 Plain 只用其 VT 解析库无关）,本文档未做链接层级的实测核实，标注为需人工确认**，建议实施阶段用 `otool -L`/`nm` 等工具核实最终 Rust 二进制的真实链接内容，而不是假设 vendor 目录里出现的每个文件都进了产物。

#### 3.5 `@codingame/monaco-vscode-api` 的真实权威 LICENSE 文本（`gh api` 抓取，非猜测）

```
$ gh api repos/CodinGame/monaco-vscode-api/license
license.spdx_id: MIT
content: MIT License

Copyright (c) 2022 CodinGame
...
```

15 个 `@codingame/monaco-vscode-*` 系列包（14 个直接依赖 + `monaco-editor` 别名的 `monaco-vscode-editor-api`）**在各自 `package.json` 里都自报 `"license": "MIT"`**（真实读取每个包的 `package.json` 确认），且 `pnpm licenses list --prod` 对传递依赖同样全部报告 MIT——但**没有一个包在 `node_modules` 里物理携带 LICENSE 文件**（`ls <pkg>/ | grep -i license` 全部为空）。这意味着 F120 重写通知文件时，MIT 正文本身需要从上述 `gh api` 查到的权威源（`CodinGame/monaco-vscode-api` 仓库根 LICENSE，Copyright 2022 CodinGame）引用，而不能假设 node_modules 里会有现成文本可抄。**这是一个 monorepo 发布多个 npm 包的常见模式**（单一 GitHub 仓库、单一顶层 LICENSE，对应 npm 上的十几个不同 package 名）——通知文件可以对这一整族包只写一条署名（同一 Copyright/同一许可证正文），不需要为每个 service-override 子包单独复制一份相同的文本。

#### 3.6 汇总：F120 需要面对的第三方声明现状矩阵

| 组件类别                                                                                                                                                         | 现状                                                                                                                       | F120 需要做的判断                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 旧 Code OSS/Electron（`chromium`/`ffmpeg`/`electron`/`nodejs`/`inno setup`/`spdlog`/`ripgrep`/`vscode-win32-app-container-tokens`/`cacheable-request` 等 13 条） | 随 F110 S1 物理删除，`package.json` 确认零依赖                                                                             | 大概率整体移除这些注册（F110 S1 已给出「观察」，F120 需给出「结论」） |
| `vscode-codicons`                                                                                                                                                | **本文档新增核实**：仍对应真实、当前发布的字体资源，许可证描述本身已经准确                                                 | 保留，核实版本/commit 是否需要更新以匹配 35.0.1 内嵌版本              |
| `mdn-data`/`@mdn/browser-compat-data`/`@iktakahiro/markdown-it-katex`                                                                                            | 未逐一核实是否仍有独立引用路径                                                                                             | 需要重复「3.2」的方法逐条核实，不能假设与 codicons 同构或异构         |
| 15 个 `@codingame/monaco-vscode-*` 包 + 传递依赖共 34 个 prod JS 包                                                                                              | 真实审计完成（本文档「3.3」），MIT 为主，`dompurify`（MPL/Apache）、`jschardet`（LGPL-2.1+，**当前完全缺失署名**）两个例外 | 新增全部 34 条署名，`jschardet` 需要法务确认 LGPL 义务范围            |
| Rust 直接依赖 21 个 + 传递依赖共 483 个                                                                                                                          | 直接依赖已真实审计（本文档「3.4」），传递依赖未逐一审计                                                                    | 引入 `cargo-license`/`cargo-about` 类工具做全量生成，不手工维护       |
| `libghostty-vt` 及其构建时 vendor 的 Ghostty C 源码                                                                                                              | 双层许可证结构已核实（crate 本身 MIT/Apache-2.0，vendor 源码 MIT），Nerd Fonts 子资源是否实际链接未核实                    | 需要人工确认最终二进制的真实链接内容                                  |
| Plain 自己的 `LICENSE.txt`                                                                                                                                       | 仍是原始 Microsoft 版权声明                                                                                                | 需要产品/法务决策（见「需要拍板的决策点」）                           |

### 结论 4：macOS entitlement、签名与公证

#### 4.1 当前签名状态是完全空白，不是部分配置

见「结论 2.5」：真实打包产物只有 ad-hoc 签名、零 entitlements、无 Team ID。`Info.plist` 也没有 `NSHumanReadableCopyright` 键。

#### 4.2 macOS Catalina（10.15）及以上强制要求签名+公证——非可选项

真实检索确认：「On macOS Catalina and later Gatekeeper enforces that you must sign and notarize your application. Unsigned software cannot be run, so contrary to Windows Code Signing this is not optional for macOS.」`tauri.conf.json` 的 `bundle.macOS.minimumSystemVersion` 恰好设为 `"10.15"`——即 Plain 自己声明支持的最低系统版本，正好是这条规则生效的分界点。这意味着**任何面向真实用户分发**（不只是本机开发调试）的 macOS 构建，签名+公证不是「锦上添花」，而是能否运行的前提。

#### 4.3 真实、已文档化的陷阱：启用 hardened runtime 后如果 entitlements 配置不对，应用会在公证后直接崩溃

真实检索到的 Tauri 官方指引：「Tauri apps use a WebView that requires JIT compilation... If your app crashes right after notarization but works fine unsigned, it's almost certainly an entitlements issue... com.apple.security.cs.allow-jit and related security entitlements」需要写进 `src-tauri/Entitlements.plist`。**这是一个比「entitlement 缺失导致某个次要功能不可用」严重得多的风险**——如果 F120 只是简单地「打开签名开关」而不同时配置正确的 entitlements 文件，很可能导致 Plain 在完成公证、真正可分发之后，反而**完全无法启动**（WKWebView 初始化失败）。F120 的签名切片必须把 `Entitlements.plist` 的内容本身作为一个受契约保护的产出物，而不是签名流程的附带细节。

#### 4.4 对 F100「原生调试需要 `com.apple.security.cs.debugger`」这一假设的技术复核（重要修正，标注为需人工/实机确认）

真实检索确认的权威事实：`task_for_pid()` 的权限判定基于**调用方进程自身**的代码签名/entitlement——需要**调用 `task_for_pid` 的那个进程**（调试器本身）持有 `com.apple.security.cs.debugger`，而**被调试的目标进程**需要持有 `com.apple.security.get-task-allow`（通常只有本地非公证/debug 构建默认为真）。

据此重新审视 `ADR 0003` 与 F100 研究文档对 Plain 自身角色的定义——「Rust 实现编辑器侧 DAP client，而不是运行 VS Code debugger extension」「adapter 由用户显式配置或连接」：**Plain 自己从不直接调用 `task_for_pid`**，它只是 spawn 一个外部 DAP adapter 子进程（例如 `lldb-dap`）、通过 stdio/TCP 说 DAP 协议。真正调用 `task_for_pid` 的是 **adapter 自己**（`lldb-dap`/`debugserver`），不是 Plain.app 的可执行文件。

按照上述权限模型，**需要持有 `com.apple.security.cs.debugger` 的更可能是 adapter 二进制本身，而不是 Plain.app**——如果用户配置的是 Apple 自己通过 Xcode Command Line Tools 分发的 `lldb`/`debugserver`，这些二进制早已由 Apple 自己签好所需 entitlement（前提是用户机器已启用「Developer Mode」，这是 macOS 较新版本引入的系统级开关，与任何第三方 App 的签名状态无关）；如果用户配置的是其他来源的 debugger（例如某个 VS Code 扩展私自打包的 `lldb-dap`），entitlement 是否齐全取决于**那个二进制自己的签名**,完全不在 Plain 打包配置的控制范围内。

**这与 F100 研究文档现有措辞的落差**：F100/`docs/e2e-handover.md` 现有表述是「Plain 自己 spawn 的子进程（`lldb-dap`）要对另一个子进程调用 `task_for_pid`，通常需要**该应用自身**的代码签名 entitlements 包含调试相关权限」——本文档认为这里的「该应用」更准确的所指应该是 **adapter 进程自身**，而不是 Plain.app。**本文档没有能力在当前环境完成端到端实机验证来 100% 证实这一结论**（本机没有 Apple 开发者证书，此前 F100 已确认本机沙箱本身会让任何 `ptrace`/`task_for_pid` 调用挂起，这个环境限制本身也无法排除）——因此本文档：

1. 不推翻 F100 记录的现象（真实沙箱挂起是真实观察到的事实）；
2. 但对「根因是 Plain.app 自身缺少 entitlement」这一归因提出修正意见，理由是 Plain 的架构角色是 DAP 客户端而非调试器本身；
3. 明确标注为**需要实机确认**：F130 或 F120 实施阶段，应该用一个**未特别签名的 Plain.app（当前默认 ad-hoc 状态）+ 系统自带、已由 Apple 正确签名的 `lldb-dap`**，在一台已启用 Developer Mode、非本次调研使用的沙箱环境的真实 Mac 上做一次 `launch` → 命中断点的验证。如果这次验证成功，说明 Plain.app 自身完全不需要 `com.apple.security.cs.debugger`，F120 的签名工作量可以相应减少；如果失败，再考虑是否真的需要在 Plain.app 自己的 `Entitlements.plist` 里加这条权限（技术上这也是可以做的——`com.apple.security.cs.debugger` 是一个应用可以自行申请、不需要 Apple 特殊审批的普通 hardened runtime entitlement，与需要 Apple 额外授权的「特殊 entitlement」不同类）。

**不确定但值得记录的次要可能性**：即使 adapter 自身已正确签名，如果 Plain 未来某个版本决定启用 macOS **App Sandbox**（`com.apple.security.app-sandbox`，只有上架 Mac App Store 才强制要求），沙箱会把限制一并传导给所有子进程，那时候 Plain.app 自己的 sandbox entitlements 配置才会真正影响子进程的调试能力。当前判断 Plain 大概率不会走 App Sandbox 路线（`DeveloperTool` 分类的直接分发桌面工具通常不需要，且会与 ADR 0004 描述的「任意目录访问」「PTY/Git/DAP 子进程」产品能力冲突），但这是需要拍板的决策点之一（见后文）。

#### 4.5 不签名的开发构建下，调试功能能到什么程度

真实证据（4.4 已述）：Apple 自己的 `lldb`/`debugserver` 只要用户机器启用了 Developer Mode，理论上不依赖 Plain.app 本身的签名状态就能工作——即**本地开发构建（当前默认的 ad-hoc 签名状态）很可能已经足够验证原生调试**，前提是能避开本次调研环境本身的沙箱限制（这是 Claude Code Bash 工具沙箱的限制，不是 macOS 对普通用户桌面会话的限制）。这意味着 F130「原生调试器验收能做到什么程度」的答案可能好于 F100 原文档的悲观预期——但本文档同样无法在当前环境实测证实，标注为 F130 执行阶段的第一优先验证项（无需等待 F120 签名切片完成）。

对 `debugpy` 类不依赖 `task_for_pid`（用 Python 自身 `sys.settrace`）的适配器，签名状态从一开始就无关——F100 已经证实这条路径在本机沙箱下完整跑通,不受本节讨论影响。

#### 4.6 Tauri 内建签名/公证机制（真实文档确认，非猜测）

Tauri CLI 自带签名+公证流程，通过环境变量驱动，无需额外自定义脚本：`APPLE_SIGNING_IDENTITY`（钥匙串里签名证书条目名）、`APPLE_CERTIFICATE`（`.p12` 证书的 base64）、`APPLE_CERTIFICATE_PASSWORD`、`APPLE_ID`、`APPLE_PASSWORD`（App 专属密码）、`APPLE_TEAM_ID`。`tauri-apps/tauri-action` 这个官方 GitHub Action 把「打包 macOS/Linux/Windows 三平台 + 签名 + 公证 + 发布到 GitHub Release」封装成一步。这些都需要一个**真实 Apple Developer Program 账号**（付费，$99/年）——这是本文档在当前环境完全无法验证、也无法自行获取的外部前提，必须由产品所有者决定是否购买/提供。

### 结论 5：CI 与跨平台打包现状缺口

真实读取 `.github/workflows/plain-ci.yml` 全文（30 行）：单一 `ubuntu-latest` job，只安装 WebKitGTK 系统依赖后执行 `pnpm check` + `playwright test`，**没有任何 `tauri build`/`tauri:build:e2e` 调用，没有产物上传，没有 macOS/Windows runner**。

`tauri.conf.json` 的 `bundle.targets: ["app", "dmg"]` 是**macOS 专属**格式（`app` = `.app` bundle，`dmg` = 磁盘映像安装包）——这意味着即使现在就把 CI 矩阵扩展到 `windows-latest`/`ubuntu-latest` 两个额外 runner，`tauri build` 在这两个平台上也不会产出任何 Windows（`nsis`/`msi`）或 Linux（`deb`/`appimage`/`rpm`）安装包，因为配置里根本没有请求这些 target。这是比「CI 缺 job」更底层的一层缺口，必须先在 `tauri.conf.json`（或按 Tauri 2 约定的平台专属配置文件 `tauri.macos.conf.json`/`tauri.linux.conf.json`/`tauri.windows.conf.json`）里补上对应 target，CI 矩阵才有意义。

本机是 macOS，**无法在本地验证 Windows/Linux 的真实打包行为**（没有对应工具链）——这是本文档如实标注的能力边界，Windows/Linux 打包必须依赖真实 CI 环境验证，不能在本次调研里给出等同 macOS 那样的实测证据密度。Linux 桌面依赖（`libwebkit2gtk-4.1-dev`/`libappindicator3-dev`/`librsvg2-dev`/`patchelf`）现有 CI 已经在装，说明至少 `pnpm check`/浏览器 E2E 这一层已经验证过 Linux 系统依赖是够用的，但这不等于 `tauri build --bundles deb` 这类真正打包步骤也已经验证过。

### 结论 6：现有机器化契约的缺口

真实读取 `scripts/plain/boundary-contracts.mjs` 的 `validateTauriConfiguration` 函数（第 1792-1856 行）：它只校验 `config.build`（固定的 Vite entrypoint）、`config.app.withGlobalTauri`、`config.app.windows`（唯一窗口、label、无 `url`/`incognito`/`dataStoreIdentifier`）和 `config.app.security`（capabilities/CSP）——**完全不校验 `config.bundle` 任何字段**。这意味着当前 `pnpm check` 不会发现：`identifier` 被改回 Code OSS 风格的值、`icon` 字段被删除或指向错误路径、`category`/`copyright` 缺失、`macOS.minimumSystemVersion` 被意外改动。这是一个真实、可验证的契约盲区，F120 必须补上（见下一节）。

`scripts/plain/check-bundle.mjs` 现有的 `forbiddenCommandIds`/`forbiddenDebtTokenStrings` 机制（对 `dist/**/*.js` 拼接后的完整字符串做 `.includes()` 检索）是一个**已经在生产、已经被验证过的模式**，可以直接复用同一机制新增「禁止品牌字符串」清单，不需要新机制。

## 主导会话裁定（八条已拍板；两条属产品所有者，明确挂起）

文末「需要拍板的决策点」十条中，**第 4、7 两条涉及法律归属与付费授权，不是工程判断能替代的，明确挂起等待产品所有者**；其余八条由主导会话裁定如下，实施方按此执行。

### 已拍板（直接执行，不要再当作开放选项）

1. **产品名维持「Plain」，不再变更**（决策点 1）。已是全仓库既成事实（100+ 处引用），改名成本远高于收尾工作本身，且没有任何技术理由要改。这条确认掉，避免它以「默认值」的形式一直悬着。
2. **`bundle.identifier` 维持 `com.plain.editor`**（决策点 2）。已在真实打包产物里生效，无品牌/域名规划要求更换。
3. **`dataFolderName` = `.plain`，`urlProtocol` = `plain`**（决策点 3）。与产品名一致、与 VS Code 的 `.vscode-oss`/`code-oss` 完全无重叠，避免与用户机器上真实安装的 VS Code 抢同一数据目录或 URL scheme——**这一点是安全相关而非美观相关**：沿用 `code-oss` 会让两个不同产品读写同一份用户数据。
4. **顶层 `product.json` 删除，不改造成数据源**（决策点 5）。调研已实测确认真正生效的是 vendor 内嵌的 `product.json.js`，顶层那份是死文件；保留一个「看起来像配置但从不被读取」的文件，是本项目已经吃过亏的那类误导（F090 S6 的三个视图、F110 S5 的注册机制错配，都源于「看着对但实际不生效」）。删除它，品牌字段统一由 `app/main.ts` 的 `productConfiguration` 覆盖，并**新增 AST 契约锁定该覆盖的字段闭集**，防止将来漏字段。
5. **顶层 `resources/`（11M、115 文件）整体删除，不挑素材**（决策点 6）。调研已确认与当前构建零引用关系。更关键的是：那些是 **VS Code 品牌资产**，本产品要做的恰恰是去品牌化——从中「挑素材复用」在品牌与许可两个层面都是错误方向。Plain 的图标需要独立产出。
6. **`com.apple.security.cs.debugger`：先验证，后决定，不预先添加**（决策点 8）。调研对 F100 判断的修正（`task_for_pid` 按调用方进程判定，而调用方是 adapter 不是 Plain.app）**若成立则这条 entitlement 根本不该加**。在实机验证结论出来之前添加它，等于凭猜测扩大攻击面。实施顺序固定为：先做实机验证 → 有结论再决定加不加。
7. **CI 打包矩阵先只加 macOS**（决策点 9）。本机可预演、风险最低；现有 CI 从未跑过任何 `tauri build`，一次性上三平台等于把三类未知平台问题叠在同一个首跑里排查。macOS 跑通并稳定后再扩展。
8. **`jschardet`：先补齐署名，不做替换评估**（决策点 10 的工程部分）。「bundle 里有它却没有署名」是明确、无争议的缺口，**且它独立于本次重写、早已存在**——先把这个确定的义务补上。是否因 LGPL 属于「需规避的风险类别」而替换，属于产品/法务判断，与补署名不冲突，可后续单独评估。**注意**：LGPL 动态链接豁免在 WebView 打包语境下是否适用，调研已明确标注为需法律专业判断，本裁定**不涉及**该问题，只处置「缺失署名」这一确定事实。

### 明确挂起，等待产品所有者（实施方遇到时跳过并标注，不要自行决定）

- **决策点 4：版权归属人。** 顶层 `LICENSE.txt` 仍是「Copyright (c) 2015 - present Microsoft Corporation」，而 F110 S1 已物理删除 16,103 个文件的原始源码树。是维持提及 Microsoft 历史渊源、替换为 Plain 项目自己的声明、还是两者并存（注明「最初基于 Code OSS，后经重写」），是法律判断，**主导会话不代为决定**。在拍板前，`bundle.copyright` 与 `LICENSE.txt` 保持现状不动。
- **决策点 7：是否投入 Apple Developer Program（$99/年）。** 这是付费授权决定。在拍板前，F120 只做到「entitlements 文件内容 + 本地 ad-hoc 签名验证」，**真正的公证可分发版本挂起**。这直接限定了 F130 能验收到什么程度，需在 F130 交接材料里如实写明。

## 技术方案

### 5.1 品牌统一

- **产品名「Plain」实质上已经是既成事实**，不是一个待定选项——全仓库 100+ 处已经把它当作最终名字使用（`package.json` name/description、`tauri.conf.json` productName/identifier、`app/main.ts` 的 `productConfiguration`、窗口标题、`src-tauri/icons/`）。F120 不需要重新做「取名」决策，只需要把已经确立的名字**铺满**剩下没覆盖到的字段。
- 对 vendor `product.json.js` 生效的字段，建议**扩大 `app/main.ts` 的 `productConfiguration` 覆盖面**，而不是尝试 patch vendor 包内的 `product.json.js` 文件本身（后者是纯数据文件，patch 一份数据 blob 的收益低于直接在 Plain 自己已经建立的覆盖机制里加字段）。至少需要新增覆盖：`applicationName`、`dataFolderName`、`sharedDataFolderName`、`urlProtocol`、`reportIssueUrl`（若保留该功能面，需指向 Plain 自己的 issue 渠道；若判断当前无可达 UI，也应该覆盖以防未来某个 vendor 更新意外让它变得可达）、`licenseUrl`（指向 Plain 自己的 `LICENSE.txt`）、`serverApplicationName`。`win32*`/`darwinBundleIdentifier`/`defaultChatAgent`/`onboardingThemes`/`onboardingKeymaps` 已确认零引用，可以不覆盖，但需要在同一个 patch 里顺手清掉 `missing-services.js` 里那个死掉的第二个 `ProductService` 类（2.1 节），否则「产物禁止品牌字符串」检查永远无法通过。
- `bundle.icon` 字段：把已经存在、已经是 Plain 品牌的 `src-tauri/icons/{32x32.png,128x128.png,128x128@2x.png,icon.icns,icon.ico}` 接入 `tauri.conf.json` 的 `bundle.icon` 数组（Tauri 2 标准做法）。
- `bundle.copyright` 字段：需要一个明确的版权持有人字符串（见「需要拍板的决策点」）。
- 顶层 `product.json`（未接入构建的死文件）：建议要么删除（避免维护两份平行、容易漂移的数据），要么改造成真正被 `app/main.ts` 读取的单一数据源（例如把 `productConfiguration` 对象改为从这个 JSON 文件读取而不是硬编码在 `main.ts` 里）——两条路径都可行，是一次范围判断，不是纯技术判断,列入决策点。
- 顶层 `resources/`：建议整体删除（11M、115 文件，已确认零引用），除非产品所有者认为其中某些素材（如 `.icns` 系列）值得作为未来「按语言着色文件图标」功能的参考基线保留（若保留，应该移到一个明确标注「参考素材，非产品资产」的位置，不能继续放在容易被误认为「正在使用」的顶层 `resources/`）。
- `LICENSE.txt`/`README.md`/`CONTRIBUTING.md`/`SECURITY.md`：README 已自我标注为临时占位，其余三个文件需要按「需要拍板的决策点」的版权归属结论重写。

### 5.2 声明文件重写

建议的落地顺序（工具化优先于手工枚举，参考「结论 3」已验证的方法）：

1. 用 `pnpm licenses list --prod --json` 生成 JS 侧生产依赖的机器可读清单，作为 `ThirdPartyNotices.txt` 生成脚本的输入之一（而不是手工维护一份平行清单，容易随依赖升级漂移）。
2. 引入 `cargo-license` 或 `cargo-about`（Rust 生态标准工具）生成 483 个传递依赖的完整许可证清单，替代任何手工枚举方案。
3. 对每一条生成的记录，交叉核对是否已有 `cgmanifest.json`/`cglicenses.json` 里的既有条目（如 `vscode-codicons`、`jschardet` 的 `prependLicenseText`）可以复用其手工补充的署名文案，而不是重新生成一份可能更简陋的版本。
4. `jschardet`（LGPL-2.1+）与 `dompurify`（MPL-2.0/Apache-2.0）作为两个已知的非 MIT 生产依赖单独处理：前者需要法务确认动态链接豁免的适用性，后者建议显式选择 Apache-2.0 分支并记录选择理由。
5. `libghostty-vt` 需要区分 crate 自身许可证（MIT/Apache-2.0）与其构建时 vendor 的 Ghostty C 源码许可证（MIT），并核实 Nerd Fonts 子资源是否真的进入最终链接产物。
6. 顶层 `cgmanifest.json` 14 条旧注册：大部分（已确认零 `package.json` 依赖的 13 条）建议移除，`vscode-codicons` 一条建议保留并核实版本号；`mdn-data`/`@mdn/browser-compat-data`/`@iktakahiro/markdown-it-katex` 三条建议重复「结论 3.2」的方法逐条核实是否仍有独立引用路径,不能假设结论与 codicons 相同或不同。

### 5.3 macOS 签名/公证

- 本次调研判断,签名/公证工作应该拆成两个独立、可以分别决定是否现在做的部分：(a) **hardened runtime + JIT entitlements**（`com.apple.security.cs.allow-jit` 等,Tauri 官方文档已明确指出这是启用签名后**不可选**的必需项,否则会在真实公证后崩溃)；(b) **Developer ID 证书 + 公证**（需要付费 Apple Developer 账号，是否现在投入是一个产品决策）。二者可以独立于「是否已获得 Apple 开发者账号」先行准备——`src-tauri/Entitlements.plist` 的内容本身可以先写好、先在本地未签名/ad-hoc 签名状态下测试不出问题,等账号到位后再接通真正的签名密钥。
- 建议先创建 `src-tauri/Entitlements.plist`,至少包含 `com.apple.security.cs.allow-jit`（WebView JIT 需要）,并在 F100 交接的原生调试问题上按「结论 4.4」的修正意见先做一次「不改 Plain 自己签名状态、只用系统自带 lldb-dap」的验证,再决定是否需要额外追加 `com.apple.security.cs.debugger` 到 Plain 自己的 entitlements 里。
- CI/公证所需的 Apple 账号相关变量（`APPLE_SIGNING_IDENTITY`/`APPLE_CERTIFICATE`/`APPLE_CERTIFICATE_PASSWORD`/`APPLE_ID`/`APPLE_PASSWORD`/`APPLE_TEAM_ID`）本身是敏感凭据,不应该由本文档或任何自动化流程去获取/生成,必须由产品所有者手动在 GitHub仓库 Secrets 里配置。

### 5.4 CI 打包矩阵

- 建议评估官方 `tauri-apps/tauri-action`（一次性覆盖三平台构建+签名+公证+发布)与「继续手写 workflow、只添加 `tauri build` 步骤」两条路径的取舍——前者省心但需要适配其固定输入/输出约定,后者更贴合当前 `plain-ci.yml` 已有的手写风格（`pnpm/action-setup`+`actions/setup-node`+`dtolnay/rust-toolchain`)。本文档不替 F120 做这个选型,只指出两条路径都存在且都是可行的。
- 无论选哪条路径,第一步都必须先在 `tauri.conf.json`（或拆分出 `tauri.linux.conf.json`/`tauri.windows.conf.json` 平台专属配置)里把 `bundle.targets` 从 `["app", "dmg"]` 扩展为按平台包含 `deb`/`appimage`（Linux)和 `nsis`/`msi`（Windows)——这是不可省略的前置步骤,现有配置在其它平台上无法产出任何东西。
- Windows/Linux 的图标/copyright/category 等字段现状与 macOS 同构（均缺失),建议在同一个「品牌统一」切片里一次性补齐三平台,而不是分别打三次补丁。

## 需要新增的 AST 契约与发布前检查清单

沿用 `check-bundle.mjs` 已验证过的「拼接全部 `dist/**/*.js` 后做字符串检索」机制，新增：

1. **`forbiddenBrandStrings`（新增于 `check-bundle.mjs`）**：`"Code - OSS"`、`"code-oss"`、`"vscodeoss"`、`"com.visualstudio.code.oss"`、`".vscode-oss"`、`"vscode-oss-shared"`、`"Code - OSS Dev"`、`"win32AppUserModelId"`、`"Microsoft Code OSS"` 等——**能证伪什么**：任何一次 vendor 升级、patch 误改或新增代码路径,不小心让旧品牌字符串重新进入真实产物,会立刻被抓住,而不必等到人工检查窗口标题才发现。需要先完成「5.1」的 `missing-services.js` 死 `ProductService` 类清理,否则这条检查从写入的第一天就会失败。
2. **`validateTauriConfiguration` 扩展 `bundle` 段校验（`boundary-contracts.mjs`）**：锁定 `identifier === "com.plain.editor"`（或最终拍板值)、`icon` 数组非空且路径真实存在、`macOS.minimumSystemVersion`/`category` 固定值、新增的 `copyright` 字段非空——**能证伪什么**：`bundle` 段目前完全没有机器化保护,任何一次误改（哪怕是无心的格式化工具改动)都不会被 `pnpm check` 拦截,这条契约把「结论 6」发现的盲区补上。
3. **`Entitlements.plist` 内容契约（新脚本或扩展 `check-boundaries.mjs`）**：一旦「5.3」引入该文件,应锁定其 `com.apple.security.cs.allow-jit` 等必需 key 齐全、不包含未经审计新增的额外 entitlement（每条新增 entitlement 都应该像 Tauri capability 一样「新增权限必须同时添加威胁说明和测试」,复用 `AGENTS.md` 已经确立的同一条纪律)。
4. **第三方声明新鲜度检查（新脚本）**：对照「5.2」生成的 `pnpm licenses list --prod --json`/`cargo-license` 输出,断言 `cgmanifest.json`/`cglicenses.json`/`ThirdPartyNotices.txt` 至少覆盖了每一个非 MIT-with-no-attribution-needed 的生产依赖（尤其是任何 copyleft/需署名许可证)——**能证伪什么**：这是「结论 3.3」发现的 `jschardet` 缺失署名这类问题的机器化防线,防止同类问题在下一次依赖升级后重新出现且无人察觉。
5. **CI 矩阵存在性检查**：一条简单的 grep/静态检查,断言 `.github/workflows/*.yml` 中存在覆盖 `macos-latest`/`windows-latest`/`ubuntu-latest` 三种 runner 且各自都有一步真实调用 `tauri build`（或等价的 `tauri-action`)的 job——**能证伪什么**：防止「本地能打包」被误当成「CI 也能打包」这个本文档反复强调的落差被后续切片再次引入。
6. **发布前人工清单（非机器化,但应写入 `docs/testing.md`/`docs/e2e-handover.md`）**：真实公证后启动测试（对应「结论 4.3」的 JIT 崩溃风险)、真实签名后原生调试验证（对应「结论 4.4」的修正意见)、三平台图标真实显示效果人工确认（Dock/任务栏/文件管理器)、`About`/`Report Issue` 等未来若被激活的 UI 入口需要重新做一次「结论 2.1」式的可达性巡检。

## 切片拆分（参考 F080/F090/F100/F110 粒度，每片可独立验收、独立提交）

1. **S0 品牌覆盖面扩容**：`app/main.ts` 的 `productConfiguration` 补齐「5.1」列出的字段；同一 patch 清理 `missing-services.js` 死掉的第二个 `ProductService` 类；`tauri.conf.json` 补 `bundle.icon`/`bundle.copyright`；真实重新构建 + `dist/**/*.js` 内容检索验证品牌字符串下降。这一步不涉及签名/CI,风险最低,建议最先做。
2. **S1 顶层遗留资产清理**：处理顶层 `product.json`（删除或改造为单一数据源)、`resources/`（删除或迁移可复用素材)、`LICENSE.txt`/`README.md`/`CONTRIBUTING.md`/`SECURITY.md` 按「需要拍板的决策点」的版权归属结论重写。
3. **S2 JS 第三方声明重写**：引入 `pnpm licenses list --prod --json` 生成管线,重写 `ThirdPartyNotices.txt` 对应 34 个 prod 包部分,修正 `jschardet` 缺失署名,处理 `dompurify` 许可证选择。
4. **S3 Rust 第三方声明重写**：引入 `cargo-license`/`cargo-about`,生成 483 个传递依赖的完整清单,补充 `libghostty-vt` 双层许可证与 Nerd Fonts 链接层级核实。
5. **S4 顶层 `cgmanifest.json`/`cglicenses.json` 裁剪**：按「结论 3.6」矩阵逐条处理 14 条旧注册（大部分移除,`vscode-codicons` 保留并核实版本,其余按「结论 3.2」方法逐条核实)。
6. **S5 macOS entitlements + 签名基础设施**：创建 `src-tauri/Entitlements.plist`（先只含 JIT 相关必需项)；对「结论 4.4」的修正意见做一次实机验证（需要一台可用的真实 Mac、非本次调研沙箱环境),确认 Plain.app 自身是否真的需要 `com.apple.security.cs.debugger`；补充 AST 契约第 3 条。这一步依赖产品所有者是否已获取 Apple Developer 账号,若未获取,可以只完成 entitlements 文件内容与本地 ad-hoc 验证,把真正的 Developer ID 签名+公证留到账号到位后。
7. **S6 CI 打包矩阵**：`tauri.conf.json` 补齐三平台 `bundle.targets`；`plain-ci.yml` 新增 macOS/Windows runner 与真实 `tauri build` 步骤（或迁移到 `tauri-action`)；补充 AST 契约第 5 条。Windows/Linux 打包结果只能在真实 CI 里验证,本机无法本地复现。
8. **S7 发布前检查清单收口**：落地 AST 契约第 1/2/4 条（品牌字符串扫描、`bundle` 段契约、声明新鲜度检查),并把发布前人工清单（AST 契约第 6 条)写入 `docs/testing.md`/`docs/e2e-handover.md`。

## 风险与未知项清单

1. **「结论 4.4」对 F100 entitlement 归因的修正意见未经实机验证**——本文档给出了有文献支持的技术推理（`task_for_pid` 权限判定基于调用方而非父进程),但本机环境（沙箱本身会让 `ptrace`/`task_for_pid` 挂起,且无 Apple 开发者证书)无法完成端到端验证。这是本文档影响最大的一条不确定性——如果修正意见成立,F120 的签名工作量和 F130 的原生调试验收前提都会显著变化,必须在 S5 切片一开始就做实机验证,而不是拖到最后。
2. **Windows/Linux 打包完全未经本地验证**——本机是 macOS,无对应工具链，只能依赖真实 CI 环境验证，且现有 CI 从未跑过任何 `tauri build` 步骤（连 macOS 也没有)，S6 切片第一次跑很可能会暴露若干本文档未能预见的平台特定问题。
3. **`jschardet`（LGPL-2.1+）的合规义务范围需要法务确认**——本文档指出了「缺失署名」这一明确、无争议的缺口,但「是否需要满足 LGPL 动态链接豁免的技术条件」在浏览器/WebView 打包语境下没有给出确定结论,标注为需要法律专业判断,而非工程判断能单独解决。
4. **`libghostty-vt` 是否真的静态链接了 Nerd Fonts 资源未实测**——需要在真实构建产物上用 `otool -L`/`nm`/查看最终二进制大小变化等手段核实,本次只读取了源码树结构,未做链接层级验证。
5. **`dataFolderName`/`urlProtocol` 是否存在本文档未发现的间接消费路径**——本次检索方法（`grep` 静态字符串)可能漏掉通过变量间接引用的情况,标注为需要更彻底的动态追踪（例如浏览器断点调试实际运行时的 `IProductService` 读取点)才能 100% 排除。
6. **`reportIssueUrl`/`licenseUrl` 的 UI 可达性巡检未完成**——尝试用 Claude Browser 工具做命令面板交互验证但未能稳定聚焦 Quick Input,只能用「bundle 内容检索无 Report Issue/About 相关 action」这一较弱的负面证据代替,不能排除本次搜索方法本身的盲区。
7. **`cgmanifest.json` 剩余 3 条注册（`mdn-data`/`@mdn/browser-compat-data`/`@iktakahiro/markdown-it-katex`）未逐条重复「结论 3.2」的深度核实**——本文档只对 `vscode-codicons` 一条做了完整的「追踪真实产物 → 反查来源 → 权威许可证查询」全链路验证,其余条目的处置建议目前只是「应该重复同样方法」,不是已经得出的结论。
8. **顶层 `resources/` 目录是否含有值得保留的素材未做产品判断**——本文档只确认了「与当前构建无引用关系」这一技术事实,是否要从 11M 素材里挑出可复用部分是一个产品决策,不是技术判断。

## 需要拍板的决策点

1. **产品名「Plain」**：已经是全仓库既成事实（100+ 处引用),本文档判断不需要重新决策,除非产品所有者现在就想改名（改名成本会显著高于「铺满品牌字段」这类收尾工作,建议明确一次「维持 Plain,不再变更」的确认,而不是留着默认）。
2. **`bundle.identifier`**：当前 `com.plain.editor` 已经在真实打包产物里生效,建议确认维持,除非有品牌/域名规划要求换用其他反向域名。
3. **`dataFolderName`/`urlProtocol` 的新值**：若决定覆盖（本文档建议覆盖),需要具体拍板成什么字符串（例如 `.plain`/`plain` 之类),这是纯命名决策。
4. **`bundle.copyright` 与顶层 `LICENSE.txt` 的版权归属人**：当前 `LICENSE.txt` 仍是「Copyright (c) 2015 - present Microsoft Corporation」，而 `package.json` 只声明 `"license": "MIT"` 未说明版权人。需要决定：维持一份提及 Microsoft 历史渊源的版权声明（哪怕大部分原始代码已被 F110 物理删除)，还是替换为 Plain 项目/作者自己的版权声明，还是两者并存（例如注明「本项目最初基于 Microsoft 的 Code OSS 项目，后经重写」)。这是一个法律敏感问题，本文档不给出建议，只指出这是必须拍板才能继续的前置项。
5. **顶层 `product.json` 处理方式**：删除（依赖 `app/main.ts` 硬编码 `productConfiguration`),还是改造为真正被读取的单一数据源。
6. **顶层 `resources/`（11M、115 文件）**：整体删除,还是从中挑选部分素材保留为参考基线。
7. **是否现在就投入 Apple Developer Program 账号（签名+公证的硬前提）**：如果暂不投入，F120 只能完成「entitlements 文件内容 + 本地 ad-hoc 验证」这部分，真正的可分发公证版本需要等账号到位；如果决定现在投入,需要产品所有者提供账号并配置 CI Secrets。
8. **是否给 Plain.app 自身追加 `com.apple.security.cs.debugger`**：取决于「结论 4.4」的实机验证结果——如果验证证实不需要,这一项可以从 entitlements 清单里去掉,降低攻击面；如果验证证实确实需要,则必须加上,否则原生调试器验收会持续受阻。
9. **是否/何时启用 CI 三平台打包矩阵**：现有 CI 只有 `ubuntu-latest` 且不打包,是先只加 macOS（本机可验证、风险最低),还是一次性把三平台都加上（无法本地预演,风险更高但一次到位)。
10. **`jschardet`（LGPL-2.1+）的取舍**：是接受现状、把署名和许可证义务补齐（本文档倾向的默认路径),还是评估替换为许可证更简单的编码检测方案（如果产品所有者认为 LGPL 依赖本身就是需要避免的风险类别)。

## 与 F130 的边界

- F130「最终端到端验收」应该包含：真实签名/公证后的 macOS 应用能否正常启动（对应「结论 4.3」的 JIT 崩溃风险)、真实原生调试器在真实签名状态下能否工作（对应「结论 4.4」的修正意见,且这一验证的优先级应该高于等待 F120 全部完成,因为它可能反过来影响 F120 是否需要给 Plain.app 追加调试相关 entitlement)、三平台安装包的真实安装/卸载/首次启动体验、`docs/e2e-handover.md` 已登记的 E2E-010/E2E-011 中标注「阻塞于 F120 签名前提」的步骤（一旦 F120 完成,应重新执行而不是继续标记为阻塞)。
- F120 只负责让「品牌/打包/声明」这一层的机器化契约（本文档「需要新增的 AST 契约」一节)全部就位并通过；F130 负责在真实三平台桌面环境上验证这些契约锁定的行为在实机上确实如预期工作，机器化契约通过不等于实机验证通过（这正是本项目已经反复出现过的「`pnpm check` 全绿但真实功能坏了」模式在打包领域的对应版本）。
- 本文档不改动 `features.json`/`progress.md`（按纪律留给主导会话操作),未执行任何 `git commit`。

## 排除项

本文档不涉及：Windows/Linux 平台的深度品牌/entitlement 等价分析（本次调研工具与时间集中在 macOS,Windows 的 Authenticode 签名与 Linux 的 `.desktop`/AppStream 元数据本文档只在「结论 5」层面提及,未做同等深度的实测)；对 483 个 Rust 传递依赖与 34 个 JS 生产依赖之外的完整开发依赖树做许可证审计（开发依赖不进入发行产物,不在 acceptance 第 2 条范围内)；`monaco-vscode-api` 版本升级本身（不是 F120 范围)；Apple Developer Program 账号本身的获取流程（纯行政/商务流程,不是技术调研范畴)；对「结论 4.4」修正意见的最终定论（明确留给实机验证,本文档只给出有文献支持的推理和验证方法)。
