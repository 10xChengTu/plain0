# F060 文件与产品图标主题

日期：2026-07-24

## 目标与边界

`F060` 三条 acceptance：文件/文件夹/展开态图标优先级匹配；字体与图片资源留在导入主题内部；不安全 SVG 或缺失图标 ID 安全回退。全面复用 F050 地基（见 docs/research/2026-07-24-theme-compatibility.md 及其实施偏差记录）；真实桌面场景登记交接清单。

## 调研结论（锚定 Code OSS `5264f`、v35.0.1，vendored 产物与 GitHub 双源核实）

- `setFileIconTheme`/`setProductIconTheme` 与 `setColorTheme` 同构接受裸 `FileIconThemeData`/`ProductIconThemeData` 实例（instanceof 分支）；加载走同一个 `IExtensionResourceLoaderService`（F050 的 `PlainExtensionResourceLoaderService` 零改动复用）；CSS 经 `contributedFileIconTheme`/`contributedProductIconTheme` style 元素整段注入 + `@font-face` 经 adoptedStyleSheets 提升。
- 三种主题共用同一 `ThemeRegistry` 类与同一断裂前置（`NullExtensionService`），`vs-minimal` 内置图标主题结构性同构断裂（S2 开头以探针坐实）。命令劫持点：`workbench.action.selectIconTheme`/`selectProductIconTheme`。
- file icon JSON：`iconDefinitions`（iconPath 或 fontCharacter/fontId）、`fonts[].src[].{path,format}`、`file/folder/folderExpanded/rootFolder*`、`fileExtensions/fileNames/folderNames/languageIds`、`light/highContrast` 覆盖块、`hidesExplorerArrows`；`iconPath` 相对图标 JSON 自身目录解析；上游运行时容错、格式错误只跳过关联。
- product icon JSON：`fonts`+`iconDefinitions` 必填否则整体拒绝；字体格式闭集 `woff|woff2|truetype|opentype|embedded-opentype|svg`、`fontIdRegex=^([\w_-]+)$`。未知图标 ID 沿 `ThemeIcon.defaults` 链回退内置 codicon——上游自带，Plain 只需让未覆盖 id 不出现在 iconDefinitions。
- **上游对 SVG/字体资源零净化**（信任模型不同），ADR 0002 的净化要求必须 Rust 自建：字符串扫描级拒绝 `<script`（含命名空间变体）、`on[a-z]+\s*=` 事件属性、`<foreignObject`、外部 URL（http/https/javascript:/data:text/html 的 href/xlink:href/image/style @import/url()；`#id` 片段放行）、`<!DOCTYPE`/外部实体；`format:"svg"` 字体同规则。字体校验取 magic bytes 级（wOFF/wOF2/0x00010000/true/ttcf/OTTO），不引入字体解析依赖——与 tmTheme 最小结构校验同一取舍。
- 上限：单资源沿用 8 MiB、整包 64 MiB；新增关联映射条目数上限（icon 定义/关联总数，量级对齐既有 64 类预算，实现定精确值并 Harness 锁定）。

## 技术方案

Rust：`manifest.rs` 把 `iconThemes`/`productIconThemes` 从透传改为结构化校验（`{id,label?,path}`，path 走既有 resolve+清单命中）；新增 `icon_theme_json.rs`/`product_icon_theme_json.rs` 解析并把 `iconPath`/字体 `src` 收进既有 `resources` 白名单，同处执行 SVG 净化与字体 magic bytes；`record.rs` 字段结构化；`resource.rs` 零改动；selection 存储扩展 `fileIconThemeId`/`productIconThemeId` 可选字段（同文件同原子写）。
前端：registry/picker/coordinator 平行扩展（`FileIconThemeData`/`ProductIconThemeData` 深导入、两个 Quick Pick 劫持、导入消费面加 icon 资源 MIME、启动应用两类 selection）；内置 `vs-minimal` 激活。

### 切片

1. **S1 Rust 校验管线**：结构化 manifest + SVG 净化 + 字体 magic bytes + resources 扩展 + 恶意 fixture 矩阵（脚本/事件属性/外部 URL SVG、伪造字体、超限、关联条目超限）。
2. **S2 前端激活与消费**：`vs-minimal` 探针坐实 → Data 深导入构造 + 两个 picker 劫持 + 导入包 icon 主题进入选择器 + Browser 证据（图标真实渲染、`hidesExplorerArrows`、未知 id 回退）。
3. **S3 持久化与收口**：双 icon selection 持久化 + 启动应用 + E2E 交接条目 + evidence 闭环切 F070。

## 排除项

不做 `showLanguageModeIcons` 的语言探测增强、不做图标主题热重载 watch、不引入 XML/字体解析依赖；marketplace 兜底不做。

## 实施偏差记录（S1-S3 收口后回填）

