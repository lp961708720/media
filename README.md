# Media Studio · 自媒体工作台桌面首版

按 `PRD V1.5` 实现的本机优先桌面软件，版本 0.1.0。支持 macOS Apple Silicon / Intel 及 Windows x64。首版交付核心内容生产闭环，**不代表 PRD 的 P0/P1/P2 全量需求已全部验收**。具体范围见 `验收与限制.md`。

## 使用客户端

- Mac：解压对应架构压缩包，将 `Media Studio.app` 放进「应用程序」，打开即可。M1/M2/M3/M4 等使用 Apple Silicon 版；Intel 处理器使用 Intel 版。
- Windows 10/11 x64：完整解压客户端 ZIP 后运行 `Media Studio.exe`。请保留同目录的 DLL、resources、locales 等文件，不要单独复制 EXE。
- 安装包内自带运行环境，不需要安装 Node.js。Mac 使用本地 ad-hoc 签名，尚未 Apple Developer 签名/公证；Windows 未使用商业代码签名。
- Mac 两种架构、Windows x64 均已生成文件。Apple Silicon 完成启动及运行时检查；Intel Mac / Windows 尚需目标机器运行验收。

## 第一次使用

1. 在「账号矩阵」添加自己的公众号或小红书账号，填写定位、受众及写作规则。
2. 在「选题研究」收集选题，或在「对标研究」手工记录公开账号和文章拆解，提炼本账号选题。
3. 在「模型配置」填写真实模型接口、API Key、模型 ID、价格与预算，执行连接测试，然后为账号保存默认模型。没有 Key 也可人工编辑、导出及安排发布。
4. 新建任务默认「AI 直接写作」，去 AI 味关闭。导入自己的 Skill 后，可在任务里主动选择。
5. AI 生成保留独立候选。先比较，再采纳；采纳创建新修订，原稿不被自动覆盖。
6. 「排版中心」预览并导出 Markdown、公众号 HTML 或小红书文字卡片 PNG ZIP。
7. 「发布中心」创建排期，审核明确版本，人工发布并回填实际链接和时间。修改稿件后需要重新审核。
8. 「数据中心」录入指标或导入模板 CSV；作品只采用最新累计快照，不累加历史累计数。
9. 「设置与备份」导出备份。Mac / Windows 暂无自动同步，可通过备份迁移到空工作空间；密钥需要重新录入。

## 数据与安全

- 桌面 SQLite 位于 Electron 的应用用户数据目录。默认 macOS：`~/Library/Application Support/Media Studio/`；Windows：`%APPDATA%/Media Studio/`。可从应用菜单「打开数据目录」查看实际位置。
- 数据保存在 `studio.sqlite`，处于 WAL 模式。运行时不要仅复制主数据库文件；优先使用应用内备份。停机完整目录备份需要一并保留数据库相关文件。
- API Key 使用 AES-256-GCM 加密，主密钥通过 Electron safeStorage 使用系统 Keychain / Windows DPAPI 保护。恢复 JSON 备份不包含凭证。
- 桌面页面不启用 Node.js，启用 contextIsolation、sandbox 和 CSP。本机 API 仅监听随机回环端口，校验随机 HttpOnly 会话 cookie、Host 和 Origin。
- 操作数据的每一个请求都校验所属账号；AI 只引用当前账号选题、关联研究和显式选择的素材。跨账号复制新建 ID，并清除私有研究和素材引用。
- 首版供应商 URL 限定受信任 HTTPS 域名，拒绝回环、内网、任意自定义域名和重定向。支持 OpenAI Chat Completions 兼容协议和 Anthropic Messages 协议，不承诺所有模型参数都兼容。
- AI 费用是按用户配置价格与返回 Token 估算，不是供应商账单。单次、每日、每月预算在请求前检查并原子预留；币种分别核算。请求超时或取消仍可能产生供应商费用，保守保留预留估算。
- 不保存平台登录 Cookie / 密码，不自动抓取全文，不模拟平台发布成功。

## Skill 文件格式

新工作空间没有预装用户 Skill。支持 `.md` 和 ZIP 中的 `SKILL.md`、文本参考文件；不执行包内任何脚本。

```markdown
---
name: my-writing
display_name: 我的写作规则
description: 保持具体、自然、有出处
version: 1.0.0
---
先写具体场景。区分事实、推断与虚构。
```

frontmatter 为顶层无缩进纯文本键值。首版不支持复杂 YAML、锚点、自定义标签或嵌套结构。文件最多 200 KB，ZIP 最多 1 MB / 32 文件，解压总文本最多 500 KB。更新正文时需要递增 version。

## 源码运行

需要 Node.js 24+。核心界面、服务端及测试没有运行时 npm 依赖。

```bash
npm run check
npm test
npm run build
npm run dev
```

开发服务地址为 `http://127.0.0.1:4327`，仅监听回环。开发模式会建立本机管理员会话，数据在源码目录 `.local/`，与桌面正式用户目录分开。开发加密密钥仅用于开发，不应随代码交付。设置 `PORT` 可更换端口。

桌面开发和常规构建：

```bash
npm ci
npm run desktop
npm run dist:mac
npm run dist:win
```

`electron-builder` 配置支持 Mac DMG/ZIP 与 Windows NSIS/ZIP。`.github/workflows/desktop.yml` 提供原生 Mac / Windows CI 构建，不会自动发布 GitHub Release。本次交付的是已打包的 ZIP 客户端；没有把尚未运行的 NSIS/DMG 流水线标记为已生成安装器。

提供 `scripts/package-portable.mjs`，可使用官方 SHA-256 校验过的 Electron 45.0.0 运行时重复打包；本次包采用该脚本生成。手工运行需要传入目标平台、架构、运行时 ZIP、官方校验表和新的输出目录。

## 工程结构

- `public/`：中文响应式界面、编辑器、导出器、数据和 Skill 页面。
- `worker/index.js`：统一业务 API、账号校验、修订和发布状态机、模型网关。
- `scripts/server.mjs`：桌面本机 HTTP 桥与会话边界。
- `scripts/database.mjs` / `drizzle/`：SQLite 适配和初始迁移。
- `desktop/main.cjs`：桌面生命周期、系统加密、原生导出对话框。
- `tests/core.test.mjs`：账号隔离、候选/修订、审核、密钥、Skill、预算、恢复等自动化验收。
- `.openai/hosting.json`：最初登记的私有网页项目标识，未部署；桌面运行不依赖云端。

未附任何真实账号、用户 Skill、API Key 或运营数据。界面验收使用的测试数据只位于开发工作空间，不包含在客户端 ZIP 内。
