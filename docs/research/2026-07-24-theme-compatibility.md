# F050 VS Code 颜色主题兼容

日期：2026-07-24

## 目标与边界

`F050` 四条 acceptance：导入本地 VSIX 与解包目录；应用 workbench colors 与 TextMate token colors；JSONC/include/tmTheme fixture 通过；绝不执行扩展代码。遵循 ADR 0002（Theme Package Importer，白名单只读 `contributes.themes`，防 zip-slip/zip bomb/include cycle）。本侧只做单元/Rust/Browser mock E2E；真实桌面场景登记 `docs/e2e-handover.md`。

## 调研结论（双路 + 运行时探针交叉复核，锚定 Code OSS `5264f`、CodinGame v35.0.1）

### 运行时实证：既有静默缺口（S0 的直接依据）

- 探针证实：主题选择器 Quick Pick 恒空（0 行，连兜底项都没有，gallery 已禁用）；`.monaco-workbench` 只有裸 `vs` class、`--vscode-editor-background` 等 CSS 变量为空——**应用一直运行在 `createUnloadedThemeForThemeType` 的无主题占位符上，从未加载过任何真实主题文件**，且全程零报错。
- 根因链：theme-defaults 在 `initialize()` 前 `registerExtension` → 进入模块私有 `builtinExtensions` 数组；该数组唯一消费者是被 AGENTS.md 明令禁止 app/ 直接导入的 `extensions-service-override`；当前 `IExtensionService` 是 `NullExtensionService`（无 `deltaExtensions`、`extensions=[]`），extension point 处理链整体断裂，`ThemeRegistry.extensionThemes` 恒空。

### 可用的官方 seam

- `@codingame/monaco-vscode-api/extensions` 的 `registerExtension(manifest)`（不传 extHostKind = 纯声明式、零 Extension Host）与 `registerFileUrl(path, url)` 是公开运行时 API；后者落在 `extension-file:` 只读闭合虚拟树（`registerExtensionFile`，与被禁的 `file:` overlay API 完全不同 scheme/用途）。theme-defaults 的构建期产物就是「registerExtension + N 行 registerFileUrl」模板；其资源已注册进 `extension-file:` 树，**文件字节今天就可经 IFileService 读取**——断的只是 extension point 分发。
- `getBuiltinExtensions()` 由 api 包导出——正是 AGENTS.md 允许的「惰性静态 contribution registry」读取面。
- `IWorkbenchThemeService.setColorTheme()` 显式接受裸 `ColorThemeData` 实例（instanceof 分支），`ColorThemeData` 类可经深子路径导入——**Plain 可完全绕开 ExtensionsRegistry/IExtensionService，自行枚举 manifest → 构造 ColorThemeData → 应用**。

### 上游安全空白（必须 Rust 自建）

- include 链**无循环/深度防护**（`_loadColorTheme` 纯递归，自环=资源耗尽挂起）：Rust 侧 visited-set + 深度上限（32）先验校验，通过后才允许注册；上游递归加载因此安全。
- Code OSS 自带 zip 解包是反面教材（字符串前缀判断、`mkdir recursive` 跟随符号链接）：采用 `zip` crate（8.6.0，`ZipArchive::new` 吃已打开 File 句柄、`enclosed_name` 内建 zip-slip 校验、`is_symlink`/`size` 逐条目检查），按条目手动迭代 + cap-std capability-relative 写入，绕开其 ambient `extract()` 便捷方法；条目数/单条/累计字节上限齐备。
- JSONC 方言：`jsonc-parser`（0.33.0）配 `{allow_comments, allow_trailing_commas}` 精确复刻上游 `ParseOptions.DEFAULT`（不含 JSON5 其余扩展），自带 512 层嵌套上限。
- `contributes.themes[].path` 越界在上游只是 warning；真正防线是 `extension-file:` 闭合树的 404——Plain 在 Rust 侧仍做显式路径校验（相对、无 `..`、命中解包清单）。

### 格式事实

- VSIX：zip，manifest 在 `extension/package.json`，主题 path 相对 `extension/` 剥离后的根；`uiTheme` 四值 `vs`/`vs-dark`/`hc-black`/`hc-light` 直接透传 `ThemeTypeSelector`。
- 解包目录导入与 VSIX 共享同一 manifest/主题校验管线，仅输入枚举不同。
- 持久化现状：`vscode-userdata:` 是纯内存 provider，无任何设置持久化；`IPreferencesService` 是全方法 throw 的桩。主题选择的跨会话保留由 Rust theme 域自带的小型持久面承担（staged 原子写先例），不建通用 settings 域（留待后续 feature）。

## 技术方案

### 决策 1：Plain 自有主题注册与选择（不接 extensions-service）

