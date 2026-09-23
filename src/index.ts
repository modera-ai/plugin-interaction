import manifest from "../plugin.json";
import { declaredTool, type PluginModule } from "@modera/plugin-sdk";
import { normalizeQuestion, Questions } from "./questions";
import { questionUi } from "./ui";
const definition = declaredTool(manifest, "ask_user_question");
export const activate: PluginModule["activate"] = async (host) => {
  const questions = new Questions(host);
  return {
    tools: [
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
    ui: [questionUi(questions)],
  };
};
