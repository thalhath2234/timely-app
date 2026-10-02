import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// Local worktree only. Credentials never appear in the output or evidence.
const base = "http://127.0.0.1:8081";
const run = randomUUID();
const password = randomUUID();
const results = [];
const objects = {};
async function request(path, method = "GET", body, token) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: response.status, data };
}
async function check(name, action) {
  try {
    const evidence = await action();
    results.push({ name, pass: true, ...(evidence ? { evidence } : {}) });
    console.log(`PASS ${name}`);
  } catch (error) {
    // Assertions contain fixture data only, never complete auth responses.
    results.push({ name, pass: false, error: error.message });
    console.log(`FAIL ${name}: ${error.message}`);
  }
}
async function ok(path, method, body, token) {
  const result = await request(path, method, body, token);
  assert.ok(
    result.status >= 200 && result.status < 300,
    `${method ?? "GET"} ${path}: HTTP ${result.status}`,
  );
  return result.data;
}
const emailA = `qa-audit-${run}-a@example.invalid`;
const emailB = `qa-audit-${run}-b@example.invalid`;
const a = await ok("/register", "POST", {
  name: "QA API A",
  email: emailA,
  password,
});
const b = await ok("/register", "POST", {
  name: "QA API B",
  email: emailB,
  password,
});
const token = a.token;
await check("Anonymous reads are rejected", async () => {
  for (const path of [
    "/me",
    "/tasks",
    "/docs",
    "/sheets",
    "/events",
    "/workspaces",
    "/chats",
    "/export/full",
    "/api-keys",
  ])
    assert.equal((await request(path)).status, 401, path);
});
await check("Wrong password is rejected", async () => {
  assert.equal(
    (
      await request("/login", "POST", {
        email: emailA,
        password: "wrong-password",
      })
    ).status,
    401,
  );
});
await check("Workspace creation and onboarding", async () => {
  const result = await ok(
    "/workspaces",
    "POST",
    { name: "QA API Workspace" },
    token,
  );
  objects.workspace = result.workspace ?? result;
  assert.ok(objects.workspace.id);
  await ok("/config", "PUT", { isOnboardingCompleted: true }, token);
  assert.equal(
    (await ok("/me", "GET", undefined, token)).is_on_boarding_completed,
    true,
  );
});
await check("Project CRUD", async () => {
  const result = await ok(
    "/projects",
    "POST",
    { title: "QA API Project", workspaceId: objects.workspace.id },
    token,
  );
  objects.project = result.project ?? result;
  await ok(
    `/projects/${objects.project.id}`,
    "PUT",
    { title: "QA API Project Edited" },
    token,
  );
  const saved = await ok(
    `/projects/${objects.project.id}`,
    "GET",
    undefined,
    token,
  );
  assert.equal((saved.project ?? saved).title, "QA API Project Edited");
});
await check("Work creation, editing and checklist persistence", async () => {
  const result = await ok(
    "/tasks",
    "POST",
    {
      name: "QA API Work",
      duration: 30,
      workspaceId: objects.workspace.id,
      projectId: objects.project.id,
    },
    token,
  );
  objects.task = result.task ?? result;
  await ok(
    `/tasks/${objects.task.id}`,
    "PUT",
    { name: "QA API Work Edited" },
    token,
  );
  await ok(
    `/tasks/${objects.task.id}/checklist`,
    "POST",
    { title: "QA API checklist" },
    token,
  );
  await ok(
    `/tasks/${objects.task.id}/activity`,
    "POST",
    { comment: "QA API comment" },
    token,
  );
  const saved = await ok(`/task/${objects.task.id}`, "GET", undefined, token);
  assert.equal(saved.name, "QA API Work Edited");
  assert.ok(saved.checklist?.length);
});
await check("Capture and clarify consume the original inbox item", async () => {
  const captured = await ok(
    "/inbox",
    "POST",
    { name: "QA API Thought" },
    token,
  );
  const item = captured.task ?? captured;
  assert.equal(item.kind, "inbox");
  const clarified = await ok(
    `/inbox/${item.id}/clarify`,
    "POST",
    {
      name: item.name,
      kind: "task",
      workspaceId: objects.workspace.id,
      duration: 15,
    },
    token,
  );
  objects.clarified = clarified.task ?? clarified;
  assert.notEqual(objects.clarified.id, item.id);
  assert.equal(
    (await request(`/task/${item.id}`, "GET", undefined, token)).status,
    404,
  );
});
await check("Document rich content survives reload", async () => {
  const content = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "QA persistent rich text" }],
      },
    ],
  };
  const result = await ok(
    "/docs",
    "POST",
    { title: "QA API Doc", workspaceId: objects.workspace.id, content },
    token,
  );
  objects.doc = result.document ?? result;
  const saved = await ok(`/docs/${objects.doc.id}`, "GET", undefined, token);
  assert.deepEqual((saved.document ?? saved).content, content);
});
await check("Sheet data and formulas survive reload", async () => {
  const columns = [
    { id: "qa_col_a", name: "Amount", width: 140, type: "number" },
    { id: "qa_col_b", name: "Total", width: 140, type: "formula" },
  ];
  const rows = [
    { id: "qa_row_a", cells: { qa_col_a: "42", qa_col_b: "=SUM(A1:A1)" } },
  ];
  const result = await ok(
    "/sheets",
    "POST",
    { title: "QA API Sheet", workspaceId: objects.workspace.id, columns, rows },
    token,
  );
  objects.sheet = result.sheet ?? result;
  const saved = await ok(
    `/sheets/${objects.sheet.id}`,
    "GET",
    undefined,
    token,
  );
  assert.deepEqual((saved.sheet ?? saved).rows, rows);
});
await check("Timed event creation and calendar inclusion", async () => {
  const result = await ok(
    "/events",
    "POST",
    {
      title: "QA API Event",
      workspaceId: objects.workspace.id,
      start: "2026-10-02T01:00:00Z",
      end: "2026-10-02T02:00:00Z",
    },
    token,
  );
  objects.event = result.event ?? result;
  const range = await ok(
    "/calendar?from=2026-10-01T00:00:00Z&to=2026-10-03T00:00:00Z",
    "GET",
    undefined,
    token,
  );
  assert.ok(JSON.stringify(range).includes(objects.event.id));
});
await check("Auto-schedule preview, apply and undo", async () => {
  const scope = {
    taskIds: [objects.task.id],
    from: "2026-10-02T00:00:00Z",
    to: "2026-10-05T00:00:00Z",
    timezone: "Asia/Tokyo",
  };
  const before = JSON.stringify(
    await ok(`/task/${objects.task.id}`, "GET", undefined, token),
  );
  await ok("/schedule/preview", "POST", scope, token);
  assert.equal(
    JSON.stringify(
      await ok(`/task/${objects.task.id}`, "GET", undefined, token),
    ),
    before,
  );
  const applied = await ok("/schedule/apply", "POST", scope, token);
  assert.ok(
    JSON.stringify(applied).includes(objects.task.id),
    "Applied plan should contain the selected Work",
  );
  await ok("/schedule/undo", "POST", undefined, token);
});
await check(
  "Rank day boundary follows the client timezone (QA-03)",
  async () => {
    // A new account has no saved Working hours. Pick a zone whose local date
    // differs from the UTC date right now, and a Block that is "today" in UTC
    // but not in that zone: Rank must list the Work for the zone and not for UTC.
    const now = new Date();
    const utcDay = now.toISOString().slice(0, 10);
    const afternoon = now.getUTCHours() >= 12;
    const zone = afternoon ? "Etc/GMT-14" : "Etc/GMT+12";
    const blockStart = afternoon
      ? `${utcDay}T00:30:00Z`
      : `${utcDay}T23:30:00Z`;
    const created = await ok(
      "/tasks",
      "POST",
      {
        name: "QA API Rank Zone",
        duration: 30,
        workspaceId: objects.workspace.id,
      },
      token,
    );
    objects.rankTask = created.task ?? created;
    await ok(
      `/tasks/${objects.rankTask.id}/blocks`,
      "POST",
      { start: blockStart, durationMinutes: 30 },
      token,
    );
    const ids = (list) => (list.items ?? list).map((row) => row.task.id);
    const zoneRank = ids(
      await ok(
        `/schedule/rank?timezone=${encodeURIComponent(zone)}`,
        "GET",
        undefined,
        token,
      ),
    );
    const utcRank = ids(await ok("/schedule/rank", "GET", undefined, token));
    const evidence = {
      zone,
      blockStart,
      listedForZone: zoneRank.includes(objects.rankTask.id),
      listedForUtc: utcRank.includes(objects.rankTask.id),
    };
    console.log(`EVIDENCE rank timezone ${JSON.stringify(evidence)}`);
    assert.equal(
      evidence.listedForZone,
      true,
      "Block is not today in the zone",
    );
    assert.equal(evidence.listedForUtc, false, "Block is today in UTC");
    return evidence;
  },
);
await check("Cross-account object reads and writes are denied", async () => {
  for (const [get, put] of [
    [`/task/${objects.task.id}`, `/tasks/${objects.task.id}`],
    ...["projects", "docs", "sheets", "events", "workspaces"].map((path) => [
      `/${path}/${objects[{ projects: "project", docs: "doc", sheets: "sheet", events: "event", workspaces: "workspace" }[path]].id}`,
      `/${path}/${objects[{ projects: "project", docs: "doc", sheets: "sheet", events: "event", workspaces: "workspace" }[path]].id}`,
    ]),
  ]) {
    assert.ok(
      [403, 404].includes(
        (await request(get, "GET", undefined, b.token)).status,
      ),
      get,
    );
    assert.ok(
      [403, 404].includes(
        (
          await request(
            put,
            "PUT",
            { title: "unauthorized", name: "unauthorized" },
            b.token,
          )
        ).status,
      ),
      put,
    );
  }
});
await check("Foreign workspace cannot be used to create Work", async () => {
  const result = await request(
    "/tasks",
    "POST",
    { name: "Foreign Work", duration: 30, workspaceId: objects.workspace.id },
    b.token,
  );
  assert.ok([400, 403, 404].includes(result.status), `HTTP ${result.status}`);
});
await check("Keyword search returns the saved Work", async () => {
  const result = await ok("/search?q=QA%20API%20Work", "GET", undefined, token);
  assert.ok(JSON.stringify(result).includes(objects.task.id));
});
await check("Data exports contain only the current account", async () => {
  const exported = await ok("/export/full", "GET", undefined, token);
  assert.ok(JSON.stringify(exported).includes(objects.task.id));
  const other = await ok("/export/full", "GET", undefined, b.token);
  assert.ok(!JSON.stringify(other).includes(objects.task.id));
  await ok("/export/tasks.csv", "GET", undefined, token);
  await ok("/export/calendar.ics", "GET", undefined, token);
});
await check("Invalid-signature JWT cannot revoke a session", async () => {
  const disposable = await ok("/login", "POST", { email: emailA, password });
  const sid = JSON.parse(
    Buffer.from(disposable.token.split(".")[1], "base64url"),
  ).sid;
  const forged = [
    Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
      "base64url",
    ),
    Buffer.from(JSON.stringify({ sid })).toString("base64url"),
    "invalid-signature",
  ].join(".");
  assert.equal((await request("/me", "GET", undefined, forged)).status, 401);
  assert.equal(
    (await request("/me", "GET", undefined, disposable.token)).status,
    200,
  );
  const logout = await request("/logout", "POST", undefined, forged);
  const victim = await request("/me", "GET", undefined, disposable.token);
  const unaffected = await request("/me", "GET", undefined, token);
  const evidence = {
    forgedRead: 401,
    beforeLogout: 200,
    forgedLogout: logout.status,
    afterLogout: victim.status,
    unrelatedSession: unaffected.status,
  };
  console.log(
    `EVIDENCE logout signature validation ${JSON.stringify(evidence)}`,
  );
  assert.equal(
    victim.status,
    200,
    "Invalid JWT revoked the targeted session (expected 200, got 401)",
  );
  return evidence;
});
await check("Refresh token rotation rejects replay", async () => {
  const disposable = await ok("/login", "POST", { email: emailB, password });
  const fresh = await ok("/auth/refresh", "POST", {
    refreshToken: disposable.refreshToken,
  });
  assert.ok(fresh.token);
  assert.equal(
    (
      await request("/auth/refresh", "POST", {
        refreshToken: disposable.refreshToken,
      })
    ).status,
    401,
  );
});
await check("Valid logout revokes its access token", async () => {
  const disposable = await ok("/login", "POST", { email: emailB, password });
  await ok("/logout", "POST", undefined, disposable.token);
  assert.equal(
    (await request("/me", "GET", undefined, disposable.token)).status,
    401,
  );
});
await check("QA fixture deletion", async () => {
  for (const [key, path] of [
    ["event", "events"],
    ["sheet", "sheets"],
    ["doc", "docs"],
    ["clarified", "tasks"],
    ["rankTask", "tasks"],
    ["task", "tasks"],
    ["project", "projects"],
  ]) {
    if (objects[key]?.id)
      await ok(`/${path}/${objects[key].id}`, "DELETE", undefined, token);
  }
  // The product deliberately preserves an account's last workspace.
  const lastWorkspace = await request(
    `/workspaces/${objects.workspace.id}`,
    "DELETE",
    undefined,
    token,
  );
  assert.equal(lastWorkspace.status, 400);
  await ok("/logout", "POST", undefined, token);
  await ok("/logout", "POST", undefined, b.token);
});
const evidence = {
  run,
  base,
  results,
  passed: results.filter((r) => r.pass).length,
  failed: results.filter((r) => !r.pass).length,
};
// evidence/api-audit.json holds the audited build's result; reruns write to
// QA_EVIDENCE_FILE, defaulting to the remediation folder.
const target =
  process.env.QA_EVIDENCE_FILE ||
  new URL("../2026-10-01-remediation/evidence/api-audit.json", import.meta.url)
    .pathname;
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, JSON.stringify(evidence, null, 2) + "\n");
console.log(
  `${evidence.passed} passed; ${evidence.failed} failed. QA accounts and their last workspace remain; other created objects were deleted.`,
);
process.exitCode = evidence.failed ? 1 : 0;
