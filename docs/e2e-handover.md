# 端到端桌面验收交接清单（Codex 执行）

更新时间：2026-07-26

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

状态：待执行。Browser mock 层已全部闭合（S0-S4：内置主题激活与选择器、Rust VSIX/目录安全解包、manifest/主题校验与恶意 fixture 矩阵、导入 UX 与注册消费、selection 跨会话持久化与失效 id 回退，见 progress.md 与 `tests/browser/workspace.spec.ts`）；本条目补真实系统文件选择器、真实 `<app_local_data_dir>` 磁盘持久化路径和真实进程重启这几个 mock 无法替代的维度。

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

## 后续条目（随切片追加）

- F030 遗留：真实 `CloseRequested` 关窗握手协议实现后，补「正常关窗 → 重开恢复」的桌面验收变体。
- F080-F090 Git、F100 DAP 的真实桌面矩阵按 docs/testing.md「真实 Tauri E2E」清单逐项登记。
- F120/F130 发布与全量原生回归。
