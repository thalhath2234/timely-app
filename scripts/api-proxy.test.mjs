// The web app's /api-proxy route forwards to API_ORIGIN as it is set when the
// server runs, so one build or Docker image can reach any API
// (apps/web/app/api-proxy/[...path]/route.ts).
import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { GET, POST } from "../apps/web/app/api-proxy/[...path]/route.ts";

async function fakeApi(name) {
  const seen = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body });
      res.setHeader("set-cookie", ["session=a; Path=/", "refresh=b; Path=/"]);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ from: name }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { origin: `http://127.0.0.1:${server.address().port}`, seen, close: () => new Promise((resolve) => server.close(resolve)) };
}

function request(method, url, { headers = {}, body = null } = {}) {
  return { method, nextUrl: new URL(url), headers: new Headers(headers), body };
}

const params = (...path) => ({ params: Promise.resolve({ path }) });

test("each request goes to API_ORIGIN as it is set at that moment", async (t) => {
  const first = await fakeApi("first");
  const second = await fakeApi("second");
  t.after(() => Promise.all([first.close(), second.close()]));
  const saved = process.env.API_ORIGIN;
  t.after(() => (saved === undefined ? delete process.env.API_ORIGIN : (process.env.API_ORIGIN = saved)));

  process.env.API_ORIGIN = `${first.origin}/`;
  const one = await GET(request("GET", "http://web.test/api-proxy/health"), params("health"));
  assert.deepEqual(await one.json(), { from: "first" });

  process.env.API_ORIGIN = second.origin;
  const two = await GET(request("GET", "http://web.test/api-proxy/health"), params("health"));
  assert.deepEqual(await two.json(), { from: "second" });
  assert.equal(first.seen.length, 1);
  assert.equal(second.seen.length, 1);
});

test("path, query, body and the client address reach the API; the browser origin does not", async (t) => {
  const api = await fakeApi("api");
  t.after(api.close);
  const saved = process.env.API_ORIGIN;
  t.after(() => (saved === undefined ? delete process.env.API_ORIGIN : (process.env.API_ORIGIN = saved)));
  process.env.API_ORIGIN = api.origin;

  const response = await POST(
    request("POST", "http://web.test/api-proxy/docs/a%20b/blocks?limit=5", {
      headers: { "content-type": "application/json", cookie: "refresh=old", origin: "http://web.test", "x-forwarded-for": "203.0.113.7" },
      body: new Blob(['{"text":"hi"}']).stream(),
    }),
    params("docs", "a b", "blocks"),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(response.headers.getSetCookie(), ["session=a; Path=/", "refresh=b; Path=/"]);
  const [seen] = api.seen;
  assert.equal(seen.method, "POST");
  assert.equal(seen.url, "/docs/a%20b/blocks?limit=5");
  assert.equal(seen.body, '{"text":"hi"}');
  assert.equal(seen.headers.cookie, "refresh=old");
  assert.equal(seen.headers["x-forwarded-for"], "203.0.113.7", "the API's sign-in rate limit keys on it");
  assert.equal(seen.headers.origin, undefined);
});

test("a page served over https still gets Secure session cookies", async (t) => {
  const api = await fakeApi("api");
  t.after(api.close);
  const saved = process.env.API_ORIGIN;
  t.after(() => (saved === undefined ? delete process.env.API_ORIGIN : (process.env.API_ORIGIN = saved)));
  process.env.API_ORIGIN = api.origin;

  // apps/api/internal/features/auth/handler.go applySessionCookieFlags reads Origin or X-Forwarded-Proto.
  await POST(request("POST", "http://web.test/api-proxy/login", { headers: { origin: "https://timely.example", "x-forwarded-proto": "http" }, body: new Blob(["{}"]).stream() }), params("login"));
  await POST(request("POST", "http://web.test/api-proxy/login", { headers: { origin: "http://127.0.0.1:44001", "x-forwarded-proto": "http" }, body: new Blob(["{}"]).stream() }), params("login"));
  assert.equal(api.seen[0].headers["x-forwarded-proto"], "https");
  assert.equal(api.seen[1].headers["x-forwarded-proto"], "http");
});

test("an API that is not running answers 502, the gap the web client retries through", async (t) => {
  const saved = process.env.API_ORIGIN;
  t.after(() => (saved === undefined ? delete process.env.API_ORIGIN : (process.env.API_ORIGIN = saved)));
  const gone = await fakeApi("gone");
  await gone.close();
  process.env.API_ORIGIN = gone.origin;

  const response = await GET(request("GET", "http://web.test/api-proxy/health"), params("health"));
  assert.equal(response.status, 502);
  assert.match((await response.json()).message, /did not answer/);
});
