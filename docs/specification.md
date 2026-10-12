# Decoframe Specification

**Status:** Initial specification of current implementation  
**Audience:** Contributors, maintainers, and users of the framework

## 1. Purpose and scope

This document describes the observable behaviour of the current Decoframe implementation, including its public API, component model, validation, composition, and compilation behaviour.

It is a baseline for understanding and testing the implementation, not a claim that every current implementation detail is a permanent design commitment. Where behaviour is covered by tests, those tests help establish the current contract. Changes to documented behaviour should be deliberate and accompanied by appropriate tests and documentation updates.

Decoframe is a general-purpose declarative composition framework. Modular prompt architecture is its originating use case, but the framework is not defined exclusively by that application.

## 2. Public API

The package exposes two runtime functions:

- `validateComponent(schema, component): Diagnostic[]`
- `compileComponent(schema, component, registry, schemas, context): CompileResult`

The optional arguments to `compileComponent` have these defaults:

- `registry`: an empty array of component definitions
- `schemas`: an array containing the supplied root schema
- `context`: an empty object

The public entry point also exports the framework's TypeScript types. Internal implementation functions and resource-limit configuration are not part of the public entry point.

### 2.1 Validation

`validateComponent` checks a component definition against a component schema and returns an array of diagnostics. An empty array indicates that no validation problems were found by this validation pass.

Validation covers component identity, schema compatibility, declared properties, required properties, defaults, nullability, property types, and array item types.

This function does not perform the full registry-based compilation process. In particular, successful validation alone does not establish that every referenced or nested component can be resolved during compilation.

### 2.2 Compilation

`compileComponent` resolves a component definition into formatted JSON. Depending on the supplied inputs, compilation can include defaults, inheritance, property merging, interpolation, nested component compilation, and reference resolution.

A successful result has the form:

- `ok: true`
- `json`: the compiled JSON string
- `diagnostics`: an empty array

A failed result has the form:

- `ok: false`
- `diagnostics`: one or more diagnostic records

Each diagnostic contains a `code`, a `path`, and a human-readable `message`.

Compilation can fail because of invalid input, schema or property errors, unresolved or ambiguous components, inheritance or interpolation problems, and resource limits. Unexpected implementation errors are not guaranteed to be converted into diagnostics.

## 3. Component and schema model

### 3.1 Component definitions

A component definition contains:

- `name`: the component's name.
- `version`: the component's version.
- `schema`: the name of the schema the component conforms to.
- `properties`: the component's property values.
- `extends` (optional): a reference identifying a parent component by name and version.

A component's identity is determined by its `name` and `version`. The registry is used to resolve component definitions by this identity.

### 3.2 Component schemas

A component schema contains a `name` and a `properties` object. Each property declaration describes the property's expected type and may specify whether it is required or nullable, a default value, a schema constraint, or array item rules.

Supported property types are:

- `string`
- `number`
- `boolean`
- `object`
- `component`
- `reference`
- `array`

Array item types are restricted to `string`, `number`, `boolean`, `object`, and `component`. Array item declarations may include a schema constraint where supported by the item type.

Schema validation rejects malformed property declarations, unsupported fields, invalid defaults, invalid type declarations, and inconsistent array item definitions.

### 3.3 Required properties, defaults, and nullability

A missing required property is an error unless the property declares a default value. Defaults are incorporated during compilation and can participate in inheritance and subsequent property merging.

A property explicitly declared `nullable: true` may contain `null`. A null default is valid only for a nullable property.

Unknown properties supplied by a component definition are rejected rather than silently included in the compiled result.

## 4. Validation and diagnostics

Validation reports problems using diagnostic records with three fields:

- `code`: a machine-readable diagnostic identifier.
- `path`: the location associated with the problem.
- `message`: a human-readable explanation.

Paths identify the relevant part of the schema, component, or property where possible. Nested compilation can add the path of the containing component or array item.

Validation can report multiple problems in one pass. Compilation stops when it has accumulated diagnostics that prevent successful resolution.

Input processing also checks that values can be safely snapshotted for compilation. Unsupported values, circular structures, and exceeded snapshot limits can cause diagnostics rather than being accepted as ordinary component data.

