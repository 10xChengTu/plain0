# 端到端桌面验收交接清单（Codex 执行）

更新时间：2026-07-24

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

## 后续条目（随切片追加）

- F030 遗留：真实 `CloseRequested` 关窗握手协议实现后，补「正常关窗 → 重开恢复」的桌面验收变体。
- F080-F090 Git、F100 DAP 的真实桌面矩阵按 docs/testing.md「真实 Tauri E2E」清单逐项登记。
- F120/F130 发布与全量原生回归。
