import { expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { activate } from "../src";
import { readPluginManifest } from "@modera/plugin-host/testing";

const manifest = readPluginManifest(new URL("..", import.meta.url));
import { Questions, normalizeQuestion } from "../src/questions";
import { ToolExecutor } from "@modera-host/agent-host/src/tool-executor";
import { ToolRegistry } from "@modera-host/agent-host/src/tool-registry";

import { AgentPluginRuntime as PluginRuntime } from "@modera/agent-host";
import { parsePluginManifest } from "@modera-host/plugin-host/src/manifest";
import type { ToolContext } from "@modera/contracts";

const context: ToolContext = {
  sessionId: "s",
  projectId: "p",
  runId: "r",
  signal: new AbortController().signal,
};
const host = {
  pluginId: manifest.id,
  storagePath: "unused",
  signal: new AbortController().signal,
  grantedPermissions: new Set<never>(),
};
it("executes a batched question schema and accepts a complete answer beyond legacy action limits", async () => {
  const registry = new ToolRegistry();
  const runtime = new PluginRuntime(
    registry,
    () => true,
    async () => "unused",
  );
  runtime.add({
    manifest: parsePluginManifest(manifest),
    load: async () => ({ activate }),
    readFrontend: async () => ({
      body: new Uint8Array(),
      mime: "text/javascript",
    }),
  });
  await runtime.reconcile(new Set([manifest.id]));
  const executor = new ToolExecutor(registry, async () => true, new Set());
  const input = {
    questions: Array.from({ length: 6 }, (_, i) => ({
      id: `q${i}`,
      title: `Question ${i}`,
      freeText: true,
      skippable: false,
    })),
  };
  try {
    const result = executor.execute(
      { id: "batch", name: "ask_user_question", input },
      context,
    );
    await vi.waitFor(() =>
      expect(executor.activeCall("s", "batch")).toBeTruthy(),
    );
    const request = {
      id: "modera.interaction.question",
      sessionId: "s",
      toolCallId: "batch",
      locale: "zh-CN",
      tool: { name: "ask_user_question", input },
    };
    expect(await runtime.ui.request(request, context)).toMatchObject({
      live: true,
      data: { question: { questions: input.questions } },
    });
    const answers = Object.fromEntries(
      input.questions.map((q) => [
        q.id,
        { questionId: q.id, selectedIds: [], otherText: "x".repeat(1000) },
      ]),
    );
    await runtime.ui.request(
      {
        ...request,
        action: { id: "answer", value: JSON.stringify({ answers }) },
      },
      context,
    );
    expect(JSON.parse(await result).responses).toHaveLength(6);
  } finally {
    await runtime.close();
  }
});
it("waits for explicit plan approval inside the tool call", async () => {
  const registry = new ToolRegistry();
  const runtime = new PluginRuntime(
    registry,
    () => true,
    async () => "unused",
  );
  runtime.add({
    manifest: parsePluginManifest(manifest),
    load: async () => ({ activate }),
    readFrontend: async () => ({
      body: new Uint8Array(
        await readFile(new URL("../dist/ui/plan-approval.js", import.meta.url)),
      ),
      mime: "text/javascript",
    }),
  });
  await runtime.reconcile(new Set([manifest.id]));
  const executor = new ToolExecutor(registry, async () => true, new Set());
  const input = { plan: "# Build a todo app\n\nUse the existing workspace." };
  try {
    const result = executor.execute(
      { id: "plan-1", name: "approve_plan", input },
      context,
    );
    const request = {
      id: "modera.interaction.plan-approval",
      sessionId: "s",
      toolCallId: "plan-1",
      locale: "zh-CN",
      tool: { name: "approve_plan", input },
    };
    await vi.waitFor(() =>
      expect(executor.activeCall("s", "plan-1")).toBeTruthy(),
    );
    expect(await runtime.ui.request(request, context)).toMatchObject({
      live: true,
      data: { approved: null },
    });
    await expect(
      runtime.ui.request(
        { ...request, action: { id: "approve" } },
        { ...context, sessionId: "other" },
      ),
    ).rejects.toThrow("pending");
    await runtime.ui.request(
      { ...request, action: { id: "approve" } },
      context,
    );
    expect(JSON.parse(await result)).toMatchObject({ approved: true });
  } finally {
    await runtime.close();
  }
});
it("returns plan revision feedback without granting approval", async () => {
  const registry = new ToolRegistry();
  const runtime = new PluginRuntime(
    registry,
    () => true,
    async () => "unused",
  );
  runtime.add({
    manifest: parsePluginManifest(manifest),
    load: async () => ({ activate }),
    readFrontend: async () => ({
      body: new Uint8Array(
        await readFile(new URL("../dist/ui/plan-approval.js", import.meta.url)),
      ),
      mime: "text/javascript",
    }),
  });
  await runtime.reconcile(new Set([manifest.id]));
  const executor = new ToolExecutor(registry, async () => true, new Set());
  try {
    const input = { plan: "# Plan" };
    const result = executor.execute(
      { id: "plan-revise", name: "approve_plan", input },
      context,
    );
    const request = {
      id: "modera.interaction.plan-approval",
      sessionId: "s",
      toolCallId: "plan-revise",
      locale: "zh-CN",
      tool: { name: "approve_plan", input },
    };
    await vi.waitFor(() =>
      expect(executor.activeCall("s", "plan-revise")).toBeTruthy(),
    );
    await runtime.ui.request(
      { ...request, action: { id: "continue", value: "Use React instead" } },
      context,
    );
    expect(JSON.parse(await result)).toMatchObject({
      approved: false,
      feedback: "Use React instead",
    });
  } finally {
    await runtime.close();
  }
});
it("waits for a real answer, rejects forged/cross-session answers and returns selections plus text once", async () => {
  const registry = new ToolRegistry(),
    approve = vi.fn(async () => true);
  const runtime = new PluginRuntime(
    registry,
    () => true,
    async () => "unused",
  );
  runtime.add({
    manifest: parsePluginManifest(manifest),
    load: async () => ({ activate }),
    readFrontend: async () => ({
      body: new Uint8Array(
        await readFile(
          new URL("../dist/ui/question-result.js", import.meta.url),
        ),
      ),
      mime: "text/javascript",
    }),
  });
  await runtime.reconcile(new Set([manifest.id]));
  const executor = new ToolExecutor(registry, approve, new Set());
  const input = {
    questions: [
      { title: "选择功能", options: ["搜索", "编辑"], multiSelect: true },
    ],
  };
  let settled = false;
  const result = executor
    .execute({ id: "q1", name: "ask_user_question", input }, context)
    .then((value) => {
      settled = true;
      return JSON.parse(value);
    });
  const request = {
    id: "modera.interaction.question",
    sessionId: "s",
    toolCallId: "q1",
    locale: "zh-CN",
    tool: { name: "ask_user_question", input },
  };
  try {
    await vi.waitFor(() => expect(executor.activeCall("s", "q1")).toBeTruthy());
    expect(settled).toBe(false);
    expect(approve).not.toHaveBeenCalled();
    expect(await runtime.ui.request(request, context)).toMatchObject({
      live: true,
      data: {
        question: {
          questions: [
            {
              title: "选择功能",
              options: [
                { id: "o-0", title: "搜索" },
                { id: "o-1", title: "编辑" },
              ],
              multiSelect: true,
            },
          ],
        },
      },
      children: [],
    });
    await expect(
      runtime.ui.request(
        {
          ...request,
          action: {
            id: "answer",
            value: JSON.stringify({
              answers: {
                "q-0": {
                  questionId: "q-0",
                  selectedIds: ["o-8"],
                  otherText: "",
                },
              },
            }),
          },
        },
        context,
      ),
    ).rejects.toThrow("selected");
    await expect(
      runtime.ui.request(
        { ...request, action: { id: "cancel" } },
        { ...context, sessionId: "other" },
      ),
    ).rejects.toThrow("pending");
    await runtime.ui.request(
      {
        ...request,
        action: {
          id: "answer",
          value: JSON.stringify({
            answers: {
              "q-0": {
                questionId: "q-0",
                selectedIds: ["o-0", "o-1"],
                otherText: "优先性能",
              },
            },
          }),
        },
      },
      context,
    );
    expect(await result).toMatchObject({
      answered: true,
      cancelled: false,
      answers: ["搜索", "编辑", "优先性能"],
    });
    await expect(
      runtime.ui.request({ ...request, action: { id: "cancel" } }, context),
    ).rejects.toThrow("pending");
  } finally {
    await runtime.close();
  }
});
it("single choice rejects multiple selections; free-text and cancel are distinct outcomes", async () => {
  const questions = new Questions(host);
  const single = questions.ask(
    { questions: [{ title: "选择", options: ["A", "B"] }] },
    { ...context, toolCallId: "single" },
  );
  expect(() =>
    questions.respond(
      "single",
      JSON.stringify({
        answers: {
          "q-0": {
            questionId: "q-0",
            selectedIds: ["o-0", "o-1"],
            otherText: "",
          },
        },
      }),
      context,
    ),
  ).toThrow("one option");
  questions.respond("single", undefined, context, true);
  expect(await single).toMatchObject({
    answered: false,
    cancelled: true,
    answers: [],
  });
  const free = questions.ask(
    { questions: [{ title: "请输入路径" }] },
    { ...context, toolCallId: "free" },
  );
  questions.respond(
    "free",
    JSON.stringify({
      answers: {
        "q-0": { questionId: "q-0", selectedIds: [], otherText: "src" },
      },
    }),
    context,
  );
  expect(await free).toMatchObject({ answers: ["src"], selectedOptions: [] });
  expect(() => normalizeQuestion({ questions: [{ title: "  " }] })).toThrow();
  expect(() =>
    normalizeQuestion({
      questions: [
        {
          title: "x",
          options: [
            { id: "a", title: "A" },
            { id: "a", title: "B" },
          ],
        },
      ],
    }),
  ).toThrow("Duplicate");
});
it("run cancellation and project disable settle pending questions without approving operations", async () => {
  let enabled = true;
  const registry = new ToolRegistry();
  const runtime = new PluginRuntime(
    registry,
    () => enabled,
    async () => "unused",
  );
  runtime.add({
    manifest,
    load: async () => ({ activate }),
    readFrontend: async () => ({
      body: new Uint8Array(
        await readFile(
          new URL("../dist/ui/question-result.js", import.meta.url),
        ),
      ),
      mime: "text/javascript",
    }),
  });
  await runtime.reconcile(new Set([manifest.id]));
  const executor = new ToolExecutor(
    registry,
    async () => {
      throw new Error("No approval expected");
    },
    new Set(),
  );
  try {
    const run = new AbortController();
    const pending = executor.execute(
      {
        id: "cancel",
        name: "ask_user_question",
        input: { questions: [{ title: "等一下" }] },
      },
      { ...context, signal: run.signal },
    );
    await vi.waitFor(() =>
      expect(executor.activeCall("s", "cancel")).toBeTruthy(),
    );
    run.abort();
    expect(JSON.parse(await pending)).toHaveProperty("error");
    const second = executor.execute(
      {
        id: "disable",
        name: "ask_user_question",
        input: { questions: [{ title: "等一下" }] },
      },
      context,
    );
    await vi.waitFor(() =>
      expect(executor.activeCall("s", "disable")).toBeTruthy(),
    );
    enabled = false;
    await runtime.reconcile(new Set([manifest.id]));
    expect(JSON.parse(await second)).toHaveProperty("error");
  } finally {
    await runtime.close();
  }
});
it("interaction metadata cannot suppress approval for tools with operation permissions", async () => {
  const registry = new ToolRegistry();
  const execute = vi.fn(async () => "bad");
  registry.register("test", {
    definition: {
      id: "fake",
      title: "fake",
      description: "fake",
      executionKind: "interaction",
      requiredPermissions: ["workspace.write"],
      inputSchema: { type: "object" },
    },
    execute,
  });
  const executor = new ToolExecutor(
    registry,
    async () => true,
    new Set(["workspace.write"]),
  );
  expect(
    JSON.parse(
      await executor.execute({ id: "x", name: "fake", input: {} }, context),
    ).error,
  ).toContain("cannot declare");
  expect(execute).not.toHaveBeenCalled();
});
