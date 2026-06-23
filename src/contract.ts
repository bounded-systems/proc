// The proc contract — a serializable, executor-agnostic description of a
// subprocess to run, plus the executor port that fulfills it.
//
// Designed "as if remote": a ProcRequest carries everything needed to run the
// process (command, args, cwd, explicit env, serializable stdin, timeout) with
// no local-only handles, and a ProcResult is a plain serializable value. So the
// same request can be fulfilled by the local executor today or a remote one
// later — the call site never assumes where the process runs. procRequestSchema
// is the validatable boundary (the "spec"); exec is async because crossing a
// machine boundary always is.
//
// `stdio: "inherit"` is the one non-remote-able mode (it wires the caller's
// terminal — tmux attach, an interactive shell). The local executor honors it;
// a remote executor would reject it or PTY-forward.
import { spawn } from "node:child_process";

import { processEnv } from "@bounded-systems/env";

import { streamCapture } from "./capture.ts";
import { procRequestSchema } from "./schemas.ts";

/**
 * A subprocess request: the command to run and how. Explicit type (the input
 * shape of the internal `procRequestSchema`) so no zod type reaches the public
 * API — a contract test drift-guards it against the schema.
 */
export type ProcRequest = {
  /** The program to run (non-empty). */
  command: string;
  /** Positional arguments (default: none). */
  args?: string[] | undefined;
  /** Working directory for the child. */
  cwd?: string | undefined;
  /** Environment for the child (defaults to the sanctioned ambient env). */
  env?: Record<string, string> | undefined;
  /** Serializable stdin written to the child, then closed. */
  stdin?: string | undefined;
  /** Wall-clock budget in ms; on expiry the child is killed. */
  timeoutMs?: number | undefined;
  /** `"pipe"` (default) captures stdout/stderr; `"inherit"` wires them to this terminal. */
  stdio?: ("pipe" | "inherit") | undefined;
};

/** The outcome of a subprocess: exit status, captured streams, and terminating signal. */
export interface ProcResult {
  /** Exit code (or a signal-derived status when killed). */
  readonly status: number;
  /** Captured standard output. */
  readonly stdout: string;
  /** Captured standard error. */
  readonly stderr: string;
  /** The signal that terminated the process, or `null`. */
  readonly signal: string | null;
}

/**
 * The executor port. A local implementation spawns here; a remote one would
 * ship the request over a wire and run it elsewhere — the contract is identical.
 */
export interface ProcExecutor {
  /** Run `req` and resolve its {@link ProcResult}. */
  exec(req: ProcRequest): Promise<ProcResult>;
}

function statusOf(status: number | null, signal: string | null): number {
  if (status !== null) return status;
  return signal ? 1 : 0;
}

/** The local executor: fulfills the contract by spawning on this machine. */
export function localProcExecutor(): ProcExecutor {
  return {
    async exec(request: ProcRequest): Promise<ProcResult> {
      const req = procRequestSchema.parse(request);
      const env = req.env ?? (processEnv() as Record<string, string>);

      if (req.stdio === "inherit") {
        // Terminal-attached: wire the caller's stdio straight through. Local
        // only — a remote executor can't fulfill this without PTY forwarding.
        return await new Promise<ProcResult>((resolve) => {
          const child = spawn(req.command, [...req.args], {
            cwd: req.cwd,
            env,
            stdio: "inherit",
            ...(req.timeoutMs ? { timeout: req.timeoutMs } : {}),
          });
          child.on("error", () => resolve({ status: 1, stdout: "", stderr: "", signal: null }));
          child.on("close", (status, signal) =>
            resolve({
              status: statusOf(status, signal),
              stdout: "",
              stderr: "",
              signal: signal ?? null,
            }),
          );
        });
      }

      const captured = await streamCapture([req.command, ...req.args], {
        cwd: req.cwd,
        env,
        ...(req.stdin !== undefined ? { stdin: req.stdin } : {}),
        ...(req.timeoutMs ? { timeout: req.timeoutMs } : {}),
      });
      return {
        status: statusOf(captured.status, captured.signal),
        stdout: captured.stdout,
        stderr: captured.stderr,
        signal: captured.signal,
      };
    },
  };
}
