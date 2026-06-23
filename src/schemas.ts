// Internal zod schema — NOT exported from the package index. Exposing a zod
// schema (or a z.infer/z.input of one) forfeits JSR fast-types. The public type
// is the explicit `ProcRequest` in contract.ts, kept in sync via a compile-time
// drift guard in the contract tests. `localProcExecutor` imports this to parse.
import { z } from "zod";

import type { ProcRequest } from "./contract.ts";

/** Validates a ProcRequest (command + args + cwd/env/stdin/timeout/stdio). */
export const procRequestSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  cwd: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  stdin: z.string().optional(),
  timeoutMs: z.number().int().positive().optional(),
  stdio: z.enum(["pipe", "inherit"]).default("pipe"),
});

// Compile-time drift guard: the explicit public `ProcRequest` (contract.ts) must
// equal this schema's INPUT type. If they diverge, `_drift` fails to type-check.
// Internal (not exported) — no zod type reaches the public API. `void` satisfies
// noUnusedLocals.
type _Eq<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const _drift: _Eq<ProcRequest, z.input<typeof procRequestSchema>> = true;
void _drift;
