import { test } from "bun:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { DEFAULT_AMBIENT_RULES, assertSeam } from "@bounded-systems/seam-check";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// @bounded-systems/proc is the ONE sanctioned spawn point. It may touch
// node:child_process (the primitive it wraps) + node:os/fs/path, and reaches the
// ambient environment only through @bounded-systems/env — never process.env
// directly. Because proc legitimately spawns, the spawn ambient rules don't
// apply here; we keep only the env rule, enforcing "no direct process.env".
test("@bounded-systems/proc upholds its seam claim", () => {
  assertSeam({
    root: SRC,
    prod: [
      "node:child_process",
      "node:os",
      "node:fs",
      "node:path",
      "@bounded-systems/env",
      "zod",
      "@bounded-systems/policy",
    ],
    test: ["@bounded-systems/proc", "@bounded-systems/seam-check"],
    forbidAmbient: DEFAULT_AMBIENT_RULES.filter(([, label]) => label === "ambient env / auth"),
  });
});
