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

const engineSchema = {
  name: "Engine",
  properties: {
    fuel: {
      type: "string",
      required: true,
    },
    horsepower: {
      type: "number",
      required: true,
    },
    turbocharged: {
      type: "boolean",
      default: false,
    },
  },
};

const vehicleWithEngineSchema = {
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
    engine: {
      type: "component",
      schema: "Engine",
      required: true,
    },
  },
};

const petrolEngine = {
  name: "PetrolEngine",
  version: "1.0.0",
  schema: "Engine",
  properties: {
    fuel: "petrol",
    horsepower: 150,
  },
};

const familyCar = {
  name: "FamilyCar",
  version: "1.0.0",
  schema: "Vehicle",
  properties: {
    make: "Example Motors",
    model: "E1",
    engine: {
      name: "PetrolEngine",
      version: "1.0.0",
      properties: {
        horsepower: 180,
      },
    },
  },
};

test("nested component references compile recursively with overrides", () => {
  const result = compileComponent(
    vehicleWithEngineSchema,
    familyCar,
    [petrolEngine],
    [vehicleSchema, engineSchema],
  );

  assert.equal(result.ok, true);

  if (result.ok) {
    const output = JSON.parse(result.json);

    assert.deepEqual(output.properties.engine, {
      name: "PetrolEngine",
      version: "1.0.0",
      schema: "Engine",
      properties: {
        fuel: "petrol",
        horsepower: 180,
        turbocharged: false,
      },
    });
  }
});

test("missing nested component definitions produce a diagnostic", () => {
  const result = compileComponent(
    vehicleWithEngineSchema,
    familyCar,
    [],
    [vehicleSchema, engineSchema],
  );

  assert.equal(result.ok, false);

  if (!result.ok) {
    assert.ok(
      result.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === "COMPONENT_NOT_FOUND",
      ),
    );
  }
});

test("nested component schema mismatches produce a diagnostic", () => {
  const invalidEngine = {
    ...petrolEngine,
    schema: "Vehicle",
  };

  const result = compileComponent(
    vehicleWithEngineSchema,
    familyCar,
    [invalidEngine],
    [vehicleSchema, engineSchema],
  );

  assert.equal(result.ok, false);

  if (!result.ok) {
    assert.ok(
      result.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === "COMPONENT_SCHEMA_MISMATCH",
      ),
    );
  }
});

test("nested components can contain further nested components", () => {
  const transmissionSchema = {
    name: "Transmission",
    properties: {
      gears: {
        type: "number",
        required: true,
      },
    },
  };

  const engineWithTransmissionSchema = {
    name: "Engine",
    properties: {
      fuel: {
        type: "string",
        required: true,
      },
      horsepower: {
        type: "number",
        required: true,
      },
      transmission: {
        type: "component",
        schema: "Transmission",
        required: true,
      },
    },
  };

  const transmission = {
    name: "SixSpeed",
    version: "1.0.0",
    schema: "Transmission",
    properties: {
      gears: 6,
    },
  };

  const engine = {
    name: "PetrolEngineWithTransmission",
    version: "1.0.0",
    schema: "Engine",
    properties: {
      fuel: "petrol",
      horsepower: 150,
      transmission: {
        name: "SixSpeed",
        version: "1.0.0",
        properties: {},
      },
    },
  };

  const result = compileComponent(
    engineWithTransmissionSchema,
    engine,
    [transmission],
    [engineWithTransmissionSchema, transmissionSchema],
  );

  assert.equal(result.ok, true);

  if (result.ok) {
    assert.deepEqual(
      JSON.parse(result.json).properties.transmission,
      {
        name: "SixSpeed",
        version: "1.0.0",
        schema: "Transmission",
        properties: {
          gears: 6,
        },
      },
    );
  }
});

test("primitive arrays compile and preserve item order", () => {
  const schema = {
    name: "TaggedItem",
    properties: {
      tags: {
        type: "array",
        items: { type: "string" },
        required: true,
      },
    },
  };

  const component = {
    name: "ExampleItem",
    version: "1.0.0",
    schema: "TaggedItem",
    properties: {
      tags: ["first", "second", "third"],
    },
  };

  const result = compileComponent(schema, component);

  assert.equal(result.ok, true);

  if (result.ok) {
    assert.deepEqual(
      JSON.parse(result.json).properties.tags,
      ["first", "second", "third"],
    );
  }
});

