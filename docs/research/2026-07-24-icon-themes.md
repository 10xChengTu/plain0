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
