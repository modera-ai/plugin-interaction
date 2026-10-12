import { expect, it, vi } from "vitest";
vi.mock("@modera/ui", () => ({
  QuestionInteraction: () => null,
  ToolExecution: () => null,
  parseToolOutput: (value: string) => JSON.parse(value),
}));
import { QuestionInteraction, ToolExecution } from "@modera/ui";
import QuestionResult from "../ui/question-result";

it.each(["running", "done", "failed", "interrupted"] as const)(
  "owns one tool card and preserves the question form in state %s",
  async (state) => {
    const act = vi.fn(async () => true);
    const onOpenChange = vi.fn();
    const answer = { responses: [{ questionId: "q", selectedIds: ["a"] }] };
    const result = QuestionResult({
      call: {
        id: "call",
        name: "ask_user_question",
        input: {
          questions: [
            { id: "q", title: "Pick", options: [{ id: "a", title: "A" }] },
          ],
        },
      },
      state,
      title: "询问用户",
      locale: "zh",
      open: false,
      onOpenChange,
      act,
      ...(state === "done" ? { result: JSON.stringify(answer) } : {}),
    } as never);
    expect(result.type).toBe(ToolExecution);
    expect(result.props).toMatchObject({
      name: "ask_user_question",
      state,
      open: false,
      onOpenChange,
      awaitingInput: state === "running",
    });
    const form = result.props.children;
    expect(form.type).toBe(QuestionInteraction);
    expect(form.props.status).toBe(
      state === "running" ? "waiting" : state === "done" ? "answered" : state,
    );
    await form.props.onComplete({ q: { selectedIds: ["a"] } });
    expect(act).toHaveBeenCalledWith("answer", expect.any(String));
  },
);
