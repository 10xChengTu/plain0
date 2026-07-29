# F110 S1：遗留 Electron/Node 源码树删除——事实性清单

日期：2026-07-29

## 目的

`docs/research/2026-07-28-legacy-retirement.md`「主导会话裁定」第 6 点要求：`cgmanifest.json`/`cglicenses.json`/`ThirdPartyNotices.txt` 三个第三方声明文件的重写属于 `F120` 范围，本切片（`F110` S1）不改写它们，但必须产出一份**事实性的删除清单**——实际移除了哪些第三方代码、涉及哪些原始许可证条目——作为 `F120` 重写这三个文件时的输入。本文档就是这份清单，不包含任何删除操作本身的实施细节（那些记在 `progress.md` 的 S1 条目里）。

## 一、删除的目录/文件与规模（`git rm` 实测数字）

删除前用 `git ls-files <dir> | wc -l` 逐个核实存在性与文件数，删除后用 `git diff --cached --shortstat` 与 `git diff --cached --name-only | awk -F/ '{print $1}' | sort | uniq -c` 核实实际暂存的删除范围：

| 路径                                  | 删除前跟踪文件数 | 说明                                                                                                                        |
| ------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `src/`                                | 8,957            | 旧 Code OSS `src/vs/**`：Electron 主进程/渲染进程 TypeScript 源码、Node 原生模块绑定、全部内置 workbench contrib 的原始实现 |
| `extensions/`                         | 6,477            | 96 个内置扩展目录（见下「二」）+ 10 个 extensions/ 顶层工具文件（`package.json`/`cgmanifest.json`/esbuild 脚本等）          |
| `build/`                              | 381              | gulp 构建管线、Monaco Editor 打包脚本、Windows/Linux/macOS 打包脚本、Azure Pipelines 脚本                                   |
| `test/`                               | 196              | 旧 Code OSS 自身的 smoke/unit/integration/mcp/sanity/monaco/componentFixtures/automation 测试套件                           |
| `cli/`                                | 83               | 旧 Rust CLI（`code` 命令行工具、隧道转发客户端），与 `src-tauri/` 无关的独立 Rust crate                                     |
| `remote/web`                          | 6                | 旧 Code Server Web 客户端入口                                                                                               |
| `.vscode-test.js`                     | 1                | 旧 `@vscode/test-electron` 测试启动配置                                                                                     |
| `gulpfile.mjs`                        | 1                | 旧 gulp 构建入口                                                                                                            |
| `scripts/generate-definitelytyped.sh` | 1                | 生成 `vscode.d.ts` 的历史工具脚本（未被任何流程调用，已用 `grep` 确认零引用）                                               |
| **合计**                              | **16,103**       | `git diff --cached --shortstat`：**16103 files changed, 5128731 deletions(-)**                                              |

删除后重新执行的完整 `pnpm check`（`format:check`/`typecheck`/`oxlint`/`check:features`/`test:unit`/`build:frontend`/`check:architecture`/`check:bundle`/`cargo fmt --check`/`cargo clippy -D warnings`/`cargo test`）与全量 `pnpm test:e2e:browser` 均通过，`check:bundle` 的 `sourceCount`/`categoryCounts`/棘轮上界与删除前逐位一致（见 `progress.md` S1 条目「验收真实数字」），证明这 16,103 个文件确实没有一个在 Plain 真实构建路径或 bundle 产物中被引用。

## 二、`extensions/` 下 96 个内置扩展目录（完整枚举）

```
bat, clojure, coffeescript, configuration-editing, copilot, cpp, csharp, css,
css-language-features, dart, debug-auto-launch, debug-server-ready, diff,
docker, dotenv, emmet, extension-editing, fsharp, git, git-base, github,
github-authentication, go, groovy, grunt, gulp, handlebars, hlsl, html,
html-language-features, ini, ipynb, jake, java, javascript, json,
json-language-features, julia, latex, less, log, lua, make, markdown-basics,
markdown-language-features, markdown-math, media-preview, merge-conflict,
mermaid-markdown-features, microsoft-authentication, notebook-renderers, npm,
objective-c, perl, php, php-language-features, powershell, prompt-basics,
pug, python, r, razor, references-view, restructuredtext, ruby, rust, scss,
search-result, shaderlab, shellscript, simple-browser, sql, swift,
terminal-suggest, theme-abyss, theme-defaults, theme-kimbie-dark,
theme-monokai, theme-monokai-dimmed, theme-quietlight, theme-red, theme-seti,
theme-solarized-dark, theme-solarized-light, theme-tomorrow-night-blue,
tunnel-forwarding, types, typescript-basics, typescript-language-features,
vb, vscode-api-tests, vscode-colorize-perf-tests, vscode-colorize-tests,
vscode-test-resolver, xml, yaml
```

