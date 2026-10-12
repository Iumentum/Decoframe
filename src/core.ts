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

const MAX_JSON_DEPTH = 100;
const MAX_JSON_NODES = 1_000_000;
const MAX_DIAGNOSTICS = 100;
const RESOURCE_LIMIT_CODE = "RESOURCE_LIMIT_EXCEEDED";

type ResourceBudget = {
  workRemaining: number;
  maxWork: number;
  maxDepth: number;
  interpolatedChars: number;
  maxInterpolatedChars: number;
  outputChars: number;
  maxOutputChars: number;
};

class ResourceLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResourceLimitError";
  }
}

function consumeWork(budget: ResourceBudget, amount = 1): void {
  if (amount > budget.workRemaining) {
    throw new ResourceLimitError(
      `Resource limit exceeded: maxWork of ${budget.maxWork} operations exceeded.`,
    );
  }

  budget.workRemaining -= amount;
}

function consumeInterpolatedChars(
  budget: ResourceBudget,
  amount: number,
): void {
  if (amount > budget.maxInterpolatedChars - budget.interpolatedChars) {
    throw new ResourceLimitError(
      `Resource limit exceeded: maxInterpolatedChars of ${budget.maxInterpolatedChars} would be exceeded.`,
    );
  }

  budget.interpolatedChars += amount;
}

function consumeOutputChars(budget: ResourceBudget, amount: number): void {
  if (amount > budget.maxOutputChars - budget.outputChars) {
    throw new ResourceLimitError(
      `Resource limit exceeded: maxOutputChars of ${budget.maxOutputChars} would be exceeded.`,
    );
  }

  budget.outputChars += amount;
}

export type Limits = {
  maxSnapshotNodes: number;
  maxSnapshotDepth: number;
  maxWork: number;
  maxDepth: number;
  maxInterpolatedChars: number;
  maxOutputChars: number;
};

export const DEFAULT_LIMITS: Readonly<Limits> = Object.freeze({
  maxSnapshotNodes: 1_000_000,
  maxSnapshotDepth: 100,
  maxWork: 1_000_000,
  maxDepth: 100,
  maxInterpolatedChars: 10_000_000,
  maxOutputChars: 10_000_000,
});

const LIMIT_KEYS = new Set<keyof Limits>([
  "maxSnapshotNodes",
  "maxSnapshotDepth",
  "maxWork",
  "maxDepth",
  "maxInterpolatedChars",
  "maxOutputChars",
]);

