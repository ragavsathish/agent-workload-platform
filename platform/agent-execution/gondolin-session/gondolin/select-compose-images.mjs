#!/usr/bin/env node

import fs from "node:fs";

const [indexPath, selection] = process.argv.slice(2);
const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
const archives = new Set();
for (const service of selection.split(",").map((value) => value.trim()).filter(Boolean)) {
  const archive = index.services?.[service]?.archive;
  if (typeof archive !== "string" || !/^[a-f0-9]{24}\.tar$/.test(archive)) {
    throw new Error(`No cached image for Compose service: ${service}`);
  }
  archives.add(archive);
}
if (archives.size === 0) throw new Error("COMPOSE_CACHE_SERVICES must name at least one service");
process.stdout.write(`${[...archives].sort().join("\n")}\n`);