**与 Plain 实际运行时的关系（已实测核实，非推测）**：这 96 个扩展目录里包含的 10 个内置主题扩展（`theme-abyss`/`theme-defaults`/`theme-kimbie-dark`/`theme-monokai`/`theme-monokai-dimmed`/`theme-quietlight`/`theme-red`/`theme-seti`/`theme-solarized-dark`/`theme-solarized-light`/`theme-tomorrow-night-blue`）**不是** `F050`/`F060` 内置主题与图标功能的资源来源——实测确认 Plain 运行时通过 `app/main.ts` 的 `import "@codingame/monaco-vscode-theme-defaults-default-extension"`（`node_modules` 里的独立 npm 包，例如其 `resources/vs_minimal-icon-theme.json` 与本仓库已删除的 `extensions/theme-defaults/fileicons/vs_minimal-icon-theme.json` 是两份独立文件，来自两条完全不同的分发渠道）与 `@codingame/monaco-vscode-theme-service-override` 取得内置主题/文件图标数据，`package.json` 里没有任何一条依赖指向本仓库的 `extensions/` 目录。故这 10 个主题目录的删除**不影响** `F050`/`F060` 已验收的功能。

`extensions/copilot`、`extensions/github`、`extensions/github-authentication`、`extensions/microsoft-authentication` 四个目录本身就是 `AGENTS.md`「不可破坏的产品边界」第 1/2 条明确排除的 AI/账号/云功能的原始实现，其删除是本切片而非某条已有 acceptance 的直接结果，但方向一致。

## 三、随目录删除一并移除的第三方许可证声明文件（原文件，非改写）

以下 13 个文件随其所在目录被物理删除，**不再存在于工作树中**；`F120` 重写 `cgmanifest.json`/`cglicenses.json`/`ThirdPartyNotices.txt` 时，这些文件曾经声明的第三方组件不应再被视为"仍在发布物中"（除非该组件另有独立的 `node_modules` 依赖路径进入 Plain 的真实构建，需逐条核实，本文档不代替 `F120` 做这一步判断）：

| 文件路径（已删除）                                                    | 行数   | 覆盖的第三方组件（据文件内容摘录，非猜测）                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `build/monaco/LICENSE`                                                | 21     | Microsoft 自身对 Monaco Editor 打包脚本的 MIT 许可声明                                                                                                                                                                                                                                                                                                      |
| `build/monaco/ThirdPartyNotices.txt`                                  | 63     | `nodejs` path library、`markedjs`（两个 `%%` 分节组件）                                                                                                                                                                                                                                                                                                     |
| `cli/ThirdPartyNotices.txt`                                           | 13,933 | 旧 Rust CLI（`cli/`，隧道/远程转发命令行工具）依赖的完整 Rust crate 许可证清单，体量最大，条款覆盖 MIT/Apache-2.0/BSD/MPL-2.0 等多种协议族的数十个 crate（本文档不逐条列出条目名，因 `cli/` 与 `src-tauri/` 是两套完全独立的 Rust 依赖树，`Cargo.lock` 从未共享——`F120` 若需要逐条核对，应直接读取 `git show f87cc64e:cli/ThirdPartyNotices.txt` 取回原文） |
| `extensions/copilot/LICENSE.txt`                                      | 20     | Copilot 扩展自身许可证（MIT，Microsoft）——本身即 `AGENTS.md` 排除的 AI 功能面                                                                                                                                                                                                                                                                               |
| `extensions/copilot/chat-lib/LICENSE.txt`                             | 20     | Copilot `chat-lib` 子模块许可证                                                                                                                                                                                                                                                                                                                             |
| `extensions/mermaid-markdown-features/ThirdPartyNotices.txt`          | 277    | `elkjs`（Eclipse Public License v2.0）等 mermaid 图表渲染依赖的组件许可证集合                                                                                                                                                                                                                                                                               |
| `extensions/terminal-suggest/ThirdPartyNotices.txt`                   | 30     | `withfig/autocomplete`（fig 终端自动补全数据，MIT，Hercules Labs Inc.）                                                                                                                                                                                                                                                                                     |
| `extensions/theme-seti/ThirdPartyNotices.txt`                         | 31     | `Seti UI`（`jesseweed/seti-ui`，MIT，Jesse Weed）—— vs-seti 图标主题的原始来源                                                                                                                                                                                                                                                                              |
| `extensions/copilot/test/scenarios/test-notebook-tools/LICENSE`       | —      | Copilot 测试 fixture 内嵌许可证（测试数据本身，非发布物）                                                                                                                                                                                                                                                                                                   |
| `extensions/copilot/test/scenarios/test-notebooks/LICENSE`            | —      | 同上                                                                                                                                                                                                                                                                                                                                                        |
| `extensions/copilot/test/simulation/fixtures/notebook/LICENSE`        | —      | 同上                                                                                                                                                                                                                                                                                                                                                        |
| `extensions/copilot/src/platform/endpoint/common/licenseAgreement.ts` | —      | Copilot 服务条款文案（TS 源码，非独立 NOTICE 文件，随扩展一并删除）                                                                                                                                                                                                                                                                                         |
| `src/vs/platform/endpoint/common/licenseAgreement.ts`                 | —      | 同上在 `src/` 侧的对应文件                                                                                                                                                                                                                                                                                                                                  |

