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

test("component references compile without embedding their targets", () => {
  const schema = {
    name: "Vehicle",
    properties: {
      engine: {
        type: "reference",
        schema: "Engine",
        required: true,
      },
    },
  };

  const component = {
    name: "Car",
    version: "1.0.0",
    schema: "Vehicle",
    properties: {
      engine: {
        name: "PetrolEngine",
        version: "1.0.0",
      },
    },
  };

  const result = compileComponent(schema, component, [petrolEngine]);

  assert.equal(result.ok, true);

  if (result.ok) {
    assert.deepEqual(
      JSON.parse(result.json).properties.engine,
      {
        name: "PetrolEngine",
        version: "1.0.0",
      },
    );
  }
});

test("missing component references produce a diagnostic", () => {
  const schema = {
    name: "Vehicle",
    properties: {
      engine: {
        type: "reference",
        schema: "Engine",
        required: true,
      },
    },
  };

  const component = {
    name: "Car",
    version: "1.0.0",
    schema: "Vehicle",
    properties: {
      engine: {
        name: "MissingEngine",
        version: "1.0.0",
      },
    },
  };

  const result = compileComponent(schema, component, []);

  assert.equal(result.ok, false);

  if (!result.ok) {
    assert.ok(
      result.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === "COMPONENT_NOT_FOUND" &&
          diagnostic.path === "properties.engine",
      ),
    );
  }
});

test("references reject targets with incompatible schemas", () => {
  const schema = {
    name: "Vehicle",
    properties: {
      engine: {
        type: "reference",
        schema: "Engine",
        required: true,
      },
    },
  };

  const wrongSchemaComponent = {
    ...petrolEngine,
    schema: "Transmission",
  };

  const component = {
    name: "Car",
    version: "1.0.0",
    schema: "Vehicle",
    properties: {
      engine: {
        name: "PetrolEngine",
        version: "1.0.0",
      },
    },
  };

  const result = compileComponent(
    schema,
    component,
    [wrongSchemaComponent],
  );

  assert.equal(result.ok, false);

  if (!result.ok) {
    assert.ok(
      result.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === "REFERENCE_SCHEMA_MISMATCH" &&
          diagnostic.path === "properties.engine",
      ),
    );
  }
});

test("ambiguous component references produce a diagnostic", () => {
  const duplicateEngine = {
    ...petrolEngine,
  };

  const referenceSchema = {
    name: "Vehicle",
    properties: {
      engine: {
        type: "reference",
        required: true,
      },
    },
  };

  const vehicle = {
    name: "Car",
    version: "1.0.0",
    schema: "Vehicle",
    properties: {
      engine: {
        name: "PetrolEngine",
        version: "1.0.0",
      },
    },
  };

  const result = compileComponent(
    referenceSchema,
    vehicle,
    [petrolEngine, duplicateEngine],
    [referenceSchema, engineSchema],
  );

  assert.ok(
    result.diagnostics.some(
      (diagnostic) => diagnostic.code === "AMBIGUOUS_COMPONENT",
    ),
  );
});

test("references without schema constraints accept any target schema", () => {
  const referenceSchema = {
    name: "Vehicle",
    properties: {
      engine: {
        type: "reference",
        required: true,
      },
    },
  };

  const vehicle = {
    name: "Car",
    version: "1.0.0",
    schema: "Vehicle",
    properties: {
      engine: {
        name: "PetrolEngine",
        version: "1.0.0",
      },
    },
  };

  const result = compileComponent(
    referenceSchema,
    vehicle,
    [petrolEngine],
    [referenceSchema, engineSchema],
  );

  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(
    JSON.parse(result.json).properties.engine,
    {
      name: "PetrolEngine",
      version: "1.0.0",
    },
  );
});

