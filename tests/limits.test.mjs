import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";

import {
  compileComponentInternal,
  DEFAULT_LIMITS,
  resolveLimits,
} from "../dist/internal.js";

const vehicleSchema = {
  name: "Vehicle",
  properties: {
    make: { type: "string", required: true },
    model: { type: "string", required: true },
    electric: { type: "boolean", default: false },
  },
};

const vehicle = {
  name: "ElectricVehicle",
  version: "1.0.0",
  schema: "Vehicle",
  properties: {
    make: "Example Motors",
    model: "E1",
    electric: true,
  },
};

function compile(limits) {
  return compileComponentInternal({
    schema: vehicleSchema,
    component: vehicle,
    limits,
  });
}

test("internal entry point is emitted by the build", () => {
  assert.equal(
    existsSync(new URL("../dist/internal.js", import.meta.url)),
    true,
  );
});

test("default limits have the agreed values and are frozen", () => {
  assert.deepEqual(DEFAULT_LIMITS, {
    maxSnapshotNodes: 1_000_000,
    maxSnapshotDepth: 100,
    maxWork: 1_000_000,
    maxDepth: 100,
    maxInterpolatedChars: 10_000_000,
    maxOutputChars: 10_000_000,
  });
  assert.equal(Object.isFrozen(DEFAULT_LIMITS), true);
});

test("resolveLimits applies overrides without mutating defaults", () => {
  const limits = resolveLimits({
    maxWork: 500,
    maxOutputChars: 250,
    maxSnapshotNodes: undefined,
  });

  assert.equal(limits.maxWork, 500);
  assert.equal(limits.maxOutputChars, 250);
  assert.equal(limits.maxSnapshotNodes, DEFAULT_LIMITS.maxSnapshotNodes);
  assert.equal(limits.maxSnapshotDepth, DEFAULT_LIMITS.maxSnapshotDepth);
  assert.equal(Object.isFrozen(limits), true);
  assert.equal(DEFAULT_LIMITS.maxWork, 1_000_000);
  assert.equal(DEFAULT_LIMITS.maxOutputChars, 10_000_000);
});

test("resolveLimits rejects non-object overrides", () => {
  for (const value of [null, 1, "limits", [], true]) {
    assert.throws(
      () => resolveLimits(value),
      TypeError,
    );
  }
});

test("resolveLimits rejects unknown fields", () => {
  assert.throws(
    () => resolveLimits({ maxWork: 10, unknownLimit: 20 }),
    /Unknown limits field "unknownLimit"/,
  );
});

test("resolveLimits rejects invalid numeric values", () => {
  for (const value of [
    0,
    -1,
    1.5,
    NaN,
    Infinity,
    "10",
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    assert.throws(
      () => resolveLimits({ maxWork: value }),
      /limits\.maxWork must be a positive safe integer/,
    );

    assert.throws(
      () => resolveLimits({ maxOutputChars: value }),
      /limits\.maxOutputChars must be a positive safe integer/,
    );
  }
});

test("output character limit rejects repeated strings before serialization", () => {
  const text = "x".repeat(10_000);
  const count = 100;

  const schema = {
    name: "RepeatedStrings",
    properties: Object.fromEntries(
      Array.from({ length: count }, (_, index) => [
        `text${index}`,
        { type: "string" },
      ]),
    ),
  };

  const component = {
    name: "RepeatedStringsComponent",
    version: "1.0.0",
    schema: "RepeatedStrings",
    properties: Object.fromEntries(
      Array.from({ length: count }, (_, index) => [
        `text${index}`,
        text,
      ]),
    ),
  };

  const result = compileComponentInternal({
    schema,
    component,
    limits: { maxOutputChars: 100_000 },
  });

  assert.equal(result.ok, false);
  assert.ok(
    result.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === "RESOURCE_LIMIT_EXCEEDED" &&
        diagnostic.message.includes("maxOutputChars"),
    ),
  );
});

test("repeated 100 KB strings compile within the default output limit", () => {
  const text = "x".repeat(100_000);
  const count = 10;

  const schema = {
    name: "RepeatedStrings",
    properties: Object.fromEntries(
      Array.from({ length: count }, (_, index) => [
        `text${index}`,
        { type: "string" },
      ]),
    ),
  };

  const component = {
    name: "RepeatedStringsComponent",
    version: "1.0.0",
    schema: "RepeatedStrings",
    properties: Object.fromEntries(
      Array.from({ length: count }, (_, index) => [
        `text${index}`,
        text,
      ]),
    ),
  };

  const result = compileComponentInternal({
    schema,
    component,
  });

  assert.equal(result.ok, true);
});

test("snapshot node limit produces a diagnostic", () => {
  const result = compile({ maxSnapshotNodes: 1 });

  assert.equal(result.ok, false);
  assert.ok(
    result.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === "RESOURCE_LIMIT_EXCEEDED" &&
        diagnostic.message.includes("Maximum JSON node budget of 1 exceeded"),
    ),
  );
});

test("snapshot node limit rejects wide objects", () => {
  const wideComponent = {
    ...vehicle,
    properties: Object.fromEntries(
      Array.from({ length: 20 }, (_, index) => [
        `property${index}`,
        index,
      ]),
    ),
  };

  const result = compileComponentInternal({
    schema: vehicleSchema,
    component: wideComponent,
    limits: { maxSnapshotNodes: 5 },
  });

  assert.equal(result.ok, false);
  assert.ok(
    result.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === "RESOURCE_LIMIT_EXCEEDED" &&
        diagnostic.message.includes("Maximum JSON node budget of 5 exceeded"),
    ),
  );
});

test("snapshot depth limit produces a diagnostic", () => {
  const result = compile({ maxSnapshotDepth: 1 });

  assert.equal(result.ok, false);
  assert.ok(
    result.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === "RESOURCE_LIMIT_EXCEEDED" &&
        diagnostic.message.includes("Maximum JSON nesting depth of 1 exceeded"),
    ),
  );
});

test("exhausting one call does not affect a later call", () => {
  const limited = compile({ maxSnapshotNodes: 1 });
  assert.equal(limited.ok, false);

  const normal = compile();
  assert.equal(normal.ok, true);
});

test("nested component depth limit produces RESOURCE_LIMIT_EXCEEDED", () => {
  const childSchema = {
    name: "ChildSchema",
    properties: {
      child: {
        type: "component",
        schema: "ChildSchema",
      },
    },
  };

  const child = {
    name: "Child",
    version: "1.0.0",
    schema: "ChildSchema",
    properties: {
      child: {
        name: "Grandchild",
        version: "1.0.0",
        schema: "ChildSchema",
        properties: {},
      },
    },
  };

  const rootSchema = {
    name: "RootSchema",
    properties: {
      child: {
        type: "component",
        schema: "ChildSchema",
        required: true,
      },
    },
  };

  const root = {
    name: "Root",
    version: "1.0.0",
    schema: "RootSchema",
    properties: {
      child,
    },
  };

  const result = compileComponentInternal({
    schema: rootSchema,
    component: root,
    registry: [
      child,
      {
        name: "Grandchild",
        version: "1.0.0",
        schema: "ChildSchema",
        properties: {},
      },
    ],
    schemas: [childSchema],
    limits: { maxDepth: 1 },
  });

  assert.equal(result.ok, false);
  assert.ok(
    result.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === "RESOURCE_LIMIT_EXCEEDED" &&
        diagnostic.message.includes("maxDepth of 1"),
    ),
    JSON.stringify(result.diagnostics, null, 2),
  );
});
