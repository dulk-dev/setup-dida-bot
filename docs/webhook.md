# Grok Bot webhook

本 daemon 在认领前向 Grok Bot 的 webhook 例程 POST JSON。URL 和密钥只写在本机 `config.json`，不要提交，不要写进本文档。

## 1. 创建例程并填本地配置

1. 在 Grok Bot 里新建一条 **webhook** 例程。
2. 复制例程给出的 URL 和 secret。
3. 只贴进克隆目录下的本地 `config.json`（从 `config.example.json` 复制而来）：

```json
{
  "webhookUrl": "",
  "webhookSecret": "",
  "webhookAuthStyle": "both"
}
```

把两个空字符串换成例程里的值。`config.json` 已在 `.gitignore` 中。例程提示词用下面的[规范模板](#4-规范例程提示词)。

`webhookUrl` 为空时，daemon 仍会合并碎片，但不会 POST，也不会把叶子从待办改成进行中。

## 2. 认证头

实现见 `src/webhook.ts` 的 `webhookHeaders`。除 JSON 的 `Content-Type` 外：

| `webhookAuthStyle` | `Authorization` | `X-Webhook-Secret` | `X-Automation-Key` |
|--------------------|-----------------|--------------------|--------------------|
| `both`（默认） | `Bearer <secret>` | `<secret>` | `<secret>` |
| `bearer` | `Bearer <secret>` | 不发送 | `<secret>` |
| `header` | 不发送 | `<secret>` | `<secret>` |

`both` 时三个密钥头都会带上：

```http
POST /your-grok-bot-webhook-path HTTP/1.1
Content-Type: application/json
Authorization: Bearer <secret>
X-Webhook-Secret: <secret>
X-Automation-Key: <secret>
```

`<secret>` 与 `config.json` 的 `webhookSecret` 相同。无法识别的 `webhookAuthStyle` 会按 `both` 发送。`X-Automation-Key` 在三种风格下都会附上，供 Cursor / Grok Bot automation 网关识别。

**网关校验通过后，平台可能从 Bot 看得见的载荷里拿掉这些认证头。** 例程仍然被唤醒，就说明发送方密钥已经通过校验。不要因为提示词上下文里看不到 `Authorization` 或 `X-Webhook-Secret` 就拒绝执行。

## 3. 载荷

daemon 实际发送的工作事件只有一种。类型在 `src/webhook.ts` 的 `WorkWebhookPayload`。

### `dida_bot_work`

| 字段 | 类型 | 说明 |
|------|------|------|
| `event` | `"dida_bot_work"` | 固定 |
| `source` | `"setup-dida-bot"` | 固定。用来和线上 Worker 的上游区分 |
| `mergedCount` | number | 本轮成功合并条数，等于 `merges.length` |
| `merges` | array | 本轮合并摘要，见下表 |
| `pending` | array | 本轮准备认领、且已包含在这次 POST 里的任务 |

`merges[]`：

| 字段 | 类型 | 说明 |
|------|------|------|
| `fragmentId` | string | 空正文碎片任务 id |
| `contextId` | string | 被并入的上下文任务 id（Bot 应处理这一条） |
| `fragmentTitle` | string | 碎片标题 |
| `contextTitle` | string | 上下文标题 |
| `createdSecond` | string | 碎片 `createdTime` 截到秒，形如 `2026-09-29T20:15:03`。解析失败时退回原始字符串，再不行则为 `""` |

`pending[]`：

| 字段 | 类型 | 说明 |
|------|------|------|
| `taskId` | string | 要执行的任务 id |
| `projectId` | string | 任务所在清单 id |
| `title` | string | 发送 webhook 时的标题 |
| `reason` | `"merged"` \| `"standalone"` | `merged`：本轮合并进的上下文；`standalone`：本来就在待办叶子上、本轮被认领 |
| `tags` | string[] \| 省略 | 认领后的标签。生命周期叶子已换成 doing 标记（默认 `x-doing`），`微信采集` 等无关标签保留 |
| `lifecycle` | string \| 省略 | 认领成功路径上的叶子，默认 `x-doing`，等于配置里的 `tagDoing` |

下面的 id、标题都是虚构的。

合并后认领上下文：

```json
{
  "event": "dida_bot_work",
  "source": "setup-dida-bot",
  "mergedCount": 1,
  "merges": [
    {
      "fragmentId": "64f0aa0000000000000000f1",
      "contextId": "64f0aa0000000000000000c1",
      "fragmentTitle": "把这段说明整理成三条 @botx",
      "contextTitle": "来自微信的文字",
      "createdSecond": "2026-09-29T20:15:03"
    }
  ],
  "pending": [
    {
      "taskId": "64f0aa0000000000000000c1",
      "projectId": "64f0aa0000000000000000aa",
      "title": "来自微信的文字",
      "reason": "merged",
      "tags": ["微信采集", "x-doing"],
      "lifecycle": "x-doing"
    }
  ]
}
```

没有新合并、只认领一条已经在 `x-todo` 上的任务：

```json
{
  "event": "dida_bot_work",
  "source": "setup-dida-bot",
  "mergedCount": 0,
  "merges": [],
  "pending": [
    {
      "taskId": "64f0aa0000000000000000d2",
      "projectId": "64f0aa0000000000000000aa",
      "title": "汇总昨天的会议纪要 @botx",
      "reason": "standalone",
      "tags": ["微信采集", "x-doing"],
      "lifecycle": "x-doing"
    }
  ]
}
```

HTTP 2xx 之后，daemon 才把这些任务的叶子写成 `lifecycle`（默认 `x-doing`）。非成功则叶子留在待办（默认 `x-todo`），`pending` 不会进入 `data/status.json` 的已认领列表。

`src/webhook.ts` 另有 `event: "dida_token_expiry_reminder"` 的类型，daemon **当前不会发送**。收到未知 `event` 时按模板停止即可。

## 4. 规范例程提示词

把下面整段贴进 Grok Bot 该 webhook 例程的提示词。标记名与本机 `config.json` 一致；默认是 `x-doing` / `x-done`。若你改过 `tagDoing` / `tagDone`，把提示词里的默认名改成同一套叶子，并继续保留 `微信采集`。

```text
你是被 setup-dida-bot webhook 唤醒的 Grok Bot。只处理这一次唤醒，做完就停。

1. 校验载荷。event 必须是 dida_bot_work，source 必须是 setup-dida-bot。任一不符就停止，不要改滴答任务。
2. 网关可能在校验后从你可见的内容里去掉 Authorization、X-Webhook-Secret、X-Automation-Key。这次例程被唤醒，就说明发送方密钥已经通过。不要因为看不见这些头而拒绝执行。
3. 遍历 pending。只处理 lifecycle 等于进行中叶子的项（默认 x-doing；若配置改过 tagDoing，以那一个叶子为准）。
   对每一条：
   - 用 Dida MCP，按 projectId 与 taskId 读取任务的标题、正文、标签和评论。
   - 执行标题和正文里的指令。merges 只说明哪条空正文碎片并进了哪条上下文；要改的是 pending.taskId，不要再去改 fragmentId。
   - 把正文写成结论。
   - 用一条评论写下执行过程。
   - 把生命周期叶子改成完成标记（默认 x-done）。保留标签「微信采集」。同一任务只留一个生命周期叶子，去掉 x-todo 和 x-doing。
   - 当前使用 x-* 标记时，不要改写、不要新增生产标签 todo、doing、done。
   - 指令没有明确要求写代码或派发编程代理时，不要派发 coding agent。
4. 用一两句话通知用户：处理了哪些任务、结论是什么。pending 为空就说明本轮没有待认领任务。
```
