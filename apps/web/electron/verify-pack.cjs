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
// extra, no absolute symlink; plus every staged folder, so an empty one such
// as app/skills is not lost either. CommonJS and node: builtins only, because
// electron-builder require()s it.
"use strict";

/* eslint-disable @typescript-eslint/no-require-imports -- electron-builder require()s this CommonJS hook */

const { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync } = require("node:fs");
const path = require("node:path");

// app-builder-lib's Arch enum (builder-util): the number afterPack hands over.
const ARCH = { 0: "ia32", 1: "x64", 2: "armv7l", 3: "arm64", 4: "universal" };
// electron-builder's ${os} macro, which names the stage folders (targets.mjs).
const OS = { linux: "linux", darwin: "mac", mas: "mac", win32: "win" };

const webRoot = path.join(__dirname, "..");

/** Regular files [rel, size], symlinks [rel, target] and folders under root, POSIX-relative. */
function listAgentTree(root) {
  const files = [];
  const links = [];
  const dirs = [];
  const visit = (rel) => {
    for (const entry of readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      const full = path.join(root, childRel);
      if (entry.isSymbolicLink()) links.push([childRel, readlinkSync(full)]);
      else if (entry.isDirectory()) {
        dirs.push(childRel);
        visit(childRel);
      } else if (entry.isFile()) files.push([childRel, lstatSync(full).size]);
      else files.push([childRel, -1]);
    }
  };
  visit("");
  return { files, links, dirs };
}

/**
 * Problems with a packed agent folder, empty when it matches. `manifest` is the
 * parsed MANIFEST.json; `stagedDirs` the folders of the staged tree (optional).
 */
function verifyAgentTree(packedDir, manifest, stagedDirs = null) {
  if (!existsSync(packedDir)) return [`the packed app has no agent runtime at ${packedDir}`];
  const packed = listAgentTree(packedDir);
  const problems = [];

  const want = new Map(manifest.files);
  const got = new Map(packed.files.filter(([rel]) => rel !== "MANIFEST.json"));
  for (const [rel, size] of want) {
    if (!got.has(rel)) problems.push(`missing: ${rel}`);
    else if (got.get(rel) !== size) problems.push(`size differs: ${rel} (staged ${size}, packed ${got.get(rel)})`);
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

  if (stagedDirs) {
    const gotDirs = new Set(packed.dirs);
    for (const rel of stagedDirs) if (!gotDirs.has(rel)) problems.push(`missing folder: ${rel}`);
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
  const problems = verifyAgentTree(packedDir, manifest, listAgentTree(stageDir).dirs);
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
