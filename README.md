# setup-dida-bot

本地 Node 脚本版滴答清单「微信拆分任务合并 + 认领 webhook」，面向 **Grok Bot**。  
行为对齐 Cloudflare Worker `dida-bot-merge`，但使用**独立标记**，避免与线上 Worker 冲突。

## 默认标记（本地测试，勿与线上混用）

| 用途 | 本地默认 | 线上 Worker |
|------|----------|-------------|
| 片段标记 | `@botx` | `@bot` |
| 歧义改写 | `@notx` | `@not` |
| 生命周期 | `x-todo` / `x-doing` / `x-done` | `todo` / `doing` / `done` |
| 冻结 | `x-freeze` | `freeze` |
| 父标签 | `x-bot`（可选） | `bot` |
| 微信来源 | `微信采集`（与线上相同，用于依赖匹配） | 同左 |

全部在 `config.json` 可改；切生产前请停掉本 daemon，再改标记。

## 前置

1. 安装并登录 [dida-cli](https://github.com/)：`dida auth login`  
   Token 读自 `~/.config/dida-cli/config.json` 的 `access_token`（脚本不会打印完整 token）。
2. `cd /workspace/projects/setup-dida-bot && npm install`
3. 复制配置：`cp config.example.json config.json`，填入 `webhookUrl` / `webhookSecret`。

## 命令

```bash
npm test              # vitest（标记为 @botx）
npm run once          # 合并 + 认领跑一轮，写 data/status.json
npm run daemon        # 默认每 120s 轮询
npm run status        # 打印最近状态
npm run ui            # http://127.0.0.1:8788/ 状态页（可改 interval / enabled）
npm run selftest      # 真 API + 本地 mock webhook 端到端
```

## Webhook 事件

```json
{
  "event": "dida_bot_work",
  "source": "setup-dida-bot",
  "mergedCount": 1,
  "merges": [{ "fragmentId", "contextId", "fragmentTitle", "contextTitle", "createdSecond" }],
  "pending": [{ "taskId", "projectId", "title", "reason", "tags", "lifecycle": "x-doing" }]
}
```

认证：`webhookAuthStyle` = `bearer` | `header` | `both`（Authorization Bearer + `X-Webhook-Secret`）。

## 数据目录

- `data/merge.lock` — 文件锁  
- `data/processed.json` — 已处理片段 id  
- `data/status.json` — 最近一次运行结果（UI 读取）

## 切到生产标记（谨慎）

在 `config.json` 中改为：

```json
{
  "botMarker": "@bot",
  "notMarker": "@not",
  "tagParent": "bot",
  "tagTodo": "todo",
  "tagDoing": "doing",
  "tagDone": "done",
  "tagFreeze": "freeze"
}
```

并确保线上 CF Worker 已停，避免双写。详见 `SKILL.md`。

## 与 Worker 的差异

- 无 CF KV / 子请求预算；用本地文件锁 + processed 集合  
- `source` 为 `setup-dida-bot`  
- 默认生命周期叶子带 `x-` 前缀  
- 提供 CLI daemon 与本机 UI