test("text interpolation resolves other effective component properties", () => {
  const schema = {
    name: "Vehicle",
    properties: {
      make: { type: "string", required: true },
      model: { type: "string", required: true },
      description: { type: "string", required: true },
    },
  };

  const component = {
    name: "Car",
    version: "1.0.0",
    schema: "Vehicle",
    properties: {
      make: "Volvo",
      model: "240",
      description: "${text:property.make} ${text:property.model}",
    },
  };

  const result = compileComponent(schema, component);

  assert.deepEqual(result.diagnostics, []);
  assert.equal(
    JSON.parse(result.json).properties.description,
    "Volvo 240",
  );
});

test("circular property interpolation produces a diagnostic", () => {
  const schema = {
    name: "Vehicle",
    properties: {
      first: { type: "string", required: true },
      second: { type: "string", required: true },
    },
  };

  const component = {
    name: "Car",
    version: "1.0.0",
    schema: "Vehicle",
    properties: {
      first: "${text:property.second}",
      second: "${text:property.first}",
    },
  };

  const result = compileComponent(schema, component);

  assert.ok(
    result.diagnostics.some(
      (diagnostic) => diagnostic.code === "INTERPOLATION_CYCLE",
    ),
  );
});

test("object properties preserve nested objects and arrays", () => {
  const schema = {
    name: "Configuration",
    properties: {
      settings: {
        type: "object",
        required: true,
      },
    },
  };

  const component = {
    name: "App",
    version: "1.0.0",
    schema: "Configuration",
    properties: {
      settings: {
        features: ["search", "export"],
        limits: {
          retries: 3,
        },
      },
    },
  };

  const result = compileComponent(schema, component);

  assert.equal(result.ok, true);

  if (result.ok) {
    assert.deepEqual(JSON.parse(result.json).properties.settings, {
      features: ["search", "export"],
      limits: {
        retries: 3,
      },
    });
  }
});

test("text interpolation resolves compilation context values", () => {
  const schema = {
    name: "Configuration",
    properties: {
      description: {
        type: "string",
        required: true,
      },
    },
  };

  const component = {
    name: "App",
    version: "1.0.0",
    schema: "Configuration",
    properties: {
      description: "Deploying to ${text:context.environment}",
    },
  };

  const result = compileComponent(
    schema,
    component,
    [],
    [schema],
    { environment: "production" },
  );

  assert.equal(result.ok, true);

  if (result.ok) {
    assert.equal(
      JSON.parse(result.json).properties.description,
      "Deploying to production",
    );
  }
});

test("value interpolation preserves number types", () => {
  const schema = {
    name: "Configuration",
    properties: {
      source: {
        type: "number",
        required: true,
      },
      destination: {
        type: "number",
        required: true,
      },
    },
  };

  const component = {
    name: "App",
    version: "1.0.0",
    schema: "Configuration",
    properties: {
      source: 42,
      destination: "${value:property.source}",
    },
  };

  const result = compileComponent(schema, component);

  assert.equal(result.ok, true);

  if (result.ok) {
    const output = JSON.parse(result.json);

    assert.equal(output.properties.destination, 42);
    assert.equal(typeof output.properties.destination, "number");
  }
});

test("interpolation resolves recursively inside objects and arrays", () => {
  const schema = {
    name: "Configuration",
    properties: {
      environment: { type: "string", required: true },
      settings: { type: "object", required: true },
    },
  };

  const component = {
    name: "App",
    version: "1.0.0",
    schema: "Configuration",
    properties: {
      environment: "production",
      settings: {
        label: "${text:property.environment}",
        targets: [
          "${text:context.region}",
          "${value:property.environment}",
        ],
      },
    },
  };

  const result = compileComponent(
    schema,
    component,
    [],
    [schema],
    { region: "asia-southeast" },
  );

  assert.equal(result.ok, true);

  if (result.ok) {
    assert.deepEqual(JSON.parse(result.json).properties.settings, {
      label: "production",
      targets: ["asia-southeast", "production"],
    });
  }
});

test("missing interpolation sources produce diagnostics", () => {
  const schema = {
    name: "Configuration",
    properties: {
      description: { type: "string", required: true },
    },
  };

  const component = {
    name: "App",
    version: "1.0.0",
    schema: "Configuration",
    properties: {
      description: "${text:context.missing}",
    },
  };

  const result = compileComponent(schema, component);

  assert.equal(result.ok, false);
  assert.ok(
    result.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === "INTERPOLATION_SOURCE_NOT_FOUND",
    ),
  );
});

