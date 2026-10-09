import type { PluginUiContribution } from "@modera/plugin-sdk";
import type { Questions } from "./questions";

export function planApprovalUi(questions: Questions): PluginUiContribution {
  return {
    id: "modera.interaction.plan-approval",
    slot: "tool.result",
    hostRenderer: "plan-approval",
    toolNames: ["approve_plan"],
    requiredPermissions: [],
    actions: ["approve", "continue"],
    async act(action, context, request) {
      if (!request.toolCallId || request.tool?.result !== undefined)
        throw new Error("Plan approval is not pending");
      questions.respond(
        request.toolCallId,
        JSON.stringify({
          answers: {
            plan: {
              questionId: "plan",
              selectedIds: [action.id === "approve" ? "approve" : "continue"],
              otherText: action.id === "continue" ? (action.value ?? "") : "",
            },
          },
        }),
        context,
      );
    },
    async render(request, context) {
      const snapshot = request.toolCallId
        ? questions.snapshot(request.toolCallId, context)
        : undefined;
      const result = request.tool?.result
        ? (JSON.parse(request.tool.result) as { approved?: boolean })
        : undefined;
      if (!snapshot && !result)
        throw new Error("Plan approval is no longer available");
      return {
        title: request.locale.startsWith("zh") ? "计划审批" : "Plan approval",
        live: !result,
        data: { approved: result?.approved ?? null },
        children: [],
      };
    },
  };
}
