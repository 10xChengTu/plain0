# ADR 0002：主题是唯一扩展输入且只读静态数据

- 状态：接受
- 日期：2026-07-18

## 背景

用户要求直接迁移 VS Code 主题，但不支持其他扩展。完整 VS Code Extension Host 会重新引入任意代码执行、语言环境、账号和巨大维护面；主题本身已有声明式 manifest 和静态文件格式，无需运行扩展代码。

## 决策

实现专用 Theme Package Importer，而不是 Extension Host：

- 输入：本地 `.vsix`、解包目录、标准 VS Code 扩展目录。
- 白名单：`contributes.themes`、`iconThemes`、`productIconThemes`。
- 文件：JSON/JSONC、`.tmTheme` plist、被引用的字体/图片/SVG。
- 忽略且绝不执行：`main`、`browser`、`activationEvents`、scripts、commands 和任何其他 contribution。
- 使用 Monaco + vscode-textmate + vscode-oniguruma 和静态内置 grammar。
- 首阶段不从 Microsoft Marketplace 自动下载；用户本地导入不意味着项目可重新分发主题资产。

## 安全要求

- 防 zip-slip、符号链接越界、zip bomb、路径 include cycle 和超大资源。
- SVG 禁止脚本、事件属性、外部 URL；不安全资源回退默认图标。
- 所有解包资源只进入应用主题数据目录，不获得工作区或 shell 权限。

## 兼容边界

- 静态主题数据应尽可能兼容 VS Code。
- 动态 JS 主题行为不支持。
- `semanticTokenColors` 会解析保存，但没有语义 token provider 时不能产生 VS Code 等同结果。

## 结果

用户可迁移绝大多数纯主题扩展，同时产品仍然没有通用扩展运行时。主题导入器的攻击面可被明确测试和限制。
