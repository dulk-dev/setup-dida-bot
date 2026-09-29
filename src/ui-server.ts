import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AppConfig, RawConfig } from "./config.ts";
import { loadConfig } from "./config.ts";
import { readStatus } from "./store.ts";

export interface UiServerOptions {
  onUpdate: (patch: Partial<RawConfig>) => void;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(text);
}

function sendHtml(res: ServerResponse, html: string): void {
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(html);
}

function pageHtml(config: AppConfig): string {
  const status = readStatus(config.dataDir);
  const markers = config.markers;
  const webhookPresent = config.webhookUrl.length > 0;
  const statusJson = status
    ? JSON.stringify(status, null, 2)
    : "(尚无 status.json — 先跑一次 npm run once)";

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>setup-dida-bot</title>
  <style>
    :root { font-family: ui-sans-serif, system-ui, sans-serif; color: #111; background: #f6f7f9; }
    body { max-width: 840px; margin: 2rem auto; padding: 0 1rem; }
    h1 { font-size: 1.4rem; margin-bottom: 0.25rem; }
    .muted { color: #666; font-size: 0.9rem; }
    card, .card { display: block; background: #fff; border: 1px solid #e2e5ea; border-radius: 10px; padding: 1rem 1.1rem; margin: 1rem 0; }
    label { display: block; margin: 0.6rem 0 0.2rem; font-weight: 600; font-size: 0.9rem; }
    input[type=number], input[type=text] { width: 100%; max-width: 320px; padding: 0.45rem 0.6rem; border: 1px solid #ccd; border-radius: 6px; }
    button { margin-top: 0.8rem; padding: 0.5rem 1rem; border: 0; border-radius: 6px; background: #111; color: #fff; cursor: pointer; }
    button.secondary { background: #445; margin-left: 0.4rem; }
    pre { background: #0f172a; color: #e2e8f0; padding: 0.9rem; border-radius: 8px; overflow: auto; font-size: 0.8rem; }
    .row { display: flex; gap: 1.5rem; flex-wrap: wrap; }
    .pill { display: inline-block; padding: 0.15rem 0.55rem; border-radius: 999px; background: #eef2ff; color: #3730a3; font-size: 0.8rem; margin-right: 0.35rem; }
    .warn { color: #9a3412; background: #fff7ed; padding: 0.6rem 0.8rem; border-radius: 8px; font-size: 0.9rem; }
    #msg { margin-top: 0.6rem; font-size: 0.9rem; }
  </style>
</head>
<body>
  <h1>setup-dida-bot</h1>
  <p class="muted">本地 Grok Bot 用 Dida 合并轮询（默认标记 <code>@botx</code> / <code>x-todo</code>，不与线上 Worker 冲突）</p>

  <div class="card">
    <div class="row">
      <div>
        <div><strong>启用</strong>: ${config.enabled ? "是" : "否"}</div>
        <div><strong>间隔</strong>: ${config.intervalSeconds}s</div>
        <div><strong>Webhook</strong>: ${webhookPresent ? "已配置 URL" : "未配置"}</div>
      </div>
      <div>
        <span class="pill">${markers.botMarker}</span>
        <span class="pill">${markers.notMarker}</span>
        <span class="pill">${markers.tagTodo}</span>
        <span class="pill">${markers.tagDoing}</span>
        <span class="pill">${markers.tagDone}</span>
        <span class="pill">${markers.tagFreeze}</span>
      </div>
    </div>
    <p class="muted" style="margin-top:0.8rem">标记只读 — 改 config.json 后重启。切到生产请把 botMarker/@bot、lifecycle 改为 todo/doing/done（并停掉本 daemon）。</p>
  </div>

  <div class="card">
    <h2 style="font-size:1.05rem;margin:0 0 0.4rem">设置</h2>
    <label>intervalSeconds</label>
    <input id="interval" type="number" min="15" value="${config.intervalSeconds}" />
    <label><input id="enabled" type="checkbox" ${config.enabled ? "checked" : ""} /> enabled</label>
    <div>
      <button id="save">保存</button>
      <button class="secondary" id="refresh">刷新状态</button>
    </div>
    <div id="msg"></div>
  </div>

  <div class="card">
    <h2 style="font-size:1.05rem;margin:0 0 0.4rem">最近一次运行</h2>
    <pre id="status">${escapeHtml(statusJson)}</pre>
  </div>

  <script>
    const msg = document.getElementById('msg');
    document.getElementById('save').onclick = async () => {
      const intervalSeconds = Number(document.getElementById('interval').value);
      const enabled = document.getElementById('enabled').checked;
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intervalSeconds, enabled }),
      });
      const data = await res.json();
      msg.textContent = res.ok ? '已保存' : (data.error || '保存失败');
      if (res.ok) setTimeout(() => location.reload(), 400);
    };
    document.getElementById('refresh').onclick = () => location.reload();
  </script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export async function startUiServer(
  initial: AppConfig,
  options: UiServerOptions,
): Promise<void> {
  const host = initial.uiHost;
  const port = initial.uiPort;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${host}:${port}`);
    try {
      if (req.method === "GET" && url.pathname === "/") {
        const config = loadConfig(initial.configPath);
        sendHtml(res, pageHtml(config));
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/status") {
        const config = loadConfig(initial.configPath);
        sendJson(res, 200, {
          status: readStatus(config.dataDir),
          enabled: config.enabled,
          intervalSeconds: config.intervalSeconds,
          webhookConfigured: config.webhookUrl.length > 0,
          markers: {
            botMarker: config.markers.botMarker,
            notMarker: config.markers.notMarker,
            tagTodo: config.markers.tagTodo,
            tagDoing: config.markers.tagDoing,
            tagDone: config.markers.tagDone,
            tagFreeze: config.markers.tagFreeze,
            tagParent: config.markers.tagParent,
            wechatCaptureTag: config.markers.wechatCaptureTag,
          },
        });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/settings") {
        const body = JSON.parse(await readBody(req)) as {
          intervalSeconds?: number;
          enabled?: boolean;
        };
        const patch: Partial<RawConfig> = {};
        if (typeof body.intervalSeconds === "number") {
          patch.intervalSeconds = Math.max(15, Math.floor(body.intervalSeconds));
        }
        if (typeof body.enabled === "boolean") {
          patch.enabled = body.enabled;
        }
        options.onUpdate(patch);
        sendJson(res, 200, { ok: true, patch });
        return;
      }
      sendJson(res, 404, { error: "not_found" });
    } catch (error) {
      sendJson(res, 500, {
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(port, host, () => resolve());
    server.on("error", reject);
  });

  console.log(
    JSON.stringify({
      msg: "ui_listening",
      url: `http://${host}:${port}/`,
    }),
  );
}