- 不引入 `extensions-service-override`（边界不动）；`NullExtensionService` 保持。
- `PlainThemeRegistry`（app/features/themes/）：启动时从 `getBuiltinExtensions()` 过滤含 `contributes.themes` 的 manifest（今天即 theme-defaults 的 10 个），资源经既有 `extension-file:` 树读取；每条构造 `ColorThemeData.fromExtensionTheme` 等价实例，list 供选择器用。
- `PlainThemePicker`：接管 `workbench.action.selectTheme` 的用户面（自建 Quick Pick，列内置 + 已导入主题；即时预览、Esc 还原、Enter 应用——行为对齐上游 picker 的核心语义，不复刻 marketplace 兜底）。应用 = `setColorTheme(实例)`。
- 默认主题：启动时应用 Dark Modern（上游默认深色），替换裸占位符；跟随系统亮暗可后续 feature，不在本项。

### 决策 2：Rust theme 域

- 新建 `src-tauri/src/theme/`：Cargo 精确新增 `zip`、`jsonc-parser`；许可证记录。
- 主题库：`<app_local_data_dir>/themes/<theme-package-id>/`（复用 backup 域的 base_path 自举与 staged 原子写/Drop 清理范式）；包 id 由 publisher.name@version 派生并做文件名白名单校验。
- 命令闭集（预计）：`theme_import_vsix`（文件选择器 `.vsix` filter → 解包 → 校验 → 入库 → 返回已验证 manifest 摘要）、`theme_import_directory`（目录选择器 → 同管线）、`theme_list`（库内已验证包清单）、`theme_read_resource`（按包 id + 白名单相对路径读字节，8 MiB 上限）、`theme_remove`（删除已导入包）、`theme_get_selection`/`theme_set_selection`（持久化当前主题 id，staged 原子写）。
- 校验管线（导入时一次性）：zip 安全解包（或目录有界拷贝）→ `extension/package.json` JSONC 解析 → 白名单只读 `contributes.themes`（含 `iconThemes`/`productIconThemes` 字段保留给 F060，不处理）→ 每个主题 JSON/include 链解析（cycle/depth/大小上限）→ `.tmTheme` plist 结构校验 → 无静态主题贡献的包整体拒绝（product-scope 明言）→ 拒绝时不留半成品（staged 目录整体丢弃）。`main`/`browser`/`activationEvents` 字段仅作为「存在即记录、绝不执行」处理。
- 前端消费：`theme_list`/`theme_read_resource` → blob URL → `registerFileUrl` + `registerExtension(manifest, undefined)`（官方声明式 API）→ 进入 PlainThemeRegistry 清单；应用路径与内置主题一致。

### 决策 3：持久化

- 当前主题 id 由 Rust `theme_get/set_selection` 持久化（启动读取 → 应用对应主题；id 失效回退默认并如实提示）。不注册假的 `workbench.colorTheme` 配置写入路径（内存配置仍会被上游读取，但权威在 Rust selection——文档化这一分工，避免双写漂移）。

### 切片拆分

1. **S0 内置主题激活与选择器**：PlainThemeRegistry + PlainThemePicker + 默认 Dark Modern + Browser 证据（列表 10 项、切换真实生效、CSS 变量/主题 class 出现、Esc 还原）；修复静默缺口并以测试锁定「不再是裸占位符」。
2. **S1 Rust VSIX 安全解包**：zip crate 接入、capability-relative 落库、zip-slip/symlink/条目数/字节上限、结构化拒绝、无半成品；目录导入共用管线。
3. **S2 Rust manifest/主题校验**：JSONC 方言、include cycle/depth、tokenColors/tmTheme/semanticTokenColors 结构校验、白名单抽取、恶意 fixture 全矩阵（zip-slip、symlink、bomb、include 自环/互环、越界 path、超大资源、无主题贡献包）。
4. **S3 导入 UX 与注册消费**：文件/目录选择器命令、blob URL + registerExtension/registerFileUrl 消费、导入主题进入选择器并可应用/移除、失败可见反馈。
5. **S4 持久化与收口**：selection 持久化 + 启动应用、E2E 交接条目（真实 VSIX 桌面导入）、evidence 闭环、切换 F060。

## 排除项

- 不引入 extensions-service-override/Extension Host；不做 marketplace/gallery；不做 icon/productIcon 主题（F060）；不做语义 token provider；不建通用 settings 域/Settings UI；不做系统亮暗自动跟随。
- 第三方主题资源不打包进仓库；fixture 自造最小主题包。

## 验收

每切片：定向单元/Harness → 聚焦 Browser → 全量 Browser → 完整 `pnpm check`；S2 恶意 fixture 矩阵是 testing.md「VSIX zip-slip、zip bomb 上限、JSONC/include cycle、资源越界」要求的直接落点。桌面证据由 Codex 按交接清单执行。

## 实施偏差记录（S0-S3，S4 收口时补记）

