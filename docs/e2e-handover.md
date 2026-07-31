# 端到端桌面验收交接清单（Codex 执行）

更新时间：2026-07-30（新增 E2E-013：`F130` 最终验收收口后，对 E2E-001 至 E2E-012 共 12 条待执行条目的总览、十条产品需求交叉索引与建议执行顺序）

## 分工模式

自 2026-07-22 起（用户指示）：Claude 负责实现与所有可自动化的本机测试——单元测试、Rust 测试、确定性 Tauri IPC mock 的 Browser E2E（Playwright）、架构/bundle guard；**真实 Tauri 桌面（Computer Use / 人工驱动）验收不再由 Claude 执行**，全部登记在本清单，最终由用户交接给 Codex 统一执行。

- Claude 每完成一个涉及桌面验收面的垂直切片，必须向本清单追加对应条目（含前置、fixture、步骤、断言、清理），并在 `features.json` 对应 feature 的 `platformGaps` 中引用本清单。
- Codex 执行完成后，应把结果回写到对应 feature 的 evidence，并在本清单勾选。

## 执行环境纪律（适用于全部条目）

1. 构建与绑定：统一 `pnpm tauri:build:e2e`，把 `src-tauri/target/debug/bundle/macos/Plain.app` 解析为**当前仓库绝对路径**后再启动；不得按 `com.plain.editor` bundle id 绑定（旧 `.app` 会造成假阳性/假阴性）。`pnpm tauri:dev:e2e` 的裸二进制无 `CFBundleIdentifier`、不经 LaunchServices，桌面自动化授权层结构性不可见，**不能**用于取样（详见 docs/testing.md）。
2. 首个取样必须轮询至 Activity Bar 出现 Explorer 或 `#plain-bootstrap-status` 明确报错；瞬时空白不是结果。
3. macOS 目录选择器内部列表由系统 XPC 服务（openAndSavePanelService）渲染，自动化点击不可达；导航一律用 `Cmd+Shift+G` 键入绝对路径。
4. 合成键盘在真人键鼠活动时会被让位中止（"user interrupt"）；执行前需确保真实空闲窗口，且注意自动化 wait 原语同样会被该信号打断，墙钟等待应在 shell 层完成。
5. 不可逆确认按钮（如永久删除）点击前必须取得用户即时确认。
6. fixture 放在仓库外临时目录；结束后删除 fixture、截图，并删除 `src-tauri/target` 等大体积构建产物（验收失败时保留以便复跑）。
7. 每步 UI 操作后用 shell 在磁盘核对（字节数、SHA-256）；UI 观察与磁盘核对都要记录。

## 待执行条目

### E2E-001 · F020 真实 multi-root 桌面矩阵（阻塞 F020 的最终原生证据）

状态：待执行。Browser mock 层证据已全部闭合（多根投影/写链/watcher/失败矩阵，见 progress.md 与 `tests/browser/workspace.spec.ts`）；单根真实桌面验收（目录选择器、CRUD、保存、FSEvents 收敛、确认永久删除的取消与执行）已在此前会话通过。本条目补 multi-root 的原生层。

fixture（临时目录中创建）：

- `plain-mr-primary/`：`README.md`（任意短内容）+ 空目录 `src/`
- `plain-mr-secondary/`：`notes.txt`、`move-source.txt`

步骤与断言：

1. 双根投影：Open Folder（`Cmd+Shift+G`）打开 primary → 命令面板 `Add Folder to Workspace` 加入 secondary → Explorer 双根与各自文件正确。
2. 跨根磁盘写链（每步磁盘核对）：primary 新建 `real-note.txt` 输入精确内容保存；secondary `notes.txt` 改写保存；`README.md` 跨根 Copy/Paste（源保留、目标一致）；`move-source.txt` 跨根 Cut/Paste 到 primary `src/`（源消失、内容不变）。
3. 每根独立 FSEvents（全程不点 Refresh）：shell 分别在两根外部创建文件 → Explorer 自动出现；shell 删除其一 → 自动消失；记录收敛时长。
4. root 生命周期：Explorer 右键移除 secondary → 仅剩 primary；命令面板移除 primary → EMPTY（Open Folder 可见）→ 重新打开 primary 成功。
5. 收尾：Cmd+Q；清理 fixture/截图/`src-tauri/target`；`git status --short` 干净。

完成后：将结果写入 `features.json` F020 evidence（nativeScenarios 追加、platformGaps 移除对应缺口）。

### E2E-002 · F020 multi-root 永久删除桌面正向路径（可选补强）

状态：待执行（低优先级）。单根真实永久删除（含取消路径与用户确认后的执行路径）已通过；本条目在双根 workspace 中重复一次「右键/⌘Backspace → DOM 确认 → 永久删除 → Explorer 与磁盘同步消失」。不可逆点击前必须取得用户即时确认。

### E2E-003 · F030 热退出恢复的真实桌面矩阵

状态：待执行。Browser mock 层已闭合（编辑不保存 → reload → 自动恢复 dirty → 保存 discard → 不再复活，22/22 E2E 含此链）；本条目补真实 WKWebView/磁盘/进程层。

fixture：临时 workspace（含一个文本文件）。

步骤与断言：

1. 打开 workspace → 编辑文件不保存（tab 脏点 + Activity Bar 脏计数徽章可见）→ 等待 backup 落盘（`~/Library/Application Support/<app>/backups/<64位十六进制身份>/` 下出现条目文件；身份由 canonical roots 哈希派生，同 workspace 重开应相同）。
2. **强杀进程**（`kill -9`，模拟崩溃）→ 重启应用 → 重开同一 workspace → 断言编辑器自动恢复为 dirty、内容含未保存编辑。
3. 保存 → 磁盘内容正确、backup 目录条目消失；再次重启重开 → 无恢复 tab。
4. 外部删除已打开文件（真实 FSEvents）→ tab 出现删除线装饰（`.monaco-icon-label.strikethrough`）；外部恢复 → 装饰消失。
5. 保存冲突真实路径：外部改写文件后在 app 内 `Cmd+S` → 冲突通知（动作恰为 Reload/Save As.../Details，无 Retry/Overwrite）→ Reload 后内容为外部版本。
6. 清理：退出、删除 fixture 与 backup 目录、删除 `src-tauri/target`。

已知边界（执行方须知）：真实 `WindowEvent::CloseRequested` 关窗握手（关窗前保证 backup 落盘的 veto/等待协议）**尚未实现**——Plain tracker 的 `onFinalBeforeShutdown` 恒不 veto，正常关窗时最后一次节流备份可能未落盘；崩溃路径（kill -9）依赖此前已完成的节流备份。该协议属后续工作项，本条目按现状验收即可，发现关窗竞态属预期，不算回归。

### E2E-004 · F040 Quick Open、搜索与替换的真实桌面矩阵

状态：待执行。Browser mock 层已闭合（S1-S4 全部场景：文件/文本搜索、ignore/exclude 矩阵、流式取消、替换与版本冲突交互，见 progress.md 与 `tests/browser/workspace.spec.ts`）；本条目补真实磁盘、真实大目录规模和 WKWebView 层，这些是 mock 无法替代的维度。

fixture（临时目录中创建）：

- 一个真实规模较大的目录树（至少数千个文件），根目录一个 `.gitignore` 忽略其中一个子目录；该子目录之外的另一个子目录自带独立的 `.gitignore`，再忽略其内部一个文件——用于验证多层 `.gitignore` 按目录分层精确生效，而不是只认根 `.gitignore` 或被上层短路。
- 该目录树内包含至少一个 `node_modules/` 目录（内含若干文件）——用于验证 F040 S5 新注册的 `search.exclude` 默认（`**/node_modules` 等）在真实磁盘规模下确实生效。
- 一个独立的小文本文件，专用于替换版本冲突步骤。

步骤与断言：

1. 大目录真实文本搜索性能与取消：`Cmd+Shift+F` 打开 Search 视图，搜索一个在树中出现次数较多的词，观察流式结果开始渲染的真实时延；在结果尚未完成前清空并输入另一个查询词，断言旧搜索被真实取消（旧查询不再产生新的可见批次，UI 无残留旧结果、无报错）。
2. 真实 `.gitignore`/多层 ignore：确认根 `.gitignore` 忽略的子目录内容完全不出现在 Quick Open 与 Search 结果中；另一个子目录自带 `.gitignore` 忽略的单个文件同样不出现，但同目录下未被忽略的兄弟文件正常出现。
3. `search.exclude` 默认：`node_modules/` 目录下的文件不出现在默认 Quick Open 或 Search 结果中，即使其内容或文件名与查询匹配。
4. Cmd+P 打开文件：在真实大目录树中用 Cmd+P 搜索一个文件名片段，Enter 打开，确认编辑器内容与磁盘该文件内容一致。
5. 替换含版本冲突路径：对专用小文件的一个匹配点击 Replace；若能可靠复现真实竞态窗口，则在点击到保存完成之间用 shell 改写同一文件模拟外部竞争；若时机不可靠复现，退化为——先完成一次正常替换并核对磁盘，再对同一文件手工制造一次「UI 未刷新旧版本上的替换」（例如 shell 改写后立即在 UI 侧对仍显示旧内容的匹配点击 Replace）——断言该次替换走 `FILE_MODIFIED_SINCE` 冲突链，通知动作只有 Reload/Save As/Details（无 Retry/Overwrite），磁盘内容与 UI 呈现的冲突状态一致。
6. 每步 UI 断言后用 shell 在磁盘核对实际内容/SHA-256（尤其是替换前后的文件）。
7. 清理：退出应用；删除大目录 fixture、截图与 `src-tauri/target`。

已知边界（执行方须知）：

- Browser mock 的 gitignore/exclude glob 匹配是刻意简化的子集（精确名、单段名、`*.ext` 后缀、`!` 否定、`**/name`、`**/name/**`，见 `app/platform/tauri/browser-mock.ts` 的 `compileMockExcludeGlob`）；真实 Rust 侧用 `globset` 与 `ignore::gitignore::GitignoreBuilder`，语义更完整。本条目步骤 2/3 是这一更完整语义在真实文件系统、真实规模下的唯一验证点，Browser mock 层不能替代。
- 正则不支持 `usePCRE2`/lookaround/backreference，替换不支持捕获组反向引用（`$1` 风格）——这两点如果在本条目执行中意外被观察到，应按既有已知限制记录，不算新发现的缺陷。
- 每窗口活跃搜索的取消是 best-effort（新查询会立即在前端丢弃旧结果并让 Rust 释放对应队列），不提供跨进程强一致的"已完全停止"信号；步骤 1 断言的是可观察的 UI/结果层面停止，不是 Rust 内部线程退出的证明。

完成后：将结果写入 `features.json` F040 evidence（`nativeScenarios` 追加、`platformGaps` 移除对应缺口）。

