---
name: setup-dida-bot
description: use when setting up the local setup-dida-bot daemon that merges WeChat-split Dida tasks and wakes a Grok Bot webhook.
---

# setup-dida-bot

本地 Node daemon：通过 `dida` CLI 读写滴答清单，合并微信拆分的 `@bot` 空正文碎片，用 `todo` / `doing` / `done` 认领，再 POST「setup-dida-bot webhook」。载荷 `source` 固定为 `setup-dida-bot`。本进程不读取 token。

人类可读的总览在 [README.md](README.md)。webhook 请求头、载荷和例程提示词在 [docs/webhook.md](docs/webhook.md)。

## 何时使用

- 在本机跑 Dida 合并认领，默认标记是 `@bot` / `todo` / `doing` / `done`
- 为 Grok Bot 例程「setup-dida-bot webhook」接上 `dida_bot_work`

## 安装

命令都在**克隆后的项目根目录**执行（含 `package.json` 的那一层）。不要写死某台机器上的绝对路径。

1. **dida CLI**（单独安装；本仓库调用 `dida … --json`，不读取 token）

   npm 包 `@suibiji/dida-cli` 没有公开 GitHub 仓库字段。安装说明：

   - https://www.npmjs.com/package/@suibiji/dida-cli
   - https://help.dida365.com/articles/7464976698707017728

   ```bash
   npm install -g @suibiji/dida-cli
   dida auth login
   ```

   `config.json` 的 `didaBinary` 默认是 `dida`。命令不在 PATH 上时改成可执行文件路径。

2. **项目**

   ```bash
   npm install
   cp config.example.json config.json
   ```

3. **Webhook**

   编辑本地 `config.json`（不要提交）：

   - `webhookUrl`：「setup-dida-bot webhook」的 URL，只写本地文件
   - `webhookSecret`：与例程密钥一致，只写本地文件
   - `webhookAuthStyle`：默认 `both`（同时发送 `Authorization: Bearer <secret>`、`X-Webhook-Secret`、`X-Automation-Key`）。也可设 `bearer` 或 `header`。三种风格的对照表在 [docs/webhook.md](docs/webhook.md)
   - `intervalSeconds`：建议 `120`

   例程提示词使用 [docs/webhook.md](docs/webhook.md) 里的规范模板：校验 `event` / `source`，对 `lifecycle` 为 `doing` 的 `pending` 用 Dida MCP 读任务并执行。正文写结论，评论写过程；有可执行下一步才写个人建议；难认标题可改短到不超过 30 字；叶子改为 `done` 并保留 `微信采集`；不勾选完成；指令没有明确要求编码时不派 Oct。

4. **启动**

   ```bash
   npm test
   npm run once
   npm run daemon
   npm run ui
   ```

   状态页默认是 `http://127.0.0.1:8788/`。

5. **联调自测**

   ```bash
   npm run selftest
   ```

   会通过 `dida` CLI 创建标题前缀为 `[setup-dida-bot-test]` 的收件箱任务对，合并后打到本机 mock webhook，再清理。需要已经 `dida auth login`。

## 标记

默认：

- `botMarker`: `@bot`
- `notMarker`: `@not`
- `tagTodo` / `tagDoing` / `tagDone`: `todo` / `doing` / `done`
- `tagFreeze`: `freeze`
- `tagParent`: `bot`
- `wechatCaptureTag`: `微信采集`

这些字段都在本机 `config.json` 里。要改标记就整组一起改，改完重启 daemon。

## Webhook 形态

- 例程名：`setup-dida-bot webhook`
- `event`: `dida_bot_work`
- `source`: `setup-dida-bot`
- `pending[].lifecycle`: 认领成功路径为 `doing`（或配置的 `tagDoing`）
- 完整字段、虚构 id 示例、认证头、写回规范，以及「网关可能剥掉可见载荷里的认证头」的说明，都在 [docs/webhook.md](docs/webhook.md)

## 注意

- 不要打印 `access_token` 或 `webhookSecret`
- 不要把 `config.json`、真实 webhook URL、automation id、个人邮箱或收件箱任务 id 写进仓库
- 必须留在本机的文件见 [SECURITY.md](SECURITY.md)
