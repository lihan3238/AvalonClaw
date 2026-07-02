/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { handleAiActionRequest } from "./server/aiEndpoint";
import { handleRoomRequest } from "./server/roomEndpoint";

function aiActionApiPlugin(): Plugin {
  return {
    name: "avalon-ai-action-api",
    configureServer(server) {
      server.middlewares.use("/api/ai-action", (req, res) => {
        void handleAiActionRequest(req, res);
      });
      server.middlewares.use("/api/room", (req, res) => {
        void handleRoomRequest(req, res);
      });
    }
  };
}

export default defineConfig({
  plugins: [react(), aiActionApiPlugin()],
  ssr: {
    noExternal: ["zod"]
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["src/test/setup.ts"]
  }
});