### E2E-005 · F050 VS Code 主题兼容的真实桌面矩阵

状态：执行中（2026-07-31 已完成步骤 1-2）。真实系统文件选择器导入合法 VSIX 成功，toast 与 `<app_local_data_dir>/themes/` 磁盘内容均核对通过；首次真实完全退出/重启暴露出 Workbench 布局恢复晚于 Plain 主题 apply 的 WKWebView 启动竞态，已改为等待 `LifecyclePhase.Restored` 后再应用三轴默认/持久化主题，并以重新构建的当前绝对路径 debug `.app` 复核 `E2E Demo Dark` 启动即恢复。步骤 3-4（恶意包拒绝、删除回退及再次重启）仍待执行。Browser mock 层原有证据已全部闭合（S0-S4：内置主题激活与选择器、Rust VSIX/目录安全解包、manifest/主题校验与恶意 fixture 矩阵、导入 UX 与注册消费、selection 跨会话持久化与失效 id 回退，见 progress.md 与 `tests/browser/workspace.spec.ts`）。

fixture（临时目录中构造，不提交仓库）：

- 一个真实、最小的合法主题包 VSIX：
  1. 建目录 `demo-theme/extension/`，写入 `package.json`：
     ```json
     {
     	"name": "demo-theme",
     	"publisher": "plain-e2e",
     	"version": "1.0.0",
     	"engines": { "vscode": "*" },
     	"contributes": {
     		"themes": [
     			{
     				"label": "E2E Demo Dark",
     				"uiTheme": "vs-dark",
     				"path": "./themes/demo-dark.json"
     			}
     		]
     	}
     }
     ```
  2. 写入 `demo-theme/extension/themes/demo-dark.json`：`{"colors": {"editor.background": "#0a0a0a"}, "tokenColors": []}`（一个有辨识度、不与任何内置主题冲突的背景色，用于后续步骤的即时肉眼/CSS 变量核对）。
  3. 在 `demo-theme/` 目录内执行 `zip -r ../demo-theme.vsix extension`（`extension/` 是包内容的固定顶层前缀），产出标准 zip 容器的 `demo-theme.vsix`。
- 一个 zip-slip 恶意 VSIX：复用上面的合法内容，额外加入或替换一个条目名形如 `extension/../../evil.json`（或依本地 `zip`/`python zipfile` 实际行为改用等价的越界写入路径）的畸形归档条目。
- 一个「无主题包」VSIX：合法 zip、合法 `extension/package.json`，但 `contributes` 不含 `themes` 字段（例如一个不声明任何主题贡献的普通扩展 manifest）。

步骤与断言：

1. 真实系统文件选择器导入：命令面板执行 `Plain: Import Color Theme (VSIX)...`，确认弹出的是系统原生文件选择器（非任何模拟/mock 面板）；导航到合法 `demo-theme.vsix` 并选择；断言导入成功 toast 含 `plain-e2e.demo-theme@1.0.0`，Color Theme Quick Pick 中出现 "E2E Demo Dark"。
2. 应用并重启保持：选择该主题，确认 `--vscode-editor-background` 变为 `#0a0a0a`；**完全退出应用（Cmd+Q）并重新启动**（不是页面 reload，是真实进程重启）；重开同一份用户数据目录后应用应在启动完成时即已是该主题，不需要用户重新选择——这是 `theme_get_selection`/`theme_set_selection` 与主题库导入记录二者在真实磁盘上协同持久化的核心证据。
3. 恶意 VSIX 拒绝且去敏：分别对 zip-slip VSIX 与无主题包 VSIX 执行导入命令；断言两者都被拒绝并出现错误 toast，且 toast 文案不包含内部错误码原文（`THEME_PACKAGE_UNSAFE_PATH`/`THEME_PACKAGE_NO_THEMES`）或任何文件系统路径；用 shell 核对 `<app_local_data_dir>/themes/` 下没有为这两次失败导入留下任何半成品（不存在 `.plain-theme-*.tmp` 残留目录，也不存在以这两个失败包命名的已发布目录）。
4. 删除导入主题回退：确认当前主题为已导入的 "E2E Demo Dark"；命令面板 `Plain: Remove Imported Color Theme...` 移除 `plain-e2e.demo-theme@1.0.0`；断言主题立即回退为 Dark Modern（`#1f1f1f`）、Quick Pick 中不再列出 "E2E Demo Dark"；**再次完全退出并重启应用**，断言依旧是 Dark Modern（证明 selection 的清除同样落盘持久化，不只是内存态）；用 shell 核对 `<app_local_data_dir>/themes/` 下该包目录已不存在，且 `selection.plain.json` 或缺失、或其中不含该包对应的主题 id。
5. 每步 UI 断言后用 shell 在磁盘核对 `<app_local_data_dir>/themes/` 的实际内容（目录清单、`selection.plain.json` 是否存在及其内容、确认无残留 staging 目录）。
6. 清理：退出应用；删除 fixture VSIX、本次测试新建的主题库内容、截图与 `src-tauri/target`；如与既有隔离 WebView profile/临时用户数据目录惯例冲突，按既有隔离约定操作，不得污染真实用户数据。

已知边界（执行方须知）：

- 恶意 fixture 的完整闭集（zip bomb、条目数超限、include 环/深度超限、越界路径等 23 个错误码的全部场景）已在 Rust 单元测试层逐项覆盖（`src-tauri/src/theme/unpack/tests.rs`、`theme_json/tests.rs` 等，见 progress.md S1/S2 条目）；本条目只挑 zip-slip 与无主题包两个最具代表性、最依赖真实系统文件选择器路径的场景做桌面级复核，不重复整张矩阵。
- 目录导入（`Plain: Import Color Theme (Folder)...`）与 VSIX 导入共用同一校验管线（见 docs/research/2026-07-24-theme-compatibility.md「决策 2」），本条目只验收 VSIX 路径；目录导入的等价复核不是阻塞项。
- 图标主题（`iconThemes`/`productIconThemes`）留给 F060：本条目 fixture 不声明这两个字段；即便声明，Plain 当前只原样保留而不消费，观察到这一点属预期，不算缺陷。
- 不跟随系统亮暗、无 Settings UI、导入主题不携带 `contributes.themes[].id`（用解析出的 label 或路径 basename 兜底）均为既定收窄，出现属预期。

完成后：将结果写入 `features.json` F050 evidence（`nativeScenarios` 追加、`platformGaps` 移除本条目对应缺口）。

### E2E-006 · F060 文件与产品图标主题的真实桌面矩阵

状态：待执行。Browser mock 层已全部闭合（S1 Rust 校验管线含 SVG 净化/字体 magic bytes/恶意 fixture 矩阵；S2 内置 `vs-minimal` 真实 DOM 渲染与两个 Quick Pick 激活；S3 导入包 `iconThemes`/`productIconThemes` 的 DTO 投影、双 icon selection 跨会话持久化、启动应用、None/Default 保留 sentinel、失效回退，见 progress.md 与 `tests/browser/workspace.spec.ts`）；本条目补真实系统文件选择器、真实 SVG/字体文件在真实 WKWebView 中的渲染，以及真实进程重启持久化——这些是 Rust 单元测试与 Browser mock 都无法替代的维度。复用 E2E-005 已验证过的 VSIX 构造与系统选择器路径，不重复该矩阵。

fixture（临时目录中构造，不提交仓库）：

- 一个真实、最小但同时携带三类贡献的合法 VSIX（复用 E2E-005 的 zip 打包步骤）：
  1. `icon-theme-demo/extension/package.json`：
     ```json
     {
     	"name": "icon-theme-demo",
     	"publisher": "plain-e2e",
     	"version": "1.0.0",
     	"engines": { "vscode": "*" },
     	"contributes": {
     		"themes": [
     			{
     				"label": "E2E Icon Demo Dark",
     				"uiTheme": "vs-dark",
     				"path": "./themes/demo-dark.json"
     			}
     		],
     		"iconThemes": [
     			{
     				"id": "e2e-demo-icons",
     				"label": "E2E Demo Icons",
     				"path": "./fileicons/demo-icon-theme.json"
     			}
     		],
     		"productIconThemes": [
     			{
     				"id": "e2e-demo-picons",
     				"label": "E2E Demo Product Icons",
     				"path": "./picons/demo-picon-theme.json"
     			}
     		]
     	}
     }
     ```
  2. `themes/demo-dark.json`：`{"colors": {"editor.background": "#0a0a0a"}, "tokenColors": []}`。
  3. `fileicons/demo-icon-theme.json`：`iconDefinitions` 至少含 `_file`（`iconPath` 指向同目录下一个真实、视觉上有辨识度的 `.svg`，例如一个纯色矩形或一个明显不同于 `vs-minimal` 默认图形的形状）、`_folder`，并把 `file`/`folder` 映射到它们；再放一个真实 `.svg` 资源文件。
  4. `picons/demo-picon-theme.json`：`iconDefinitions` 至少覆盖一个真实会被渲染的 codicon id（例如 Explorer 图标用到的那个），`fonts` 非空且指向同目录下一个真实字体文件（`.woff`/`.woff2`，真实合法的字体二进制，不是伪造字节——这是与本文档「实施偏差记录」第 6 条一致的真实性要求，否则上游会在真实浏览器里拒绝或警告）。
  5. 按 E2E-005 的 `zip -r` 步骤打包为 `icon-theme-demo.vsix`。
- 一个恶意 SVG VSIX：复用上面的合法内容，只把 `_file` 的 `iconPath` 换成一个含 `<script>alert(1)</script>` 或 `onload="alert(1)"` 事件属性的 `.svg`。

步骤与断言：

1. 真实系统文件选择器导入：命令面板 `Plain: Import Color Theme (VSIX)...` 选择 `icon-theme-demo.vsix`；断言导入成功 toast 含 `plain-e2e.icon-theme-demo@1.0.0`。
2. 三类主题真实生效：`Preferences: File Icon Theme` 列出 "E2E Demo Icons" 并选中，Explorer 中文件/目录行的 `.monaco-icon-label::before` `background-image` 变为该主题自己的 SVG（肉眼与 CSS 均可核对，非 `vs-minimal` 默认图形）；`Preferences: Product Icon Theme` 列出 "E2E Demo Product Icons" 并选中，Activity Bar 对应图标真实变化为该主题字体渲染的字形（不是回退到内置 codicon）；`Preferences: Color Theme` 应用 "E2E Icon Demo Dark"，`--vscode-editor-background` 为 `#0a0a0a`。
3. 三轴重启保持：**完全退出（Cmd+Q）并重新启动**（真实进程重启，非页面 reload）；重开同一份用户数据目录后应用启动完成时三个轴应已分别是上一步选中的主题，不需要用户重新选择；用 shell 核对 `<app_local_data_dir>/themes/selection.plain.json` 同时含 `themeId`/`fileIconThemeId`/`productIconThemeId` 三个字段且均指向该导入包。
4. 恶意 SVG 包拒绝且去敏：导入恶意 SVG VSIX，断言被拒绝、错误 toast 不含内部错误码原文（`THEME_SVG_UNSAFE`）或文件系统路径；用 shell 核对 `<app_local_data_dir>/themes/` 下无该失败导入的半成品目录或 `.plain-theme-*.tmp` 残留。
5. 每步 UI 断言后用 shell 在磁盘核对 `<app_local_data_dir>/themes/` 的实际内容（该包目录内 SVG/字体资源字节、`selection.plain.json` 内容）。
6. 清理：退出应用；删除 fixture VSIX、本次测试新建的主题库内容、截图与 `src-tauri/target`；遵循既有隔离 WebView profile/临时用户数据目录惯例，不得污染真实用户数据。

