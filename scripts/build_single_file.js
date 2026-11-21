#!/usr/bin/env node
"use strict";

/**
 * Optional standalone single-file HTML bundler.
 * Packs `index.html` + `styles/` + `data/` + `src/` into a single portable
 * offline HTML file (`.cache/Web AutoEQ - Standalone.html`) on demand, so the
 * repository stays clean and modular without losing single-file export capability.
 */

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const outPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(root, ".cache/Web AutoEQ - Standalone.html");

let html = fs.readFileSync(path.join(root, "index.html"), "utf8");

html = html.replace(/<link\s+rel="stylesheet"\s+href="([^"]+)">/g, (_, href) => {
  const css = fs.readFileSync(path.join(root, href), "utf8");
  return `<style>\n${css.trimEnd()}\n</style>`;
});

html = html.replace(/<script\s+src="([^"]+)"><\/script>/g, (_, src) => {
  const js = fs.readFileSync(path.join(root, src), "utf8");
  if (src === "data/headphone-db.js") {
    const b64 = Buffer.from(js, "utf8").toString("base64");
    return `<script src="data:application/javascript;base64,${b64}"></script>`;
  }
  return `<script>\n${js.trimEnd()}\n</script>`;
});

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, html, "utf8");
console.log(
  JSON.stringify({
    ok: true,
    out: outPath,
    bytes: fs.statSync(outPath).size,
    lines: html.split("\n").length,
  })
);
