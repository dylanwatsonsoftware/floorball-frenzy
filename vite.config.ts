import { defineConfig } from "vite";
import { execSync } from "child_process";

function gitInfo() {
  try {
    const hash = execSync("git rev-parse --short HEAD").toString().trim();
    const msg = execSync("git log -1 --format=%s").toString().trim();
    const isoDate = execSync("git log -1 --format=%cI").toString().trim();
    return { hash, msg, isoDate };
  } catch {
    return { hash: "unknown", msg: "", isoDate: new Date().toISOString() };
  }
}

const { hash, msg, isoDate } = gitInfo();

export default defineConfig({
  define: {
    __GIT_HASH__: JSON.stringify(hash),
    __GIT_MSG__: JSON.stringify(msg),
    __GIT_DATE__: JSON.stringify(isoDate),
  },
  base: "./",
  build: {
    target: "es2020",
    outDir: "dist",
    assetsDir: "assets",
    rollupOptions: {
      output: {
        manualChunks: {
          phaser: ["phaser"],
        },
      },
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