已知边界（执行方须知）：

- 本条目只验收 VSIX 路径，不复核目录导入（与 E2E-005 相同的既定收窄）。
- `embedded-opentype`（EOT）字体格式在 Rust 校验闭集下恒被拒绝（S1 已知限制），fixture 不使用该格式。
- None/Default 的持久化保留 sentinel（`plain:no-file-icon-theme`/`plain:default-product-icon-theme`）是纯前端持久化编码细节，本条目不需要专门验证——只要三轴重启后行为符合预期（步骤 3）即已覆盖其真实效果；无需在磁盘上断言 sentinel 字面值。
- 图标/字体资源的 MIME 映射、SVG 净化规则闭集、字体 magic bytes 闭集已在 Rust 单元测试与 Browser mock 层逐项覆盖（见 progress.md F060 S1/S2/S3 条目），本条目不重复整张矩阵，只挑「真实文件在真实 WKWebView 中确实渲染」与「真实进程重启持久化」两个 mock 无法替代的维度。

完成后：将结果写入 `features.json` F060 evidence（`nativeScenarios` 追加、`platformGaps` 移除本条目对应缺口）。

### E2E-007 · F070 真实桌面终端矩阵（真实 shell、resize、多 tab/split、trust、高吞吐）

状态：待执行。Browser mock 层已全部闭合（S1 trust/PTY 域 Rust 测试：`stable_roots_identity` 持久化 grant/revoke/is_trusted、`FlowControl` 高低水位 hysteresis 单元测试与真实子进程吞吐测试 `output_well_beyond_the_high_water_mark_still_arrives_completely_and_in_order`——2,200 行/约 112 KiB、远超 100,000 字节高水位，验证真实暂停/恢复、字节不丢、序列号严格连续；VT 集成 `vt.rs` 分片测试——一个 SGR 转义序列在两次 `feed()` 调用间的全部 17 个可能切分点、以及逐字节切分，均与整段一次喂入结果逐位相同，另加一个跨两次 `feed()` 拆分的多字节 UTF-8 字符正确解码；IPC 改造的帧级单帧信用背压 `frame_emission_is_gated_until_the_previous_frame_is_acked`；WebView DOM 渲染 + trust UX 与多 tab/split/scrollback 的全部 Browser E2E；本切片新增的高吞吐 mock Browser E2E——500 行无让出的突发写入被单帧信用门合并为个位数 `terminal_ack` 往返、内容不丢、页面在突发后仍立即响应键盘输入，见 `tests/browser/workspace.spec.ts` 与 `src-tauri/src/terminal/{flow.rs,vt/tests.rs,service/tests.rs}`）；本条目补真实 shell 进程、真实 WKWebView 渲染管线、真实操作系统调度下的高吞吐与多进程生命周期这几个 mock/单元测试无法替代的维度。

fixture（临时目录中创建，不提交仓库）：

- 一个空目录作为未信任的 workspace 根（专用于步骤 1 的 trust 矩阵，避免与已有信任状态的目录混用）。
- 一个约 50-100 MiB 的临时大文件（用于步骤 5 高吞吐 `cat`；`yes` 命令本身不需要 fixture）。

步骤与断言：

1. 未信任 workspace 的 trust 确认与禁用文案：Open Folder 打开上述全新临时空目录（从未对其执行过信任授权）→ Panel `Plain: Create Terminal` → 断言弹出确认对话框，文案含 "Trust this workspace to run a terminal?"；点击 Cancel → 断言终端保持禁用并显示「已拒绝信任」的解释文案（区别于「空 workspace」的另一种禁用文案——参照 Browser E2E 已验证的两种文案分支）；再次执行 `Plain: Create Terminal` → 这次点击 Trust & Continue → 断言终端真正 spawn 出一个真实 shell（而不是继续停留在禁用态）。
2. 真实 shell 交互：终端就绪后聚焦其隐藏 `<textarea>` 输入 `pwd` 回车，断言回显内容等于该 workspace root 的 canonical 磁盘路径（真实 `cwd`，非 mock 值）；再输入一条产生可辨识输出的命令（如 `echo plain-e2e-terminal-probe`），断言终端网格中出现该文本。
3. resize：调整应用窗口尺寸（或拖拽 Panel 高度），断言终端行列数随真实布局变化——输入 `stty size` 回车，断言回显的行列数与调整后的真实像素尺寸/cell 尺寸换算一致（真实字体度量与 DPI 缩放只有真机可验证，Browser mock 只验证了「resize 信号触发新 `terminal_resize` 调用」这条前端链路）。
4. 多 tab/split 生命周期：`Plain: Create Terminal` 新建第二个 tab，确认两个 tab 各自是独立的真实 shell 进程（在 tab 1 输入一条命令，断言其输出只出现在 tab 1，不出现在 tab 2）；`Plain: Split Terminal Right`（或 Down）在当前 tab 内建立第二个 pane，确认两个 pane 同样各自独立可交互；用 tab 自己的 `×` 关闭其中一个 tab，随即用 shell 层核对（如 `ps -ef | grep <shell 可执行文件>`，或应用自身 Activity Monitor 观察进程列表）确认该 tab 的子进程已真正终止，而未关闭的 tab/pane 不受影响、仍可继续交互。
5. 高吞吐命令下 UI 不卡死：在一个 tab 内运行 `yes`（或 `cat` 步骤 fixture 里的大文件）几秒钟，期间断言应用仍可响应——能切换到另一个 tab、能点击菜单/命令面板、窗口能正常拖拽/最小化，不出现「无响应应用」的系统级提示；用 Ctrl+C 中断该命令，断言终端恢复到可交互的提示符状态；用 shell 层粗略核对该 Tauri 进程的内存占用在命令运行期间保持有界（不无限增长），核对方式与结论记入报告即可，不要求精确数值阈值。
6. 退出语义：完全退出应用（Cmd+Q）前，用 shell 层核对所有 tab/split 对应的子进程仍存活；退出后立即用 shell 层核对这些子进程已全部消失（无残留 zombie 或孤儿进程）——对应 acceptance 第二条「Multiple tabs and splits clean up on window close」的真实进程层证据（Rust 侧 `close_window` 的并发 kill+join 已由单元测试覆盖，本步骤验证的是真实操作系统进程树层面的观感）。
7. 每步 UI 断言后尽量用 shell 层核对真实进程/输出，而不仅凭 UI 呈现下结论。
8. 清理：退出应用；删除未信任 workspace fixture 目录、大文件 fixture、截图与 `src-tauri/target`。

已知边界（执行方须知）：

- 终端内「查找」（acceptance 第一条 search 的一半）在代码级复核后已判定两个平台在当前实现下都不成立——Ctrl+F 在 Windows/Linux 上会被本域自己的按键转发当作真实终端控制序列编码并拦截，macOS 上 WKWebView 也不提供开箱即用的页内查找；Browser E2E 只验证并保证了「可被原生选中」这一半。本条目不需要专门验证「查找」，观察到没有查找功能属预期，不算新发现的缺陷。
- scrollback 历史行无逐字色彩保真度、split 封顶 2 个 pane 且不支持递归再分割、停留在历史视图时新输入不自动跳回实时、无 shell integration（OSC 133/633）、无会话持久化/重连、Windows 平台留给 F120——均为已记录的既定收窄，参见 progress.md F070 多 tab/split/scrollback 切片条目，出现属预期。
- libghostty-vt 与其 Rust binding 均 pre-1.0（API 可能变动）、构建依赖 Zig 0.15.x 与 `.ghostty-vendor/` 本地离线 checkout；这些是供应链层面的已知约束，与本条目桌面验收本身无关，执行方无需重新验证构建过程，只需确保执行机已具备本仓库既有的 `pnpm check` 构建能力。
- 「高吞吐下不卡死」的量化机制证据（PTY→VT 字节级背压的真实吞吐测试、VT→前端单帧信用门、Browser 层 500 行 burst 合并为个位数帧）已在 Rust/Browser 测试层验证了背压机制本身是真实生效的；本条目验证的是这套机制在真实进程调度、真实 WKWebView 渲染管线下的端到端主观观感（应用不卡死、菜单可点、窗口可拖动），这是 mock 层无法替代的最后一环，而不是重新证明背压算法本身。

完成后：将结果写入 `features.json` F070 evidence（`nativeScenarios` 追加、`platformGaps` 移除本条目对应缺口；若未执行则如实标注「已登记未执行」，不得凭本条目文字描述代替真实结果）。

### E2E-008 · F080 S4 真实凭证/SSH agent/远端网络矩阵（fetch/pull/push）

状态：待执行。本切片（S4）的机制层证据已全部闭合，且刻意选择了**完全不触网**的证明手法：`src-tauri/src/git/exec/tests.rs`（`network_mode_fixtures` 模块）用真实 `git` 二进制 + 真实本机 `ssh-agent`（`ssh-add -l` 在 `SSH_AUTH_SOCK` 存在/缺失两种状态下的真实差异）+ `core.sshCommand` 替身脚本证明 `SSH_AUTH_SOCK` 确实透传到子进程环境；用真实 `git credential fill`（无网络的本地凭据子系统调用）证明 `GIT_ASKPASS` 拒绝程序确实优先于仓库自身 `core.askPass` 配置生效、且一个完整满足的 `credential.helper` 响应能让 askpass 全程不被咨询；用真实 `pre-push` hook + 本地 `git init --bare` 充当"远端"证明网络模式放行仓库自身 hooks。`src-tauri/src/git/network/tests.rs` 用同样的本地 bare 仓库手法覆盖 fetch/pull/push 的 porcelain 正确性（ahead/behind 预览、fast-forward、divergence 拒绝、`--force-with-lease` 的合法/过期两种结果）与 `GitNetworkService::request_cancel` 的取消标志本身。Browser E2E 覆盖了预览+确认 UI 全链路（fetch/pull/push 三种确认文案、force push 的独立措辞与按钮、无 upstream 时 pull/push 预览 fail-closed、从不弹窗也从不调用桥接方法、Cancel 按钮在真实进行中的调用期间可点击并触发 `gitNetworkCancel`）。本条目补的是这些机制层证据无法触达的维度：**真实凭据存储**（macOS Keychain/`git-credential-osxkeychain`）、**真实 ssh-agent 对真实远端的完整握手**、**真实网络远端**上的 fetch/pull/push、以及认证失败/凭据缺失时的真实用户可见文案——这些都需要真实桌面 + 真实（或至少真实协议层的）远端，Rust 单元测试和 Browser mock 都无法替代。

