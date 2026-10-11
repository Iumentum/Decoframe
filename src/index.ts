/**
 * Decoframe
 * Object-Oriented Declarative Composition Framework
 */

export type PropertyType = "string" | "number" | "boolean";
export type PropertyValue = string | number | boolean;

export interface PropertySchema {
  type: PropertyType;
  required?: boolean;
  default?: PropertyValue;
}

export interface ComponentSchema {
  name: string;
  properties: Record<string, PropertySchema>;
}

export interface ComponentReference {
  name: string;
  version: string;
}

export interface ComponentDefinition {
  name: string;
  version: string;
  schema: string;
  extends?: ComponentReference;
  properties: Record<string, unknown>;
}

export interface Diagnostic {
  code: string;
  path: string;
  message: string;
}

export type CompileResult =
  | {
      ok: true;
      json: string;
      diagnostics: [];
    }
  | {
      ok: false;
      diagnostics: Diagnostic[];
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function matchesType(value: unknown, type: PropertyType): boolean {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (isRecord(value)) {
    const result: Record<string, unknown> = {};

    for (const key of Object.keys(value).sort()) {
      result[key] = canonicalize(value[key]);
    }

    return result;
  }

  return value;
}

function identity(component: ComponentReference): string {
  return JSON.stringify([component.name, component.version]);
}

function resolveInheritance(
  component: ComponentDefinition,
  registry: readonly ComponentDefinition[],
  stack: readonly string[] = [],
): {
  properties?: Record<string, unknown>;
  diagnostics: Diagnostic[];
} {
  const currentIdentity = identity(component);

  if (stack.includes(currentIdentity)) {
    return {
      diagnostics: [
        {
          code: "INHERITANCE_CYCLE",
          path: "extends",
          message: `Inheritance cycle detected at "${component.name}@${component.version}".`,
        },
      ],
    };
  }

  if (!isRecord(component.properties)) {
    return {
      diagnostics: [
        {
          code: "INVALID_PROPERTIES",
          path: "properties",
          message: "Component properties must be an object.",
        },
      ],
    };
  }

  const nextStack = [...stack, currentIdentity];
  let inheritedProperties: Record<string, unknown> = {};

  if (component.extends !== undefined) {
    const parentIdentity = identity(component.extends);

    if (nextStack.includes(parentIdentity)) {
      return {
        diagnostics: [
          {
            code: "INHERITANCE_CYCLE",
            path: "extends",
            message: `Inheritance cycle detected involving "${component.extends.name}@${component.extends.version}".`,
          },
        ],
      };
    }

    const matches = registry.filter(
      (candidate) => identity(candidate) === parentIdentity,
    );

    if (matches.length === 0) {
      return {
        diagnostics: [
          {
            code: "PARENT_NOT_FOUND",
            path: "extends",
            message: `Parent "${component.extends.name}@${component.extends.version}" was not found.`,
          },
        ],
      };
    }

    if (matches.length > 1) {
      return {
        diagnostics: [
          {
            code: "AMBIGUOUS_PARENT",
            path: "extends",
            message: `Multiple definitions match parent "${component.extends.name}@${component.extends.version}".`,
          },
        ],
      };
    }

    const parent = matches[0]!;

    if (parent.schema !== component.schema) {
      return {
        diagnostics: [
          {
            code: "INHERITANCE_SCHEMA_MISMATCH",
            path: "extends",
            message: `Parent schema "${parent.schema}" does not match child schema "${component.schema}".`,
          },
        ],
      };
    }

    const resolvedParent = resolveInheritance(
      parent,
      registry,
      nextStack,
    );

    if (resolvedParent.diagnostics.length > 0) {
      return resolvedParent;
    }

    inheritedProperties = resolvedParent.properties!;
  }

  return {
    properties: {
      ...inheritedProperties,
      ...component.properties,
    },
    diagnostics: [],
  };
}

export function validateComponent(
  schema: ComponentSchema,
  component: ComponentDefinition,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  if (!schema.name.trim()) {
    diagnostics.push({
      code: "INVALID_SCHEMA_NAME",
      path: "schema.name",
      message: "Schema name must not be empty.",
    });
  }

  if (!component.name.trim()) {
    diagnostics.push({
      code: "INVALID_COMPONENT_NAME",
      path: "name",
      message: "Component name must not be empty.",
    });
  }

  if (!component.version.trim()) {
    diagnostics.push({
      code: "INVALID_COMPONENT_VERSION",
      path: "version",
      message: "Component version must not be empty.",
    });
  }

  if (component.schema !== schema.name) {
    diagnostics.push({
      code: "SCHEMA_MISMATCH",
      path: "schema",
      message:
        `Component references schema "${component.schema}", ` +
        `but "${schema.name}" was provided.`,
    });
  }

  if (!isRecord(component.properties)) {
    diagnostics.push({
      code: "INVALID_PROPERTIES",
      path: "properties",
      message: "Component properties must be an object.",
    });

    return diagnostics;
  }

  for (const key of Object.keys(component.properties).sort()) {
    if (!Object.hasOwn(schema.properties, key)) {
      diagnostics.push({
        code: "UNKNOWN_PROPERTY",
        path: `properties.${key}`,
        message: `Property "${key}" is not defined by the schema.`,
      });
    }
  }

  for (const key of Object.keys(schema.properties).sort()) {
    const propertySchema = schema.properties[key]!;
    const supplied = Object.hasOwn(component.properties, key);
    const hasDefault = Object.hasOwn(propertySchema, "default");

    if (!supplied && !hasDefault) {
      if (propertySchema.required) {
        diagnostics.push({
          code: "MISSING_REQUIRED_PROPERTY",
          path: `properties.${key}`,
          message: `Required property "${key}" is missing.`,
        });
      }

      continue;
    }

    const value = supplied
      ? component.properties[key]
      : propertySchema.default;

    if (!matchesType(value, propertySchema.type)) {
      diagnostics.push({
        code: "INVALID_PROPERTY_TYPE",
        path: `properties.${key}`,
        message: `Expected ${propertySchema.type} for property "${key}".`,
      });
    }
  }

  return diagnostics;
}

export function compileComponent(
  schema: ComponentSchema,
  component: ComponentDefinition,
  registry: readonly ComponentDefinition[] = [],
): CompileResult {
  const resolved = resolveInheritance(component, registry);

  if (resolved.diagnostics.length > 0) {
    return {
      ok: false,
      diagnostics: resolved.diagnostics,
    };
  }

  const effectiveComponent: ComponentDefinition = {
    name: component.name,
    version: component.version,
    schema: component.schema,
    properties: resolved.properties!,
  };

  const diagnostics = validateComponent(schema, effectiveComponent);

  if (diagnostics.length > 0) {
    return { ok: false, diagnostics };
  }

  const properties: Record<string, PropertyValue> = {};

  for (const key of Object.keys(schema.properties).sort()) {
    const propertySchema = schema.properties[key]!;

    if (Object.hasOwn(effectiveComponent.properties, key)) {
      properties[key] = effectiveComponent.properties[key] as PropertyValue;
    } else if (Object.hasOwn(propertySchema, "default")) {
      properties[key] = propertySchema.default!;
    }
  }

  const output = {
    name: component.name,
    version: component.version,
    schema: component.schema,
    properties,
  };

  return {
    ok: true,
    json: JSON.stringify(canonicalize(output), null, 2),
    diagnostics: [],
  };
}