/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import dotenv from "dotenv";
import { defineConfig, type Plugin } from "vite";
import { handleAiActionRequest } from "./server/aiEndpoint";

dotenv.config();

function aiActionApiPlugin(): Plugin {
  return {
    name: "avalon-ai-action-api",
    configureServer(server) {
      server.middlewares.use("/api/ai-action", (req, res) => {
        void handleAiActionRequest(req, res);
      });
    }
  };
}

export default defineConfig({
  plugins: [react(), aiActionApiPlugin()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["src/test/setup.ts"]
  }
});