fixture（临时目录/临时远端中创建，不提交仓库；具体凭据由执行人自备，不得写入仓库或本清单）：

- 一个真实可写的远程 Git 仓库，通过 **HTTPS**（例如执行人自己名下的一个临时 GitHub/GitLab 仓库）访问，且执行机的 macOS Keychain 中已有一条对应的 `git-credential-osxkeychain` 凭据（可提前用真实终端跑一次 `git push` 触发系统凭据存储弹窗并保存，来预置这条 Keychain 记录）。
- 同一个远程仓库的 **SSH** 形式远端（`git@host:owner/repo.git`），且执行机已有一个加载进真实 `ssh-agent`（`ssh-add -l` 能看到）的部署密钥或个人密钥，对该仓库有推送权限。
- 一个本地 clone，以及至少一次「从另一个 clone 抢先推送」的操作，用于制造真实的 divergence（force-with-lease 的过期 lease 场景）。
- 一个刻意**没有**保存凭据、没有加载 SSH key 的干净测试账号或临时 keychain 项（用于步骤 4 的失败路径）——若难以构造，可改用一个执行人明确无权限的公开仓库（如某个随机开源仓库）充当"权限拒绝"替身，两者都能验证「认证/授权失败必须干净报错，不得挂起」这条核心断言，择一即可，如实记录用了哪一种。

步骤与断言：

1. **HTTPS + Keychain 凭据真实 fetch/pull**：Open Folder 打开上述 HTTPS 远端的本地 clone → 打开 Source Control → 点击 Fetch → 断言预览对话框显示真实的 upstream 名称与 ahead/behind 数字（可用一个平行的真实终端 `git rev-list --left-right --count '@{upstream}...HEAD'` 交叉核对数字完全一致）→ 确认 → 断言真实网络请求发生（可用 `git -C <repo> log -1 origin/<branch>` 之类核对远程追踪分支确有更新，或用系统网络监控粗略确认有出站流量）、UI 无异常挂起、无我们自建的密码输入框弹出（S4 明确不做凭据 UI，应完全依赖系统 Keychain 静默完成）。Pull 同理：确认后断言本地分支被真实快进/合并。
2. **macOS Keychain 首次访问授权对话框的真实交互**（若触发）：若该 Keychain 凭据此前从未被这个具体的 Plain.app 二进制访问过，macOS 可能弹出系统级"是否允许 Plain 访问钥匙串项目"的原生授权对话框——断言这个系统对话框确实需要一次人工点击"始终允许"/"允许"才能继续（而不是我们应用自己的 UI），记录这次交互对整体流程耗时与 UX 的真实影响；确认后续同一会话内的操作不再重复弹出。如实记录该对话框是否出现、出现时机与外观，这是本条目要摸清的一个未知维度，而不是预设结论。
3. **SSH + ssh-agent 真实 fetch/push**：把 remote 切到 SSH 形式（或用第二个 clone），重复步骤 1 的 Fetch/Pull 流程，并额外做一次真实 **Push**（先在本地提交一个可安全撤销的小改动，如追加一行注释到某个非核心文件，推送后再撤销/删除该提交并强制同步回原状，不得污染真实仓库历史）→ 断言 push 预览显示正确的 ahead 数、确认后 push 真实成功、远端可通过网页或另一次 `git ls-remote` 观察到新 commit。核对整个过程中从未有终端风格的 passphrase 提示卡在后台（GUI 应用没有 tty，S4 的硬化专门防止这个）。
4. **认证/授权失败的真实文案，且不得挂起**：用 fixture 中准备好的"无凭据"或"无权限"远端仓库，点击 Fetch 或 Push → 断言应用在合理时间内（不应等到 `GIT_EXEC_NETWORK_TIMEOUT` 的 300 秒上限，真实的认证失败通常几秒内返回）展示一条清晰的错误通知（而不是无响应或原始不可读的 git stderr 堆栈），UI 恢复可交互、可以立即重试或切换到其他视图。这一步是本条目最核心的断言——S4 明确没有做自己的凭据输入 UI，必须验证「干净失败」这个替代承诺在真实系统上真的成立，而不是想象中的行为。
5. **真实 divergence 下 force-with-lease 的合法与过期两种结果**：用两个 clone 制造真实 divergence（clone A 先推送一个新 commit，clone B 在未 fetch 的情况下 `--amend` 自己的最新 commit）→ 在 clone B 里先尝试普通 Push → 断言被拒绝（`GIT_PUSH_REJECTED` 对应的错误通知，提示已有真实历史差异）→ 勾选 Force 复选框（UI 文案含 "cannot be undone"/"--force-with-lease"、按钮为独立的 "Force Push"）→ 确认 → 因为 clone B 自己的 lease（它上次看到的远程状态）其实早已过期（clone A 已经先推送过），断言这次 force push **仍然被拒绝**（真实 `--force-with-lease` 的过期 lease 语义，不是网络层失败）。之后在 clone B 里先 Fetch 一次更新 lease，再重复 force push，断言这次真实成功、远端历史真的被改写为 clone B 的版本。核对全程从未退化为裸 `--force`（该选项在本应用中根本不存在，不需要专门断言"没有裸 force 选项"——UI 上确实找不到）。
6. **Cancel 一个真实卡住的 fetch**：找一种真实、可控地制造"慢" fetch 的方式（例如对一个体积明显较大的真实仓库做首次 fetch、或临时降低本机网络带宽/开代理限速——具体手法由执行人视现场条件选择，如实记录采用的方法）→ 点击 Fetch 并确认 → 在其明显仍在进行中时点击 Cancel 按钮 → 断言：(a) 该次 fetch 调用最终以取消/失败告终而不是继续挂起等到完成或 300 秒超时；(b) 用 shell 层核对对应的 `git` 子进程确已被终止（不是仅仅前端不再等待，底层进程仍在跑）；(c) UI 恢复到可交互状态、可以立即发起新的操作。这是 S4 的"用户必须能中止一个卡住的 fetch"要求在真实操作系统进程调度下的最终证据，机制本身（取消标志 + `wait_with_limits` 轮询）已由 Rust 单元测试证明，本步骤证明的是它在真实慢速网络场景下确实达成预期效果。
7. 每步 UI 断言后尽量用一个平行的真实终端（`git log`/`git rev-parse`/`git ls-remote`/`ps`）交叉核对，而不仅凭 UI 呈现下结论。
8. 清理：退出应用；撤销/清理步骤 3、5 中对真实远端仓库做的任何试验性 commit（不得在共享或生产仓库历史中留下测试痕迹，优先使用执行人自己专门为此创建的临时仓库）；删除本地 clone fixture、截图、`src-tauri/target`；若为测试目的临时调低过网络带宽或加过代理限速，执行完后必须恢复。

已知边界（执行方须知）：

- S4 明确没有实现自己的凭据输入 UI——步骤 1/2/4 验证的正是「完全依赖系统凭据存储 + 干净失败」这一有意收窄的承诺是否在真实系统上成立，而不是缺陷。
- `GIT_NETWORK_ENV_PASSTHROUGH_NAMES` 只透传 `PATH`/`HOME`/`SSH_AUTH_SOCK`，不透传 `SSH_AGENT_PID`——真实 ssh-agent 场景下这不应造成任何功能性影响（SSH 客户端认证只需要 `SSH_AUTH_SOCK`），若步骤 3 观察到与此不符的现象需如实记录为新发现，不得预设"不可能有问题"。
- fetch/pull/push 目前只针对当前分支的已配置 upstream（`@{upstream}`），没有"选择任意远端/分支"或"设置 upstream"的 UI——若执行人期望这类操作，应确认这是已记录的范围收窄而非缺陷（见 `src-tauri/src/git/network.rs` 模块文档）。
- 预览的 ahead/behind 数字反映的是"上次已知的远程追踪分支状态"，不是实时的远端真实状态（除非刚做过 fetch）——步骤 5 的过期 lease 场景正是这一点的直接体现，属预期设计，不是 bug。
- 本条目不重复验证 hooks/fsmonitor/credential/SSH 硬化本身是否生效（那是 S0-S4 的 Rust hostile-fixture 测试职责，已完整覆盖且经真实 `git 2.50.1` 二进制验证）；本条目验证的是这些机制在真实凭据存储、真实网络远端、真实操作系统调度下的端到端可用性与用户可见效果。

完成后：将结果写入 `features.json` F080 evidence（`nativeScenarios` 追加、`platformGaps` 移除本条目对应缺口；若未执行则如实标注「已登记未执行」，不得凭本条目文字描述代替真实结果）。

### E2E-009 · F090 S6 真实大仓库体感、真实 worktree/stash 工作流与 multi-diff 编辑器

状态：待执行。本条目补的是 F090 全部六个实现切片（blame/history/compare/graph+refs/stash/worktree）里，Browser mock 与 Rust 真实 fixture 都无法替代的几个维度：**真实大仓库上的响应体感**（S3 已用合成仓库测出精确毫秒数，但"感觉快不快"需要人在真实桌面上主观确认）、**真实 macOS 原生目录选择器**（`worktree add` 的落盘路径唯一交互入口）、**真实 stash pop 冲突**（Browser mock 的冲突模拟是脚本化的，不是真实 git 三方合并）、以及 **multi-diff 编辑器在真实多文件提交上的渲染**（`multi-diff-editor-service-override` 是本 feature 唯一新增的 vendor override 包，S2 交付时"未新增 Playwright/browser E2E 覆盖"，S6 虽然已经补齐了一个小型 mock 用例，但从未在真实仓库、真实文件系统内容上验证过）。

**S6 本身发现并修复的两个真实产品 bug，执行方必须重点复核在真实桌面上是否同样已经生效**（均已提交，Browser mock 层已验证修复；但两者都是"运行时才炸"的类别,真实 WKWebView 与 Chromium 的渲染路径可能有细节差异,不能完全假设一致）：