test("text interpolation rejects object values", () => {
  const schema = {
    name: "Configuration",
    properties: {
      description: { type: "string", required: true },
    },
  };

  const component = {
    name: "App",
    version: "1.0.0",
    schema: "Configuration",
    properties: {
      description: "Configuration: ${text:context.settings}",
    },
  };

  const result = compileComponent(
    schema,
    component,
    [],
    [schema],
    { settings: { retries: 3 } },
  );

  assert.equal(result.ok, false);
  assert.ok(
    result.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === "INVALID_INTERPOLATION_TYPE",
    ),
  );
});

test("interpolation does not alter component identities", () => {
  const schema = {
    name: "Configuration",
    properties: {
      label: { type: "string", required: true },
    },
  };

  const component = {
    name: "${text:context.name}",
    version: "1.0.0",
    schema: "Configuration",
    properties: {
      label: "Application",
    },
  };

  const result = compileComponent(
    schema,
    component,
    [],
    [schema],
    { name: "ResolvedName" },
  );

  assert.equal(result.ok, true);

  if (result.ok) {
    assert.equal(
      JSON.parse(result.json).name,
      "${text:context.name}",
    );
  }
});

test("circular interpolation does not hide unrelated missing sources", () => {
  const schema = {
    name: "Configuration",
    properties: {
      first: { type: "string", required: true },
      second: { type: "string", required: true },
      description: { type: "string", required: true },
    },
  };

  const component = {
    name: "App",
    version: "1.0.0",
    schema: "Configuration",
    properties: {
      first: "${text:property.second}",
      second: "${text:property.first}",
      description: "${text:context.missing}",
    },
  };

  const result = compileComponent(schema, component);

  assert.equal(result.ok, false);

  assert.ok(
    result.diagnostics.some(
      (diagnostic) => diagnostic.code === "INTERPOLATION_CYCLE",
    ),
    "Expected a circular interpolation diagnostic",
  );

  assert.equal(
    result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "INTERPOLATION_SOURCE_NOT_FOUND",
    ).length,
    1,
    "Expected exactly one diagnostic for the unrelated missing source",
  );
});

test("malformed nested components produce diagnostics", () => {
  const schema = {
    name: "Vehicle",
    properties: {
      engine: {
        type: "component",
        schema: "Engine",
        required: true,
      },
    },
  };

  const component = {
    name: "Car",
    version: "1.0.0",
    schema: "Vehicle",
    properties: {
      engine: {
        name: "PetrolEngine",
        version: "1.0.0",
        properties: "not-an-object",
      },
    },
  };

  const result = compileComponent(schema, component, [petrolEngine], [
    schema,
    engineSchema,
  ]);

  assert.equal(result.ok, false);
  assert.ok(
    result.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === "INVALID_PROPERTY_TYPE" &&
        diagnostic.path === "properties.engine",
    ),
  );
});

test("malformed component array items produce diagnostics", () => {
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
          properties: "not-an-object",
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

  assert.equal(result.ok, false);
  assert.ok(
    result.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === "INVALID_ARRAY_ITEM" &&
        diagnostic.path === "properties.engines[0]",
    ),
  );
});

test("malformed schema properties produce diagnostics instead of crashing", () => {
  const schema = {
    name: "Vehicle",
    properties: null,
  };

  const component = {
    name: "Car",
    version: "1.0.0",
    schema: "Vehicle",
    properties: {},
  };

  assert.doesNotThrow(() => {
    const result = compileComponent(schema, component, [], [schema]);
    assert.equal(result.ok, false);
    assert.ok(result.diagnostics.length > 0);
  });
});

test("malformed property definitions produce diagnostics instead of crashing", () => {
  const schema = {
    name: "Vehicle",
    properties: {
      engine: null,
    },
  };

  const component = {
    name: "Car",
    version: "1.0.0",
    schema: "Vehicle",
    properties: {},
  };

  assert.doesNotThrow(() => {
    const result = compileComponent(schema, component, [], [schema]);
    assert.equal(result.ok, false);
    assert.ok(result.diagnostics.length > 0);
  });
});

