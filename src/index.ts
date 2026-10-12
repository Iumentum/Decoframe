
/**
 * Decoframe
 * Object-Oriented Declarative Composition Framework
 */

export type PropertyType =
  | "string"
  | "number"
  | "boolean"
  | "component"
  | "array";

export interface PropertyItemSchema {
  type: "string" | "number" | "boolean" | "component";
  schema?: string;
}

export type PropertyValue = string | number | boolean;

export interface PropertySchema {
  type: PropertyType;
  required?: boolean;
  default?: PropertyValue | unknown[];
  schema?: string;
  items?: PropertyItemSchema;
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

interface InternalCompileResult {
  output?: Record<string, unknown>;
  diagnostics: Diagnostic[];
}

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
    case "array":
      return Array.isArray(value);
    case "component":
      return (
        isRecord(value) &&
        typeof value.name === "string" &&
        typeof value.version === "string" &&
        isRecord(value.properties)
      );
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
      diagnostics: [{
        code: "INHERITANCE_CYCLE",
        path: "extends",
        message: `Inheritance cycle detected at "${component.name}@${component.version}".`,
      }],
    };
  }

  if (!isRecord(component.properties)) {
    return {
      diagnostics: [{
        code: "INVALID_PROPERTIES",
        path: "properties",
        message: "Component properties must be an object.",
      }],
    };
  }

  const nextStack = [...stack, currentIdentity];
  let inheritedProperties: Record<string, unknown> = {};

  if (component.extends !== undefined) {
    const parentIdentity = identity(component.extends);

    if (nextStack.includes(parentIdentity)) {
      return {
        diagnostics: [{
          code: "INHERITANCE_CYCLE",
          path: "extends",
          message: `Inheritance cycle detected involving "${component.extends.name}@${component.extends.version}".`,
        }],
      };
    }

    const matches = registry.filter(
      (candidate) => identity(candidate) === parentIdentity,
    );

    if (matches.length === 0) {
      return {
        diagnostics: [{
          code: "PARENT_NOT_FOUND",
          path: "extends",
          message: `Parent "${component.extends.name}@${component.extends.version}" was not found.`,
        }],
      };
    }

    if (matches.length > 1) {
      return {
        diagnostics: [{
          code: "AMBIGUOUS_PARENT",
          path: "extends",
          message: `Multiple definitions match parent "${component.extends.name}@${component.extends.version}".`,
        }],
      };
    }

    const parent = matches[0]!;

    if (parent.schema !== component.schema) {
      return {
        diagnostics: [{
          code: "INHERITANCE_SCHEMA_MISMATCH",
          path: "extends",
          message: `Parent schema "${parent.schema}" does not match child schema "${component.schema}".`,
        }],
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

      continue;
    }

    if (
      propertySchema.type === "component" &&
      propertySchema.schema !== undefined &&
      isRecord(value) &&
      typeof value.schema === "string" &&
      value.schema !== propertySchema.schema
    ) {
      diagnostics.push({
        code: "COMPONENT_SCHEMA_MISMATCH",
        path: `properties.${key}`,
        message: `Expected nested component schema "${propertySchema.schema}".`,
      });
    }

    if (propertySchema.type === "array" && Array.isArray(value)) {
      const itemSchema = propertySchema.items;

      if (!itemSchema) {
        diagnostics.push({
          code: "MISSING_ARRAY_ITEM_SCHEMA",
          path: `properties.${key}`,
          message: `Array property "${key}" must declare an item schema.`,
        });
        continue;
      }

      value.forEach((item, index) => {
        if (!matchesType(item, itemSchema.type)) {
          diagnostics.push({
            code: "INVALID_ARRAY_ITEM",
            path: `properties.${key}[${index}]`,
            message: `Expected ${itemSchema.type} for array item.`,
          });
        }
      });
    }
  }

  return diagnostics;
}