1. `PlainGitHistoryView`（`app/features/scm/plain-git-history-view.ts`，S1 引入）**自创建以来从未声明任何 DI 装饰器**——不同于 S4 那次"声明了一部分、漏了一部分"的已知故事，这次是**完全零声明**，导致该视图能从 `ViewPane` 基类的原型链正常继承前 9 个服务（因此不会像 S4 那样连累同容器的其他视图），但自己新增的 `workspaceContextService`/`editorService` 两个参数永远是 `undefined`——`Show File History`/`Show Line History`/`View Changed Files` 三个功能因此**自 S1 起从未真正工作过**，点击即抛 `Cannot read properties of undefined (reading 'activeEditor')`，只是从未被任何 Playwright 用例触达过,所以从未被发现。S2 交付的"commit 详情 multi-diff"功能的**唯一入口**正是这个视图的"View Changed Files"按钮,因此 S2 这整块功能事实上也从未被验证过真的能打开。已修复（补全 11 个装饰器声明）。
2. `plain-git-blame.ts` 的 `buildBlameDecorations` 生成的装饰是一个刻意的**零宽区间**（`Position(line, MAX_SAFE_INTEGER)`），但没有设置 `showIfCollapsed: true`——真实 Monaco/vscode-api 的 `ITextModel.getInjectedTextInInterval`（视图每次渲染都会查询）对零宽区间的注入文本无条件过滤掉，除非这个字段显式为真。`editor.deltaDecorations(...)` 依旧会返回"成功"的装饰 id（这是最误导人的地方——没有任何异常、任何错误提示），但真实 DOM 里永远不会出现这行内 blame 文本。inline blame 装饰**自 S0 起从未在真实编辑器里显示过**，hover 由于走的是独立的 `languages.registerHoverProvider` 路径（按行号查找，不依赖装饰是否真的渲染）反而一直是好的——这也是为什么本次调研过程中"hover 有数据但装饰不可见"这个现象一度让人怀疑是两个独立问题。已修复（`options.showIfCollapsed = true`）。

**执行方须知**：以上两个 bug 都是通过本切片*首次*针对这两块功能的真实 Playwright（Chromium/WKWebView 共享同一套 Blink/WebKit 排版内核语义，但不是同一份实现）用例发现的——真实桌面执行时，请把"blame 装饰真的出现在编辑器里"和"点击 History 视图任何按钮不报错"当作本条目的隐含前置断言，而不是想当然认为这两块基础功能没问题。

fixture（临时目录中创建，不提交仓库）：

- 一个真实的、有一定深度的本地 git 仓库（**不要求**S3 那种合成的 5 万/50 万提交量级——那属于性能数字本身，S3 已用真实 `git fast-import` 测过；这里需要的是一个开发者会真实使用的仓库,例如克隆一份本仓库自身的浅历史,或任意一个开发者本地已有的、有几百到几千次真实提交历史的项目),用于:
  - blame 步骤：选一个有较长真实修改历史的源文件。
  - graph/refs 步骤：确保该仓库至少有 2-3 个分支和几个 tag。
  - 一个至少改动 3 个文件（含新增、删除、修改各一个）的真实历史提交，用于 multi-diff 步骤。
- 一个独立的临时目录（**不在**上述仓库内部，作为 `worktree add` 步骤要选择的父目录）。
- 为 stash 冲突步骤准备:同一个文件在工作区与目标切换分支上有真实冲突的编辑（具体手法见步骤 5)。

步骤与断言：

1. **真实 inline blame 装饰是否显示**：打开上述仓库,在编辑器中打开被选中的源文件,断言每一行（或至少可见视口内每一行）末尾出现淡色的 "作者名, 相对时间 • 摘要" 文本——这是本条目的隐含前置断言（见上文"执行方须知"）,若这里就已经不显示,不要继续执行本条目其余步骤,直接如实记录为回归。
2. **真实体感：大文件/长历史 blame 与 age heatmap**：选择仓库里修改历史最长的一个源文件,滚动查看,主观评价装饰渲染是否流畅（不卡顿、无明显延迟)、age heatmap 的颜色梯度是否符合直觉（越新越暖）。
3. **真实体感:graph 大仓库响应时间**：打开 Source Control 的 Graph 视图,点击 Refresh Graph,主观计时并记录从点击到 graph/refs 渲染完成的真实等待时间;与 S3 的合成仓库基准数字（5 万提交/0 ref ~134-138ms,50 万提交/1,201 ref ~2049-2208ms,真实瓶颈是 `--topo-order` 本身而非 ref 数量或 `maxCount`)做数量级上的合理性交叉核对,而非要求精确复现;如果真实仓库量级下体感明显比这个数量级预测的更慢,如实记录为需要进一步调查的信号,而不是直接归因于"预期内"。
4. **真实 History/graph/refs 点击链路不报错**：依次点击 History 视图的 `Show File History`/`Show Line History`,展开一条记录后点击 `View Changed Files`,断言均正常打开且不出现任何 JS 异常（浏览器 devtools console 应无红色错误）——这是"执行方须知"第 1 条 bug 的隐含前置断言。
5. **真实 multi-diff 编辑器渲染**：对上述"至少改动 3 个文件"的历史提交执行"View Changed Files",断言:multi-diff 编辑器真实打开、每个改动文件各有一个 diff 面板、新增文件的面板只显示"新增"侧内容、删除文件的面板只显示"删除前"内容、修改文件的面板正确显示两侧真实 diff（真实语法高亮、真实行号,而非空白面板）。
6. **真实 worktree 创建（原生目录选择器 + macOS 沙箱授权）**：在 Worktrees 视图填入一个新文件夹名,点击 Add Worktree,断言弹出的是**真实系统原生**目录选择器（非任何模拟面板）;导航到上述准备好的临时父目录并选择;若这是应用**首次**尝试访问该目录,断言可能出现的 macOS 沙箱授权对话框（记录其是否出现、外观、对整体流程耗时的影响——这是一个需要如实记录的未知维度,而非预设结论,参考 E2E-008 步骤 2 对 Keychain 首次授权对话框的同类记录要求）;确认后断言新 worktree 真实出现在列表中,且用 shell 层核对该路径确实是一个真实的、可用 `git status` 查询的 git worktree（`git worktree list` 从仓库主目录应能看到它）。
7. **真实 worktree 删除（含强制确认）**：对刚创建的 worktree 做一次真实修改（新建一个文件)后点击 Remove,断言:第一次点击（无 `--force`)因为有真实未跟踪内容而不会静默成功,UI 弹出确认对话框;确认后 worktree 真实从磁盘消失（shell 层核对目录不再存在、`git worktree list` 不再列出）。
8. **真实 stash pop 冲突处理**：制造一个真实的 stash pop 冲突（例如:在分支 A 修改文件 X 某一行并 stash;切换到分支 B,同一行做不同修改并提交;切回分支 A,尝试 pop 该 stash）→ 断言:UI 侧展示的冲突文件列表与真实 `git status` 报告的冲突文件一致;该 stash 条目**依然保留**在列表中（未被误删——这是 `git stash pop` 冲突时的真实文档行为,Rust 侧已有单测覆盖这一语义,本步骤是它在真实 git 冲突机制下的最终验证）;手动解决冲突后,用 Drop 显式清理该 stash 条目,确认需要强确认对话框。
9. 每步 UI 断言后尽量用一个平行的真实终端（`git log`/`git status`/`git worktree list`/`git stash list`)交叉核对,而不仅凭 UI 呈现下结论。
10. 清理：退出应用；删除大仓库 fixture（如为专门克隆的临时副本)、worktree 临时父目录、截图与 `src-tauri/target`；确认原仓库的分支/stash/worktree 状态已复原（不得在真实开发者仓库历史中留下测试痕迹,优先使用专门为此克隆的临时仓库副本)。

已知边界（执行方须知）：

- Browser mock 的 stash 冲突（`stashConflictForTest`）与 worktree 脏检测（`worktreeDirtyForTest`）都是**脚本化断言**，不是真实 git 三方合并或真实文件系统脏检测——步骤 8 是这一简化在真实 git 语义下的唯一验证点。
- graph 的"折叠泳道数超阈值"降级策略 S3 判定不实现（真实瓶颈在 git 子进程拓扑排序，不在前端渲染开销）——如果步骤 3 观察到大仓库下泳道特别多导致的渲染卡顿（而非等待 git 响应的卡顿），应如实记录为一个新发现，而不是预设"这属于已知限制"。
- `worktree add` 不支持 `-b`/`-B` 显式命名新分支（S5 的既定收窄，见 progress.md），只支持"不给 commit-ish 时用 git 自己的默认启发式"或"给一个已存在的 commit-ish"两种；步骤 6 不需要验证命名分支的场景。
- stash 的 `--include-untracked`/`--keep-index` 等非默认变体本条目不需要专门验证（S4 的既定范围收窄）。

完成后：将结果写入 `features.json` F090 evidence（`nativeScenarios` 追加、`platformGaps` 移除本条目对应缺口；若未执行则如实标注「已登记未执行」，不得凭本条目文字描述代替真实结果；若发现"执行方须知"提到的两个 bug 在真实桌面上仍有残留表现，必须作为阻塞发现单独报告，不得归入本条目的常规完成流程）。

### E2E-010 · F100 真实原生调试器与真实桌面 DAP 全链路矩阵

状态：待执行。本条目补的是 F100 全部六个实现切片（S0-S5）里，Rust 单元测试、真实子进程集成测试与 Browser mock 都无法替代的几个维度。**如实声明本条目的起点**：F100 是本项目迄今唯一一个**完全没有任何真实桌面（Computer Use）验收证据**的已完成 feature——S0 调研阶段确实用一个手写零依赖 Python 分帧客户端跑通了真实 `lldb-dap`（`initialize`/Capabilities 握手成功，但真正启动被调试进程在该沙箱环境下完全挂起）与真实 `debugpy`（完整端到端会话，含真实断点命中）的协议层握手，S2-S5 的全部 Rust 集成测试也都针对真实 spawn 的 Python mock adapter 子进程与真实 TCP socket，但这些都不是"在一个真实运行的 Plain.app 桌面会话里"的证据；本条目要补的正是这最后一环。

fixture（临时目录中创建，不提交仓库；具体路径由执行人自备）：

- 一个真实、最小的 Python 调试目标程序（含至少一个可断点的函数、一次会打印到 stdout 的输出），配套 `.vscode/launch.json`（`type: "debugpy"` 一条配置，`console` 字段先留空/`internalConsole` 用于步骤 2，另建一份 `console: "integratedTerminal"` 的变体用于步骤 4——这是 debugpy 真实支持、本项目研究阶段从未构造过的字段值，用于真实触发 `runInTerminal`）与 `.plain/debug-adapters.json`（`type: "debugpy"`，`command` 指向执行机真实 `python3` 绝对路径，`args: ["-m", "debugpy.adapter"]`）。
- 一个真实、最小的原生调试目标（例如一个用 `clang`/`swiftc` 编译出的小可执行文件，含一个可断点的函数），配套指向执行机真实 `lldb-dap` 绝对路径（通常是 Xcode Command Line Tools 自带的 `/Applications/Xcode.app/Contents/Developer/usr/bin/lldb-dap` 或等价路径）的 `.plain/debug-adapters.json` 条目与对应 `.vscode/launch.json` 配置。
- 一个真实、有意造出深调用栈/大变量的 Python 程序（例如一个递归到约 2000 层深度的函数、或持有一个约 5 万元素数组/列表的作用域），用于步骤 5 与 S5 的合成基准数字做主观体感交叉核对（不要求精确复现毫秒数，只需数量级合理）。
- 一个真实、会向 stdout 高频输出的 Python 程序（例如一个几万次循环的 `print`），用于步骤 6 与 S5 精确的 flood 基准数字（6000 条约 1.2MiB、ack 前仅投递 64 条、丢弃 138624 字节）做主观体感交叉核对。
- 一个从未对 Plain.app 这个具体二进制授予过信任的全新临时 workspace 根目录（专用于步骤 1 的 trust + 首次确认门矩阵）。

