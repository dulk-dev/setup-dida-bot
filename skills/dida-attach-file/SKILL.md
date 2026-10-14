---
name: dida-attach-file
description: >-
  use this when attaching a local file/image to a Dida365/TickTick task
  (upload via web API, then embed ![image](...) with MCP update_task while
  keeping dates), since the official Open API / MCP has no attachment upload
---
# 滴答任务挂附件

官方 Open API / MCP 没有附件上传接口。本技能用网页 API **只上传**，正文由 MCP `update_task` 写入。

## 前置

- 本地文件路径、`projectId`、`taskId`
- Python 3（仅标准库）
- 网页登录会话 cookie（不要打印到聊天或日志），任选其一：
  1. 环境变量 `DIDA_COOKIE_T`（必需）+ `DIDA_CSRF`（可选，即 cookie `_csrf_token`）
  2. `DIDA_SESSION_FILE=/path/to/dida-session.local.json` 或 `--secrets PATH`，内容 `{"t": "...", "_csrf_token": "..."}`；文件权限 0600，勿提交
- TickTick 国际版：`DIDA_API_BASE=https://api.ticktick.com`

## 命令

```bash
skills/dida-attach-file/scripts/dida-attach <projectId> <taskId> <file> [--json]
```

## 步骤

1. 确认 `projectId`、`taskId`、文件存在；每个文件取唯一文件名。
2. 逐个上传（脚本只上传，不改正文），记下每个 `attachment_id` 与 `fileName`。
3. 网络错误（SSL EOF 等）对该文件重试一次；核对 `attachment_count` 等于预期。
4. 先用 MCP `get_task_in_project` / `get_task_by_id` 读任务，再**一次** `update_task`：在原正文后追加，每个附件一行。真正的图片（png/jpg/jpeg/webp/gif）用 `![image](<attachmentId>/<fileName>)`；Word、Excel、PDF、txt、zip 等非图片用 `![file](<attachmentId>/<fileName>)`。图片不要写成 `![file]`（只会显示链接、不预览）。同一调用里原样带回 `startDate`、`dueDate`、`isAllDay`、`timeZone`；子任务带回 `parentId`。
5. `get_task_by_id` 重读：正文每行都在、日期未变；请用户刷新确认图片显示。
6. 某张图显示为链接文本：换新文件名重传，替换那一行的 id，仍带回日期。
7. 鉴权失败：提示用户重新登录网页版并更新 cookie；不要猜测或打印凭据。

## 为什么不在上传时改正文

经网页 API 改正文时，批量接口常返回 403，回退的单任务 POST 只带部分字段，会清空开始/截止日期、把图片写成 `![file]`，还可能让前一张图失效。所以正文一律走 MCP `update_task`。

## 注意

- 正常上传不删除已有附件。
- 标题、标签、移动清单、正文优先用 MCP；脚本只负责文件上传。
- 这是非官方网页接口，可能随官方改版失效。
