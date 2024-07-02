import {nodeResolve} from "@rollup/plugin-node-resolve"
export default {
  input: "./src/codemirror.js",
  output: {
    file: "./static/dist/codemirror.bundle.js",
    format: "es"
  },
  plugins: [nodeResolve()]
}