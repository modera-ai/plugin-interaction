import { expect, test, vi } from "vitest";
import type { PluginContext } from "@modera/plugin-sdk";
import { Questions } from "../src/questions";

function fixture() {
  const publish = vi.fn(async () => ({ id: "notice" }));
  const update = vi.fn(async () => {});
  const controller = new AbortController();
  const handlers = new Map<
    string,
    (values: { selected: string[]; text: string }) => void | Promise<void>
  >();
  const onAction = vi.fn(
    (
      id: string,
      handler: (values: {
        selected: string[];
        text: string;
      }) => void | Promise<void>,
    ) => {
      handlers.set(id, handler);
      return () => {
        handlers.delete(id);
      };
    },
  );
  const host = {
    signal: controller.signal,
    notifications: { publish, update, onAction },
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
    handlers,
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
test("banner actions answer through the same question handler and are disposed after completion", async () => {
  const { questions, context, handlers, publish } = fixture();
  const result = questions.ask(
    { question: "Choose", options: ["One", "Two"], multiple: true },
    context,
  );
  const notice = publish.mock.calls[0]?.[0] as unknown as {
    interaction: { actions: { id: string }[] };
  };
  const answer = notice.interaction.actions[0]!.id;
  await handlers.get(answer)!({ selected: ["0", "1"], text: "Extra" });
  await expect(result).resolves.toMatchObject({
    answered: true,
    selectedOptions: ["One", "Two"],
    customAnswer: "Extra",
  });
  expect(handlers.size).toBe(0);
});
test("only the explicit cancel action cancels a question", async () => {
  const { questions, context, handlers, publish } = fixture();
  const result = questions.ask(
    { question: "Choose", options: ["One"] },
    context,
  );
  const notice = publish.mock.calls[0]?.[0] as unknown as {
    interaction: { actions: { id: string }[] };
  };
  await handlers.get(notice.interaction.actions[1]!.id)!({
    selected: [],
    text: "",
  });
  await expect(result).resolves.toMatchObject({
    answered: false,
    cancelled: true,
  });
  expect(handlers.size).toBe(0);
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