export function resolveLimits(
  overrides?: Partial<Limits>,
): Readonly<Limits> {
  if (overrides === undefined) {
    return DEFAULT_LIMITS;
  }

  if (
    typeof overrides !== "object" ||
    overrides === null ||
    Array.isArray(overrides)
  ) {
    throw new TypeError("limits must be an object.");
  }

  const values: Partial<Limits> = {};

  for (const key of Reflect.ownKeys(overrides)) {
    if (typeof key !== "string" || !LIMIT_KEYS.has(key as keyof Limits)) {
      throw new TypeError(`Unknown limits field "${String(key)}".`);
    }

    const value = overrides[key as keyof Limits];

    if (value === undefined) {
      continue;
    }

    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError(
        `limits.${key} must be a positive safe integer.`,
      );
    }

    Object.defineProperty(values, key, {
      value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }

  return Object.freeze({
    maxSnapshotNodes:
      values.maxSnapshotNodes ?? DEFAULT_LIMITS.maxSnapshotNodes,
    maxSnapshotDepth:
      values.maxSnapshotDepth ?? DEFAULT_LIMITS.maxSnapshotDepth,
    maxWork: values.maxWork ?? DEFAULT_LIMITS.maxWork,
    maxDepth: values.maxDepth ?? DEFAULT_LIMITS.maxDepth,
    maxInterpolatedChars:
      values.maxInterpolatedChars ??
      DEFAULT_LIMITS.maxInterpolatedChars,
    maxOutputChars:
      values.maxOutputChars ?? DEFAULT_LIMITS.maxOutputChars,
  });
}

type SnapshotResult =
  | { ok: true; value: unknown }
  | { ok: false; diagnostics: Diagnostic[] };

type SnapshotBudget = {
  visited: number;
  maxNodes: number;
  maxDepth: number;
};

function snapshotJsonSafeValue(
  value: unknown,
  path: string,
  budget: SnapshotBudget = {
    visited: 0,
    maxNodes: MAX_JSON_NODES,
    maxDepth: MAX_JSON_DEPTH,
  },
): SnapshotResult {
  const diagnostics: Diagnostic[] = [];
  const ancestors = new Set<object>();
  let exhausted = false;

  function fail(
    currentPath: string,
    message: string,
    code = "INVALID_JSON_VALUE",
  ): void {
    if (diagnostics.length < MAX_DIAGNOSTICS) {
      diagnostics.push({
        code,
        path: currentPath,
        message,
      });
      return;
    }

    exhausted = true;
    diagnostics[MAX_DIAGNOSTICS - 1] = {
      code,
      path: currentPath,
      message: "Further validation errors suppressed.",
    };
  }

  function copy(
    current: unknown,
    currentPath: string,
    depth: number,
  ): unknown {
    budget.visited += 1;

    if (budget.visited > budget.maxNodes) {
      exhausted = true;
      return undefined;
    }

    if (
      current === null ||
      typeof current === "string" ||
      typeof current === "boolean"
    ) {
      return current;
    }

    if (typeof current === "number") {
      if (!Number.isFinite(current)) {
        fail(
          currentPath,
          `Non-finite numbers are not supported at "${currentPath}".`,
        );
        return undefined;
      }

      return Object.is(current, -0) ? 0 : current;
    }

    if (typeof current !== "object") {
      fail(
        currentPath,
        `Unsupported JSON value at "${currentPath}".`,
      );
      return undefined;
    }

    if (depth >= budget.maxDepth) {
      fail(
        currentPath,
        `Maximum JSON nesting depth of ${budget.maxDepth} exceeded at "${currentPath}".`,
        RESOURCE_LIMIT_CODE,
      );
      return undefined;
    }

    if (ancestors.has(current)) {
      fail(
        currentPath,
        `Circular reference detected at "${currentPath}".`,
      );
      return undefined;
    }

    try {
      const prototype = Object.getPrototypeOf(current);
      const isArray = Array.isArray(current);

      if (
        !isArray &&
        prototype !== Object.prototype &&
        prototype !== null
      ) {
        fail(
          currentPath,
          `Only plain objects are supported at "${currentPath}".`,
        );
        return undefined;
      }

      const keys = Reflect.ownKeys(current);
      const descriptors = new Map<PropertyKey, PropertyDescriptor>();
      const childCount = keys.length - (isArray ? 1 : 0);
      const remainingNodes = budget.maxNodes - budget.visited;

      if (childCount > remainingNodes) {
        fail(
          currentPath,
          `Maximum JSON node budget of ${budget.maxNodes} exceeded.`,
          RESOURCE_LIMIT_CODE,
        );
        return undefined;
      }

      for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(current, key);

        if (!descriptor) {
          fail(
            currentPath,
            `Unable to inspect the value at "${currentPath}".`,
          );
          return undefined;
        }

        descriptors.set(key, descriptor);
      }

      const result: unknown[] | Record<string, unknown> = isArray
        ? []
        : {};

      ancestors.add(current);

      try {
        if (isArray) {
          const array = current as unknown[];
          const output = result as unknown[];

          for (const key of keys) {
            if (key === "length") {
              continue;
            }

            if (
              typeof key !== "string" ||
              !/^(0|[1-9]\d*)$/.test(key) ||
              Number(key) >= array.length ||
              String(Number(key)) !== key
            ) {
              fail(
                currentPath,
                `Unsupported array property at "${currentPath}".`,
              );
              return undefined;
            }

            const descriptor = descriptors.get(key)!;

            if (
              !descriptor.enumerable ||
              !("value" in descriptor)
            ) {
              fail(
                `${currentPath}[${key}]`,
                `Array entries must be enumerable data properties at "${currentPath}[${key}]".`,
              );
              return undefined;
            }
          }

          if (keys.length !== array.length + 1) {
            fail(
              currentPath,
              `Sparse arrays are not supported at "${currentPath}".`,
            );
            return undefined;
          }

          for (let index = 0; index < array.length; index += 1) {
            const key = String(index);
            const descriptor = descriptors.get(key);

            if (!descriptor || !("value" in descriptor)) {
              fail(
                `${currentPath}[${index}]`,
                `Sparse arrays are not supported at "${currentPath}[${index}]".`,
              );
              return undefined;
            }

            output.push(
              copy(
                descriptor.value,
                `${currentPath}[${index}]`,
                depth + 1,
              ),
            );

            if (exhausted) {
              return undefined;
            }
          }

          return Object.freeze(output);
        }

        const output = result as Record<string, unknown>;

        for (const key of keys) {
          if (typeof key !== "string") {
            fail(
              currentPath,
              `Symbol keys are not supported at "${currentPath}".`,
            );
            return undefined;
          }

          const descriptor = descriptors.get(key)!;

          if (
            !descriptor.enumerable ||
            !("value" in descriptor)
          ) {
            fail(
              `${currentPath}.${key}`,
              `Object properties must be enumerable data properties at "${currentPath}.${key}".`,
            );
            return undefined;
          }

          const copied = copy(
            descriptor.value,
            `${currentPath}.${key}`,
            depth + 1,
          );

          if (exhausted) {
            return undefined;
          }

          Object.defineProperty(output, key, {
            value: copied,
            enumerable: true,
            writable: false,
            configurable: false,
          });
        }

        return Object.freeze(output);
      } finally {
        ancestors.delete(current);
      }
    } catch {
      fail(
        currentPath,
        `Unable to inspect the value at "${currentPath}".`,
      );
      return undefined;
    }
  }

  let snapshot: unknown;

  try {
    snapshot = copy(value, path, 0);
  } catch {
    fail(path, `Unable to inspect the value at "${path}".`);
  }

  if (budget.visited > budget.maxNodes) {
    fail(
      path,
      `Maximum JSON node budget of ${budget.maxNodes} exceeded at "${path}".`,
      RESOURCE_LIMIT_CODE,
    );
  } else if (exhausted && diagnostics.length === 0) {
    fail(path, "Further validation errors suppressed.");
  }

  if (diagnostics.length > 0 || exhausted) {
    return { ok: false, diagnostics };
  }

  return { ok: true, value: snapshot };
}
function canonicalize(
  value: unknown,
  budget: ResourceBudget,
): unknown {
  consumeWork(budget);

  if (typeof value === "string") {
    consumeOutputChars(budget, value.length);
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item, budget));
  }

  if (isRecord(value)) {
    const keys = Object.keys(value);

    // Charge for processing keys before sorting or copying them.
    consumeWork(budget, keys.length);

    let keyChars = 0;
    for (const key of keys) {
      keyChars += key.length;
    }
    consumeOutputChars(budget, keyChars);

    const result: Record<string, unknown> = {};

    for (const key of keys.sort()) {
      setOwn(result, key, canonicalize(value[key], budget));
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
  budget: ResourceBudget,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const key of Object.keys(inherited)) {
    consumeWork(budget);
    setOwn(result, key, inherited[key]);
  }

  for (const key of Object.keys(overrides)) {
    consumeWork(budget);

    const inheritedValue = Object.hasOwn(result, key)
      ? result[key]
      : undefined;
    const overrideValue = overrides[key];

    if (isRecord(inheritedValue) && isRecord(overrideValue)) {
      setOwn(
        result,
        key,
        mergeObjectValues(inheritedValue, overrideValue, budget),
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
  budget: ResourceBudget,
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

      const inheritedItems = Array.isArray(inheritedValue)
        ? inheritedValue
        : [];
      const appendedItems = overrideValue.$append;

      consumeWork(budget, inheritedItems.length + appendedItems.length);

      setOwn(properties, key, [
        ...inheritedItems,
        ...appendedItems,
      ]);
    } else if (
      propertySchema?.type === "object" &&
      isRecord(inheritedValue) &&
      isRecord(overrideValue)
    ) {
      setOwn(
        properties,
        key,
        mergeObjectValues(inheritedValue, overrideValue, budget),
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
  budget: ResourceBudget,
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
  if (stack.length >= budget.maxDepth) {
    throw new ResourceLimitError(
      `Resource limit exceeded: maxDepth of ${budget.maxDepth} exceeded while resolving inheritance.`,
    );
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
      budget,
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
    budget,
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
  budget: ResourceBudget,
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
    consumeWork(budget);
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
    setOwn(properties, key, value);
    return value;
  }
  function resolveToken(
    mode: "value" | "object" | "text",
    sourceType: "property" | "context",
    sourcePath: string,
    targetPath: string,
  ): unknown {
    consumeWork(budget);
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
    const scanWork = Math.max(1, Math.ceil(value.length / 1024));
    consumeWork(budget, scanWork);

    const expression =
      /^\$\{(value|object|text):(property|context)\.([^{}]+)\}$/;
    const exactMatch = value.match(expression);
    if (exactMatch) {
      const replacement = resolveToken(
        exactMatch[1] as "value" | "object" | "text",
        exactMatch[2] as "property" | "context",
        exactMatch[3]!,
        path,
      );

      if (
        exactMatch[1] === "text" &&
        typeof replacement === "string"
      ) {
        consumeInterpolatedChars(budget, replacement.length);
      }

      return replacement;
    }
    consumeWork(budget, scanWork);
    if (!value.includes("${")) {
      return value;
    }
    const tokenPattern =
      /\$\{(value|object|text):(property|context)\.([^{}]+)\}/g;
    let result = "";
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    consumeWork(budget, scanWork);
    while ((match = tokenPattern.exec(value)) !== null) {
      const literalLength = match.index - lastIndex;
      consumeInterpolatedChars(budget, literalLength);
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

      const replacementText = replacement as string;
      consumeInterpolatedChars(budget, replacementText.length);
      result += replacementText;
      lastIndex = match.index + match[0].length;
    }
    consumeInterpolatedChars(budget, value.length - lastIndex);
    result += value.slice(lastIndex);
    consumeWork(
      budget,
      Math.max(1, Math.ceil(result.length / 1024)),
    );
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
    consumeWork(budget);
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

      consumeWork(budget, value.length);

      return value.map((item, index) =>
        resolveValue(item, undefined, `${path}[${index}]`),
      );
    }
    if (isRecord(value)) {
      const keys = Object.keys(value);
      consumeWork(budget, keys.length);

      const result: Record<string, unknown> = {};
      for (const key of keys.sort()) {
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

  const sourceKeys = Object.keys(sourceProperties);
  consumeWork(budget, sourceKeys.length);

  for (const key of sourceKeys.sort()) {
    resolveProperty(key);
  }

  return { properties, diagnostics };
}
function validateComponentInternal(
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
  budget: ResourceBudget,
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

  if (componentStack.length >= budget.maxDepth) {
    throw new ResourceLimitError(
      `Resource limit exceeded: maxDepth of ${budget.maxDepth} exceeded while compiling nested components.`,
    );
  }

  consumeWork(budget);

  const propertiesWithDefaults: Record<string, unknown> = {};

  for (const key of Object.keys(schema.properties)) {
    consumeWork(budget);
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
    budget,
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
      budget,
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
    budget,
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
  const diagnostics = validateComponentInternal(
    schema,
    effectiveComponent,
  );
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
          budget,
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
      budget,
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
export function validateComponent(
  schema: ComponentSchema,
  component: ComponentDefinition,
): Diagnostic[] {
  const budget: SnapshotBudget = {
    visited: 0,
    maxNodes: MAX_JSON_NODES,
    maxDepth: MAX_JSON_DEPTH,
  };

  const schemaSnapshot = snapshotJsonSafeValue(
    schema,
    "schema",
    budget,
  );
  const componentSnapshot = snapshotJsonSafeValue(
    component,
    "component",
    budget,
  );

  const diagnostics: Diagnostic[] = [];

  if (!schemaSnapshot.ok) {
    diagnostics.push(...schemaSnapshot.diagnostics);
  }

  if (!componentSnapshot.ok) {
    diagnostics.push(...componentSnapshot.diagnostics);
  }

  if (!schemaSnapshot.ok || !componentSnapshot.ok) {
    return diagnostics;
  }

  return validateComponentInternal(
    schemaSnapshot.value as ComponentSchema,
    componentSnapshot.value as ComponentDefinition,
  );
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

    if (
      key.trim() === "" ||
      key === "__proto__" ||
      !isRecord(property)
    ) {
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

      const validDefaultType =
        defaultValue === null
          ? nullable
          : matchesType(
              defaultValue,
              property.type as PropertyType,
            );

      if (!validDefaultType) {
        invalidPaths.push(`${path}.default`);
      }
    }

    if (property.type === "array" && !Object.hasOwn(property, "items")) {
      invalidPaths.push(`${path}.items`);
    }

    if (property.type !== "array" && Object.hasOwn(property, "items")) {
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
export type CompileComponentInternalOptions = {
  schema: ComponentSchema;
  component: ComponentDefinition;
  registry?: readonly ComponentDefinition[];
  schemas?: readonly ComponentSchema[];
  context?: CompilationContext;
  limits?: Partial<Limits>;
};

export function compileComponentInternal(
  options: CompileComponentInternalOptions,
): CompileResult {
  const limits = resolveLimits(options.limits);

  const schema = options.schema;
  const component = options.component;
  const registry = options.registry ?? [];
  const schemas = options.schemas ?? [schema];
  const context = options.context ?? {};

  const budget: SnapshotBudget = {
    visited: 0,
    maxNodes: limits.maxSnapshotNodes,
    maxDepth: limits.maxSnapshotDepth,
  };

  const snapshotInput = (value: unknown, path: string) =>
    value === undefined
      ? { ok: true as const, value }
      : snapshotJsonSafeValue(value, path, budget);

  const schemaSnapshot = snapshotInput(schema, "schema");
  const componentSnapshot = snapshotInput(component, "component");
  const registrySnapshot = snapshotInput(registry, "registry");
  const schemasSnapshot = snapshotInput(schemas, "schemas");
  const contextSnapshot = snapshotInput(context, "context");

  const snapshotDiagnostics: Diagnostic[] = [];

  for (const snapshot of [
    schemaSnapshot,
    componentSnapshot,
    registrySnapshot,
    schemasSnapshot,
    contextSnapshot,
  ]) {
    if (!snapshot.ok) {
      snapshotDiagnostics.push(...snapshot.diagnostics);
    }
  }

  if (
    snapshotDiagnostics.length > 0 ||
    !schemaSnapshot.ok ||
    !componentSnapshot.ok ||
    !registrySnapshot.ok ||
    !schemasSnapshot.ok ||
    !contextSnapshot.ok
  ) {
    return {
      ok: false,
      diagnostics: snapshotDiagnostics,
    };
  }

  const validSchema = schemaSnapshot.value as ComponentSchema;
  const validComponent =
    componentSnapshot.value as ComponentDefinition;
  const validRegistry =
    registrySnapshot.value as readonly ComponentDefinition[];
  const validSchemas =
    schemasSnapshot.value as readonly ComponentSchema[];
  const validContext =
    contextSnapshot.value as CompilationContext;

  if (!isRecord(validSchema)) {
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

  if (!isRecord(validComponent)) {
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
    !Array.isArray(validRegistry) ||
    !validRegistry.every(
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
    !Array.isArray(validSchemas) ||
    !validSchemas.every(
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

  if (!isRecord(validContext)) {
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

  const invalidNestedSchemaDiagnostics =
    validSchemas.flatMap((candidate, index) =>
      getInvalidComponentSchemaPaths(candidate).map((path) => {
        const nestedPath =
          `schemas[${index}].${path.replace(/^schema\./, "")}`;

        return {
          code: "INVALID_SCHEMA",
          path: nestedPath,
          message: `Invalid schema definition at "${nestedPath}".`,
        };
      }),
    );

  if (invalidNestedSchemaDiagnostics.length > 0) {
    return {
      ok: false,
      diagnostics: invalidNestedSchemaDiagnostics,
    };
  }

  const resourceBudget: ResourceBudget = {
    workRemaining: limits.maxWork,
    maxWork: limits.maxWork,
    maxDepth: limits.maxDepth,
    interpolatedChars: 0,
    maxInterpolatedChars: limits.maxInterpolatedChars,
    outputChars: 0,
    maxOutputChars: limits.maxOutputChars,
  };

  try {
    const result = compileInternal(
      validSchema,
      validComponent,
      validRegistry,
      validSchemas,
      validContext,
      resourceBudget,
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
      json: JSON.stringify(canonicalize(result.output, resourceBudget), null, 2),
      diagnostics: [],
    };
  } catch (error) {
    if (!(error instanceof ResourceLimitError)) {
      throw error;
    }

    return {
      ok: false,
      diagnostics: [{
        code: RESOURCE_LIMIT_CODE,
        path: "",
        message: error.message,
      }],
    };
  }
}
export function compileComponent(
  schema: ComponentSchema,
  component: ComponentDefinition,
  registry: readonly ComponentDefinition[] = [],
  schemas: readonly ComponentSchema[] = [schema],
  context: CompilationContext = {},
): CompileResult {
  return compileComponentInternal({
    schema,
    component,
    registry,
    schemas,
    context,
  });
}
