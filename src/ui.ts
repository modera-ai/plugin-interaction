import type { PluginUiContribution } from "@modera/plugin-sdk";
import type { Answer, Questions } from "./questions";
export function questionUi(questions: Questions): PluginUiContribution {
  return {
    id: "modera.interaction.question",
    slot: "tool.result",
    toolNames: ["ask_user_question"],
    requiredPermissions: [],
    actions: ["answer", "cancel"],
    async act(action, context, request) {
      if (!request.toolCallId || request.tool?.result !== undefined)
        throw new Error("Question is not pending");
      questions.respond(
        request.toolCallId,
        action.value,
        context,
        action.id === "cancel",
      );
    },
    async render(request, context) {
      const zh = request.locale.startsWith("zh");
      const state = request.toolCallId
        ? questions.snapshot(request.toolCallId, context)
        : undefined;
      const answer = request.tool?.result
        ? (JSON.parse(request.tool.result) as Answer & { error?: string })
        : state?.answer;
      const rawOptions = (
        request.tool?.input as { options?: unknown } | undefined
      )?.options;
      const options =
        state?.question.options ??
        (Array.isArray(rawOptions)
          ? rawOptions
              .filter((v): v is string => typeof v === "string")
              .slice(0, 8)
          : []);
      if (answer)
        return {
          title: zh ? "用户回复" : "User response",
          children: [
            { type: "text", text: answer.question ?? "" },
            ...(!answer.cancelled && !("error" in answer) && options.length
              ? [
                  {
                    type: "choice-form" as const,
                    action: "answer",
                    options,
                    multiple: true,
                    readOnly: true,
                    selected: options.flatMap((option, i) =>
                      answer.selectedOptions?.includes(option) ? [i] : [],
                    ),
                    responseText: answer.customAnswer ?? "",
                    label: zh ? "已回答" : "Answered",
                    placeholder: "",
                    maxLength: 1000,
                  },
                ]
              : []),
            {
              type: "text",
              text:
                "error" in answer
                  ? String(answer.error)
                  : answer.cancelled
                    ? zh
                      ? "已取消，本次没有提供答案。"
                      : "Cancelled; no answer provided."
                    : options.length
                      ? zh
                        ? "已提交回答"
                        : "Answer submitted"
                      : answer.answers.join("\n"),
              tone: "muted",
            },
          ],
        };
      if (!state) throw new Error("Question is no longer available");
      return {
        title: state.question.question,
        live: true,
        children: [
          {
            type: "text",
            tone: "muted",
            text: zh
              ? state.question.options.length
                ? state.question.multiple
                  ? "可多选，也可以补充文字。提交后继续执行。"
                  : "请选择一项，也可以直接填写回答。提交后继续执行。"
                : "请填写回答，提交后继续执行。"
              : state.question.multiple
                ? "Select any options or add your answer to continue."
                : "Choose one option or write an answer to continue.",
          },
          {
            type: "choice-form",
            action: "answer",
            options: state.question.options,
            multiple: state.question.multiple,
            label: zh ? "提交回答" : "Submit answer",
            placeholder: zh
              ? "填写回答或补充说明…"
              : "Your answer or additional details…",
            maxLength: 1000,
          },
          {
            type: "button",
            action: "cancel",
            label: zh ? "取消回答" : "Cancel question",
          },
        ],
      };
    },
  };
}
