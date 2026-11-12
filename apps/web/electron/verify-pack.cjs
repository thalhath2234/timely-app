// electron-builder afterPack hook (electron-builder.yml): checks that the
// packed <resources>/agent is exactly the staged agent runtime before any
// installer is written. electron-builder drops some folders of an
// extraResources tree without a word (the root node_modules/ of each one) and
// ships symlinks as they are, so a packed runtime can be short a file or carry
// a build-machine path while every step reports success (docs/desktop/README.md,
// plan 11.4).
//
// The reference is the stage's MANIFEST.json (stage-agent.mjs): the same
// regular files with the same sizes, the same relative symlinks, nothing
// extra, no absolute symlink. One exception: when Windows code signing is
// configured (WIN_CSC_LINK), electron-builder signs every .exe of
// extraResources while copying it, before this hook runs, and the Authenticode
// certificate it appends makes the file bigger. A packed .exe whose size
// differs passes on win32 only when it is the staged file plus a certificate
// table: same bytes before the table, header checksum and certificate entry
// aside (samePeImage). Empty folders are not compared: electron-builder
// drops them on Linux (app/skills, Hermes category folders whose skills were
// all left out), and the runtime does not need them (prepare treats a missing
// app/skills as empty; make smoke-agent on the packed folder shows it).
// CommonJS and node: builtins only, because electron-builder require()s it.
"use strict";

/* eslint-disable @typescript-eslint/no-require-imports -- electron-builder require()s this CommonJS hook */

const { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync } = require("node:fs");
const path = require("node:path");

// app-builder-lib's Arch enum (builder-util): the number afterPack hands over.
const ARCH = { 0: "ia32", 1: "x64", 2: "armv7l", 3: "arm64", 4: "universal" };
// electron-builder's ${os} macro, which names the stage folders (targets.mjs).
const OS = { linux: "linux", darwin: "mac", mas: "mac", win32: "win" };

const webRoot = path.join(__dirname, "..");

/** Regular files [rel, size] and symlinks [rel, target] under root, POSIX-relative. */
function listAgentTree(root) {
  const files = [];
  const links = [];
  const visit = (rel) => {
    for (const entry of readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      const full = path.join(root, childRel);
      if (entry.isSymbolicLink()) links.push([childRel, readlinkSync(full)]);
      else if (entry.isDirectory()) visit(childRel);
      else if (entry.isFile()) files.push([childRel, lstatSync(full).size]);
      else files.push([childRel, -1]);
    }
  };
  visit("");
  return { files, links };
}

/**
 * The bytes of a PE image that Authenticode signing leaves alone: everything
 * before the certificate table (the whole file when unsigned), with the
 * optional header's CheckSum and the certificate table's directory entry
 * zeroed, and whether it has a certificate table. Null when `buf` is not a PE
 * image or its certificate table is not at the end of the file.
 */
function peImageBody(buf) {
  if (buf.length < 0x40 || buf.readUInt16LE(0) !== 0x5a4d) return null; // "MZ"
  const pe = buf.readUInt32LE(0x3c);
  if (pe + 24 > buf.length || buf.readUInt32LE(pe) !== 0x00004550) return null; // "PE\0\0"
  const opt = pe + 24;
  const magic = opt + 2 <= buf.length ? buf.readUInt16LE(opt) : 0;
  const dirs = magic === 0x10b ? opt + 96 : magic === 0x20b ? opt + 112 : -1; // PE32 / PE32+
  const numberOfDirs = magic === 0x10b ? opt + 92 : opt + 108;
  if (dirs < 0 || dirs + 5 * 8 > buf.length || buf.readUInt32LE(numberOfDirs) < 5) return null;
  const security = dirs + 4 * 8; // IMAGE_DIRECTORY_ENTRY_SECURITY: a file offset, not an RVA
  const certOffset = buf.readUInt32LE(security);
  const certSize = buf.readUInt32LE(security + 4);
  let end = buf.length;
  if (certSize !== 0) {
    // signtool and osslsigncode pad the image to 8 bytes and put the table last.
    if (certOffset > buf.length || certOffset + certSize > buf.length || buf.length - (certOffset + certSize) >= 8) return null;
    end = certOffset;
  }
  const body = Buffer.from(buf.subarray(0, end));
  body.fill(0, opt + 64, opt + 68); // CheckSum
  body.fill(0, security, security + 8);
  return { body, signed: certSize !== 0 };
}

/**
 * True when `packed` is `staged` signed (or re-signed) by Authenticode: both
 * are PE images, `packed` has a certificate table, and their bodies match up
 * to the zero padding signing adds before the table.
 */
