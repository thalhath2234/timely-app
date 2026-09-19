const fs = require("fs");
const path = require("path");
const bundle = fs.readFileSync(
  path.join(__dirname, "..", "android", "app", "build", "generated", "assets", "react", "release", "index.android.bundle"),
  "utf8",
);
const generated = fs.readFileSync(path.join(__dirname, "..", "lib", "api", "bundledUrl.ts"), "utf8");
const url = (generated.match(/BUNDLED_API_URL = "(.*)"/) || [])[1] || "";
const validUrl = /^https?:\/\/[^/\s]+/.test(url);
const bundleHasUrl = validUrl && bundle.includes(url);

console.log("generated-url-valid", validUrl);
console.log("bundle-has-generated-url", bundleHasUrl);

if (!validUrl || !bundleHasUrl) {
  console.error("Release bundle is missing its configured API URL; refusing to accept this APK.");
  process.exitCode = 1;
}
