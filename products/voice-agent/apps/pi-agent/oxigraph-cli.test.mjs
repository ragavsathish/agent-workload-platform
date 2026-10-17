import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execute = promisify(execFile);
const cli = fileURLToPath(new URL("./cli/oxigraph", import.meta.url));

test("Oxigraph CLI sends query and update text only to the configured endpoint", async () => {
  const requests = [];
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      requests.push({ url: request.url, contentType: request.headers["content-type"], body });
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end('{"ok":true}');
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.equal(typeof address, "object");
  const endpoint = `http://127.0.0.1:${address.port}`;
  const root = await mkdtemp(join(tmpdir(), "oxigraph-cli-test-"));
  try {
    const query = join(root, "query.rq");
    const update = join(root, "update.ru");
    await writeFile(query, "SELECT * WHERE { ?s ?p ?o } LIMIT 1\n");
    await writeFile(update, "CLEAR GRAPH <urn:test>\n");
    const environment = { ...process.env, OXIGRAPH_URL: endpoint };

    assert.equal((await execute(cli, ["query", query], { env: environment })).stdout, '{"ok":true}');
    assert.equal((await execute(cli, ["update", update], { env: environment })).stdout, '{"ok":true}');
    assert.equal((await execute(cli, ["graphs"], { env: environment })).stdout, '{"ok":true}');

    assert.deepEqual(requests, [
      {
        url: "/query",
        contentType: "application/sparql-query",
        body: "SELECT * WHERE { ?s ?p ?o } LIMIT 1\n",
      },
      {
        url: "/update",
        contentType: "application/sparql-update",
        body: "CLEAR GRAPH <urn:test>\n",
      },
      {
        url: "/query",
        contentType: "application/sparql-query",
        body: "SELECT DISTINCT ?graph WHERE { GRAPH ?graph { ?subject ?predicate ?object } } ORDER BY ?graph\n",
      },
    ]);
  } finally {
    server.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Oxigraph CLI rejects unsupported commands before making a request", async () => {
  await assert.rejects(
    execute(cli, ["serve"], { env: { ...process.env, OXIGRAPH_URL: "http://127.0.0.1:9" } }),
    (error) => error.code === 2 && /Usage:/.test(error.stderr),
  );
});
