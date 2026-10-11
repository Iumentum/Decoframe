import test from "node:test";
import assert from "node:assert/strict";

import {
  compileComponent,
  validateComponent,
} from "../dist/index.js";

const vehicleSchema = {
  name: "Vehicle",
  properties: {
    make: {
      type: "string",
      required: true,
    },
    model: {
      type: "string",
      required: true,
    },
    electric: {
      type: "boolean",
      default: false,
    },
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

test("valid component compiles to JSON", () => {
  const result = compileComponent(vehicleSchema, vehicle);

  assert.equal(result.ok, true);

  if (result.ok) {
    assert.deepEqual(JSON.parse(result.json), {
      name: "ElectricVehicle",
      version: "1.0.0",
      schema: "Vehicle",
      properties: {
        make: "Example Motors",
        model: "E1",
        electric: true,
      },
    });
  }
});

test("schema defaults are applied during compilation", () => {
  const component = {
    ...vehicle,
    properties: {
      make: "Example Motors",
      model: "E1",
    },
  };

  const result = compileComponent(vehicleSchema, component);

  assert.equal(result.ok, true);

  if (result.ok) {
    assert.equal(
      JSON.parse(result.json).properties.electric,
      false,
    );
  }
});

test("missing required properties produce diagnostics", () => {
  const component = {
    ...vehicle,
    properties: {
      make: "Example Motors",
    },
  };

  const diagnostics = validateComponent(vehicleSchema, component);

  assert.ok(
    diagnostics.some(
      (diagnostic) =>
        diagnostic.code === "MISSING_REQUIRED_PROPERTY" &&
        diagnostic.path === "properties.model",
    ),
  );
});

test("unknown properties are rejected", () => {
  const component = {
    ...vehicle,
    properties: {
      ...vehicle.properties,
      colour: "blue",
    },
  };

  const result = compileComponent(vehicleSchema, component);

  assert.equal(result.ok, false);

  if (!result.ok) {
    assert.ok(
      result.diagnostics.some(
        (diagnostic) => diagnostic.code === "UNKNOWN_PROPERTY",
      ),
    );
  }
});

test("equivalent inputs produce identical JSON", () => {
  const first = compileComponent(vehicleSchema, vehicle);

  const reorderedVehicle = {
    ...vehicle,
    properties: {
      electric: true,
      model: "E1",
      make: "Example Motors",
    },
  };

  const second = compileComponent(vehicleSchema, reorderedVehicle);

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);

  if (first.ok && second.ok) {
    assert.equal(first.json, second.json);
  }
});

test("child inherits parent properties and applies schema defaults", () => {
  const parent = {
    name: "Vehicle",
    version: "1.0.0",
    schema: "Vehicle",
    properties: {
      make: "Example Motors",
      model: "E1",
    },
  };

  const child = {
    name: "ElectricVehicle",
    version: "1.0.0",
    schema: "Vehicle",
    extends: {
      name: "Vehicle",
      version: "1.0.0",
    },
    properties: {
      electric: true,
    },
  };

  const result = compileComponent(vehicleSchema, child, [parent]);

  assert.equal(result.ok, true);

  if (result.ok) {
    assert.deepEqual(JSON.parse(result.json).properties, {
      electric: true,
      make: "Example Motors",
      model: "E1",
    });
  }
});

test("child overrides inherited properties", () => {
  const parent = {
    name: "Vehicle",
    version: "1.0.0",
    schema: "Vehicle",
    properties: {
      make: "Example Motors",
      model: "E1",
    },
  };

  const child = {
    name: "ElectricVehicle",
    version: "1.0.0",
    schema: "Vehicle",
    extends: {
      name: "Vehicle",
      version: "1.0.0",
    },
    properties: {
      make: "Decoframe Motors",
      model: "E2",
      electric: true,
    },
  };

  const result = compileComponent(vehicleSchema, child, [parent]);

  assert.equal(result.ok, true);

  if (result.ok) {
    assert.deepEqual(JSON.parse(result.json).properties, {
      electric: true,
      make: "Decoframe Motors",
      model: "E2",
    });
  }
});

test("missing parent produces a diagnostic", () => {
  const child = {
    name: "ElectricVehicle",
    version: "1.0.0",
    schema: "Vehicle",
    extends: {
      name: "MissingVehicle",
      version: "1.0.0",
    },
    properties: {},
  };

  const result = compileComponent(vehicleSchema, child);

  assert.equal(result.ok, false);

  if (!result.ok) {
    assert.ok(
      result.diagnostics.some(
        (diagnostic) => diagnostic.code === "PARENT_NOT_FOUND",
      ),
    );
  }
});

test("inheritance cycles produce a diagnostic", () => {
  const first = {
    name: "VehicleA",
    version: "1.0.0",
    schema: "Vehicle",
    extends: {
      name: "VehicleB",
      version: "1.0.0",
    },
    properties: {},
  };

  const second = {
    name: "VehicleB",
    version: "1.0.0",
    schema: "Vehicle",
    extends: {
      name: "VehicleA",
      version: "1.0.0",
    },
    properties: {},
  };

  const result = compileComponent(vehicleSchema, first, [first, second]);

  assert.equal(result.ok, false);

  if (!result.ok) {
    assert.ok(
      result.diagnostics.some(
        (diagnostic) => diagnostic.code === "INHERITANCE_CYCLE",
      ),
    );
  }
});