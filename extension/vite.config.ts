import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { copyFileSync, mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync, unlinkSync, statSync } from "fs";
import { resolve, join } from "path";

const ONNXRT_DIR = resolve(__dirname, "../node_modules/onnxruntime-web/dist");
const ASSETS_TO_COPY = [
  "ort.bundle.min.mjs",
  "ort-all.bundle.min.mjs",
  "ort-wasm-simd-threaded.jsep.wasm",
  "ort-wasm-simd-threaded.wasm",
  "ort-wasm-simd-threaded.mjs",
  "offscreen.html",
];

function flattenHtmlPages() {
  return {
    name: "flatten-html-pages",
    closeBundle() {
      const pages = [
        { src: resolve(__dirname, "dist/src/popup/index.html"), dest: resolve(__dirname, "dist/popup.html") },
        { src: resolve(__dirname, "dist/src/offscreen/index.html"), dest: resolve(__dirname, "dist/offscreen.html") },
      ];

      for (const page of pages) {
        if (existsSync(page.src)) {
          let html = readFileSync(page.src, "utf8");
          html = html.replace(/(src|href)="\/([^"]+)"/g, (_match, attr, path) => `${attr}="./${path}"`);
          writeFileSync(page.dest, html);
        }
      }

      // Clean up the now-redundant src/ subtree.
      const srcDir = resolve(__dirname, "dist/src");
      if (existsSync(srcDir)) {
        const removeRecursive = (dir: string) => {
          for (const entry of readdirSync(dir)) {
            const full = join(dir, entry);
            if (statSync(full).isDirectory()) {
              removeRecursive(full);
            } else {
              unlinkSync(full);
            }
          }
          try {
            readdirSync(dir);
          } catch {}
        };
        removeRecursive(srcDir);
      }
    },
  };
}

import { buildSync } from "esbuild";

function bundleContentScript() {
  return {
    name: "bundle-content-script",
    closeBundle() {
      const contentSrc = resolve(__dirname, "src/content/index.ts");
      const contentDest = resolve(__dirname, "dist/content.js");
      buildSync({
        entryPoints: [contentSrc],
        bundle: true,
        format: "iife",
        outfile: contentDest,
        sourcemap: true,
        target: ["chrome100"],
        alias: {
          "@privatesight/shared": resolve(__dirname, "../shared/src/index.ts"),
          "@privatesight/shared/schemas": resolve(__dirname, "../shared/src/schemas/index.ts"),
        },
      });
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [
    react(),
    flattenHtmlPages(),
    bundleContentScript(),
    {
      name: "copy-manifest",
      closeBundle() {
        const manifestPath = resolve(__dirname, "src/manifest.json");
        const distPath = resolve(__dirname, "dist/manifest.json");
        if (existsSync(manifestPath)) {
          copyFileSync(manifestPath, distPath);
        }
        const publicDir = resolve(__dirname, "public");
        const distPublicDir = resolve(__dirname, "dist/public");
        if (existsSync(publicDir)) {
          mkdirSync(distPublicDir, { recursive: true });
        }
      },
    },
    {
      name: "copy-onnx-assets",
      closeBundle() {
        const distDir = resolve(__dirname, "dist");
        ASSETS_TO_COPY.forEach((asset) => {
          if (asset === "offscreen.html") return; // Handled by Vite build + flatten
          const src = join(ONNXRT_DIR, asset);
          if (existsSync(src)) {
            const dest = resolve(distDir, asset);
            try {
              if (existsSync(dest) && statSync(dest).size === statSync(src).size) {
                return;
              }
              copyFileSync(src, dest);
            } catch (err) {
              console.warn(`[WARN] Skipping copy of ${asset}:`, err);
            }
          }
        });
      },
    },
  ],
  resolve: {
    alias: {
      "@privatesight/shared": resolve(__dirname, "../shared/src/index.ts"),
      "@privatesight/shared/schemas": resolve(__dirname, "../shared/src/schemas/index.ts"),
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, "src/popup/index.html"),
        offscreen: resolve(__dirname, "src/offscreen/index.html"),
        background: resolve(__dirname, "src/background/index.ts"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "[name].js",
        assetFileNames: "[name].[ext]",
      },
    },
  },
  server: {
    port: 5173,
    hmr: { port: 5173 },
  },
});