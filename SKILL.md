---
name: setup-dida-bot
description: use when setting up the local setup-dida-bot daemon that merges WeChat-split Dida tasks and wakes a Grok Bot webhook.
---

# setup-dida-bot

本地替代 Cloudflare Worker `dida-bot-merge`：轮询滴答 Open API，合并微信拆分的 `@botx` 空正文碎片，认领后 POST webhook 给 Grok Bot。`source` 固定为 `setup-dida-bot`。

人类可读的总览在 [README.md](README.md)。webhook 请求头、载荷和例程提示词在 [docs/webhook.md](docs/webhook.md)。

## 何时使用

- 在本机跑 Dida 合并，而不部署或改动线上 Worker
- 为 Grok Bot 接上 `dida_bot_work` 上游
- 用独立标记（`@botx` / `x-todo` / `x-doing` / `x-done`）联调，避开生产 `todo` / `doing` / `done`

## 安装

命令都在**克隆后的项目根目录**执行（含 `package.json` 的那一层）。不要写死某台机器上的绝对路径。

1. **dida-cli**（单独安装；本仓库只读 token）

   与默认 `tokenPath` `~/.config/dida-cli/config.json` 的 `access_token` 对齐的是 npm 包 `@suibiji/dida-cli`。该包没有公开 GitHub 仓库字段，安装说明以 npm 与滴答帮助为准：

   - https://www.npmjs.com/package/@suibiji/dida-cli
   - https://help.dida365.com/articles/7464976698707017728

   ```bash
   npm install -g @suibiji/dida-cli
   dida auth login
   ```

2. **项目**

   ```bash
   npm install
   cp config.example.json config.json
   ```

3. **Webhook**

   编辑本地 `config.json`（不要提交）：

   - `webhookUrl`：Grok Bot webhook 例程 URL
   - `webhookSecret`：与例程密钥一致
   - `webhookAuthStyle`：默认 `both`（同时发送 `Authorization: Bearer <secret>`、`X-Webhook-Secret`、`X-Automation-Key`）。也可设 `bearer` 或 `header`。三种风格的对照表在 [docs/webhook.md](docs/webhook.md)
   - `intervalSeconds`：联调建议 `120`

   例程提示词使用 [docs/webhook.md](docs/webhook.md) 里的规范模板：校验 `event` / `source`，对 `lifecycle` 为 doing 叶子的 `pending` 用 Dida MCP 读任务并执行，正文写结论、评论写过程，叶子改为 `x-done` 并保留 `微信采集`。

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

   会创建标题前缀为 `[setup-dida-bot-test]` 的收件箱任务对，合并后打到本机 mock webhook，再清理。需要已经 `dida auth login`。

## 标记

默认（保持这套，除非操作者明确要接管生产标签）：

- `botMarker`: `@botx`
- `notMarker`: `@notx`
- `tagTodo` / `tagDoing` / `tagDone`: `x-todo` / `x-doing` / `x-done`
- `tagFreeze`: `x-freeze`
- `tagParent`: `x-bot`
- `wechatCaptureTag`: `微信采集`

### 切到生产标记

1. 停掉本机 `npm run daemon` 和 UI。
2. 停掉线上 CF Worker `dida-bot-merge`，确认它不再写同一批任务。
3. 两边都停了之后，把本机 `config.json` 改成 `@bot` / `@not` / `todo` / `doing` / `done` / `freeze` / `bot`。
4. 再 `npm run once` 看一轮。

默认配置保持 `x-*`。不要在这个 skill 里改仓库默认标记，也不要改 Cloudflare Worker。

## Webhook 形态

- `event`: `dida_bot_work`
- `source`: `setup-dida-bot`
- `pending[].lifecycle`: 认领成功路径为 `x-doing`（或配置的 `tagDoing`）
- 完整字段、虚构 id 示例、认证头，以及「网关可能剥掉可见载荷里的认证头」的说明，都在 [docs/webhook.md](docs/webhook.md)

## 注意

- 不要打印 `access_token` 或 `webhookSecret`
- 不要把 `config.json`、真实 webhook URL、automation id、个人邮箱或收件箱任务 id 写进仓库
- 必须留在本机的文件见 [SECURITY.md](SECURITY.md)
