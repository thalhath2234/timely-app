// Supported desktop targets and the sidecar artefacts each one needs.
//
// Keys are `${process.platform}-${process.arch}` of the machine the build runs
// on. `stageDir` is the directory name under .electron-api/ and
// .electron-postgres/ and matches electron-builder's `${os}-${arch}` macros so
// electron-builder.yml can stay static (see extraResources there).

export const POSTGRES_VERSION = "17.11.0";

const ZONKY_BASE = "https://repo1.maven.org/maven2/io/zonky/test/postgres";

export const TARGETS = {
  "linux-x64": {
    goos: "linux",
    goarch: "amd64",
    electronOs: "linux",
    electronArch: "x64",
    zonkyClassifier: "linux-amd64",
    zonkyArchiveName: "postgres-linux-x86_64.txz",
    zonkySha256: "0dd7b72b6f335b8ecfb355fa24c5781e8a93edd09880bb77eb52ebbf29b3e96d",
  },
  "linux-arm64": {
    goos: "linux",
    goarch: "arm64",
    electronOs: "linux",
    electronArch: "arm64",
    zonkyClassifier: "linux-arm64v8",
    zonkyArchiveName: "postgres-linux-arm_64.txz",
    zonkySha256: "8b042e0ea418b1927d95399207950da0734d27fe01e29503ade3bdc464ad4c2b",
  },
  "darwin-x64": {
    goos: "darwin",
    goarch: "amd64",
    electronOs: "mac",
    electronArch: "x64",
    zonkyClassifier: "darwin-amd64",
    zonkyArchiveName: "postgres-darwin-x86_64.txz",
    zonkySha256: "d464ff178e9860ba204662ac23fa547504b7fd392392ff2fb92e3fd73b5bdb64",
  },
  "darwin-arm64": {
    goos: "darwin",
    goarch: "arm64",
    electronOs: "mac",
    electronArch: "arm64",
    zonkyClassifier: "darwin-arm64v8",
    zonkyArchiveName: "postgres-darwin-arm_64.txz",
    zonkySha256: "a1c2786acb0c398f9b2d76806fc52f5dc8b222cbc8e9383a9b9702084daaf3a5",
  },
  "win32-x64": {
    goos: "windows",
    goarch: "amd64",
    electronOs: "win",
    electronArch: "x64",
    zonkyClassifier: "windows-amd64",
    zonkyArchiveName: "postgres-windows-x86_64.txz",
    zonkySha256: "98040fae18dd9633ff95932125b0cecf0a45a1a9312e216e2a33ad03a31d4251",
  },
};

export function hostTargetKey() {
  return `${process.platform}-${process.arch}`;
}

/** Resolve one target key into a full descriptor. Throws on unknown keys. */
export function getTarget(key) {
  const spec = TARGETS[key];
  if (!spec) {
    throw new Error(
      `Unsupported target "${key}". Known targets: ${Object.keys(TARGETS).join(", ")}`,
    );
  }
  return {
    key,
    ...spec,
    stageDir: `${spec.electronOs}-${spec.electronArch}`,
    exe: spec.goos === "windows" ? ".exe" : "",
    zonkyJarName: `embedded-postgres-binaries-${spec.zonkyClassifier}-${POSTGRES_VERSION}.jar`,
    zonkyUrl: `${ZONKY_BASE}/embedded-postgres-binaries-${spec.zonkyClassifier}/${POSTGRES_VERSION}/embedded-postgres-binaries-${spec.zonkyClassifier}-${POSTGRES_VERSION}.jar`,
  };
}

/**
 * Targets to stage: `TIMELY_TARGETS` (comma separated keys) or the host.
 * Accepts an explicit list to bypass the environment.
 */
export function resolveTargets(keys) {
  const raw = keys ?? process.env.TIMELY_TARGETS ?? hostTargetKey();
  const list = (Array.isArray(raw) ? raw : raw.split(","))
    .map((k) => k.trim())
    .filter(Boolean);
  if (list.length === 0) list.push(hostTargetKey());
  return [...new Set(list)].map(getTarget);
}

/**
 * electron-builder CLI flags for a set of targets. All targets must share one
 * OS because electron-builder expands `${os}` once per platform build.
 */
export function electronBuilderFlags(targets) {
  const oses = new Set(targets.map((t) => t.electronOs));
  if (oses.size !== 1) {
    throw new Error(
      `electron-builder flags need a single OS per run; got ${[...oses].join(", ")}`,
    );
  }
  const [os] = oses;
  const flags = [`--${os}`];
  for (const arch of new Set(targets.map((t) => t.electronArch))) {
    flags.push(`--${arch}`);
  }
  return flags;
}
