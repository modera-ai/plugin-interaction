import type { PluginUiContribution } from "@modera/plugin-sdk";
import { normalizeQuestion, type Answer, type Questions } from "./questions";
export function questionUi(questions: Questions): PluginUiContribution {
  return {
    id: "modera.interaction.question",
    slot: "tool.result",
    hostRenderer: "question-result",
    toolNames: ["ask_user_question"],
    requiredPermissions: [],
    actions: ["answer", "cancel"],
    actionLimits: { maxValueChars: 40000 },
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
      const snapshot = request.toolCallId
        ? questions.snapshot(request.toolCallId, context)
        : undefined;
      const answer = request.tool?.result
        ? (JSON.parse(request.tool.result) as Answer)
        : snapshot?.answer;
      if (!snapshot && !answer)
        throw new Error("Question is no longer available");
      return {
        title: request.locale.startsWith("zh") ? "用户问答" : "User question",
        live: !answer,
        data: {
          question:
            snapshot?.question ?? normalizeQuestion(request.tool?.input),
          ...(answer ? { answer } : {}),
        },
        children: [],
      };
    },
  };
}
