import manifest from "../plugin.json";
import { declaredTool, type PluginModule } from "@modera/plugin-sdk";
import { normalizeQuestion, Questions } from "./questions";
import { questionUi } from "./ui";
import { planApprovalUi } from "./plan-ui";
const definition = declaredTool(manifest, "ask_user_question");
const approvalDefinition = declaredTool(manifest, "approve_plan");
export const activate: PluginModule["activate"] = async (host) => {
  const questions = new Questions(host);
  return {
    tools: [
      {
        definition: approvalDefinition,
        async prepare(input) {
          const plan = (input as { plan?: unknown })?.plan;
          if (typeof plan !== "string" || !plan.trim() || plan.length > 100000) throw new Error("A complete plan is required");
          return { input: { plan: plan.trim() }, preview: null, executionTimeoutMs: 1800000 };
        },
        async execute(_input, context) {
          const answer = await questions.ask({ question: "Approve execution of this plan?", options: ["Approve and execute", "Keep planning"] }, context);
          return { approved: answer.answered && !answer.cancelled && answer.selectedOptions.includes("Approve and execute"), feedback: answer.customAnswer };
        },
      },
      {
        definition,
        async prepare(input) {
          return {
            input: normalizeQuestion(input),
            preview: null,
            executionTimeoutMs: 1800000,
          };
        },
        execute: (input, context) => questions.ask(input, context),
      },
    ],
    ui: [questionUi(questions), planApprovalUi(questions)],
  };
};
