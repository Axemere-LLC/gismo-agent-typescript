import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ajv and ajv-formats are CJS packages with no package.json "exports" map, so
// under moduleResolution NodeNext their .d.ts (written with ESM `export
// default` syntax) resolves with implied CommonJS format, and TypeScript's
// default-import interop collapses `default` to the whole module namespace
// instead of the intended export — both `import Ajv from "ajv"` and
// `namespaceImport.default` type as non-constructable/non-callable. Ajv's
// class is also a named export, so import it by name; ajv-formats has no
// named alternative, so load it via `require` (typed against its own default
// export) to sidestep ESM default-import interop entirely. (Same workaround
// as gismo-sdk-typescript/test/mcp.test.ts.)
import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
const require = createRequire(import.meta.url);
const addFormats: typeof import("ajv-formats").default = require("ajv-formats");

/**
 * server.ts's Zod raw shapes give the MCP SDK its own required-field/type
 * checking, but they're a hand-authored mirror of gismo-contracts —nothing
 * stops them drifting from the schemas the SDK generator itself reads. By
 * the time a tool callback runs, the SDK has already parsed args through
 * that Zod shape (dropping any top-level keys it doesn't declare), so this
 * can't reject an extra top-level key the way Python's Pydantic
 * extra='forbid' does. What it does add: every field is re-checked against
 * the actual embedded gismo-contracts/mcp-schema/*.schema.json (not our
 * mirror of it), and nested TankView/BlockhouseView/TerrainView objects are
 * still checked additionalProperties:false — defense-in-depth against the
 * two representations disagreeing, not a full parity claim with Python.
 */
const schemaDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "schemas");

function loadSchema(filename: string): object {
  return JSON.parse(readFileSync(path.join(schemaDir, filename), "utf8"));
}

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);

// Each schema file's own top-level $ref already points at its *Request
// $def (getState.schema.json's is StateView, since get_state's request and
// response share a shape) — no extra wrapping needed.
const getStateSchema = ajv.compile(loadSchema("getState.schema.json"));
const submitOrdersRequestSchema = ajv.compile(loadSchema("submitOrders.schema.json"));
const surrenderRequestSchema = ajv.compile(loadSchema("surrender.schema.json"));

export class ValidationError extends Error {
  constructor(toolName: string, validate: ValidateFunction) {
    const detail = ajv.errorsText(validate.errors, { separator: "; " });
    super(`${toolName}: invalid payload: ${detail}`);
    this.name = "ValidationError";
  }
}

/** Throws ValidationError if value doesn't match get_state's StateView schema. */
export function validateGetState(value: unknown): void {
  if (!getStateSchema(value)) {
    throw new ValidationError("get_state", getStateSchema);
  }
}

/** Throws ValidationError if value doesn't match submit_orders' request schema. */
export function validateSubmitOrdersRequest(value: unknown): void {
  if (!submitOrdersRequestSchema(value)) {
    throw new ValidationError("submit_orders", submitOrdersRequestSchema);
  }
}

/** Throws ValidationError if value doesn't match surrender's request schema. */
export function validateSurrenderRequest(value: unknown): void {
  if (!surrenderRequestSchema(value)) {
    throw new ValidationError("surrender", surrenderRequestSchema);
  }
}