test("unknown property definition fields produce diagnostics", () => {
  const schema = {
    name: "Vehicle",
    properties: {
      engine: {
        type: "string",
        requred: true,
      },
    },
  };

  const component = {
    name: "Car",
    version: "1.0.0",
    schema: "Vehicle",
    properties: {
      engine: "V8",
    },
  };

  const result = compileComponent(schema, component, [], [schema]);

  assert.equal(result.ok, false);
  assert.ok(
    result.diagnostics.some(
      (diagnostic) => diagnostic.code === "INVALID_SCHEMA",
    ),
  );
});

test("unknown array item schema fields produce diagnostics", () => {
  const schema = {
    name: "Vehicle",
    properties: {
      parts: {
        type: "array",
        items: {
          type: "string",
          requred: true,
        },
      },
    },
  };

  const component = {
    name: "Car",
    version: "1.0.0",
    schema: "Vehicle",
    properties: {
      parts: ["engine"],
    },
  };

  const result = compileComponent(schema, component, [], [schema]);

  assert.equal(result.ok, false);
  assert.ok(
    result.diagnostics.some(
      (diagnostic) => diagnostic.code === "INVALID_SCHEMA",
    ),
  );
});

test("invalid required field types produce schema diagnostics", () => {
  const schema = {
    name: "Vehicle",
    properties: {
      engine: {
        type: "string",
        required: "yes",
      },
    },
  };

  const component = {
    name: "Car",
    version: "1.0.0",
    schema: "Vehicle",
    properties: {
      engine: "V8",
    },
  };

  const result = compileComponent(schema, component, [], [schema]);

  assert.equal(result.ok, false);
  assert.ok(
    result.diagnostics.some(
      (diagnostic) => diagnostic.code === "INVALID_SCHEMA",
    ),
  );
});

test("incompatible property defaults produce schema diagnostics", () => {
  const schema = {
    name: "Vehicle",
    properties: {
      speed: {
        type: "number",
        default: "fast",
      },
    },
  };

  const component = {
    name: "Car",
    version: "1.0.0",
    schema: "Vehicle",
    properties: {},
  };

  const result = compileComponent(schema, component, [], [schema]);

  assert.equal(result.ok, false);
  assert.ok(
    result.diagnostics.some(
      (diagnostic) => diagnostic.code === "INVALID_SCHEMA",
    ),
  );
});

test("array properties require an item schema", () => {
  const schema = {
    name: "Vehicle",
    properties: {
      parts: {
        type: "array",
      },
    },
  };

  const component = {
    name: "Car",
    version: "1.0.0",
    schema: "Vehicle",
    properties: {
      parts: ["engine"],
    },
  };

  const result = compileComponent(schema, component, [], [schema]);

  assert.equal(result.ok, false);
  assert.ok(
    result.diagnostics.some(
      (diagnostic) => diagnostic.code === "INVALID_SCHEMA",
    ),
  );
});

test("primitive array item schemas reject schema constraints", () => {
  const schema = {
    name: "Vehicle",
    properties: {
      parts: {
        type: "array",
        items: {
          type: "string",
          schema: "Engine",
        },
      },
    },
  };

  const component = {
    name: "Car",
    version: "1.0.0",
    schema: "Vehicle",
    properties: {
      parts: ["engine"],
    },
  };

  const result = compileComponent(schema, component, [], [schema]);

  assert.equal(result.ok, false);
  assert.ok(
    result.diagnostics.some(
      (diagnostic) => diagnostic.code === "INVALID_SCHEMA",
    ),
  );
});

test("invalid schema defaults identify the property path", () => {
  const schema = {
    name: "Vehicle",
    properties: {
      speed: {
        type: "number",
        default: "fast",
      },
    },
  };

  const component = {
    name: "Car",
    version: "1.0.0",
    schema: "Vehicle",
    properties: {},
  };

  const result = compileComponent(schema, component, [], [schema]);

  assert.equal(result.ok, false);
  assert.ok(
    result.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === "INVALID_SCHEMA" &&
        diagnostic.path === "schema.properties.speed.default",
    ),
  );
});