- **S1**：`iconThemes`/`productIconThemes` 的 `id` 字符集复用既有 `selection::validate_theme_selection_id`（非空、≤256 字节、无控制字符），未新增专属正则——理由：这两类 id 从不当路径段解释，与持久化 `themeId` 同一充分性证明。`THEME_PACKAGE_NO_THEMES` 语义从「`themes` 为空即拒绝」扩为「三轴全空才拒绝」。SVG 净化对 `data:` 一律拒绝、对 `@import`/`url()` 做全文档扫描（均比原方案文字描述更严，非放松）。`embedded-opentype`（EOT）因该格式无可识别 magic bytes，闭集校验下恒被拒绝——已知收窄，三条 acceptance 均不需要 EOT。
- **S2**：真实探针推翻「`contributedFileIconTheme`/`contributedProductIconTheme` style 元素缺失」的猜测——二者其实**恒存在但内容恒为空**（由 `ThemeRegistry` 构造时传入的 `noIconTheme`/`defaultTheme` 单例经 `findThemeById("")` 命中产生）。`FileIconThemeData`/`ProductIconThemeData` 与 `ColorThemeData` 不同，不从 `@codingame/monaco-vscode-api` 自身导出，只存在于 `theme-service-override` 包自己的 `browser/` 子目录，需要单独的深导入路径。全量 Playwright 复跑暴露一处既有断言脆弱性：`file-icons-enabled` 等 class 顺序会被颜色主题自身的 classList 操作打乱（成员不变），已改为排序后比较而非严格数组相等。发现但未在 S2 内修复的架构缺口：`ThemePackageSummary` 未投影 `icon_themes`/`product_icon_themes`，导致导入包的图标主题当时无法被前端发现——已作为 S3 的开工前置项如实登记（见下）。
- **S3**：
  1. **DTO 投影缺口**：`dto.rs` 新增 `IconThemeContributionSummary`（`{id,label,path}`）与 `ThemePackageSummary.iconThemes`/`productIconThemes`（`Vec`，纯投影已验证数据，不新增校验），闭合 S2 遗留缺口。
  2. **`StoredThemeSelection` 大小写修复**：F050 S4 落地时该结构体未加 `#[serde(rename_all = "camelCase")]`，导致磁盘上 `selection.plain.json` 的真实 JSON key 一直是蛇形 `theme_id` 而非文档/测试名暗示的 `themeId`（写入/读取自洽所以此前未被发现——直到本次为验证「旧文件缺新字段回落 None」新写的测试用真实 camelCase key 探测才暴露）。因这是本地全新库、没有历史用户数据需要迁移兼容，直接补齐 `rename_all = "camelCase"`，使磁盘形状与线协议一致。
  3. **`theme_set_selection` 语义选择：per-field 合并写，而非整体替换**。三个字段各自为 `Option<Option<String>>`（双重 Option 的经典模式，`#[serde(default, deserialize_with = "deserialize_present_field")]`）：请求体缺省该字段＝不动该轴，显式 `null`＝清空该轴，字符串＝设置该轴（仍过 `validate_theme_selection_id`）。理由：三个 picker 各自独立触发持久化，整体替换会强制每次先 `theme_get_selection` 再回填未变字段，把单轴原子更新拆成跨两次 IPC 的竞态窗口；per-field 合并写把「读当前 → 按字段合并 → 单次原子重命名发布」整个收在 Rust 一侧、同一把库锁内完成。
  4. **None/Default 无法字面持久化**：`FileIconThemeData.noIconTheme`/`ProductIconThemeData.defaultTheme` 的真实 `settingsId` 都是空字符串 `""`，但 `validate_theme_selection_id` 明确拒绝空 id——若把「用户显式选择 None/Default」和「从未选择过该轴」都编码成 `null`，重启后会把前者误当成后者、静默复活 `vs-minimal` 默认。改为两个前端专属保留 sentinel 常量（`plain:no-file-icon-theme`/`plain:default-product-icon-theme`），只在持久化边界做 `"" ↔ sentinel` 双向映射，应用时仍是真实上游单例、不经注册表查找。
  5. **失效回退目标确认为「维持已应用的 bootstrap 默认」**：不管是 fileIcon 还是 productIcon，`applyPersisted*Selection` 在「已持久化但匹配不到任何已知条目」时都不重新套用默认——因为 `applyDefault{FileIcon,ProductIcon}Theme` 已经在更早的 bootstrap 阶段把默认（`vs-minimal`/Default）应用过，这里只需警告 + 清空过期持久化值即可，不需要重复调用一次 `setXxxIconTheme`。产品意图确认：`vs-minimal` 而非「None」更贴近「和 VS Code 一样」的默认体验（上游真实默认是未捆绑的 `vscode-theme-seti`，Plain 没有触达路径，只能选自己内置的 `vs-minimal`）。
  6. **Browser E2E 真实探针纠正的产品图标 fixture 假设**：手写的产品图标主题 JSON 若 `fonts: []`（空数组）会被上游 `_loadProductIconThemeDocument` 直接拒绝（"Must contain iconDefinitions and fonts" ——检查的是 `!fonts.length` 而非单纯 truthy），且 `fonts[]` 条目缺 `weight`/`style` 时上游会各記一条 "Ignoring setting" 诊断並被 Plain 自身日志管线判定为 `console.error` 级别——因此真实感的图标 fixture 必须提供非空 `fonts[]` 且逐项带合法 `weight`/`style`/`src`，这与 F060 S1 自身对 Rust `fonts` 非空的校验要求本就一致，只是首次被真实浏览器验收坐实。
