import { fileURLToPath } from "node:url";
export default {
  resolve: {
    alias: {
      "@modera-host": fileURLToPath(
        new URL("../../modera/modera-app/core/packages", import.meta.url),
      ),
    },
  },
  test: {
    include: ["../../plugins/plugin-interaction/tests/**/*.test.ts"],
    fileParallelism: false,
  },
};
