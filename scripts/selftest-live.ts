/**
 * Live selftest against the dida CLI + a local mock webhook.
 *
 * Creates:
 *   1) context task tagged 微信采集 with body
 *   2) fragment task titled "... @bot ..." with empty content
 * Runs merge once, asserts merge + webhook claim (doing), then cleans up.
 *
 * Titles use prefix [setup-dida-bot-test] for easy identification.
 */
import { createServer, type IncomingMessage } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, PROJECT_ROOT } from "../src/config.ts";
import { DidaCliClient } from "../src/dida-api.ts";
import { withBotLifecycleTag } from "../src/markers.ts";
import { runMergeAndNotify } from "../src/run.ts";
import type { WorkWebhookPayload } from "../src/webhook.ts";

const PREFIX = "[setup-dida-bot-test]";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function startMockWebhook(): Promise<{
  url: string;
  secret: string;
  payloads: WorkWebhookPayload[];
  close: () => Promise<void>;
}> {
  const secret = "selftest-secret";
  const payloads: WorkWebhookPayload[] = [];
  const server = createServer(async (req, res) => {
    if (req.method === "POST") {
      const raw = await readBody(req);
      try {
        payloads.push(JSON.parse(raw) as WorkWebhookPayload);
      } catch {
        // ignore
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve());
    server.on("error", reject);
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no listen address");
  return {
    url: `http://127.0.0.1:${addr.port}/webhook`,
    secret,
    payloads,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

async function main(): Promise<void> {
  const baseConfig = loadConfig();
  const api = new DidaCliClient({ binary: baseConfig.didaBinary });
  const m = baseConfig.markers;

  const mock = await startMockWebhook();
  const stamp = Date.now();
  const createdIds: Array<{ projectId: string; id: string }> = [];

  const dataDir = join(PROJECT_ROOT, "data", `selftest-${stamp}`);
  mkdirSync(dataDir, { recursive: true });

  // Write a one-off config that points webhook at the mock + isolated dataDir.
  const selfConfigPath = join(dataDir, "config.json");
  const selfConfig = {
    ...JSON.parse(
      // reuse defaults from project config.json but override runtime bits
      await import("node:fs").then(({ readFileSync }) =>
        readFileSync(baseConfig.configPath, "utf8"),
      ),
    ),
    enabled: true,
    webhookUrl: mock.url,
    webhookSecret: mock.secret,
    webhookAuthStyle: "both",
    dataDir,
    intervalSeconds: 120,
  };
  writeFileSync(selfConfigPath, `${JSON.stringify(selfConfig, null, 2)}\n`);

  console.log(
    JSON.stringify({
      msg: "selftest_start",
      markers: {
        botMarker: m.botMarker,
        tagTodo: m.tagTodo,
        tagDoing: m.tagDoing,
      },
      webhook: mock.url,
      dataDir,
    }),
  );

  try {
    // Ensure tags exist (todo etc.) before create — run ensure via a dry path.
    const config = loadConfig(selfConfigPath);

    const contextTitle = `${PREFIX} context ${stamp}`;
    const fragmentTitle = `${PREFIX} ${m.botMarker} summarize ${stamp}`;

    const context = await api.createTask({
      title: contextTitle,
      content: `selftest context body ${stamp}`,
      tags: [m.wechatCaptureTag],
    });
    createdIds.push({ projectId: context.projectId, id: context.id });
    console.log(
      JSON.stringify({
        msg: "created_context",
        id: context.id,
        projectId: context.projectId,
      }),
    );

    // Tiny delay so createdTimes are close but both present.
    await sleep(800);

    const fragment = await api.createTask({
      title: fragmentTitle,
      content: "",
      tags: [m.wechatCaptureTag],
    });
    createdIds.push({ projectId: fragment.projectId, id: fragment.id });
    console.log(
      JSON.stringify({
        msg: "created_fragment",
        id: fragment.id,
        projectId: fragment.projectId,
      }),
    );

    // Allow the inbox index to settle.
    await sleep(1500);

    const result = await runMergeAndNotify(config);
    console.log(
      JSON.stringify({
        msg: "selftest_run_result",
        ok: result.ok,
        mergedCount: result.mergedCount,
        claimed: result.claimed,
        merges: result.merges,
        pending: result.pending,
        skipped: result.skipped,
        webhook: result.webhook,
        error: result.error,
      }),
    );

    const mergedOk =
      result.mergedCount >= 1 &&
      result.merges.some(
        (item) =>
          item.fragmentId === fragment.id || item.contextId === context.id,
      );
    const webhookOk =
      mock.payloads.length >= 1 &&
      mock.payloads[0].event === "dida_bot_work" &&
      mock.payloads[0].source === "setup-dida-bot";
    const claimOk =
      result.claimed >= 1 &&
      result.pending.some((p) => p.lifecycle === m.tagDoing);

    // Verify context (or surviving main) has the doing tag after claim.
    let doingOk = false;
    const mainId =
      result.merges.find((item) => item.contextId)?.contextId ?? context.id;
    const mainProject =
      result.pending.find((p) => p.taskId === mainId)?.projectId ??
      context.projectId;
    try {
      const detail = await api.getTask(mainProject, mainId);
      doingOk = (detail.tags ?? []).includes(m.tagDoing);
      console.log(
        JSON.stringify({
          msg: "selftest_main_tags",
          id: mainId,
          tags: detail.tags,
        }),
      );
    } catch (error) {
      console.log(
        JSON.stringify({
          msg: "selftest_main_fetch_failed",
          error: error instanceof Error ? error.message : "unknown",
        }),
      );
    }

    const pass = Boolean(mergedOk && webhookOk && (claimOk || doingOk));
    console.log(
      JSON.stringify({
        msg: "selftest_assert",
        mergedOk,
        webhookOk,
        claimOk,
        doingOk,
        pass,
        webhookPayloads: mock.payloads.length,
      }),
    );

    if (!pass) {
      throw new Error(
        `selftest failed: mergedOk=${mergedOk} webhookOk=${webhookOk} claimOk=${claimOk} doingOk=${doingOk}`,
      );
    }

    console.log(JSON.stringify({ msg: "selftest_pass" }));
  } finally {
    // Cleanup: delete remaining test tasks, or tag done if delete fails.
    for (const item of createdIds) {
      try {
        await api.deleteTask(item.projectId, item.id);
        console.log(
          JSON.stringify({ msg: "cleanup_deleted", id: item.id }),
        );
      } catch {
        try {
          const detail = await api.getTask(item.projectId, item.id);
          const next = withBotLifecycleTag(m, detail.tags, m.tagDone);
          await api.updateTaskTags(item.id, item.projectId, next);
          console.log(
            JSON.stringify({ msg: "cleanup_tagged_done", id: item.id }),
          );
        } catch (error) {
          console.log(
            JSON.stringify({
              msg: "cleanup_failed",
              id: item.id,
              error: error instanceof Error ? error.message : "unknown",
            }),
          );
        }
      }
    }

    // Also try to clean the merged main if it survived under a different id path
    // (fragment deleted; context may still exist — already in createdIds).

    await mock.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