The exact diagnostic code and path are part of the observable behaviour where covered by tests. Documentation and tests should be updated together when these details intentionally change.

## 5. Inheritance and property merging

### 5.1 Inheritance resolution

A component may extend another component identified by its name and version. The parent must resolve to exactly one definition in the registry.

Compilation reports an error if the parent cannot be found, if multiple definitions match, if the parent uses a different schema, or if the inheritance chain contains a cycle.

Inheritance is resolved recursively. Schema defaults and inherited properties are available to descendants, while child definitions can override inherited values.

### 5.2 Merge behaviour

Property merging follows these rules:

- **Scalar values:** child values replace inherited values.
- **Objects:** when both inherited and overriding values are objects, their properties are merged recursively.
- **Arrays:** ordinary array overrides replace the inherited array; array elements are not automatically merged.
- **Schema-level array properties:** the special `$append` operator can append items to an inherited array.
- **Instance overrides:** overrides supplied for a nested component instance are applied during compilation and can override values inherited by the registered definition.

Object merging preserves inherited keys that are not overridden. When both sides provide an object for a given key, merging continues recursively. If the values are not both objects, the overriding value replaces the inherited value.

Arrays inside ordinary objects follow ordinary replacement behaviour. The `$append` operator is special handling for properties declared as arrays in the component schema; it is not a general-purpose object merge operator.

### 5.3 Array append operator

For a property declared with schema type `array`, an append override has this form:

`{"$append": [item1, item2]}`

The operator object must contain only the `$append` key, and its value must be an array. Invalid operator shapes produce an `INVALID_ARRAY_APPEND` diagnostic.

The append operation combines the inherited array with the supplied items. If no inherited value exists, the operation starts with an empty array. If an inherited value exists but is not an array, compilation fails rather than silently replacing it.

A normal array supplied as an override replaces the inherited array.

A free-form object containing a `$append` key is treated as ordinary data unless the property is declared as a schema-level array property.

### 5.4 Precedence

The effective property set is built from schema defaults, inheritance, and applicable component-instance overrides. Interpolation then resolves against the effective properties and compilation validates the resolved values.

This ordering is significant: defaults can be inherited, child values can override parent values, and instance overrides can customise a nested component without changing its registered definition.

## 6. Property interpolation

Interpolation allows effective property values to be derived from other properties or from a compilation context.

### 6.1 Syntax

The supported expression forms are:

- `${value:property.path}`
- `${object:property.path}`
- `${text:property.path}`
- `${value:context.path}`
- `${object:context.path}`
- `${text:context.path}`

The prefix selects the conversion mode; `property` or `context` selects the source. The remaining path identifies a value using dot-separated keys.

### 6.2 Modes

**`value`** resolves to the source value without converting its type.

**`object`** resolves to a source object or array. Other source types, including `null`, are invalid for this mode.

**`text`** converts a string, boolean, or finite number to text. Text expressions may also be embedded within a larger string.

`value` and `object` expressions must occupy the entire value. They cannot be embedded in a larger string. A `text` expression can occupy the entire value or form part of a string containing literal text.

### 6.3 Resolution behaviour

Interpolation is resolved against effective properties after defaults, inheritance, and applicable instance overrides have been applied.

Property references are resolved as needed, including references to other interpolated properties. Circular property dependencies produce an `INTERPOLATION_CYCLE` diagnostic.

Interpolation is processed recursively within ordinary objects and arrays. Component and reference values are deferred to the corresponding compilation logic rather than treated as ordinary interpolated data.

Malformed or unsupported expressions produce `INVALID_INTERPOLATION`. Missing sources produce `INTERPOLATION_SOURCE_NOT_FOUND`. Sources incompatible with the selected mode produce `INVALID_INTERPOLATION_TYPE`.

After interpolation, the resulting effective properties are validated against the component schema. Preserving a value's type during interpolation does not bypass that validation.

## 7. Nested components and references

### 7.1 Nested components

Properties declared as `component` can contain a component instance to be resolved and compiled recursively. Component instances can supply property overrides that customise the resolved definition.

