# Grok Bot webhook

本 daemon 在认领前向 Grok Bot 的 webhook 例程 POST JSON。URL 和密钥只写在本机 `config.json`，不要提交，不要写进本文档。

日常派活与标签见 [usage.md](usage.md)；总览见 [README](../README.md)。

## 1. 创建例程并填本地配置

1. 在 Grok Bot 里新建（或使用）webhook 例程，建议名称「setup-dida-bot webhook」。
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
| `source` | `"setup-dida-bot"` | 固定。例程名是「setup-dida-bot webhook」，载荷里的 source 仍是这个值 |
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
| `tags` | string[] \| 省略 | 认领后的标签。生命周期叶子已换成 `doing`，`微信采集` 等无关标签保留 |
| `lifecycle` | string \| 省略 | 认领成功路径上的叶子，默认 `doing`，等于配置里的 `tagDoing` |

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
      "fragmentTitle": "把这段说明整理成三条 @bot",
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
      "tags": ["微信采集", "doing"],
      "lifecycle": "doing"
    }
  ]
}
```

没有新合并、只认领一条已经在 `todo` 上的任务：

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
      "title": "汇总昨天的会议纪要 @bot",
      "reason": "standalone",
      "tags": ["微信采集", "doing"],
      "lifecycle": "doing"
    }
  ]
}
```

HTTP 2xx 之后，daemon 才把这些任务的叶子写成 `lifecycle`（默认 `doing`）。非成功则叶子留在 `todo`，`pending` 不会进入 `data/status.json` 的已认领列表。

`src/webhook.ts` 另有 `event: "dida_token_expiry_reminder"` 的类型，daemon **当前不会发送**。收到未知 `event` 时按模板停止即可。

## 4. 规范例程提示词

把下面整段贴进「setup-dida-bot webhook」的提示词。

写回硬规则（提示词里也有，这里再列一遍方便对照）：

- **优先保留转发原文/聊天上下文，禁止整段替换正文。**
- 结论用 `\n\n---\n\n` 追加文尾，或写在评论；过程写评论。
- 仅有可执行下一步时才写个人建议。
- 标题难辨认可改短（≤30 字），不改正文原文段。改短前先判断旧标题值不值得留。
- 旧标题含超链接、URL 或其他可追溯来源时，改标题前把旧标题文字原样追加到正文（`\n\n---\n\n` 之后）或写入评论。套话标题（如「某某聊天记录」「群聊天记录」）不必保留。
- 指令未明确要求写代码或改仓库时，不要另行拉起编码代理 / 同事 bot 开工。
- 叶子改为 `done`，保留 `微信采集`；不要勾选完成。

提示词刻意精简：身份叙事与「网关拿掉头」说明不进例程（后者见上文[认证头](#2-认证头)）。校验 `event`/`source` 仍保留一行。 模板里不出现具体同事 bot 名；若你本地有固定编码助手，可在自用副本里点名，但开源默认保持泛化。

```text
只处理本次 webhook 唤醒，做完就停。

1. 校验：event 必须是 dida_bot_work，source 必须是 setup-dida-bot；不符则停止，不改滴答。
2. 遍历 pending，只处理 lifecycle 为 doing 的项。对每一条：
   - 用已接入的滴答（Dida365 / TickTick）连接器或等价客户端，按 projectId、taskId 读标题、正文、标签、评论。
   - 执行标题和正文里的指令（碎片标记是 @bot）。merges 只说明碎片并进了哪条上下文；只改 pending.taskId，不要改 fragmentId。
   - 保留正文里的转发原文/聊天上下文，禁止整段替换 content。结论或补充用分隔线 \n\n---\n\n 追加文尾；过程写在评论。
   - 评论写执行过程。仅当有可执行下一步时才另写个人建议。
   - 标题难辨认时可改成不超过 30 字的短标题；改标题不改正文原文段。改短前先判断旧标题值不值得留：含超链接、URL 或其他可追溯来源时，先把旧标题文字原样追加到正文（分隔线 \n\n---\n\n 之后）或写入评论，再改标题。套话标题（如「某某聊天记录」「群聊天记录」）不必保留。
   - 生命周期叶子改为 done；保留「微信采集」；同一任务只留一个生命周期叶子，去掉 todo/doing。
   - 不要勾选完成，不要把任务 status 标成已完成。
   - 指令未明确要求写代码或改仓库时，不要另行拉起编码代理 / 同事 bot 开工；写不清就问用户或只做清单侧收口。
3. 用一两句话通知用户：处理了哪些任务、结论是什么。pending 为空则说明本轮无待认领任务。
```
