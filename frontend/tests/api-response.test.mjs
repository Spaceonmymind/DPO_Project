import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";

test("API errors preserve JSON details and explain plain-text server failures", async () => {
  const server = await createServer({ logLevel: "silent", server: { middlewareMode: true } });
  try {
    const { parseApiResponse } = await server.ssrLoadModule("/src/apiResponse.ts");
    await assert.rejects(
      parseApiResponse(new Response("Internal Server Error", { status: 500, headers: { "content-type": "text/plain" } })),
      /Сервер не смог выполнить операцию/,
    );
    await assert.rejects(
      parseApiResponse(new Response(JSON.stringify({ detail: "Выделенный диапазон пересекается с существующей привязкой" }), { status: 409, headers: { "content-type": "application/json" } })),
      /Выделенный диапазон пересекается/,
    );
    assert.equal(await parseApiResponse(new Response(null, { status: 204 })), null);
  } finally { await server.close(); }
});
