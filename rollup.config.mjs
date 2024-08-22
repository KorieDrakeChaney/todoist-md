import typescript from "@rollup/plugin-typescript";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import postcss from "rollup-plugin-postcss";
import { resolve } from "path";
const isProd = process.env.BUILD === "production";

export default {
  input: "./src/main.ts",
  output: {
    dir: ".",
    sourcemap: "inline",
    sourcemapExcludeSources: isProd,
    format: "cjs",
    exports: "default"
  },
  external: ["obsidian"],
  plugins: [
    typescript(),
    nodeResolve({ browser: true }),
    commonjs(),
    postcss({
      extract: resolve("styles.css"),
      minimize: isProd,
      sourceMap: !isProd,
      modules: true
    })
  ]
};