步骤与断言：

1. **trust + 首次确认门的真实首次交互**：在上述全新临时 workspace 根（含 debugpy 的 `.vscode/launch.json`/`.plain/debug-adapters.json`）执行 `Plain: Start Debugging`；断言弹出真实信任确认对话框（文案含"Trust this workspace to run a debug adapter?"）；点击 Cancel/Decline，断言回落到"未信任"禁用态且文案区分于"空 workspace"；重新执行命令并这次同意信任，断言随即弹出**适配器确认对话框**，文案含真实、完整的命令行（真实 `python3` 绝对路径 + `-m debugpy.adapter`）、transport 标签（`stdio`）与配置来源字符串；确认后断言真实 debugpy 会话已启动（而非停留在确认态或报错）。**再次**对同一 workspace 执行 `Plain: Start Debugging`，断言这次两道门都不再弹出（已持久化的确认状态生效）。
2. **真实 debugpy 端到端**（调研阶段已用手写客户端跑通协议层，但从未在真实 Plain 应用里跑过，这是本步骤要补的空白）：点击编辑器 glyph margin 设置一个真实行断点，断言真实命中（调用栈视图自动刷新并选中第一帧）；展开变量视图核对真实值；添加一条 Watch 表达式并核对真实求值结果；依次点击 Continue/Step Over/Step Into/Step Out，断言每一步真实生效（行高亮/调用栈随之更新）；打开 Debug Console，输入一条表达式，断言真实 REPL 求值结果出现；断言目标程序的真实 stdout 输出出现在 Debug Console 中；Continue 至程序自然退出，断言会话正常结束（区别于步骤 7 要验证的异常终止通知）。
3. **真实 `lldb-dap` 原生调试（明确允许"跑不起来"，须如实记录而非强行跑通）**：对上述原生编译目标执行 `Plain: Start Debugging`。**已知依赖，执行前必读**：本 feature 调研阶段已实测发现，本机沙箱环境下 `lldb-dap` 的 `initialize`/Capabilities 握手能成功，但真正 `launch` 启动被调试进程会完全挂起（120 秒超时无任何响应）；独立验证还发现连最基础的交互式 `lldb ./sample` + `run` 在同一沙箱下也完全挂起——这**很可能**是该环境对 `ptrace`/`task_for_pid` 类系统调用的限制。**更进一步，这是一个纯打包层前提**：即使在真实、非沙箱的桌面环境下，一个已签名的 macOS 应用要让自己 spawn 的子进程（`lldb-dap`）对另一个子进程（被调试目标）成功调用 `task_for_pid`，通常需要该应用自身的代码签名 entitlements 包含 `com.apple.security.cs.debugger` 之类的调试权限，否则会被系统安全机制拒绝——这与 Plain 自己的 trust/确认逻辑是否正确完全无关，属于 `F120`"Branding, packaging, notices and release checks"的打包/签名范畴，F100 本身不解决它。**因此**：若执行机上用于验收的 Plain.app 构建尚未获得这一 entitlement（大概率是当前状态，因为 F120 尚未开始），本步骤预期会在 `launch` 阶段挂起或失败——这不是 F100 的回归，如实记录"因缺少签名 entitlement 而未能验证"并停止本步骤，不得为了"跑通"而采取任何绕开签名/权限检查的手段；若执行机的 Plain.app 构建**已经**具备该 entitlement（例如 F120 已完成后重新执行本条目），则应完整验证断点命中、调用栈（含原生帧）、变量（原生类型）、单步——并将"原生调试器真实可用"作为一个正向新证据记录。
4. **真实 `runInTerminal` 触发**：使用步骤 fixture 中 `console: "integratedTerminal"` 的 debugpy launch 配置执行 `Plain: Start Debugging`——这是本 feature 研究阶段与 S4 实现阶段都从未构造过的真实触发场景（S4 的 `runInTerminal` 实现与集成测试全部针对一个自造的 mock adapter，从未被真实 debugpy 或 lldb-dap 触发过）。断言：终端面板被真实强制拉出（即使此前从未打开过），出现一个标题形如 `Debug: <title>` 的新标签页；目标程序的真实 stdout/stdin 通过这个终端标签页流转（而非出现在 Debug Console 里）；该标签页可像普通终端标签页一样被用户点击关闭；关闭后 Debug 会话本身的其余状态不受影响（或按预期一并结束，如实记录二者中哪一种是真实观察到的行为，不预设）。
5. **真实大规模程序的主观体感——深调用栈/大变量**：对深递归/大数组 fixture 设置断点使其触发，断言调用栈视图能正常展开到真实深度、变量视图能正常分页展开真实大数组；主观评价响应是否流畅（无明显卡顿、无假死），并与 S5 的合成基准数字（2000 帧栈 12.607125ms/约 239KB 响应体、5 万元素数组 146.759709ms/约 3.23MB 响应体）做数量级上的合理性交叉核对，而非要求精确复现——如果真实体感明显比这个数量级预测的更慢，如实记录为需要进一步调查的信号，而非直接归因于"预期内"。
6. **真实高频 `output` 事件的主观体感**：运行高频 stdout fixture，断言 Debug Console 在洪泛期间仍可交互（可滚动、可继续输入下一条 REPL 表达式）、断言洪泛结束后出现的 `plain/outputElided`-等价提示（如果触发）文案人类可读；与 S5 精确基准数字（6000 条约 1.2MiB flood 耗时 71.826417ms、ack 前仅投递 64 条、ack 后报告丢弃 138624 字节）做数量级合理性交叉核对。
7. **进程生命周期与清理**：Stop Debugging 后，用 shell 层核对 debugpy adapter 子进程与被调试目标进程均已真正终止（无残留）；对仍在运行的调试会话直接 Cmd+Q 退出整个应用，同样用 shell 层核对全部相关子进程（adapter、debuggee、若步骤 4 创建了终端会话则含其 shell 子进程）已消失，无残留 zombie/孤儿进程。
8. 每步 UI 断言后尽量用 shell 层交叉核对（`ps`、读取真实 stdout 内容等），而不仅凭 UI 呈现下结论。
9. 清理：退出应用；删除全部 fixture（Python/原生目标程序、`.vscode/launch.json`、`.plain/debug-adapters.json`）、截图与 `src-tauri/target`；确认执行前用于原生调试步骤准备的编译产物已删除，不留在临时目录之外的位置。

已知边界（执行方须知）：

- 步骤 3（真实 `lldb-dap`）预期可能因缺少 `com.apple.security.cs.debugger` 签名 entitlement 而无法完整验证——这是已知的、记录在案的 F120 前置依赖，不是本条目或 F100 的回归，执行方应如实记录"阻塞于签名前提"而非强行寻找绕过手段。
- 步骤 4（`runInTerminal`）与 F100 S4 的 Rust/Browser 证据完全不同源——那些证据全部针对一个自造 mock adapter；本步骤是这条路径**首次**被一个真实 DAP adapter（debugpy）触发,若观察到与 mock 场景不一致的行为（例如 debugpy 实际发送的 `RunInTerminalRequestArguments` 字段形状与预期不同），应如实记录为新发现,而非预设"应该和 mock 一样"。
- `runInTerminal` 的 `kind: "external"` 分支、Disassembly 视图、`hitCondition` 命中次数条件断点、多 launch 配置的 QuickPick 选择器均为已记录的既定收窄（见 `features.json` F100 `platformGaps`），本条目不需要专门验证这些缺口，出现属预期。
- TCP "先 spawn 再连接"编排（`spawn_adapter_as_tcp_companion`）尚未接入任何生产路径，本条目不需要验证 TCP 场景——F100 v1 的 TCP 支持假设 adapter 已由外部先行启动，本条目全程使用 stdio 传输的 debugpy/lldb-dap。
- DAP 协议本身不提供取消 in-flight 请求的机制，如果本条目执行中观察到某个慢请求"无法取消"，这是协议层限制，不是缺陷。

完成后：将结果写入 `features.json` F100 evidence（`nativeScenarios` 追加、`platformGaps` 移除本条目对应缺口；若步骤 3 因签名 entitlement 缺失而未能验证，如实标注"阻塞于 F120 签名前提，已登记未执行"，不得视为回归；若步骤 4 发现 mock adapter 从未暴露过的真实差异，必须作为独立发现单独报告，不得归入本条目的常规完成流程）。

### E2E-011 · F110 真实桌面排除面巡检与 extensionRuntime 手术后回归

状态：待执行。F110 全部七个实现切片（S0-S6）已把追踪债务从（补记的诚实基线）260 个 bundle source 降到 53 个，`mcp`/`syncEditSessions`/`tasks`/`testing` 四类真降到 0，`authAccount`（1）/`chatAgent`（9）/`extensionRuntime`（19）/`notebook`（9）/`remote`（4）/`languagePacks`（1）降到逐文件有据的诚实地板值，`languageDetection`（2）/`treeSitter`（8）经依赖图审计后有意保持零改动（删除对应注册要么命中真实硬依赖、要么零收益）——全部证据见 `docs/bundle-baseline.json` 的 `categoryNotes`。运行时排除面 guard（`app/excluded-surface-policy.ts`/`excluded-surfaces.ts`）在全部 98 个 Browser E2E 场景下从未触发过。**但这两层证据都不是真实桌面证据**：Browser mock 用的是确定性 Tauri IPC mock，不是真实 WKWebView 里的真实命令面板/菜单/设置渲染；`check:bundle` 证明的是"源文件是否进入产物"，不是"真实点开命令面板搜索一个词，会不会出现一条本不该存在的结果"。本条目补这最后一环——一次穷尽式的真实桌面人工巡检，加上 `extensionRuntime` 深度手术（F110 S5）后主题导入/替换/删除这条真实调用链的回归确认。

