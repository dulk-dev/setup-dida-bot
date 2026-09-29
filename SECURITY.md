# 安全

开源评审和日常使用时，下面这些留在本机，不要提交、不要贴进 issue / PR / 聊天。

## 必须留在本机

| 路径 | 原因 |
|------|------|
| `config.json` | `webhookUrl`、`webhookSecret`。仓库只提供空字符串的 `config.example.json` |
| `~/.config/dida-cli/config.json` | dida-cli 的 `access_token`（以及该文件里可能有的刷新信息） |
| `data/status.json` | 最近一轮结果，可能含任务标题和 id |
| `data/processed.json` | 已处理碎片 id |
| `data/merge.lock` | 运行时锁 |
| `.env`、`.env.*`、`config.local.json`、`*.pid` | 已在 `.gitignore` |

文档、测试夹具和 webhook 示例只用虚构 id（例如 `64f0aa0000000000000000c1`）。不要写入真实 webhook URL、automation UUID、个人邮箱或收件箱任务 id。

## 运行时

- 进程加载 token 时只记录前后各 4 个字符的预览。不要在日志、状态页或 PR 里打印完整 `access_token` / `webhookSecret`。
- 状态页默认绑定 `127.0.0.1:8788`。保持本机回环；不要改成对公网监听。
- 改成生产标记 `@bot` / `todo` / `doing` / `done` 之前，先停本 daemon，并停掉线上 Cloudflare Worker `dida-bot-merge`，避免对同一批任务双写。
