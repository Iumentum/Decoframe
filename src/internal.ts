/**
 * Internal compiler entry point for framework tests and development.
 * Not part of the public API.
 */
export {
  compileComponentInternal,
  DEFAULT_LIMITS,
  resolveLimits,
} from "./core.js";

export type {
  CompileComponentInternalOptions,
  Limits,
} from "./core.js";