**S5 发现的真实回归类别，执行方必须重点复核在真实桌面上是否同样成立**（已在 Browser mock 层修复并验证，但同一类"运行时才炸、`pnpm check` 全绿也测不出来"的缺陷这个 feature 本身就出现过四次，真实 WKWebView 与 Chromium 的模块加载/DI 时序可能有细节差异，不能想当然认为一致）：`app/services/plain-null-extension-service.ts` 的 `PlainNullExtensionService` 必须提供一个 `deltaExtensions` no-op（不属于 `IExtensionService` 正式接口，是 vendor 包顶层 `registerExtension()` 返回句柄的 `dispose()` 无条件调用的方法）——`app/features/themes/plain-theme-import-coordinator.ts` 在导入失败清理、替换已导入包、删除已导入包这三条真实路径都会调用该 `dispose()`；如果这个方法缺失或行为不对，真实表现是用户点击"删除已导入主题"时抛出 `extensionService.deltaExtensions is not a function`，而不是任何编译期或类型层面的提示。

fixture（临时目录中构造，不提交仓库；可直接复用 E2E-005 已验证过的合法 VSIX 构造步骤）：

- 一个真实、最小的合法主题包 VSIX `demo-theme-a.vsix`（复用 E2E-005 fixture 一节的 `package.json`/`themes/demo-dark.json`/`zip -r` 步骤，`publisher: "plain-e2e"`、`name: "demo-theme-a"`，背景色 `#0a0a0a`）。
- 第二个真实、最小的合法主题包 VSIX `demo-theme-b.vsix`（同样构造，`name: "demo-theme-b"`，背景色改用一个不同、有辨识度的颜色，例如 `#141414`，用于下方"替换已导入包"步骤）。

步骤与断言：

1. **真实应用启动**：按 `docs/testing.md`/本清单「执行环境纪律」用 `pnpm tauri:build:e2e` 解析出的当前仓库绝对路径启动 `Plain.app`（不得按 bundle id 绑定），轮询至 Activity Bar 出现 Explorer 或 `#plain-bootstrap-status` 明确报错；断言启动过程中开发者工具/日志里**没有**出现 `PLAIN_EXCLUDED_SURFACE_GUARD_V1` 相关报错（该 guard 现在的定位是纵深防御，正常路径下永远不应触发——出现即是需要立即报告的回归，而不是"guard 生效了"的证明）。
2. **命令面板穷尽式关键词巡检**：`Cmd+Shift+P` 打开命令面板，依次搜索以下关键词，逐个断言**零结果**或结果与关键词语义无关（例如搜索 "test" 若只命中与测试完全无关的词条属预期，需人工甄别而非机械断言零命中）：`chat`、`copilot`、`agent`、`mcp`、`language model`、`sign in`、`sign out`、`log in`、`account`、`sync`、`edit session`、`extension`（断言不出现任何"Install Extension"/"Show Marketplace"/"Extensions: Enable/Disable"类命令；`Format Document`/`Format Document With...`/`Change Language Mode` 等真实存在的命令允许出现，这些正是 `categoryNotes.extensionRuntime`/`categoryNotes.languageDetection` 记录的诚实地板文件背后的真实功能，出现属预期而非回归）、`gallery`、`marketplace`、`remote`（允许出现与"remote"字面无关但命令面板搜索算法可能模糊命中的词，需人工甄别）、`tunnel`、`notebook`、`task`（`workbench.action.tasks.*` 一类不应出现）、`test explorer`。
3. **菜单栏/汉堡菜单人工巡检**：逐一展开 File/Edit/Selection/View/Go/Run/Terminal/Window/Help（或对应 hamburger 菜单等价结构）的每一级子菜单，人工确认没有任何 Chat/Copilot/Agent/MCP/Account/Sign in/Settings Sync 相关条目；`Preferences`/设置相关菜单下确认没有"Settings Sync"或账号登录入口。
4. **设置（Settings UI 若可达）/命令面板 `Preferences: Open Settings` 关键词巡检**：搜索 `chat`、`copilot`、`sync`、`account`、`telemetry`，断言零命中或命中内容与这些功能面语义无关。
5. **Activity Bar 巡检与 `Manage` 齿轮真实交互**（对应 F110 S4 迁移进 `app/` 的 `PlainGlobalCompositeBar`/`PlainGlobalActivityActionViewItem`）：确认 Activity Bar 底部只有一个 `aria-label="Manage"` 的复合按钮，**没有**独立的 Accounts 图标；左键点击，断言主菜单真实打开且至少含 "Command Palette..." 与 "Themes" 子菜单（这是 F110 S4 在 Browser E2E 中发现的真实菜单内容，本步骤是它在真实桌面渲染管线下的复核，而不是重新假设一个空菜单）；右键点击，断言上下文菜单含 "Activity Bar Position" 子菜单（`activitybarPart.js` 自身未被本 feature 改动的真实逻辑，证明 `PlainGlobalCompositeBar` 的回调确实原样转发，而不只是外观正确）。
6. **标题栏紧凑变体的真实可达性核实**（F110 S4 在 Browser dev server 里确认当前产品配置下标题栏不渲染 `PlainSimpleGlobalActivityActionViewItem` 这一紧凑变体，但这个结论来自网页版 dev server，真实 macOS `Plain.app` 的原生标题栏/自定义标题栏配置是否相同**从未在真实桌面上确认过**）：观察真实应用窗口标题栏区域，如实记录是否出现紧凑版 Manage 齿轮；若出现，断言其左键点击的主菜单/右键上下文菜单内容与步骤 5 的 Activity Bar 变体等价（两者共享同一套 `PlainGlobalActivityActionViewItem`/`PlainSimpleGlobalActivityActionViewItem` 回调）；若不出现，与 F110 S4 的既有结论一致，记录为确认而非新发现。
7. **`extensionRuntime` 深度手术后的主题导入/替换/删除真实回归**：命令面板 `Plain: Import Color Theme (VSIX)...` 导入 `demo-theme-a.vsix`（真实系统文件选择器），断言成功 toast、Color Theme Quick Pick 出现 "E2E Demo Dark" 且应用后 `--vscode-editor-background` 变为 `#0a0a0a`；再次执行导入命令选择 `demo-theme-b.vsix`（同一 `publisher`/包名前缀不同版本或替换流程，视实际 UI 呈现按"替换已导入包"这条真实路径操作），断言替换成功、旧包的 `dispose()` 真实执行且**没有**任何 `deltaExtensions is not a function` 或其他 JS 异常（开发者工具 console 应无红色错误）；命令面板 `Plain: Remove Imported Color Theme...` 删除 `demo-theme-b`，同样断言删除成功、无异常、主题回退为内置默认。三步操作全程留意开发者工具 console，一旦出现任何提及 `deltaExtensions`/`IExtensionService`/`extensionService` 的报错，必须作为阻塞发现单独报告，不得归入本条目的常规完成流程。
8. 每步 UI 断言后尽量用一个平行的开发者工具 console 核对没有未预期的红色错误，而不仅凭 UI 呈现下结论。
9. 清理：退出应用；删除 fixture VSIX、本次测试新建的主题库内容、截图与 `src-tauri/target`。

已知边界（执行方须知）：

- 本条目不重复验证 `mcp`/`syncEditSessions`/`chatAgent`/`authAccount`/`extensionRuntime`/`notebook`/`remote`/`languagePacks`/`languageDetection`/`treeSitter` 各类目里具体哪个 vendor 文件为何还在 bundle 里——那是 `docs/bundle-baseline.json` 的 `categoryNotes` 与真实构建分析的职责，已完整覆盖且逐文件有据；本条目验证的是这些诚实地板文件在真实桌面上确实只是惰性基础设施，不会让任何 Chat/Account/Sync/Extension-Host 相关 UI 变得可达。
- 步骤 2/3/4 的"零命中"断言需要人工甄别而非机械字符串匹配——命令面板/设置搜索使用模糊匹配，一个关键词命中一条语义无关的真实命令（例如搜索 "remote" 命中一个偶然包含该子串但与 Remote Development 无关的命令）不算回归，如实记录即可。
- `authAccount` 诚实地板值为 1（`authentication.service.js`，被 `chatAgent` 自己的地板文件 `chatEntitlementService.js` 钉住，真实内容审计已确认这条依赖惰性不可达——`IChatEntitlementService` 自身的 `registerSingleton` 早已被移除，运行中的应用从不会真正构造 `ChatEntitlementRequests`）；`extensionRuntime` 诚实地板值为 19（逐文件理由见 `categoryNotes.extensionRuntime`，均是 Format Document/Change Language Mode/声明式 `ExtensionsRegistry`/NLS 翻译等真实、非账号非 AI 的普通 Workbench 基础设施）——本条目步骤 2 允许 `Format Document`/`Format Document With...`/`Change Language Mode` 等命令出现，这不是缺陷。
- F110 S1 删除的旧 Electron/Node 源码树（`src/`/`extensions/`/`build/`/`test/`/`cli/`/`remote/web`，16,103 个文件）是纯仓库卫生操作，不涉及运行时行为——本条目不需要专门验证这一条 acceptance，`pnpm tauri:build:e2e` 本身能成功产出可启动的 `Plain.app` 就已经是它的真实证据（旧树里没有任何文件参与真实构建路径）。
- 若步骤 6 发现真实桌面标题栏确实渲染紧凑版 Manage 齿轮（与 F110 S4 基于网页版 dev server 的结论不同），应作为一条新发现独立记录，而不是预设"不可能，网页版已经验证过了"。

完成后：将结果写入 `features.json` F110 evidence（`nativeScenarios` 追加、`platformGaps` 移除本条目对应缺口；若发现任何 Chat/Account/Sync/Extension-Host 相关入口真实可达，或步骤 7 复现 `deltaExtensions` 类异常，必须作为阻塞发现单独报告，不得归入本条目的常规完成流程）。

### E2E-012 · F120 品牌/打包/发布检查收口后仍需真实桌面与真实 CI 才能确认的维度

状态：待执行。`F120` S0–S7 已全部完成并转 `complete`（`features.json`），机器化契约（品牌覆盖面、bundle 段契约、entitlements 内容契约、品牌字符串扫描、声明新鲜度检查、CI 打包存在性检查）已全部落地并配真实反向测试，`pnpm check`/`pnpm test:e2e:browser`（98/98）均通过。但按本项目一贯纪律（"机器化契约通过不等于实机验证通过"），以下维度是本次收口**明确无法**从当前沙箱环境完成、且与已登记的 `E2E-010` 步骤 3（`com.apple.security.cs.debugger` 实机验证）不重复的真实缺口，登记于此：

