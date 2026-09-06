const fs = require("fs");
const path = require("path");
const bundle = fs.readFileSync(
  path.join(__dirname, "..", "android", "app", "build", "generated", "assets", "react", "release", "index.android.bundle"),
  "utf8",
);
const generated = fs.readFileSync(path.join(__dirname, "..", "lib", "api", "bundledUrl.ts"), "utf8");
const url = (generated.match(/BUNDLED_API_URL = "(.*)"/) || [])[1] || "";
console.log("generated-https", url.startsWith("https://"));
console.log("generated-emulator", url.includes("10.0.2.2"));
console.log("bundle-has-generated", url.length > 8 && bundle.includes(url));
console.log("bundle-has-emulator-fallback", bundle.includes("10.0.2.2"));