function compileInternal(
  schema: ComponentSchema,
  component: ComponentDefinition,
  registry: readonly ComponentDefinition[],
  schemas: readonly ComponentSchema[],
  componentStack: readonly string[],
  path: string,
): InternalCompileResult {
  const componentIdentity = identity(component);

  if (componentStack.includes(componentIdentity)) {
    return {
      diagnostics: [{
        code: "COMPONENT_CYCLE",
        path,
        message: `Nested component cycle detected at "${component.name}@${component.version}".`,
      }],
    };
  }

  const resolved = resolveInheritance(component, registry);

  if (resolved.diagnostics.length > 0) {
    return {
      diagnostics: resolved.diagnostics.map((diagnostic) => ({
        ...diagnostic,
        path: path
          ? `${path}.${diagnostic.path}`
          : diagnostic.path,
      })),
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
    return {
      diagnostics: diagnostics.map((diagnostic) => ({
        ...diagnostic,
        path: path
          ? `${path}.${diagnostic.path}`
          : diagnostic.path,
      })),
    };
  }

  const properties: Record<string, unknown> = {};
  const nextStack = [...componentStack, componentIdentity];

  for (const key of Object.keys(schema.properties).sort()) {
    const propertySchema = schema.properties[key]!;
    const supplied = Object.hasOwn(effectiveComponent.properties, key);

    if (!supplied && !Object.hasOwn(propertySchema, "default")) {
      continue;
    }

    const value = supplied
      ? effectiveComponent.properties[key]
      : propertySchema.default;

    if (propertySchema.type === "array") {
      if (!Array.isArray(value) || !propertySchema.items) {
        continue;
      }

      const compiledItems: unknown[] = [];

      value.forEach((item, index) => {
        if (propertySchema.items!.type !== "component") {
          compiledItems.push(item);
          return;
        }

        if (!isRecord(item)) {
          return;
        }

        const referenceName = item.name;
        const referenceVersion = item.version;

        if (
          typeof referenceName !== "string" ||
          typeof referenceVersion !== "string" ||
          !isRecord(item.properties)
        ) {
          return;
        }

        const nestedPath = path
          ? `${path}.properties.${key}[${index}]`
          : `properties.${key}[${index}]`;

        const matches = registry.filter(
          (candidate) =>
            identity(candidate) ===
            identity({
              name: referenceName,
              version: referenceVersion,
            }),
        );

        if (matches.length === 0) {
          diagnostics.push({
            code: "COMPONENT_NOT_FOUND",
            path: nestedPath,
            message: `Component "${referenceName}@${referenceVersion}" was not found.`,
          });
          return;
        }

        if (matches.length > 1) {
          diagnostics.push({
            code: "AMBIGUOUS_COMPONENT",
            path: nestedPath,
            message: `Multiple definitions match "${referenceName}@${referenceVersion}".`,
          });
          return;
        }

        const definition = matches[0]!;

        if (
          propertySchema.items!.schema !== undefined &&
          definition.schema !== propertySchema.items!.schema
        ) {
          diagnostics.push({
            code: "COMPONENT_SCHEMA_MISMATCH",
            path: nestedPath,
            message: `Expected schema "${propertySchema.items!.schema}" but component "${referenceName}" uses "${definition.schema}".`,
          });
          return;
        }

        const nestedSchemaMatches = schemas.filter(
          (candidate) => candidate.name === definition.schema,
        );

        if (nestedSchemaMatches.length !== 1) {
          diagnostics.push({
            code: "NESTED_SCHEMA_NOT_FOUND",
            path: nestedPath,
            message: `Could not uniquely resolve schema "${definition.schema}".`,
          });
          return;
        }

        const nestedDefinition: ComponentDefinition = {
          ...definition,
          properties: {
            ...definition.properties,
            ...item.properties,
          },
        };

        const nestedResult = compileInternal(
          nestedSchemaMatches[0]!,
          nestedDefinition,
          registry,
          schemas,
          nextStack,
          nestedPath,
        );

        if (nestedResult.diagnostics.length > 0) {
          diagnostics.push(...nestedResult.diagnostics);
        } else {
          compiledItems.push(nestedResult.output!);
        }
      });

      properties[key] = compiledItems;
      continue;
    }

    if (propertySchema.type !== "component") {
      properties[key] = value;
      continue;
    }

    if (!isRecord(value)) {
      // validateComponent has already reported this invalid value.
      continue;
    }

    const referenceName = value.name;
    const referenceVersion = value.version;

    if (
      typeof referenceName !== "string" ||
      typeof referenceVersion !== "string" ||
      !isRecord(value.properties)
    ) {
      continue;
    }

    const reference = {
      name: referenceName,
      version: referenceVersion,
    };

    const matches = registry.filter(
      (candidate) => identity(candidate) === identity(reference),
    );

    const nestedPath = path
      ? `${path}.properties.${key}`
      : `properties.${key}`;

    if (matches.length === 0) {
      diagnostics.push({
        code: "COMPONENT_NOT_FOUND",
        path: nestedPath,
        message: `Component "${referenceName}@${referenceVersion}" was not found.`,
      });
      continue;
    }

    if (matches.length > 1) {
      diagnostics.push({
        code: "AMBIGUOUS_COMPONENT",
        path: nestedPath,
        message: `Multiple definitions match "${referenceName}@${referenceVersion}".`,
      });
      continue;
    }

    const definition = matches[0]!;

    if (
      propertySchema.schema !== undefined &&
      definition.schema !== propertySchema.schema
    ) {
      diagnostics.push({
        code: "COMPONENT_SCHEMA_MISMATCH",
        path: nestedPath,
        message: `Expected schema "${propertySchema.schema}" but component "${referenceName}" uses "${definition.schema}".`,
      });
      continue;
    }

    const nestedSchemaMatches = schemas.filter(
      (candidate) => candidate.name === definition.schema,
    );

    if (nestedSchemaMatches.length !== 1) {
      diagnostics.push({
        code: "NESTED_SCHEMA_NOT_FOUND",
        path: nestedPath,
        message: nestedSchemaMatches.length === 0
          ? `Schema "${definition.schema}" was not found.`
          : `Multiple schemas are named "${definition.schema}".`,
      });
      continue;
    }

    const nestedDefinition: ComponentDefinition = {
      ...definition,
      properties: {
        ...definition.properties,
        ...value.properties,
      },
    };

    const nestedResult = compileInternal(
      nestedSchemaMatches[0]!,
      nestedDefinition,
      registry,
      schemas,
      nextStack,
      nestedPath,
    );

    if (nestedResult.diagnostics.length > 0) {
      diagnostics.push(...nestedResult.diagnostics);
    } else {
      properties[key] = nestedResult.output!;
    }
  }

  if (diagnostics.length > 0) {
    return { diagnostics };
  }

  return {
    output: {
      name: component.name,
      version: component.version,
      schema: component.schema,
      properties,
    },
    diagnostics: [],
  };
}

export function compileComponent(
  schema: ComponentSchema,
  component: ComponentDefinition,
  registry: readonly ComponentDefinition[] = [],
  schemas: readonly ComponentSchema[] = [schema],
): CompileResult {
  const result = compileInternal(
    schema,
    component,
    registry,
    schemas,
    [],
    "",
  );

  if (result.diagnostics.length > 0) {
    return {
      ok: false,
      diagnostics: result.diagnostics,
    };
  }

  return {
    ok: true,
    json: JSON.stringify(canonicalize(result.output), null, 2),
    diagnostics: [],
  };
}
