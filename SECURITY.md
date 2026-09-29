# 安全

下面这些留在本机，不要提交、不要贴进 issue、PR 或聊天。

## 必须留在本机

| 路径 | 原因 |
|------|------|
| `config.json` | `webhookUrl`、`webhookSecret`。仓库只提供空字符串的 `config.example.json` |
| `~/.config/dida-cli/config.json` | `dida auth login` 写入的登录信息。本 daemon 不读取该文件，也不要提交 |
| `data/status.json` | 最近一轮结果，可能含任务标题和 id |
| `data/processed.json` | 已处理碎片 id |
| `data/merge.lock` | 运行时锁 |
| `.env`、`.env.*`、`config.local.json`、`*.pid` | 已在 `.gitignore` |

文档、测试夹具和 webhook 示例只用虚构 id（例如 `64f0aa0000000000000000c1`）。不要写入真实 webhook URL、automation UUID、个人邮箱或收件箱任务 id。

## 运行时

- 本进程不读取、不打印 dida 的 access_token。不要在日志、状态页或 PR 里打印 token 或 `webhookSecret`。
- 状态页默认绑定 `127.0.0.1:8788`。保持本机回环，不要改成对公网监听。
- 「setup-dida-bot webhook」的 URL 和 secret 只存在本机 `config.json`。
