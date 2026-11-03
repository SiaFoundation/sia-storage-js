// src/vite.ts
import { readFileSync } from "fs";
var WORKER_FILE = "sia-storage-sw.js";
function siaStorage() {
  const source = () => readFileSync(new URL(`./${WORKER_FILE}`, import.meta.url));
  let serverBuild = false;
  return {
    name: "sia-storage",
    config: () => ({
      optimizeDeps: { exclude: ["@siafoundation/sia-storage"] }
    }),
    configResolved(config) {
      serverBuild = Boolean(config.build.ssr);
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = request.url?.split("?")[0];
        if (path !== `${server.config.base}${WORKER_FILE}`) return next();
        response.setHeader("Content-Type", "text/javascript");
        response.setHeader("Cache-Control", "no-cache");
        response.end(source());
      });
    },
    generateBundle() {
      if (serverBuild) return;
      this.emitFile({ type: "asset", fileName: WORKER_FILE, source: source() });
    }
  };
}
export {
  siaStorage
};
