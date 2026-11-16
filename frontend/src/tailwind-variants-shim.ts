// Robust shim so downstream libs (e.g., rizzui) always get a working cnBase + default tv fn.
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const pkgPath = require.resolve("tailwind-variants/package.json");
const real = require(path.join(path.dirname(pkgPath), "dist", "index.js"));

const fallbackCnBase = (...classes: unknown[]) =>
  classes
    .flat()
    .map((c) => (typeof c === "string" ? c : ""))
    .filter(Boolean)
    .join(" ");

const tvFn = (real as any)?.default ?? (real as any)?.tv ?? (real as any);
const cnBase = (real as any)?.cnBase ?? fallbackCnBase;
const cn = (real as any)?.cn ?? ((...args: unknown[]) => cnBase(...args));

(tvFn as any).cnBase = cnBase;
(tvFn as any).cn = cn;

export { tvFn as tv, cnBase, cn };
export default tvFn;
