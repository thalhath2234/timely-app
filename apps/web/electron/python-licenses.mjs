// Record the licences of the libraries built into the shipped interpreter
// (make agent-python-licenses; run it when a Hermes sync moves the Python pin
// in apps/agent/hermes/pm/lock.json).
//
// The interpreter is python-build-standalone's `install_only` build, which
// holds only CPython's own LICENSE.txt. OpenSSL, libffi, mpdecimal, expat,
// SQLite, zstd, xz, bzip2, zlib, libedit/ncurses and the rest are linked into
// it, and their texts are only in the matching `full` archive
// (python/licenses/, and PYTHON.json says which module uses which). For each
// desktop target this script downloads that archive, checks it against the
// release's SHA256SUMS (which must also list the lock's install_only sha256,
// so both come from one build), and writes
//
//   apps/agent/packaging/python-licenses/<lock version>/
//     <target>.json      archive, sha256, CPython's SPDX ids, and per licence file
//                        the SPDX ids and the modules that link it
//     texts/LICENSE.*.txt
//
// stage-agent.mjs adds them to THIRD_PARTY_LICENSES and fails when the pinned
// version has no record for the target. The archives (about 110 MB each) go
// to apps/web/.cache/agent/full/ and are deleted once read. Needs tar with
// zstd support (GNU tar + zstd, or bsdtar).
//
//   node electron/python-licenses.mjs [--target <key>,...]

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { fullArchiveName, pythonLicenseRecord } from "./stage-agent-lib.mjs";
import { TARGETS } from "./targets.mjs";

const webRoot = path.join(import.meta.dirname, "..");
const repoRoot = path.join(webRoot, "..", "..");
const lockFile = path.join(repoRoot, "apps", "agent", "hermes", "pm", "lock.json");
export const pythonLicensesRoot = path.join(repoRoot, "apps", "agent", "packaging", "python-licenses");
const cache = path.join(webRoot, ".cache", "agent", "full");

async function fetchTo(url, dest) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`);
  const tmp = `${dest}.part`;
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
  renameSync(tmp, dest);
}

const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

async function main(keys) {
  const python = JSON.parse(readFileSync(lockFile, "utf8")).packages.python;
  const out = path.join(pythonLicensesRoot, python.version);
  mkdirSync(path.join(out, "texts"), { recursive: true });
  mkdirSync(cache, { recursive: true });
  let sums = "";
  for (const key of keys) {
    const artifact = python.artifacts[key];
    if (!artifact) throw new Error(`pm/lock.json has no Python artifact for ${key}`);
    const base = artifact.url.slice(0, artifact.url.lastIndexOf("/") + 1);
    if (!sums) {
      const sumsFile = path.join(cache, "SHA256SUMS");
      await fetchTo(`${base}SHA256SUMS`, sumsFile);
      sums = readFileSync(sumsFile, "utf8");
      rmSync(sumsFile);
    }
    const installOnly = decodeURIComponent(path.posix.basename(new URL(artifact.url).pathname));
    const sumOf = (name) => new RegExp(`^([0-9a-f]{64})\\s+${name.replace(/[.+]/g, "\\$&")}$`, "m").exec(sums)?.[1];
    if (sumOf(installOnly) !== artifact.sha256) {
      throw new Error(`${installOnly}: the release's SHA256SUMS does not list the lock's sha256 ${artifact.sha256}`);
    }
    const name = fullArchiveName(installOnly);
    const want = sumOf(name);
    if (!want) throw new Error(`${name} is not in the release's SHA256SUMS`);
    const archive = path.join(cache, name);
    console.log(`python-licenses ${key}: downloading ${name}`);
    await fetchTo(`${base}${encodeURIComponent(name)}`, archive);
    const scratch = path.join(cache, `x-${key}`);
    try {
      if (sha256(archive) !== want) throw new Error(`${name}: sha256 mismatch against SHA256SUMS`);
      rmSync(scratch, { recursive: true, force: true });
      mkdirSync(scratch);
      const r = spawnSync("tar", ["--zstd", "-xf", archive, "-C", scratch, "python/PYTHON.json", "python/licenses"], { encoding: "utf8" });
      if (r.status !== 0) throw new Error(`tar --zstd -xf ${name} failed (exit ${r.status}): ${r.stderr}`);
      const meta = JSON.parse(readFileSync(path.join(scratch, "python", "PYTHON.json"), "utf8"));
      const licDir = path.join(scratch, "python", "licenses");
      // LF everywhere: the Windows archive's texts differ from the others only in CRLF.
      const texts = Object.fromEntries(readdirSync(licDir).map((f) => [f, readFileSync(path.join(licDir, f), "utf8").replace(/\r\n/g, "\n")]));
      const record = pythonLicenseRecord({ key, archive: name, sha256: want, meta, texts });
      // One texts/ folder for every target; a file whose text differs per target gets the target in its name.
      for (const lib of record.libraries) {
        const text = texts[lib.file];
        let stored = lib.file;
        const existing = path.join(out, "texts", stored);
        if (existsSync(existing) && readFileSync(existing, "utf8") !== text) stored = lib.file.replace(/\.txt$/, `.${key}.txt`);
        writeFileSync(path.join(out, "texts", stored), text);
        lib.file = stored;
      }
      writeFileSync(path.join(out, `${key}.json`), `${JSON.stringify(record, null, 2)}\n`);
      console.log(`python-licenses ${key}: ${record.libraries.length} licence files → ${path.relative(repoRoot, out)}/${key}.json`);
    } finally {
      rmSync(archive, { force: true });
      rmSync(scratch, { recursive: true, force: true });
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf("--target");
  const keys = i >= 0 ? String(argv[i + 1] ?? "").split(",").filter(Boolean) : Object.keys(TARGETS);
  try {
    await main(keys);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
