import esbuild from "esbuild";
import { cp, mkdir } from "node:fs/promises";

const production = process.argv[2] === "production";
await mkdir("dist", { recursive: true });

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian"],
  format: "cjs",
  platform: "node",
  target: "es2018",
  sourcemap: production ? false : "inline",
  minify: production,
  outfile: "dist/main.js",
  logLevel: "info"
});

if (production) {
  await context.rebuild();
  await context.dispose();
  await cp("manifest.json", "dist/manifest.json");
} else {
  await context.watch();
  console.log("Watching for changes...");
}
