# setup-dida-bot

本地 Node 守护进程：把微信转发进滴答清单后被拆开的任务合并回去，打上生命周期标签认领，再 webhook 唤醒 Grok Bot。

## 需求背景

微信转发到滴答清单时，一条消息常被拆成多条任务：有正文的上下文，以及标题里带 `@bot`、正文为空的碎片。需要把这些空正文碎片并回上下文任务，用生命周期标签 `todo` → `doing` → `done` 认领，再 webhook 唤醒 Grok Bot。

本仓库是跑在本机的 Node daemon：通过 dida CLI 完成合并和认领，并向 Grok Bot 例程「setup-dida-bot webhook」发唤醒。URL 和密钥只留在本机。

## 当前方案

守护进程按间隔调用本机的 [dida CLI](#dida-cli)（`dida … --json`）。登录态由 CLI 自己保管，本进程不读取 token，也不直接请求滴答 HTTP 接口。

每一轮大致是：

```mermaid
flowchart LR
  poll["dida CLI 轮询"] --> merge["合并空正文 @bot 碎片"]
  merge --> claim["todo 认领为 doing"]
  claim --> hook["POST setup-dida-bot webhook"]
  hook --> bot["Grok Bot 写回并把叶子改为 done"]
```

1. 找出标题含 `@bot`、正文为空、且带 `微信采集` 的碎片，在创建时间窗口内并入对应的上下文任务。同一窗口命中多条上下文时，把 `@bot` 改写成 `@not` 并打上 `freeze`，不再自动合并。
2. 合并后的任务进入 `todo`。webhook 返回成功后，叶子改为 `doing`。
3. 向「setup-dida-bot webhook」POST `event: dida_bot_work`，`source` 固定为 `setup-dida-bot`。Bot 读任务、执行标题和正文里的指令，并把叶子改为 `done`。Bot 侧步骤见 [docs/webhook.md](docs/webhook.md)。

默认标记：

| 用途 | 默认 |
|------|------|
| 碎片标记 | `@bot` |
| 歧义改写 | `@not` |
| 生命周期 | `todo` / `doing` / `done` |
| 冻结 | `freeze` |
| 父标签 | `bot`（`ensureParentTag: true` 时会确保存在） |
| 微信来源 | `微信采集` |

标记名都在 `config.json` 里，改的时候整组一起改，改完重启 daemon。

本机同时只跑一轮：文件锁是 `data/merge.lock`，已处理碎片记在 `data/processed.json`。状态页默认只听 `http://127.0.0.1:8788/`。webhook 载荷的 `source` 固定为 `setup-dida-bot`。daemon 不发送 token 到期提醒。

## 快速开始

需要 Node.js 20+。下面的命令都在**克隆后的项目根目录**执行（含 `package.json` 的那一层）。

### dida CLI

本仓库通过 `dida` 命令读写任务和标签，不捆绑 CLI。请单独安装滴答官方分发的 npm 包 [`@suibiji/dida-cli`](https://www.npmjs.com/package/@suibiji/dida-cli)，再登录。滴答帮助中心的安装说明：<https://help.dida365.com/articles/7464976698707017728>。

该 npm 包没有公开的 GitHub 仓库字段，这里不链任何 `github.com/.../dida-cli` 地址。

```bash
npm install -g @suibiji/dida-cli
dida auth login
```

默认 `didaBinary` 是 PATH 上的 `dida`。命令不在 PATH 上时，把 `config.json` 的 `didaBinary` 写成可执行文件路径。未安装或未登录时，进程会报错并提示 `dida auth login`。

### 安装与跑起来

```bash
git clone https://github.com/dulk-dev/setup-dida-bot.git
cd setup-dida-bot
npm install
cp config.example.json config.json
```

编辑本机的 `config.json`，填入例程「setup-dida-bot webhook」的 `webhookUrl` 与 `webhookSecret`（只放本机，见 [安全](#安全)）。创建例程、请求头和载荷见 [docs/webhook.md](docs/webhook.md)。复制出来的配置使用 `@bot`、`@not`、`bot`、`todo`、`doing`、`done`、`freeze`。

```bash
npm test          # vitest，断言默认标记 @bot / todo
npm run once      # 合并 + 认领跑一轮，写入 data/status.json
npm run daemon    # 按 intervalSeconds 轮询（默认 120 秒，下限 15 秒）
npm run status    # 打印最近一次 data/status.json
npm run ui        # http://127.0.0.1:8788/ 可改 interval / enabled
```

`npm run selftest` 会用已登录的 `dida` CLI 建一对标题前缀为 `[setup-dida-bot-test]` 的收件箱任务，打到本机 mock webhook，然后清理。需要本机已经 `dida auth login`。

## 配置参考

默认文件是项目根目录的 `config.json`。也可以用环境变量 `SETUP_DIDA_BOT_CONFIG` 指向别的路径。仓库里只提交 [`config.example.json`](config.example.json)；`config.json` 已在 `.gitignore` 中。

| 字段 | 示例默认 | 说明 |
|------|----------|------|
| `enabled` | `true` | `false` 时 daemon 跳过本轮 |
| `intervalSeconds` | `120` | 轮询间隔（秒）。代码下限为 15 |
| `didaBinary` | `dida` | `dida` 可执行文件。默认走 PATH |
| `botMarker` | `@bot` | 空正文碎片的标题标记 |
| `notMarker` | `@not` | 同一窗口命中多条上下文时，把碎片标记改写成这个，并打冻结标签 |
| `wechatCaptureTag` | `微信采集` | 依赖匹配用的来源标签 |
| `tagParent` | `bot` | 生命周期叶子的父标签 |
| `tagTodo` | `todo` | 合并后的待办叶子 |
| `tagDoing` | `doing` | webhook 成功后的认领叶子 |
| `tagDone` | `done` | 由 Grok Bot 在做完后写入；daemon 自己不打完成，也不勾选任务完成 |
| `tagFreeze` | `freeze` | 歧义碎片冻结，不再自动合并 |
| `ensureParentTag` | `true` | 缺少父标签时创建 |
| `webhookUrl` | `""` | Grok Bot webhook 例程 URL。留空则只合并、不认领、不 POST |
| `webhookSecret` | `""` | 与例程密钥一致。留在本机 |
| `webhookAuthStyle` | `both` | `bearer`、`header` 或 `both`。头字段见 [docs/webhook.md](docs/webhook.md) |
| `maxMergeOrNot` | `10` | 每一轮最多合并或改写多少条碎片 |
| `maxClaim` | `8` | 每一轮最多认领多少条 |
| `maxHydrate` | `10` | 每一轮最多补拉多少条缺字段的任务 |
| `dependencyWindowBeforeMs` | `10000` | 碎片创建时间之前的依赖窗口 |
| `dependencyWindowAfterMs` | `10000` | 碎片创建时间之后的依赖窗口 |
| `uiHost` | `127.0.0.1` | 状态页只绑定本机 |
| `uiPort` | `8788` | 状态页端口 |
| `dataDir` | `data` | 相对路径相对项目根目录解析 |

状态页只能改 `intervalSeconds` 和 `enabled`。标记、webhook URL 和密钥改 `config.json` 后重启进程。

### 数据目录

- `data/merge.lock` — 文件锁。超过约 120 秒视为过期，可被下一轮拿走。
- `data/processed.json` — 已处理碎片 id，约 60 天后过期。
- `data/status.json` — 最近一轮结果，含任务标题时不要提交。

认领顺序是先 POST webhook，HTTP 成功才把 `todo` 改成 `doing`。webhook 失败时叶子留在 `todo`，下一轮可以再试。

## Webhook

创建 Grok Bot webhook 例程、三种认证头、`dida_bot_work` 载荷，以及 Bot 被唤醒后应执行的例程模板，写在 [docs/webhook.md](docs/webhook.md)。

## 安全

密钥和真实任务数据只留在本机。更短的清单见 [SECURITY.md](SECURITY.md)。

- 不要提交 `config.json`。其中的 `webhookUrl`、`webhookSecret` 只放在克隆后的本地文件里。
- 不要提交 `~/.config/dida-cli/config.json`、`data/status.json`、`data/processed.json`。
- 文档和示例只用虚构任务 id。

给代理用的安装步骤与本 README 对齐，见 [SKILL.md](SKILL.md)。
