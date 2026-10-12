/**
 * Decoframe
 * Object-Oriented Declarative Composition Framework
 */
export type PropertyType =
  | "string"
  | "number"
  | "boolean"
  | "object"
  | "component"
  | "reference"
  | "array";
export interface PropertyItemSchema {
  type: "string" | "number" | "boolean" | "object" | "component";
  schema?: string;
}
export type PropertyValue = string | number | boolean;
export interface PropertySchema {
  type: PropertyType;
  required?: boolean;
  nullable?: boolean;
  default?: PropertyValue | unknown[] | Record<string, unknown> | null;
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
export interface CompilationContext {
  [key: string]: unknown;
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
  | { ok: true; json: string; diagnostics: [] }
  | { ok: false; diagnostics: Diagnostic[] };
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
    case "object":
      return isRecord(value);
    case "array":
      return Array.isArray(value);
    case "reference":
      return (
        isRecord(value) &&
        typeof value.name === "string" &&
        typeof value.version === "string"
      );
    case "component":
      return (
        isRecord(value) &&
        typeof value.name === "string" &&
        typeof value.version === "string" &&
        isRecord(value.properties)
      );
  }
}
function setOwn(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (isRecord(value)) {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      setOwn(result, key, canonicalize(value[key]));
    }
    return result;
  }
  return value;
}
function identity(component: ComponentReference): string {
  return JSON.stringify([component.name, component.version]);
}
function mergeObjectValues(
  inherited: Record<string, unknown>,
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const key of Object.keys(inherited)) {
    setOwn(result, key, inherited[key]);
  }

  for (const key of Object.keys(overrides)) {
    const inheritedValue = Object.hasOwn(result, key)
      ? result[key]
      : undefined;
    const overrideValue = overrides[key];

    if (isRecord(inheritedValue) && isRecord(overrideValue)) {
      setOwn(
        result,
        key,
        mergeObjectValues(inheritedValue, overrideValue),
      );
    } else {
      setOwn(result, key, overrideValue);
    }
  }

  return result;
}
function mergeEffectiveProperties(
  defaults: Record<string, unknown>,
  overrides: Record<string, unknown>,
  schema: ComponentSchema,
  path: string,
): {
  properties: Record<string, unknown>;
  diagnostics: Diagnostic[];
} {
  const properties: Record<string, unknown> = {};
  const diagnostics: Diagnostic[] = [];

  for (const key of Object.keys(defaults)) {
    setOwn(properties, key, defaults[key]);
  }

  for (const key of Object.keys(overrides)) {
    const inheritedValue = Object.hasOwn(properties, key)
      ? properties[key]
      : undefined;
    const overrideValue = overrides[key];
    const propertySchema = schema.properties[key];

    if (propertySchema?.type === "array" && isRecord(overrideValue)) {
      const operatorKeys = Object.keys(overrideValue);

      if (
        operatorKeys.length !== 1 ||
        operatorKeys[0] !== "$append" ||
        !Array.isArray(overrideValue.$append)
      ) {
        diagnostics.push({
          code: "INVALID_ARRAY_APPEND",
          path: `${path}.${key}`,
          message:
            `Array property "${key}" must use {$append: [...]} ` +
            "with an array value.",
        });
        continue;
      }

      if (
        inheritedValue !== undefined &&
        !Array.isArray(inheritedValue)
      ) {
        diagnostics.push({
          code: "INVALID_ARRAY_APPEND",
          path: `${path}.${key}`,
          message:
            `Cannot append to inherited non-array property "${key}".`,
        });
        continue;
      }

      setOwn(properties, key, [
        ...(Array.isArray(inheritedValue) ? inheritedValue : []),
        ...overrideValue.$append,
      ]);
    } else if (
      propertySchema?.type === "object" &&
      isRecord(inheritedValue) &&
      isRecord(overrideValue)
    ) {
      setOwn(
        properties,
        key,
        mergeObjectValues(inheritedValue, overrideValue),
      );
    } else {
      setOwn(properties, key, overrideValue);
    }
  }

  return { properties, diagnostics };
}
function resolveInheritance(
  component: ComponentDefinition,
  registry: readonly ComponentDefinition[],
  schema: ComponentSchema,
  stack: readonly string[] = [],
  defaults: Record<string, unknown> = {},
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
  let inheritedProperties: Record<string, unknown> = defaults;

  if (component.extends !== undefined) {
    if (!isRecord(component.extends)) {
      return {
        diagnostics: [{
          code: "INVALID_PARENT",
          path: "extends",
          message: "Component parent reference must be an object.",
        }],
      };
    }

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
      schema,
      nextStack,
      defaults,
    );

    if (resolvedParent.diagnostics.length > 0) {
      return resolvedParent;
    }

    inheritedProperties = resolvedParent.properties!;
  }

  const merged = mergeEffectiveProperties(
    inheritedProperties,
    component.properties,
    schema,
    "properties",
  );

  if (merged.diagnostics.length > 0) {
    return {
      diagnostics: merged.diagnostics,
    };
  }

  return {
    properties: merged.properties,
    diagnostics: [],
  };
}
function resolveInterpolations(
  schema: ComponentSchema,
  sourceProperties: Record<string, unknown>,
  context: CompilationContext,
  basePath = "properties",
): {
  properties: Record<string, unknown>;
  diagnostics: Diagnostic[];
} {
  const properties: Record<string, unknown> = {};
  const diagnostics: Diagnostic[] = [];
  const resolved = new Set<string>();
  const resolving = new Set<string>();
  const cycleAffected = new Set<string>();
  const cycleResolution = Symbol("cycleResolution");
  function diagnostic(
    code: string,
    path: string,
    message: string,
  ): void {
    diagnostics.push({ code, path, message });
  }
  function lookup(
    source: Record<string, unknown>,
    pathParts: string[],
  ): unknown {
    let current: unknown = source;
    for (const part of pathParts) {
      if (!isRecord(current) || !Object.hasOwn(current, part)) {
        return undefined;
      }
      current = current[part];
    }
    return current;
  }
  function resolveProperty(key: string): unknown {
    if (!Object.hasOwn(sourceProperties, key)) {
      return undefined;
    }
    if (resolved.has(key)) {
      return properties[key];
    }
    if (resolving.has(key)) {
      for (const resolvingKey of resolving) {
        cycleAffected.add(resolvingKey);
      }
      diagnostic(
        "INTERPOLATION_CYCLE",
        `${basePath}.${key}`,
        `Circular interpolation dependency detected for property "${key}".`,
      );
      return cycleResolution;
    }
    resolving.add(key);
    const propertySchema = schema.properties[key];
    const value = resolveValue(
      sourceProperties[key],
      propertySchema,
      `${basePath}.${key}`,
    );
    resolving.delete(key);
    resolved.add(key);
    properties[key] = value;
    return value;
  }
  function resolveToken(
    mode: "value" | "object" | "text",
    sourceType: "property" | "context",
    sourcePath: string,
    targetPath: string,
  ): unknown {
    const parts = sourcePath.split(".");
    const root = parts.shift()!;
    let value: unknown;
    if (sourceType === "property") {
      value = resolveProperty(root);
      if (value === cycleResolution) {
        return undefined;
      }
      if (value !== undefined && parts.length > 0) {
        value = lookup(
          isRecord(value) ? value : {},
          parts,
        );
      }
    } else {
      value = lookup(context, [root, ...parts]);
    }
    if (value === undefined) {
      if (!(sourceType === "property" && cycleAffected.has(root))) {
        diagnostic(
          "INTERPOLATION_SOURCE_NOT_FOUND",
          targetPath,
          `Interpolation source "${sourceType}.${sourcePath}" was not found.`,
        );
      }
      return undefined;
    }
    if (mode === "object") {
      if (
        value === null ||
        (typeof value !== "object")
      ) {
        diagnostic(
          "INVALID_INTERPOLATION_TYPE",
          targetPath,
          `Object interpolation requires an object or array source.`,
        );
        return undefined;
      }
      return value;
    }
    if (mode === "text") {
      if (
        typeof value === "string" ||
        typeof value === "boolean" ||
        (typeof value === "number" && Number.isFinite(value))
      ) {
        return String(value);
      }
      diagnostic(
        "INVALID_INTERPOLATION_TYPE",
        targetPath,
        `Text interpolation requires a string, finite number, or boolean source.`,
      );
      return undefined;
    }
    return value;
  }
  function resolveString(
    value: string,
    path: string,
  ): unknown {
    const expression =
      /^\$\{(value|object|text):(property|context)\.([^{}]+)\}$/;
    const exactMatch = value.match(expression);
    if (exactMatch) {
      return resolveToken(
        exactMatch[1] as "value" | "object" | "text",
        exactMatch[2] as "property" | "context",
        exactMatch[3]!,
        path,
      );
    }
    if (!value.includes("${")) {
      return value;
    }
    const tokenPattern =
      /\$\{(value|object|text):(property|context)\.([^{}]+)\}/g;
    let result = "";
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = tokenPattern.exec(value)) !== null) {
      result += value.slice(lastIndex, match.index);
      const mode = match[1] as "value" | "object" | "text";
      if (mode !== "text") {
        diagnostic(
          "INVALID_INTERPOLATION",
          path,
          `The "${mode}" interpolation mode must occupy the entire property value.`,
        );
        return value;
      }
      const replacement = resolveToken(
        mode,
        match[2] as "property" | "context",
        match[3]!,
        path,
      );
      if (replacement === undefined) {
        return undefined;
      }
      result += replacement as string;
      lastIndex = match.index + match[0].length;
    }
    result += value.slice(lastIndex);
    if (result.includes("${")) {
      diagnostic(
        "INVALID_INTERPOLATION",
        path,
        "Malformed or unsupported interpolation expression.",
      );
      return value;
    }
    return result;
  }
  function resolveValue(
    value: unknown,
    propertySchema: PropertySchema | undefined,
    path: string,
  ): unknown {
    // Nested component definitions are resolved by the compiler itself.
    // Keep their identity fields literal.
    if (
      propertySchema?.type === "component" ||
      propertySchema?.type === "reference"
    ) {
      return value;
    }
    if (typeof value === "string") {
      return resolveString(value, path);
    }
    if (Array.isArray(value)) {
      if (
        propertySchema?.type === "array" &&
        propertySchema.items?.type === "component"
      ) {
        return value;
      }
      return value.map((item, index) =>
        resolveValue(item, undefined, `${path}[${index}]`),
      );
    }
    if (isRecord(value)) {
      const result: Record<string, unknown> = {};
      for (const key of Object.keys(value).sort()) {
        setOwn(
          result,
          key,
          resolveValue(
            value[key],
            undefined,
            `${path}.${key}`,
          ),
        );
      }
      return result;
    }
    return value;
  }
  for (const key of Object.keys(sourceProperties).sort()) {
    resolveProperty(key);
  }
  return { properties, diagnostics };
}
export function validateComponent(
  schema: ComponentSchema,
  component: ComponentDefinition,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  if (!isRecord(schema)) {
    return [
      {
        code: "INVALID_SCHEMA",
        path: "schema",
        message: "Schema definition must be an object.",
      },
    ];
  }

  if (!isRecord(component)) {
    return [
      {
        code: "INVALID_COMPONENT",
        path: "component",
        message: "Component definition must be an object.",
      },
    ];
  }

  if (typeof schema.name !== "string" || !schema.name.trim()) {
    diagnostics.push({
      code: "INVALID_SCHEMA_NAME",
      path: "schema.name",
      message: "Schema name must not be empty.",
    });
  }

  if (!isRecord(schema.properties)) {
    diagnostics.push({
      code: "INVALID_SCHEMA_PROPERTIES",
      path: "schema.properties",
      message: "Schema properties must be an object.",
    });
    return diagnostics;
  }

  if (
    typeof component.name !== "string" ||
    !component.name.trim()
  ) {
    diagnostics.push({
      code: "INVALID_COMPONENT_NAME",
      path: "name",
      message: "Component name must not be empty.",
    });
  }

  if (
    typeof component.version !== "string" ||
    !component.version.trim()
  ) {
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
    const propertySchema = schema.properties[key];

    if (!isRecord(propertySchema)) {
      diagnostics.push({
        code: "INVALID_PROPERTY_SCHEMA",
        path: `schema.properties.${key}`,
        message: `Property schema "${key}" must be an object.`,
      });
      continue;
    }

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

    if (value === null && propertySchema.nullable === true) {
      continue;
    }

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
  context: CompilationContext,
  componentStack: readonly string[],
  path: string,
  instanceOverrides?: Record<string, unknown>,
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

  const propertiesWithDefaults: Record<string, unknown> = {};

  for (const key of Object.keys(schema.properties)) {
    const propertySchema = schema.properties[key]!;

    if (Object.hasOwn(propertySchema, "default")) {
      Object.defineProperty(propertiesWithDefaults, key, {
        value: propertySchema.default,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
  }

  const resolved = resolveInheritance(
    component,
    registry,
    schema,
    [],
    propertiesWithDefaults,
  );

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

  let effectiveProperties = resolved.properties!;

  if (instanceOverrides !== undefined) {
    const mergedInstance = mergeEffectiveProperties(
      effectiveProperties,
      instanceOverrides,
      schema,
      path ? `${path}.properties` : "properties",
    );

    if (mergedInstance.diagnostics.length > 0) {
      return {
        diagnostics: mergedInstance.diagnostics,
      };
    }

    effectiveProperties = mergedInstance.properties;
  }
  const interpolationResult = resolveInterpolations(
    schema,
    effectiveProperties,
    context,
    path ? `${path}.properties` : "properties",
  );
  if (interpolationResult.diagnostics.length > 0) {
    return {
      diagnostics: interpolationResult.diagnostics,
    };
  }
  const effectiveComponent: ComponentDefinition = {
    name: component.name,
    version: component.version,
    schema: component.schema,
    properties: interpolationResult.properties,
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
    const propertyPath = path
      ? `${path}.properties.${key}`
      : `properties.${key}`;

    if (value === null && propertySchema.nullable === true) {
      properties[key] = null;
      continue;
    }

    // References are resolved locally but remain lightweight identifiers.
    if (propertySchema.type === "reference") {
      if (!isRecord(value)) {
        continue;
      }
      if (
        typeof value.name !== "string" ||
        typeof value.version !== "string"
      ) {
        continue;
      }
      const reference: ComponentReference = {
        name: value.name,
        version: value.version,
      };
      const matches = registry.filter(
        (candidate) => identity(candidate) === identity(reference),
      );
      if (matches.length === 0) {
        diagnostics.push({
          code: "COMPONENT_NOT_FOUND",
          path: propertyPath,
          message: `Component "${reference.name}@${reference.version}" was not found.`,
        });
        continue;
      }
      if (matches.length > 1) {
        diagnostics.push({
          code: "AMBIGUOUS_COMPONENT",
          path: propertyPath,
          message: `Multiple definitions match "${reference.name}@${reference.version}".`,
        });
        continue;
      }
      const target = matches[0]!;
      if (
        propertySchema.schema !== undefined &&
        target.schema !== propertySchema.schema
      ) {
        diagnostics.push({
          code: "REFERENCE_SCHEMA_MISMATCH",
          path: propertyPath,
          message: `Expected schema "${propertySchema.schema}" but component "${reference.name}" uses "${target.schema}".`,
        });
        continue;
      }
      properties[key] = reference;
      continue;
    }
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
        const nestedPath = `${propertyPath}[${index}]`;
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
            message: nestedSchemaMatches.length === 0
              ? `Schema "${definition.schema}" was not found.`
              : `Multiple schemas are named "${definition.schema}".`,
          });
          return;
        }
        const nestedResult = compileInternal(
          nestedSchemaMatches[0]!,
          definition,
          registry,
          schemas,
          context,
          nextStack,
          nestedPath,
          item.properties,
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
    if (matches.length === 0) {
      diagnostics.push({
        code: "COMPONENT_NOT_FOUND",
        path: propertyPath,
        message: `Component "${referenceName}@${referenceVersion}" was not found.`,
      });
      continue;
    }
    if (matches.length > 1) {
      diagnostics.push({
        code: "AMBIGUOUS_COMPONENT",
        path: propertyPath,
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
        path: propertyPath,
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
        path: propertyPath,
        message: nestedSchemaMatches.length === 0
          ? `Schema "${definition.schema}" was not found.`
          : `Multiple schemas are named "${definition.schema}".`,
      });
      continue;
    }
    const nestedResult = compileInternal(
      nestedSchemaMatches[0]!,
      definition,
      registry,
      schemas,
      context,
      nextStack,
      propertyPath,
      value.properties,
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
function getInvalidComponentSchemaPaths(
  schema: unknown,
): string[] {
  if (!isRecord(schema)) return ["schema"];

  const invalidPaths: string[] = [];

  if (typeof schema.name !== "string" || schema.name.trim() === "") {
    invalidPaths.push("schema.name");
  }

  if (!isRecord(schema.properties)) {
    invalidPaths.push("schema.properties");
    return invalidPaths;
  }

  const allowedTypes = [
    "string",
    "number",
    "boolean",
    "object",
    "component",
    "reference",
    "array",
  ];

  const allowedItemTypes = [
    "string",
    "number",
    "boolean",
    "object",
    "component",
  ];

  for (const [key, property] of Object.entries(schema.properties)) {
    const path = `schema.properties.${key}`;

    if (key.trim() === "" || !isRecord(property)) {
      invalidPaths.push(path);
      continue;
    }

    if (
      Object.hasOwn(property, "required") &&
      typeof property.required !== "boolean"
    ) {
      invalidPaths.push(`${path}.required`);
    }

    if (
      Object.hasOwn(property, "nullable") &&
      typeof property.nullable !== "boolean"
    ) {
      invalidPaths.push(`${path}.nullable`);
    }

    const allowedFields = [
      "type",
      "required",
      "nullable",
      "default",
      "schema",
      "items",
    ];

    for (const field of Object.keys(property)) {
      if (!allowedFields.includes(field)) {
        invalidPaths.push(`${path}.${field}`);
      }
    }

    const validType =
      typeof property.type === "string" &&
      allowedTypes.includes(property.type);

    if (!validType) {
      invalidPaths.push(`${path}.type`);
    }

    if (
      Object.hasOwn(property, "schema") &&
      typeof property.schema !== "string"
    ) {
      invalidPaths.push(`${path}.schema`);
    }

    if (validType && Object.hasOwn(property, "default")) {
      const defaultValue = property.default;
      const nullable = property.nullable === true;

      if (
        defaultValue === null
          ? !nullable
          : !matchesType(
              defaultValue,
              property.type as PropertyType,
            )
      ) {
        invalidPaths.push(`${path}.default`);
      }
    }

    if (property.type === "array" && !Object.hasOwn(property, "items")) {
      invalidPaths.push(`${path}.items`);
    }

    if (Object.hasOwn(property, "items")) {
      if (!isRecord(property.items)) {
        invalidPaths.push(`${path}.items`);
        continue;
      }

      const itemPath = `${path}.items`;

      for (const field of Object.keys(property.items)) {
        if (!["type", "schema"].includes(field)) {
          invalidPaths.push(`${itemPath}.${field}`);
        }
      }

      const validItemType =
        typeof property.items.type === "string" &&
        allowedItemTypes.includes(property.items.type);

      if (!validItemType) {
        invalidPaths.push(`${itemPath}.type`);
      }

      if (
        Object.hasOwn(property.items, "schema") &&
        (typeof property.items.schema !== "string" ||
          !["object", "component"].includes(
            property.items.type as string,
          ))
      ) {
        invalidPaths.push(`${itemPath}.schema`);
      }
    }
  }

  return invalidPaths;
}
export function compileComponent(
  schema: ComponentSchema,
  component: ComponentDefinition,
  registry: readonly ComponentDefinition[] = [],
  schemas: readonly ComponentSchema[] = [schema],
  context: CompilationContext = {},
): CompileResult {
  if (!isRecord(schema)) {
    return {
      ok: false,
      diagnostics: [
        {
          code: "INVALID_SCHEMA",
          path: "schema",
          message: "Schema definition must be an object.",
        },
      ],
    };
  }

  if (!isRecord(component)) {
    return {
      ok: false,
      diagnostics: [
        {
          code: "INVALID_COMPONENT",
          path: "component",
          message: "Component definition must be an object.",
        },
      ],
    };
  }

  if (
    !Array.isArray(registry) ||
    !registry.every(
      (item: unknown) =>
        typeof item === "object" &&
        item !== null &&
        !Array.isArray(item),
    )
  ) {
    return {
      ok: false,
      diagnostics: [
        {
          code: "INVALID_REGISTRY",
          path: "registry",
          message: "Component registry must be an array of component objects.",
        },
      ],
    };
  }

  if (
    !Array.isArray(schemas) ||
    !schemas.every(
      (item: unknown) =>
        typeof item === "object" &&
        item !== null &&
        !Array.isArray(item),
    )
  ) {
    return {
      ok: false,
      diagnostics: [
        {
          code: "INVALID_SCHEMAS",
          path: "schemas",
          message: "Schemas must be an array of schema objects.",
        },
      ],
    };
  }

  if (!isRecord(context)) {
    return {
      ok: false,
      diagnostics: [
        {
          code: "INVALID_CONTEXT",
          path: "context",
          message: "Compilation context must be an object.",
        },
      ],
    };
  }

  const validSchema = schema as unknown as ComponentSchema;
  const validComponent = component as unknown as ComponentDefinition;
  const validRegistry = registry as readonly ComponentDefinition[];
  const validSchemas = schemas as readonly ComponentSchema[];

  const invalidSchemaPaths =
    getInvalidComponentSchemaPaths(validSchema);

  if (invalidSchemaPaths.length > 0) {
    return {
      ok: false,
      diagnostics: invalidSchemaPaths.map((path) => ({
        code: "INVALID_SCHEMA",
        path,
        message: `Invalid schema definition at "${path}".`,
      })),
    };
  }

  const invalidNestedSchemaDiagnostics = validSchemas.flatMap(
    (candidate, index) => {
      if (candidate === validSchema) {
        return [];
      }

      return getInvalidComponentSchemaPaths(candidate).map((path) => {
        const nestedPath = `schemas[${index}].${path.replace(/^schema\./, "")}`;

        return {
          code: "INVALID_SCHEMA",
          path: nestedPath,
          message: `Invalid schema definition at "${nestedPath}".`,
        };
      });
    },
  );

  if (invalidNestedSchemaDiagnostics.length > 0) {
    return {
      ok: false,
      diagnostics: invalidNestedSchemaDiagnostics,
    };
  }

  const result = compileInternal(
    validSchema,
    validComponent,
    validRegistry,
    validSchemas,
    context as CompilationContext,
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
