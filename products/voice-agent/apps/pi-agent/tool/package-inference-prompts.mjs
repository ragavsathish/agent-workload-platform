import { cp, mkdir } from "node:fs/promises";

const resources = [
  {
    source: new URL("../digital-twin/runtime/image/prompts/", import.meta.url),
    destination: new URL("../dist/digital-twin/runtime/image/prompts/", import.meta.url),
  },
  {
    source: new URL("../voice-agent/prompts/", import.meta.url),
    destination: new URL("../dist/voice-agent/prompts/", import.meta.url),
  },
];

await Promise.all(resources.map(async ({ source, destination }) => {
  await mkdir(destination, { recursive: true });
  await cp(source, destination, { recursive: true });
}));
