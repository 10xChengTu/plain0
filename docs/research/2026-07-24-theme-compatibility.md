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
