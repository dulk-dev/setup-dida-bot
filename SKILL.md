---
name: setup-dida-bot
description: use when setting up local Dida bot-merge for Grok Bot (setup-dida-bot).
---

# setup-dida-bot

本地替代 Cloudflare Worker `dida-bot-merge`：轮询滴答 Open API，合并微信拆分的 `@botx` 片段，认领后 POST webhook 给 Grok Bot。

## 何时使用

- 需要在 box / 本机跑 Dida 合并，而不部署或改动线上 Worker
- 为 Grok Bot 配置 `dida_bot_work` webhook 上游
- 用独立标记（`@botx` / `x-todo`）做联调，避免碰到生产 `todo/doing/done`

## 安装步骤

1. **dida-cli**
   ```bash
   # 若未安装 dida CLI，先安装；然后：
   dida auth login
   # token 写入 ~/.config/dida-cli/config.json （含 access_token）
   ```

2. **项目**
   ```bash
   cd /workspace/projects/setup-dida-bot
   npm install
   cp config.example.json config.json
   ```

3. **Webhook**  
   编辑 `config.json`：
   - `webhookUrl`：Grok Bot 可收 POST 的 URL
   - `webhookSecret`：与 Bot 侧校验一致
   - `webhookAuthStyle`：`both`（默认）| `bearer` | `header`
   - `intervalSeconds`：测试阶段建议 `120`

4. **启动**
   ```bash
   npm test                 # 确认单测
   npm run once             # 干跑一轮
   npm run daemon           # 后台轮询
   npm run ui               # http://127.0.0.1:8788/
   ```

5. **联调自测**
   ```bash
   npm run selftest
   ```
   会创建带前缀 `[setup-dida-bot-test]` 的收件箱任务对，合并后打 mock webhook，再清理。

## 标记配置（防碰撞）

默认（**不要**改成生产值，除非你有意接管）：

- `botMarker`: `@botx`
- `notMarker`: `@notx`
- `tagTodo` / `tagDoing` / `tagDone`: `x-todo` / `x-doing` / `x-done`
- `tagFreeze`: `x-freeze`
- `tagParent`: `x-bot`
- `wechatCaptureTag`: `微信采集`（与线上一致）

### 以后切到生产标记

1. 停掉本机 `npm run daemon` 与 UI  
2. 停掉或确认线上 CF Worker 不再写同一批任务  
3. 改 `config.json` 为 `@bot` / `@not` / `todo` / `doing` / `done` / `freeze` / `bot`  
4. 再 `npm run once` 验证

## Webhook 形态

- `event`: `dida_bot_work`
- `source`: `setup-dida-bot`（不是 `dida-bot-merge-worker`）
- `pending[].lifecycle`: 认领成功路径为 `x-doing`（或你配置的 `tagDoing`）

## 注意

- 不要打印 `access_token` / `webhookSecret`
- 不要部署 CF 变更、不要合 GitHub PR（本 skill 范围外）
- Grok Bot 侧 webhook routine 由父 agent 另行创建