The target must resolve to exactly one registered component by name and version. Its schema must satisfy any schema constraint declared by the containing property. Compilation also requires exactly one matching schema definition for the nested component's schema name.

Unresolved or ambiguous targets and schema mismatches produce diagnostics. Nested compilation continues recursively, subject to cycle detection and resource limits.

### 7.2 Arrays of components

An array declared with item type `component` can contain component instances. Each item is resolved and compiled using the same general registry and schema-resolution rules as an individual nested component.

The order of array items is preserved in the compiled output. Item-level schema constraints are enforced during compilation.

### 7.3 References

A property declared as `reference` identifies a registered component by name and version. The target must resolve uniquely. If the property declares a schema constraint, the target must conform to that schema name.

References remain lightweight identifiers in the output:

`{"name": "Example", "version": "1.0.0"}`

Unlike nested components, references are not expanded into their full compiled definitions.

### 7.4 Resolution errors

Compilation distinguishes missing targets, ambiguous targets, schema mismatches, missing or ambiguous nested schemas, and component cycles through diagnostic codes. These failures prevent a successful compilation result.

## 8. Output and determinism

### 8.1 Output structure

Successful compilation produces a JSON object with these fields:

- `name`
- `version`
- `schema`
- `properties`

Nested components are expanded recursively into the same structure. References remain lightweight name/version identifiers.

Only properties present in the effective property set, or properties supplied by schema defaults, are emitted. Nullable values explicitly set to `null` are preserved.

### 8.2 Canonical ordering

Object keys are sorted recursively before serialization. Array ordering is preserved.

The resulting JSON is formatted with two-space indentation. Given equivalent resolved data and the same implementation, canonical object-key ordering produces deterministic output.

Deterministic serialization does not imply that different framework versions will necessarily produce identical results if their resolution semantics change.

## 9. Resource limits and input safety

Compilation snapshots its inputs before processing them. This helps isolate compilation from later changes to caller-owned objects and allows unsupported input structures to be diagnosed.

The implementation applies limits to snapshot size and depth, compilation work and depth, interpolated text, and output data.

The current internal defaults are:

| Limit | Default |
|---|---:|
| `maxSnapshotNodes` | 1,000,000 |
| `maxSnapshotDepth` | 100 |
| `maxWork` | 1,000,000 |
| `maxDepth` | 100 |
| `maxInterpolatedChars` | 10,000,000 |
| `maxOutputChars` | 10,000,000 |

These limits are internal implementation settings and are not configurable through the public `compileComponent` API.

Exceeding a resource budget produces a `RESOURCE_LIMIT_EXCEEDED` diagnostic. Output character accounting covers string values and object-key lengths; it does not represent the exact final serialized JSON length, including punctuation and indentation.

Input snapshotting and resource accounting reduce the risk of unbounded work but should not be interpreted as a guarantee that every possible unexpected runtime error is converted into a diagnostic.

## 10. Implementation boundaries

This specification documents the current implementation rather than prescribing every future design decision.

In particular:

- The public entry point exposes `compileComponent` and `validateComponent` as runtime functions.
- Internal helpers and resource-limit configuration are not public API exports.
- Component lookup depends on the supplied registry; the framework does not implicitly discover definitions elsewhere.
- Nested components are expanded during compilation, while references remain identifiers.
- Composition semantics are defined by the implemented schema, inheritance, merge, interpolation, and resolution rules.

Future extensions should preserve the distinction between the framework's general composition model and application-specific conventions. Changes to public behaviour should be supported by tests and documented explicitly.

## 11. Conformance and tests

The principal tests for the current implementation are:

- `tests/framework.test.mjs` — public API behaviour, schema validation, defaults, inheritance, merging, interpolation, nested components, references, deterministic output, and invalid inputs.
- `tests/limits.test.mjs` — resource-limit defaults, validation of limit overrides, budget exhaustion, snapshot limits, nested depth limits, and isolation between compilation calls.

The test suite is executable evidence of the behaviours it covers, not proof that every possible input or edge case has been tested.

When changing behaviour, update or add tests for the intended contract and revise this document where the observable specification changes.