1. **ad-hoc 签名 + hardened runtime + JIT entitlement 构建的真实 GUI 验证**：本次收口只做到了——用 `APPLE_SIGNING_IDENTITY=-` 强制真实 ad-hoc 签名，`codesign -dv`/`codesign -d --entitlements -` 确认 `flags=0x10002(adhoc,runtime)` 与 `com.apple.security.cs.allow-jit=true` 真实生效，并把签名后的原始二进制（绕开 Finder/LaunchServices）直接启动，确认进程存活 4 秒无崩溃、无报错。这**不是**真实 GUI 验证——本条目需要真实通过 Finder/`open` 双击启动该构建，确认窗口真实出现、Workbench 正常渲染、编辑器可以真实输入文本（真实验证 JIT 在 hardened runtime 下确实让 WKWebView 的 JS 执行保持正常速度且不崩溃，而不只是"进程活着"这一较弱证据）。
2. **CI `build-macos` job 的真实首跑**：本机已验证同一套命令序列（Zig 0.15.2、`pnpm ghostty:vendor:setup`、真实 `tauri build --bundles app`）能在本机成功产出真实 `Plain.app`，但 `mlugg/setup-zig@v1`/`dtolnay/rust-toolchain@stable`/`Swatinem/rust-cache@v2` 在真实 `macos-latest` runner 上的行为、与本仓库 Cargo workspace 的真实缓存交互、首跑真实耗时，均需要一次真实 PR 触发 CI 后才能确认。若首跑失败，应优先核对 Zig 安装步骤与 `ghostty:vendor:setup` 的联网行为（本项目已知 Zig 自身依赖抓取在某些网络环境下不稳定，见 `scripts/plain/ghostty-vendor-setup.mjs` 的注释）。
3. **DMG 打包目标的真实 CI 行为（可选，非阻塞）**：本机真实测试发现 `pnpm tauri:build`（含 `dmg` target）会在 `bundle_dmg.sh` 的 Finder/AppleScript 自动化步骤上真实挂起（`ps` 核实进程卡死），`build-macos` job 因此故意只跑 `--bundles app`。判断这很可能是本次验证环境本身缺少交互式 Automation 会话所致，而非真实 GitHub Actions 环境的缺陷，但未经真实 CI 确证。若执行方希望恢复 `dmg` 打包，可在真实 CI 环境里先单独试跑 `tauri build --bundles dmg`，确认是否同样挂起；若不挂起，可以放心把 `build-macos` 步骤改回默认的 `pnpm tauri:build`（两个 target 都打）。
4. **签名/公证挂起对验收范围的直接影响，供执行方规划 F130 时参考**：产品所有者已明确暂不投入 Apple Developer Program 账号，`F120` 只完成本地 ad-hoc 签名验证。这意味着任何"在另一台机器上安装运行"类验收（例如把构建产物发给另一个人在他们自己的 Mac 上首次打开）**做不到**——`spctl -a -vv` 在当前状态下会真实报 `rejected`（本次已验证，这是预期结果而非回归），真实公证后的 Gatekeeper 首次打开确认对话框流程完全无法验证。

已知边界（执行方须知）：

- 本条目不重复 `E2E-010` 步骤 3（真实 Mac、已启用 Developer Mode 环境下 `com.apple.security.cs.debugger` 是否真的需要）——那是该条目自己的责任；本条目步骤 1 只验证 JIT entitlement 本身在真实 GUI 会话下的效果，与调试器权限无关。
- 图标仍是 Tauri 脚手架默认资产（`git log --diff-filter=A` 确认来自初始 `feat: init` 提交），不是本条目要验证的维度——那是一个需要产品所有者提供设计的独立事项，见 `features.json` F120 evidence 的 `platformGaps`。

完成后：将结果写入 `features.json` F120 evidence（`nativeScenarios` 追加、`platformGaps` 移除本条目对应缺口；若步骤 1 发现真实 GUI 会话下 JIT/hardened runtime 组合确实导致崩溃或渲染异常，必须作为阻塞发现单独报告，不得归入本条目的常规完成流程；若步骤 2/3 的 CI 首跑暴露平台特定问题，如实记录具体失败原因而非笼统标注"待修"）。

### E2E-013 · F130 十二条待执行条目总览、十条产品需求交叉索引与建议执行顺序

状态：总览条目，本身不新增测试步骤。`F130`（浏览器与原生端到端验收，本项目最后一个 feature）完成最终验收收口时，`E2E-001` 至 `E2E-012` 共 12 条真实桌面验收条目仍**全部待执行**——`F130` 本身没有执行其中任何一条（详见 `features.json` F130 evidence 的 `nativeScenarios`：本次只做了 `pnpm tauri:build:e2e`/`pnpm exec tauri build --bundles app` 产出的 `.app` 静态检查与两次非 GUI 的进程级探测，未启动任何 Computer Use 交互式桌面会话），维持自 2026-07-22 起「Claude 负责可自动化验证、真实桌面验收交接人工/Codex」的既定分工。本条目的作用是把这 12 条待执行条目，按项目最初十条产品需求重新交叉索引，并区分「严格阻塞于签名/公证」与「无需签名、只是尚未执行」两类，给出一份可直接使用的执行顺序建议——而不是假设 12 条可以按登记顺序无差别逐条执行。

**十条产品需求 × 对应真实桌面验收条目**（完整对照见 `progress.md` 本次 `F130` 完成条目下的总表，逐条附证据引用；这里只列条目编号，避免重复）：

| # | 需求 | 对应条目 |
|---|------|----------|
| 1 | VS Code 颜色主题扩展迁移 | `E2E-005`、`E2E-006` |
| 2 | 不支持其他扩展 | `E2E-011` |
| 3 | 移除 AI 相关功能 | `E2E-011` |
| 4 | 保留调试功能 | `E2E-010`（步骤 3 例外，见下） |
| 5 | 移除登录注册 | `E2E-011` |
| 6 | 移除 settings-sync | `E2E-011` |
| 7 | 保留终端 | `E2E-007` |
| 8 | 保留 Git 并扩展为 GitLens 式增强 | `E2E-008`、`E2E-009` |
| 9 | 保留文件树/预览/编辑 | `E2E-001`、`E2E-002`、`E2E-003` |
| 10 | 保留搜索 | `E2E-004` |

**严格阻塞于「签名公证到位」的条目（无法绕过，只能等产品所有者重新拍板）**：

- `E2E-010` 步骤 3（真实 `lldb-dap` 原生调试）：`F120` S5 已实测确认，本沙箱下缺少 `com.apple.security.cs.debugger` entitlement 时 `task_for_pid`/真实 `lldb` 均会挂起；该 entitlement 因「无真机验证支撑、不应凭疑心扩大攻击面」被主导会话裁定不加。即便执行方拥有真实 Mac，只要这条 entitlement 决定不重新评估，本步骤依然无法完整验证，只能如实记录"阻塞于签名前提"。
- `E2E-012` 项 1（ad-hoc hardened runtime + JIT entitlement 构建的真实 GUI 验证）与项 4（跨机器安装运行/真实公证后 Gatekeeper 行为）：项 4 严格阻塞于产品所有者已拍板的"暂不投入 Apple Developer Program"决定；项 1 本身**不需要**公证（本机 `open` 真实启动即可验证，`F130` 已用非 GUI 方式确认能启动，缺的只是真实 GUI 会话下的视觉/交互确认），但仍登记于此以保持与 `E2E-012` 原条目一致，执行时不应与项 4 混为一谈。

**其余条目均不需要签名公证到位，只是尚未按既定分工执行**：`E2E-001`、`E2E-002`、`E2E-003`、`E2E-004`、`E2E-005`、`E2E-006`、`E2E-007`、`E2E-008`、`E2E-009`、`E2E-010`（除步骤 3 外）、`E2E-011`、`E2E-012` 项 2/3（CI 首跑，甚至不需要本机桌面，只需要一次真实 PR 触发 CI）。这些条目本机可用当前已构建或随时可重建的 `.app` 直接执行，不受签名状态影响。

**建议执行顺序**（供人工/Codex 参考，非强制）：

1. `E2E-011`（去 AI/账号/sync 桌面巡检 + `extensionRuntime` 手术后回归）——覆盖需求 2/3/5/6 共四条产品硬边界，且 `F110` S5 已在 mock 层发现过真实回归（`deltaExtensions` 缺失），优先级最高。
2. `E2E-001`/`E2E-002`/`E2E-003`/`E2E-004`——文件树、编辑、热退出、搜索，覆盖需求 9/10 的基础打底能力，风险面广但相互独立，可并行安排。
3. `E2E-005`/`E2E-006`——主题（需求 1），复用同一套 VSIX fixture 构造手法，建议连续执行。
4. `E2E-007`——终端（需求 7）。
5. `E2E-008`/`E2E-009`——Git 与 Git 历史增强（需求 8），`E2E-008` 需要执行人自备真实远端凭据，建议提前准备。
6. `E2E-010`——调试（需求 4），步骤 1/2/4/5/6/7 可执行；步骤 3 按上文如实标注"阻塞于签名前提"即可，不必等待。
7. `E2E-012` 项 1——品牌打包 GUI 确认，与具体产品需求无直接关联，可放在最后；项 2/3（CI 首跑）可在任意时间点通过真实 PR 单独触发，不占用桌面验收时间。

已知边界（执行方须知）：

- 本条目不新增任何 fixture 或断言，纯粹是清点、交叉索引与排序建议；每条底层条目自身的 fixture、步骤、断言、已知边界均以其自己的 `E2E-00X` 小节为准，不因本条目而改变。
- 十条产品需求与 `E2E` 条目并非一一对应——`E2E-011` 同时覆盖需求 2/3/5/6 四条（因为这四条都指向同一次命令面板/菜单穷尽巡检），`E2E-010` 只对应需求 4 但自身又分裂出「阻塞」与「不阻塞」两部分；执行方不应假设「一条需求对应一条 E2E 条目」。
- 若产品所有者未来重新拍板启用 Apple Developer Program 账号，`E2E-010` 步骤 3 与 `E2E-012` 项 4 应重新评估为「可执行」，其余条目的阻塞状态不受此决定影响。

完成后：不需要向 `features.json` 写回本条目自身的结果（本条目不是一次可执行验收，没有独立的通过/失败结果）；每条底层 `E2E-00X` 条目完成后，仍按其自身小节末尾"完成后"的指示，把结果写入对应 feature 的 evidence。

## 后续条目（随切片追加）

- F030 遗留：真实 `CloseRequested` 关窗握手协议实现后，补「正常关窗 → 重开恢复」的桌面验收变体。
- F080/F090 Git 与 Git 历史/blame 工具的真实桌面矩阵已按 docs/testing.md「真实 Tauri E2E」清单登记（分别为 E2E-008、E2E-009）。
- F100 通用 DAP 调试客户端的真实桌面矩阵已登记为 E2E-010。
- F110 遗留子系统退役的真实桌面排除面巡检与 extensionRuntime 手术后回归已登记为 E2E-011。
- F120 品牌/打包/发布检查收口后仍需真实桌面与真实 CI 才能确认的维度已登记为 E2E-012。
- F130 浏览器与原生端到端验收（本项目最后一个 feature，已完成并转 complete）：已清点 E2E-001 至 E2E-012 共 12 条待执行条目、按十条产品需求交叉索引并给出建议执行顺序，登记为 E2E-013；F130 自身未执行这 12 条中的任何一条，全部维持「待执行」状态，交由用户后续按需交接人工或 Codex。