test("invalid schema definitions report all invalid property paths", () => {
  const schema = {
    name: "Vehicle",
    properties: {
      speed: {
        type: "number",
        default: "fast",
      },
      capacity: {
        type: "number",
        required: "yes",
      },
    },
  };

  const component = {
    name: "Car",
    version: "1.0.0",
    schema: "Vehicle",
    properties: {},
  };

  const result = compileComponent(schema, component, [], [schema]);

  assert.equal(result.ok, false);

  const invalidSchemaPaths = result.diagnostics
    .filter((diagnostic) => diagnostic.code === "INVALID_SCHEMA")
    .map((diagnostic) => diagnostic.path);

  assert.ok(
    invalidSchemaPaths.includes("schema.properties.speed.default"),
  );
  assert.ok(
    invalidSchemaPaths.includes("schema.properties.capacity.required"),
  );
});

test("invalid top-level schema fields report precise paths", () => {
  const schema = {
    name: "",
    properties: null,
  };

  const component = {
    name: "Car",
    version: "1.0.0",
    schema: "Vehicle",
    properties: {},
  };

  const result = compileComponent(schema, component, [], [schema]);

  assert.equal(result.ok, false);

  const invalidSchemaPaths = result.diagnostics
    .filter((diagnostic) => diagnostic.code === "INVALID_SCHEMA")
    .map((diagnostic) => diagnostic.path);

  assert.ok(invalidSchemaPaths.includes("schema.name"));
  assert.ok(invalidSchemaPaths.includes("schema.properties"));
});

test("invalid property definitions report precise paths", () => {
  const schema = {
    name: "Vehicle",
    properties: {
      speed: null,
      capacity: {
        type: "number",
        default: "large",
      },
    },
  };

  const component = {
    name: "Car",
    version: "1.0.0",
    schema: "Vehicle",
    properties: {},
  };

  const result = compileComponent(schema, component, [], [schema]);

  assert.equal(result.ok, false);

  const invalidSchemaPaths = result.diagnostics
    .filter((diagnostic) => diagnostic.code === "INVALID_SCHEMA")
    .map((diagnostic) => diagnostic.path);

  assert.ok(invalidSchemaPaths.includes("schema.properties.speed"));
  assert.ok(
    invalidSchemaPaths.includes("schema.properties.capacity.default"),
  );
});

test("validateComponent handles malformed runtime inputs without throwing", () => {
  const schema = {
    name: "Vehicle",
    properties: {
      speed: {
        type: "number",
      },
    },
  };

  assert.doesNotThrow(() => {
    const diagnostics = validateComponent(schema, null);
    assert.ok(Array.isArray(diagnostics));
    assert.ok(diagnostics.length > 0);
  });
});

test("validateComponent handles malformed component fields without throwing", () => {
  const schema = {
    name: "Vehicle",
    properties: {},
  };

  for (const component of [
    {},
    { name: 123, version: "1.0.0", properties: {} },
    { name: "Vehicle", version: null, properties: {} },
    { name: "Vehicle", version: "1.0.0", properties: null },
  ]) {
    assert.doesNotThrow(() => {
      const diagnostics = validateComponent(schema, component);
      assert.ok(Array.isArray(diagnostics));
      assert.ok(diagnostics.length > 0);
    });
  }
});

test("validateComponent handles malformed schema inputs without throwing", () => {
  const component = {
    name: "Vehicle",
    version: "1.0.0",
    schema: "Vehicle",
    properties: {},
  };

  for (const schema of [
    null,
    {},
    { name: 123, properties: {} },
    { name: "Vehicle", properties: null },
    { name: "Vehicle", properties: [] },
  ]) {
    assert.doesNotThrow(() => {
      const diagnostics = validateComponent(schema, component);
      assert.ok(Array.isArray(diagnostics));
      assert.ok(diagnostics.length > 0);
    });
  }
});