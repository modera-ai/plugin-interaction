import type { PluginUiContribution } from "@modera/plugin-sdk";
import type { Answer, Questions } from "./questions";
export function questionUi(questions: Questions): PluginUiContribution {
  return {
    id: "modera.interaction.question",
    slot: "tool.result",
    hostRenderer: "question-result",
    toolNames: ["ask_user_question"],
    requiredPermissions: [],
    actions: ["answer", "cancel"],
    async act(action, context, request) {
      if (!request.toolCallId || request.tool?.result !== undefined) throw new Error("Question is not pending");
      questions.respond(request.toolCallId, action.value, context, action.id === "cancel");
    },
    async render(request, context) {
      const snapshot = request.toolCallId ? questions.snapshot(request.toolCallId, context) : undefined;
      const answer = request.tool?.result ? JSON.parse(request.tool.result) as Answer : snapshot?.answer;
      const input = request.tool?.input as { question?: string; options?: string[]; multiple?: boolean } | undefined;
      if (!snapshot && !answer) throw new Error("Question is no longer available");
      return {
        title: request.locale.startsWith("zh") ? "用户问答" : "User question",
        live: !answer,
        data: { question: snapshot?.question ?? { question: input?.question ?? answer?.question ?? "", options: input?.options ?? [], multiple: input?.multiple ?? false }, ...(answer ? { answer } : {}) },
        children: [],
      };
    },
  };
}