本节从 progress.md 对应切片条目提炼，记录本方案在真实实现中被修正或补强的具体点——研究阶段的调研结论本身没有错，但下列细节是方案冻结时未预判、只有落地时才暴露的事实。

1. **`IExtensionResourceLoaderService` 桩必须自建（S0）**：方案「决策 1」只规划了 `PlainThemeRegistry`/`PlainThemePicker` 两个新文件；实现时发现 `ColorThemeData#ensureLoaded`/`WorkbenchThemeService.setColorTheme` 都直接依赖 `IExtensionResourceLoaderService.readExtensionResource` 读主题 JSON 字节，而两个既有 override 包（`theme-service-override`/`files-service-override`）都未提供真实实现，只剩 `missing-services.js` 的全抛异常桩——不补上这一层，内置主题和后续导入的主题都无法真正加载。新增 `PlainExtensionResourceLoaderService`（唯一新增 `SyncDescriptor`）只包一层已有的 `IFileService`，未引入任何新的文件系统访问面。
2. **内置主题标签在 `initialize()` 前注册时从未被翻译（S0）**：VS Code 自身的 `ExtensionManifestTranslator` 只在 `servicesInitialized` 之后的 `deltaExtensions` 分支运行；内置 `theme-defaults` 经 `registerExtension` 在 `initialize()` 之前注册，永远不会触发该分支，因此构建期 manifest 的 `label` 字段恒为未翻译的 `%key%` 占位符。方案原文未提及这一点；`createPlainThemeRegistry` 因此新增了逐扩展读取自身 `package.nls.json` 并手工解析 `%key%` 占位符的一步。
3. **`enclosed_name()` 的 zip-slip 防护弱于研究文档的表述（S1）**：研究文档称 `zip` crate 的 `enclosed_name` 「内建 zip-slip 校验」；实现时发现它只挡「`../` 深度下溢」这一种越界，对纯粹的前导 `/` 绝对路径或 Windows 盘符前缀是「剥前缀当相对路径处理」而非拒绝（上游注释原话：「allows extraction of ZIP files with absolute paths」）。已通过独立的 `RelativePath::parse_wire` 校验层补足这一差距，不依赖该 API 的部分覆盖。
4. **发布 rename 在「目标已存在」上的错误码有平台/文件系统差异（S2）**：`Staging::publish_as` 把已存在的目标包目录（`publisher.name@version` 语义身份冲突）identically 视为「重复导入」而拒绝，但底层 `rename(2)` 对「目标是已存在的非空目录」这一情形，在不同平台/文件系统上可能报告 `io::ErrorKind::AlreadyExists` 或 `DirectoryNotEmpty` 两种不同 kind（macOS 与多数 Linux 文件系统实测为后者）。两种 kind 均映射为同一个 `THEME_PACKAGE_ALREADY_IMPORTED`，方案原文未预判需要同时匹配两种 kind。
5. **单一 `themes[].path` 白名单不足以覆盖 include 链与 tmTheme 引用，`resources` 清单随之扩展（S3）**：S2 阶段的 `StoredThemePackageManifest` 只记录每个 `contributes.themes[]` 条目自身的 `path`；实现 S3 的 `theme_read_resource` 白名单读时发现，一个主题文档可能通过 `include` 引用别的 JSON 文件，或通过 `tokenColors` 字符串引用一个 `.tmTheme` 文件，这些文件同样需要被前端 `registerFileUrl`，但当时的记录结构完全没有位置存放它们。为此扩展 `theme_json.rs` 的校验函数新增 `resources: &mut BTreeSet<String>` 出参，`import.rs` 收集后写入 `StoredThemePackageManifest` 新增的 `resources` 字段——这是研究文档「决策 2」命令闭集描述之外、落地时才发现必须扩展的存储结构。
6. **`registerExtension` 在 `initialize()` 之后调用时 `canAddExtension` 恒短路，且不暴露 `location`（S3）**：研究文档「可用的官方 seam」一节确认了 `registerExtension`/`registerFileUrl` 是公开声明式 API，但未预判其在 Workbench 启动完成之后调用的具体行为——真实源码证实 `NullExtensionService.canAddExtension()` 恒返回 `false`，因此导入的包「加入 `IExtensionService`」这一步恒是无操作，永远不会出现在 `getBuiltinExtensions()` 等任何可枚举面（但完全不影响功能：`registerFileUrl` 走的是独立于该步骤的 `extension-file:` 虚拟树注册，与内置主题构建期产物同一条底层机制）；同时，由于这一步是空操作，`registerExtension` 的返回值不提供任何方式取回其 `location`——`plain-theme-import-coordinator.ts` 因此按内置主题同款公式（`${publisher}.${name}` + 固定 `/extension` 路径）本地重算，而不是读取返回值。
