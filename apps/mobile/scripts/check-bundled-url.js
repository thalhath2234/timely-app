require("../app.config.js");
const text = require("fs").readFileSync(require("path").join(__dirname, "..", "lib", "api", "bundledUrl.ts"), "utf8");
console.log("has-https", text.includes("https://"));
console.log("has-emulator", text.includes("10.0.2.2"));
const match = text.match(/BUNDLED_API_URL = "(.*)"/);
console.log("url-length", match ? match[1].length : 0);
