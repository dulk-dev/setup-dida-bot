# 开机自启与保活

`npm run daemon` 是一个常驻进程（醒 → 跑一轮 → 睡）。进程停了（崩溃、登出、机器重启、云端电脑被换成另一台）轮询就停。

Grok Bot 云端电脑通常**没有** systemd / crontab，开机不会自己把进程拉回来，需要你或例程去拉。

## 拉起

在仓库根目录执行：

```bash
# 可选：PATH 里没有 node/npm 时，把目录 prepend 进去（不要把绝对路径写进脚本）
export SETUP_DIDA_NODE_BIN="$HOME/.local/node-current/bin"

bash scripts/ensure-daemon.sh
# 或
npm run ensure
```

| 退出码 | stdout 前缀 | 含义 |
|--------|-------------|------|
| 0 | `already_running` | `data/daemon.pid` 对应进程还在 |
| 0 | `started` | 这次刚拉起（或从 stale pidfile 恢复） |
| 1 | （stderr） | 缺 `config.json`、找不到 node、启动超时等 |

其它行为：缺 `node_modules` / `tsx` 时会先 `npm install`；日志追加到 `data/daemon.log`；可反复执行。

`config.json` 只留在本机（从 `config.example.json` 复制）。不要把 webhook URL 或 secret 写进仓库。

## 定时补跑

云端电脑换过或重启后，在你执行上面的脚本之前，轮询是空的。建议用 cron 或 Grok Bot 例程**每天多次**跑同一条命令作补漏，例如北京时间约 7:18 / 12:18 / 18:18：

```cron
18 7,12,18 * * * cd /path/to/setup-dida-bot && ./scripts/ensure-daemon.sh >>data/ensure-daemon.log 2>&1
```

健康时标准输出是 `already_running pid=…`：例程据此保持安静，不要发通知。只有启动失败、进程起不来时才需要人看。

这只是补漏，填不上「机器刚换完、例程还没到点」的空档。例程在 Grok Bot 里自己建；不要把 webhook URL、secret 或例程 id 写进仓库。

若跑在自有 Linux 且有 systemd，可用 user unit 在登录时执行 `scripts/ensure-daemon.sh`；云端电脑通常没有，不必准备。