function samePeImage(staged, packed) {
  const a = peImageBody(staged)?.body;
  const signed = peImageBody(packed);
  // Not signed: a size change is real.
  if (!a || !signed?.signed) return false;
  const b = signed.body;
  if (b.length < a.length || b.length - a.length >= 8) return false;
  if (!b.subarray(a.length).every((byte) => byte === 0)) return false;
  return a.equals(b.subarray(0, a.length));
}

/**
 * Problems with a packed agent folder, empty when it matches. `manifest` is the
 * parsed MANIFEST.json. On win32 (`platform`), a .exe whose size differs is
 * compared with its staged copy under `stagedDir` by samePeImage, because
 * electron-builder signs extraResources executables before afterPack.
 */
function verifyAgentTree(packedDir, manifest, { platform, stagedDir } = {}) {
  if (!existsSync(packedDir)) return [`the packed app has no agent runtime at ${packedDir}`];
  const packed = listAgentTree(packedDir);
  const problems = [];

  const signedCopy = (rel) => {
    if (platform !== "win32" || !stagedDir || !rel.toLowerCase().endsWith(".exe")) return false;
    const staged = path.join(stagedDir, ...rel.split("/"));
    if (!existsSync(staged)) return false;
    return samePeImage(readFileSync(staged), readFileSync(path.join(packedDir, ...rel.split("/"))));
  };
  const want = new Map(manifest.files);
  const got = new Map(packed.files.filter(([rel]) => rel !== "MANIFEST.json"));
  for (const [rel, size] of want) {
    if (!got.has(rel)) problems.push(`missing: ${rel}`);
    else if (got.get(rel) !== size && !signedCopy(rel)) problems.push(`size differs: ${rel} (staged ${size}, packed ${got.get(rel)})`);
  }
  for (const rel of got.keys()) if (!want.has(rel)) problems.push(`not in the stage: ${rel}`);

  const wantLinks = new Map(manifest.links);
  const gotLinks = new Map(packed.links);
  for (const [rel, target] of gotLinks) {
    if (path.isAbsolute(target) || path.win32.isAbsolute(target)) problems.push(`absolute symlink: ${rel} -> ${target}`);
    if (!wantLinks.has(rel)) problems.push(`symlink not in the stage: ${rel} -> ${target}`);
    else if (wantLinks.get(rel) !== target) problems.push(`symlink differs: ${rel} -> ${target} (staged -> ${wantLinks.get(rel)})`);
  }
  for (const [rel, target] of wantLinks) {
    // A packer that dereferences a relative link ships a file instead; the
    // interpreter still runs, but it is not the staged tree.
    if (!gotLinks.has(rel)) problems.push(`missing symlink: ${rel} -> ${target}`);
  }

  if (!existsSync(path.join(packedDir, "MANIFEST.json"))) problems.push("missing: MANIFEST.json");
  return problems;
}

/** <resources> of the packed app for this platform. */
function resourcesDir(context) {
  if (typeof context.packager?.getResourcesDir === "function") return context.packager.getResourcesDir(context.appOutDir);
  if (context.electronPlatformName === "darwin" || context.electronPlatformName === "mas") {
    return path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, "Contents", "Resources");
  }
  return path.join(context.appOutDir, "resources");
}

async function afterPack(context) {
  const os = OS[context.electronPlatformName] ?? context.electronPlatformName;
  const arch = ARCH[context.arch] ?? String(context.arch);
  const stageDir = path.join(webRoot, ".electron-agent", `${os}-${arch}`);
  const manifestFile = path.join(stageDir, "MANIFEST.json");
  if (!existsSync(manifestFile)) {
    // Every installer ships the agent runtime (owner answer Q-11.1).
    throw new Error(`verify-pack: no staged agent runtime for ${os}-${arch} (${manifestFile}); run make stage-agent on a ${os}-${arch} host`);
  }
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
  const packedDir = path.join(resourcesDir(context), "agent");
  const problems = verifyAgentTree(packedDir, manifest, { platform: context.electronPlatformName, stagedDir: stageDir });
  if (problems.length) {
    throw new Error(
      `verify-pack: ${packedDir} does not match the staged runtime (${problems.length} problems):\n  ${problems.slice(0, 40).join("\n  ")}`,
    );
  }
  console.log(`  • verify-pack: agent runtime for ${os}-${arch} matches MANIFEST.json (${manifest.totals.files} files, ${manifest.links.length} links)`);
}

module.exports = afterPack;
module.exports.default = afterPack;
module.exports.verifyAgentTree = verifyAgentTree;
module.exports.listAgentTree = listAgentTree;
module.exports.samePeImage = samePeImage;