test("arrays of component references compile recursively", () => {
  const schema = {
    name: "EngineCollection",
    properties: {
      engines: {
        type: "array",
        items: {
          type: "component",
          schema: "Engine",
        },
        required: true,
      },
    },
  };

  const component = {
    name: "Fleet",
    version: "1.0.0",
    schema: "EngineCollection",
    properties: {
      engines: [
        {
          name: "PetrolEngine",
          version: "1.0.0",
          properties: { horsepower: 180 },
        },
        {
          name: "PetrolEngine",
          version: "1.0.0",
          properties: { horsepower: 200 },
        },
      ],
    },
  };

  const result = compileComponent(
    schema,
    component,
    [petrolEngine],
    [schema, engineSchema],
  );

  assert.equal(result.ok, true);

  if (result.ok) {
    const engines = JSON.parse(result.json).properties.engines;

    assert.equal(engines.length, 2);
    assert.equal(engines[0].properties.horsepower, 180);
    assert.equal(engines[1].properties.horsepower, 200);
    assert.equal(engines[0].properties.fuel, "petrol");
    assert.equal(engines[1].properties.turbocharged, false);
  }
});

test("invalid primitive array items produce indexed diagnostics", () => {
  const schema = {
    name: "TaggedItem",
    properties: {
      tags: {
        type: "array",
        items: { type: "string" },
        required: true,
      },
    },
  };

  const component = {
    name: "ExampleItem",
    version: "1.0.0",
    schema: "TaggedItem",
    properties: {
      tags: ["valid", 42, "also-valid"],
    },
  };

  const result = compileComponent(schema, component);

  assert.equal(result.ok, false);

  if (!result.ok) {
    assert.ok(
      result.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === "INVALID_ARRAY_ITEM" &&
          diagnostic.path === "properties.tags[1]",
      ),
    );
  }
});

test("missing component references in arrays produce indexed diagnostics", () => {
  const schema = {
    name: "EngineCollection",
    properties: {
      engines: {
        type: "array",
        items: {
          type: "component",
          schema: "Engine",
        },
        required: true,
      },
    },
  };

  const component = {
    name: "Fleet",
    version: "1.0.0",
    schema: "EngineCollection",
    properties: {
      engines: [
        {
          name: "MissingEngine",
          version: "1.0.0",
          properties: {},
        },
      ],
    },
  };

  const result = compileComponent(
    schema,
    component,
    [],
    [schema, engineSchema],
  );

  assert.equal(result.ok, false);

  if (!result.ok) {
    assert.ok(
      result.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === "COMPONENT_NOT_FOUND" &&
          diagnostic.path === "properties.engines[0]",
      ),
    );
  }
});

test("array defaults are applied during compilation", () => {
  const schema = {
    name: "TaggedItem",
    properties: {
      tags: {
        type: "array",
        items: { type: "string" },
        default: ["default-tag"],
      },
    },
  };

  const component = {
    name: "ExampleItem",
    version: "1.0.0",
    schema: "TaggedItem",
    properties: {},
  };

  const result = compileComponent(schema, component);

  assert.equal(result.ok, true);

  if (result.ok) {
    assert.deepEqual(
      JSON.parse(result.json).properties.tags,
      ["default-tag"],
    );
  }
});

test("child array properties replace inherited arrays", () => {
  const schema = {
    name: "TaggedItem",
    properties: {
      tags: {
        type: "array",
        items: { type: "string" },
        required: true,
      },
    },
  };

  const parent = {
    name: "BaseItem",
    version: "1.0.0",
    schema: "TaggedItem",
    properties: {
      tags: ["parent-tag", "shared-tag"],
    },
  };

  const child = {
    name: "SpecialItem",
    version: "1.0.0",
    schema: "TaggedItem",
    extends: {
      name: "BaseItem",
      version: "1.0.0",
    },
    properties: {
      tags: ["child-tag"],
    },
  };

  const result = compileComponent(schema, child, [parent]);

  assert.equal(result.ok, true);

  if (result.ok) {
    assert.deepEqual(
      JSON.parse(result.json).properties.tags,
      ["child-tag"],
    );
  }
});

test("invalid array defaults produce indexed diagnostics", () => {
  const schema = {
    name: "TaggedItem",
    properties: {
      tags: {
        type: "array",
        items: { type: "string" },
        default: ["valid", 42],
      },
    },
  };

  const component = {
    name: "ExampleItem",
    version: "1.0.0",
    schema: "TaggedItem",
    properties: {},
  };

  const result = compileComponent(schema, component);

  assert.equal(result.ok, false);

  if (!result.ok) {
    assert.ok(
      result.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === "INVALID_ARRAY_ITEM" &&
          diagnostic.path === "properties.tags[1]",
      ),
    );
  }
});