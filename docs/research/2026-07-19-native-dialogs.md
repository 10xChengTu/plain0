# 真实 Tauri 对话框调研与接线方案

调研日期：2026-07-19

## 结论

真实 WKWebView 中永久删除不弹确认框，不是 Explorer 删除动作或 Rust 删除事务失败，而是 Plain 漏接了 `monaco-vscode-api` 官方 dialogs service override。当前运行时因此沿用 `StandaloneDialogService`，它把 `window.confirm()` 当作同步布尔值；Tauri dialog 插件又会把同一个全局函数替换成异步 Promise。Browser E2E 不加载插件初始化脚本，所以同步确认会通过，无法发现这一真实运行时差异。

采用与其余 Workbench packages 完全同版的 `@codingame/monaco-vscode-dialogs-service-override@35.0.1`。它复用 VS Code 的 `DialogService`、`DialogHandlerContribution` 和 `BrowserDialogHandler`，在 Workbench DOM 中渲染可访问的异步对话框，不依赖 WebKit 原生 JavaScript confirm，也不需要新增 Tauri dialog capability。

## 现状证据

1. Plain 的 [`createServiceOverrides`](../../app/services.ts) 没有覆盖 `IDialogService`，固定依赖最终仍使用 [`StandaloneDialogService`](https://github.com/microsoft/vscode/blob/5264f2156cbcd7aea5fd004d29eaa10209155d66/src/vs/editor/standalone/browser/standaloneServices.ts#L252-L275)。该实现直接把 `mainWindow.confirm()` 的返回值写入 `confirmed`。
2. `tauri-plugin-dialog 2.7.1` 在初始化时改写 `window.confirm` 为异步函数；上游从 [PR #3287](https://github.com/tauri-apps/plugins-workspace/pull/3287) 起也把 ask/confirm 统一建模为异步 message command。Plain 当前 capability 只有 event listen/unlisten，没有 dialog permission；即使只增加 permission，Standalone service 仍会把 Promise 当成确认结果。
3. 固定 Wry 0.55.1 的 [`WryWebViewUIDelegate`](https://github.com/tauri-apps/wry/blob/wry-v0.55.1/src/wkwebview/class/wry_web_view_ui_delegate.rs#L97-L261) 没有实现 JavaScript confirm delegate；[WebKit 的 `WKUIDelegate` 契约](https://github.com/WebKit/WebKit/blob/main/Source/WebKit/UIProcess/API/Cocoa/WKUIDelegate.h#L122-L136) 说明未实现时按 Cancel 处理。因此移除 Tauri 插件的全局改写也不是跨平台修复。
4. Plain 的删除 coordinator 固定执行 `prepare → confirm → begin → commit`。确认结果不是 primitive `true` 时会取消已准备的 batch，所以“无确认框、磁盘不变”与当前合同一致；磁盘不变不能反推 `workspace_prepare_delete` 没有执行。
5. Browser E2E 通过 Explorer 聚焦后的 `⌘Backspace` 触发同一个 `deleteFile` handler，但测试页只安装 `__TAURI_INTERNALS__.invoke` mock，不加载真实 dialog 插件初始化。它观察到浏览器原生 confirm，只证明同步浏览器路径。

## GitHub 现有方案

- [`monaco-vscode-api` 35.0.1](https://github.com/CodinGame/monaco-vscode-api/commit/d8367168c23c9d0a9ba5bc84b8034e5435e9eb93) 对应 Code OSS `1.128.1` / commit `5264f2156cbcd7aea5fd004d29eaa10209155d66`。
- CodinGame 已提供同版 [`dialogs` service override](https://github.com/CodinGame/monaco-vscode-api/blob/d8367168c23c9d0a9ba5bc84b8034e5435e9eb93/src/service-override/dialogs.ts#L1-L26)，官方 [demo 接线](https://github.com/CodinGame/monaco-vscode-api/blob/d8367168c23c9d0a9ba5bc84b8034e5435e9eb93/demo/src/setup.common.ts#L420-L430) 也把它加入 service overrides。
- VS Code 固定版 [`BrowserDialogHandler`](https://github.com/microsoft/vscode/blob/5264f2156cbcd7aea5fd004d29eaa10209155d66/src/vs/workbench/browser/parts/dialogs/dialogHandler.ts#L56-L137) 使用 Workbench DOM `Dialog`，支持 confirm、prompt、input、checkbox、键盘焦点与取消，而不是调用全局 `window.confirm`。
- 固定版 Explorer 的 [`deleteFile` 路由](https://github.com/microsoft/vscode/blob/5264f2156cbcd7aea5fd004d29eaa10209155d66/src/vs/workbench/contrib/files/browser/fileActions.contribution.ts#L63-L97) 在 provider 不支持 Trash 时让 macOS `⌘Backspace` 直接执行永久删除；当前菜单显示 `Delete Permanently ⌘Backspace` 符合上游设计。

## 方案评估

| 方案                                                    | 结论                                                                                    |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 只给 Tauri dialog 插件增加 permission                   | 拒绝。不能修复 Standalone service 的同步布尔假设，还扩大 WebView 原生 dialog 权限。     |
| patch Standalone service 去 await 全局 `window.confirm` | 拒绝。继续依赖被插件改写的全局函数和平台 delegate，只覆盖简化的 standalone 行为。       |
| 自行补 Wry `WKUIDelegate` 或引入 WebDriver              | 拒绝。平台专用、维护面大，也不能解决 Chromium/browser 与 Workbench 对话框的一致性。     |
| Plain 自写 DOM dialog service                           | 可行但不采用。固定依赖已经提供同版官方实现，重复维护没有收益。                          |
| CodinGame 官方 dialogs service override                 | 采用。版本与现有 Workbench 完全一致，沿用 VS Code DOM dialog，零新增 Tauri capability。 |

## 冻结实施边界

1. 只新增 `@codingame/monaco-vscode-dialogs-service-override@35.0.1`，在 `createServiceOverrides()` 中显式加入；禁止隐式升级其他 `@codingame` packages。
2. Harness 把 dialogs package 纳入同版 allowlist，锁定唯一 import、唯一 override 调用和 `IDialogService` 最终覆盖；同时禁止以本修复为由加入 `dialog:default`、`dialog:allow-message` 或其他 WebView 权限。
3. Browser E2E 改为观察 `role="dialog"`、完整不可逆文案和明确按钮；先验证取消不产生 begin/commit，再验证确认后的 prepare/begin/commit 顺序。不得继续用 Playwright 原生 `dialog` 事件冒充 Workbench DOM dialog。
4. 真实 Tauri 先执行取消验收：菜单与 `⌘Backspace` 都能出现相同的可访问对话框，Escape/取消后磁盘保留。正向永久删除使用专用临时 fixture，并在 Computer Use 点击不可逆确认按钮前取得即时确认。
5. 本工作项只修通 Workbench 通用对话框服务，不改变 Rust 删除 receipt、确认文案、Trash capability 或任何文件系统权限。

## 完成条件

- 单元、类型、lint、架构与 bundle guard 通过。
- Browser E2E 不再出现原生 JavaScript confirm，DOM dialog 的取消与确认路径均通过。
- 当前源码重新构建的隔离 `.app` 中，永久删除对话框可见且可由键盘/辅助功能访问。
- 取消后 fixture 保留；取得即时确认并点击永久删除后，Rust 路由、磁盘结果和 Explorer 收敛全部通过。