补充：`extensions/cgmanifest.json`（extensions 目录自己的组件登记文件，与顶层 `cgmanifest.json` 是两个独立文件）随 `extensions/` 一并删除，原内容仅 1 条注册：

```json
{ "component": { "type": "git", "git": { "name": "typescript", ... } } }
```

对应 `extensions/typescript-language-features` 扩展打包的 TypeScript 编译器；该扩展已随 `extensions/` 删除。

## 四、顶层 `cgmanifest.json` 的 14 条注册与本次删除的关系（观察，非结论——不改写该文件）

顶层 `cgmanifest.json`（未改动，留给 `F120`）目前有 14 条 `registrations`：`chromium`、`ffmpeg`、`H.264/AVC Video Standard`、`nodejs`、`electron`、`inno setup`、`spdlog`、`vscode-codicons`、`mdn-data`（npm）、`@mdn/browser-compat-data`（npm）、`ripgrep`、`vscode-win32-app-container-tokens`、`@iktakahiro/markdown-it-katex`（npm）、`cacheable-request`（npm）。

实测确认（`grep`/`node -e` 核对 `package.json` 依赖）：这 14 个组件名**没有一个**出现在 Plain 自己的 `package.json` `dependencies`/`devDependencies` 里（`ripgrep`/`cacheable-request`/`@vscode/ripgrep` 均为 `false`），说明它们对应的原始代码此前只存在于刚删除的 `src/`/`extensions/`/`build/`/`cli/` 树中（Electron 打包用的 ffmpeg/inno setup/win32 app container tokens、Node.js/Chromium/Electron 运行时本身、旧 ripgrep 搜索二进制、codicons 图标字体源、ipynb 扩展用到的 markdown-it-katex、旧 CLI 或构建工具用到的 cacheable-request）。**这是观察而非结论**——本文档没有对 14 条逐一做穷尽的"删除后是否还有任何残留引用"复核（`F120` 应在重写这三个文件前自行核实一遍，尤其是 `vscode-codicons`：Plain 运行时的图标字体实际来自 `@codingame/monaco-vscode-*` 系列 npm 包自带的 codicons 资源，与本仓库 `build/monaco`/`src/vs/base/browser/ui/codicons` 是两条独立分发渠道，但两者是否引用同一上游 `vscode-codicons` 项目、许可证条目是否应该保留，属于 `F120` 的判断范围）。

## 五、本文档范围之外、留给 F120 的工作

- 重写/清空/裁剪 `cgmanifest.json`（顶层与曾经存在的 `extensions/cgmanifest.json`——后者已随目录删除，`F120` 若认为顶层文件应该反映这一变化，需要自行决定如何处理）。
- 重写/清空 `cglicenses.json`（当前是 JSONC 格式，`1225` 行，本次未解析非法 JSON 报错的问题——它本身带 `//` 注释，不是纯 JSON，`F120` 处理时需注意用支持注释的解析器或原样保留其 JSONC 格式）。
- 重写/裁剪 `ThirdPartyNotices.txt`（顶层文件，`3,439` 行，覆盖的是 Plain 当前 `node_modules` 依赖树的第三方声明，与本次删除的旧源码树是两个独立的许可证生成来源，本文档未逐条核对两者重叠度）。
- 判断上表「四」里 14 条顶层 `cgmanifest.json` 注册各自是否应保留/删除/替换。

## 六、本文档不包含的内容（有意收窄）

- 不包含对 `cli/ThirdPartyNotices.txt`（13,933 行）里每一个 Rust crate 条目的逐条列举——体量过大且价值有限（`F120` 若需要，可直接用 `git show f87cc64e:cli/ThirdPartyNotices.txt` 取回原文，`f87cc64e` 是本次删除前的最后一次提交）。
- 不包含对 `src/`/`extensions/` 里可能存在的、未被专门 `LICENSE`/`NOTICE` 文件覆盖、但源码注释里内嵌了第三方版权声明的穷举扫描——这需要逐文件的版权头分析，超出「事实性删除清单」的合理产出比，且原始提交历史（`f87cc64e` 之前）本身就是可回溯的事实来源。
