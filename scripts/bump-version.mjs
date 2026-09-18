// bump-version.mjs <x.y.z> — set the version in the root package.json, every workspace package.json, and the matching
// package-lock.json entries (root "" + each workspace path). Offline and exact, so `npm ci` stays satisfied.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

const v = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(v ?? "")) {
  process.stderr.write("usage: bump-version.mjs x.y.z\n");
  process.exit(1);
}
const read = (f) => JSON.parse(readFileSync(f, "utf8"));
const write = (f, j) => writeFileSync(f, JSON.stringify(j, null, 2) + "\n");
const root = read("package.json");
const dirs = [""]
  .concat((root.workspaces ?? []).flatMap((g) => (g.endsWith("/*") ? readdirSync(g.slice(0, -2)).map((d) => join(g.slice(0, -2), d)) : [g])))
  .filter((d) => existsSync(join(d, "package.json")));
const log = [];
// workspace package names — dependencies on them pinned to an exact version must follow the bump, or npm ci goes to the registry
const names = new Set(dirs.map((d) => read(join(d, "package.json")).name).filter(Boolean));
const retarget = (deps) => {
  for (const [k, spec] of Object.entries(deps ?? {})) if (names.has(k) && /^\d+\.\d+\.\d+$/.test(spec)) deps[k] = v;
};
for (const d of dirs) {
  const f = join(d, "package.json");
  const j = read(f);
  j.version = v;
  for (const k of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) retarget(j[k]);
  write(f, j);
  log.push(`  ${f} -> ${v}`);
}
if (existsSync("package-lock.json")) {
  const l = read("package-lock.json");
  l.version = v;
  for (const d of dirs) {
    const e = l.packages?.[d];
    if (!e) continue;
    e.version = v;
    for (const k of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) retarget(e[k]);
  }
  write("package-lock.json", l);
  log.push(`  package-lock.json -> ${v} (${dirs.length} entries)`);
}
process.stdout.write(log.join("\n") + "\n");
