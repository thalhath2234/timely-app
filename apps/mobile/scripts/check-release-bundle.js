#!/usr/bin/env node
// Sanity check for a release build (run by scripts/build-apk.sh after Gradle):
// the phone pairs with a server at runtime, so the JS bundle must register
// the /connect route and must not carry any development API address.
//
// The bundle is Hermes bytecode; its string table is ASCII-searchable, which
// is enough for both checks.
const fs = require("fs");
const path = require("path");

const bundlePath =
  process.argv[2] ||
  path.join(__dirname, "..", "android", "app", "build", "generated", "assets", "react", "release", "index.android.bundle");

if (!fs.existsSync(bundlePath)) {
  console.error(`release bundle not found: ${bundlePath}`);
  process.exit(1);
}

const bundle = fs.readFileSync(bundlePath, "latin1");

// Route modules are referenced by file name (e.g. "login.tsx") in the bundle.
const required = [{ label: "connect route", test: (s) => s.includes("connect.tsx") }];

const forbidden = [
  { label: "ngrok URL", test: (s) => /ngrok(?:-free)?\.(?:app|io|dev)/.test(s) },
  { label: "Android emulator loopback (10.0.2.2)", test: (s) => s.includes("10.0.2.2") },
  { label: "http://localhost:8080", test: (s) => s.includes("http://localhost:8080") },
  { label: "http://127.0.0.1:8080", test: (s) => s.includes("http://127.0.0.1:8080") },
];

let failed = false;
for (const check of required) {
  const ok = check.test(bundle);
  console.log(`${ok ? "ok  " : "FAIL"} has ${check.label}`);
  if (!ok) failed = true;
}
for (const check of forbidden) {
  const hit = check.test(bundle);
  console.log(`${hit ? "FAIL" : "ok  "} no ${check.label}`);
  if (hit) failed = true;
}

if (failed) {
  console.error("Release bundle check failed; refusing to accept this APK.");
  process.exit(1);
}
console.log(`release bundle ok: ${bundlePath}`);
