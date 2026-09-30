import { expect, test, vi } from "vitest";
import type { PluginContext } from "@modera/plugin-sdk";
import { Questions } from "../src/questions";

function fixture() {
  const publish = vi.fn(async () => ({ id: "notice" }));
  const update = vi.fn(async () => {});
  const controller = new AbortController();
  const host = {
    signal: controller.signal,
    notifications: { publish, update },
  } as unknown as PluginContext;
  const context = {
    projectId: "project",
    sessionId: "session",
    runId: "run",
    toolCallId: "call",
    signal: new AbortController().signal,
  };
  return {
    questions: new Questions(host),
    publish,
    update,
    controller,
    context,
  };
}
test("a real answer ends its pending notice without going through notification approval", async () => {
  const { questions, publish, update, context } = fixture();
  const answer = questions.ask(
    { question: "Choose", options: ["One"] },
    context,
  );
  await Promise.resolve();
  questions.respond(
    "call",
    JSON.stringify({ selected: [0], text: "" }),
    context,
  );
  await expect(answer).resolves.toMatchObject({
    answered: true,
    answers: ["One"],
  });
  expect(publish).toHaveBeenCalledWith(
    expect.objectContaining({
      pending: true,
      target: { type: "conversation", sessionId: "session" },
    }),
    context,
  );
  expect(update).toHaveBeenCalledWith(
    "notice",
    { pending: false },
    { projectId: "project" },
  );
});
test("cancellation during asynchronous publication still settles the eventual notice", async () => {
  const { questions, publish, update, controller, context } = fixture();
  let finishPublish!: (item: { id: string }) => void;
  publish.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishPublish = resolve;
      }),
  );
  const answer = questions.ask({ question: "Choose" }, context);
  controller.abort();
  await expect(answer).resolves.toMatchObject({
    cancelled: true,
    answered: false,
  });
  finishPublish({ id: "notice" });
  await Promise.resolve();
  await Promise.resolve();
  expect(update).toHaveBeenCalledWith(
    "notice",
    { pending: false },
    { projectId: "project" },
  );
});
