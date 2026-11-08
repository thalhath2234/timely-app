import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test, { describe } from "node:test";
import { instantPushLine, pushDelivers, pushProjectId, pushRecordText, readPushRecord } from "../apps/mobile/lib/pushStatus.ts";

const require = createRequire(import.meta.url);
const { pushConfig } = require("../apps/mobile/pushConfig.js");

const none = () => false;
const appJsonWith = (projectId) => ({ expo: { name: "Timely", extra: { eas: { projectId } } } });

describe("pushConfig", () => {
  test("the process env wins over the root .env and app.json", () => {
    const config = pushConfig({
      env: { TIMELY_EAS_PROJECT_ID: " env-id " },
      dotEnv: { TIMELY_EAS_PROJECT_ID: "dotenv-id" },
      appJson: appJsonWith("app-id"),
      exists: none,
    });
    assert.equal(config.projectId, "env-id");
  });

  test("the root .env is read when the process has none", () => {
    const config = pushConfig({ env: { TIMELY_EAS_PROJECT_ID: "  " }, dotEnv: { TIMELY_EAS_PROJECT_ID: "dotenv-id" }, appJson: appJsonWith("app-id"), exists: none });
    assert.equal(config.projectId, "dotenv-id");
  });

  test("app.json's extra.eas.projectId is the last fallback", () => {
    assert.equal(pushConfig({ env: {}, dotEnv: {}, appJson: appJsonWith("app-id"), exists: none }).projectId, "app-id");
  });

  test("no project id anywhere gives null", () => {
    assert.deepEqual(pushConfig({ env: {}, dotEnv: {}, appJson: { expo: {} }, exists: none }), { projectId: null, googleServicesFile: null, extra: {} });
    assert.equal(pushConfig({ exists: none }).projectId, null);
  });

  test("google-services.json is used only when the file is there", () => {
    const seen = [];
    const present = pushConfig({ exists: (file) => (seen.push(file), file === "./google-services.json") });
    assert.equal(present.googleServicesFile, "./google-services.json");
    assert.deepEqual(seen, ["./google-services.json"]);
    assert.equal(pushConfig({ exists: none }).googleServicesFile, null);
  });

  test("extra carries the id, and fcm only when Firebase's file is there", () => {
    const withFile = pushConfig({ env: { TIMELY_EAS_PROJECT_ID: "id" }, exists: (file) => file === "./google-services.json" });
    assert.deepEqual(withFile.extra, { eas: { projectId: "id" }, fcm: true });
    const withoutFile = pushConfig({ env: { TIMELY_EAS_PROJECT_ID: "id" }, exists: none });
    assert.deepEqual(withoutFile.extra, { eas: { projectId: "id" } });
    assert.deepEqual(pushConfig({ exists: () => true }).extra, {});
  });

  test("the repo's app.json has no project id, so a plain build stays on background checks", () => {
    const appJson = JSON.parse(readFileSync(new URL("../apps/mobile/app.json", import.meta.url), "utf8"));
    assert.equal(pushConfig({ env: {}, dotEnv: {}, appJson, exists: none }).projectId, null);
  });
});

describe("pushProjectId", () => {
  test("Android asks for a token only when the build has Firebase's file", () => {
    const withFile = pushConfig({ env: { TIMELY_EAS_PROJECT_ID: "id" }, exists: () => true }).extra;
    const withoutFile = pushConfig({ env: { TIMELY_EAS_PROJECT_ID: "id" }, exists: none }).extra;
    assert.equal(pushProjectId(withFile, "android"), "id");
    // Without FCM the token call can never work: report no push project.
    assert.equal(pushProjectId(withoutFile, "android"), null);
    assert.equal(pushProjectId(withoutFile, "ios"), "id");
  });

  test("no id, or no extra at all, gives null", () => {
    assert.equal(pushProjectId(undefined, "android"), null);
    assert.equal(pushProjectId({ eas: { projectId: "  " }, fcm: true }, "android"), null);
    assert.equal(pushProjectId({ apiUrl: "http://x" }, "ios"), null);
  });
});

describe("stored push registration", () => {
  test("a background run skips polling while a registered token is stored", () => {
    // A background run starts with this run's flag false; only the file says push is on.
    const stored = readPushRecord(pushRecordText({ token: "ExponentPushToken[a]", on: true }));
    assert.deepEqual(stored, { token: "ExponentPushToken[a]", on: true });
    assert.equal(pushDelivers(false, stored), true);
  });

  test("polling resumes once push is marked off, and the token stays for sign-out", () => {
    const off = readPushRecord(pushRecordText({ token: "ExponentPushToken[a]", on: false }));
    assert.equal(off.token, "ExponentPushToken[a]");
    assert.equal(pushDelivers(false, off), false);
    assert.equal(pushDelivers(false, null), false);
    assert.equal(pushDelivers(true, null), true);
  });

  test("an older file with only the token counts as on; junk counts as nothing", () => {
    assert.deepEqual(readPushRecord('{"token":"t"}'), { token: "t", on: true });
    assert.equal(readPushRecord(null), null);
    assert.equal(readPushRecord(""), null);
    assert.equal(readPushRecord("{"), null);
    assert.equal(readPushRecord('{"token":""}'), null);
    assert.equal(readPushRecord('{"on":true}'), null);
  });
});

describe("instantPushLine", () => {
  test("every state has its own plain line", () => {
    assert.equal(instantPushLine("on"), "Bot alerts and reminders arrive in seconds, even when Timely is closed.");
    assert.equal(instantPushLine("unsupported"), "Instant push works in the Android and iOS apps.");
    assert.equal(
      instantPushLine("no_project"),
      "This build has no push service set up, so alerts are checked about every 15 minutes.",
    );
    assert.equal(instantPushLine("no_permission"), "Notifications are off for Timely. Turn them on to get alerts.");
    assert.equal(
      instantPushLine("failed"),
      "Couldn’t reach the push service. Timely checks for alerts about every 15 minutes and tries again next time.",
    );
  });
});
