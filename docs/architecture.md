# Decoframe Architecture

## 1. Purpose and scope

This document describes the architecture of Decoframe as currently implemented. It explains the framework's composition model, the flow from declarations to resolved output, the responsibilities of its principal source modules, and the constraints that shape its implementation.

The intended audience is developers who need to understand, maintain, evaluate, or extend the framework.

The document distinguishes three concerns:

- **Vision:** why Decoframe exists and the principles that guide it.
- **Specification:** the defined behavior of the framework, including detailed composition rules, validation behavior, diagnostics, and resource limits.
- **Architecture:** how the current implementation is organized, how its parts relate, and what architectural consequences follow from that organization.

Architectural decisions provide a further record of specific choices, their rationale, and their consequences. The decisions discussed during the preparation of this document have been agreed in principle but have not yet been formally recorded in the repository.

Decoframe's conceptual foundation is composition. Its current implementation realizes that concern through component definitions, schemas, properties, relationships, and resolution mechanisms. The conceptual scope should not be interpreted as evidence that alternative representations are supported or planned.

This document describes the current system first. It discusses limitations, trade-offs, and possible evolution only where the available implementation evidence supports doing so. It does not prescribe speculative redesigns or independently redefine the framework's behavioral contract.

## 2. Architectural overview

Decoframe is an object-oriented declarative composition framework. Callers provide component definitions and applicable inputs; the framework validates those inputs, resolves the relevant composition rules, and produces structured output or diagnostics.

At a conceptual level, the process can be summarized as:

`Declarations and applicable inputs → Validation and composition → Resolved JSON or diagnostics`

This is a conceptual overview, not a literal call graph. It summarizes the framework's purpose without suggesting that every public operation follows the same execution path.

The current source organization has three principal roles:

- **`src/index.ts`** exposes the public API and associated types.
- **`src/internal.ts`** exposes additional compiler entry points and resource-limit utilities intended for internal development and testing.
- **`src/core.ts`** contains the main implementation of validation, composition, resolution, resource control, and output generation.

These roles are distinctions within the current implementation, not independently deployable subsystems. The principal implementation responsibilities are concentrated in `src/core.ts`.

The public `compileComponent()` function delegates to `compileComponentInternal()`. The public `validateComponent()` function follows a separate validation path rather than passing through the internal compilation entry point.

The resulting architecture therefore has a shared implementation core with distinct public operations and entry points. Its organization should be understood from the actual relationships between those operations, not inferred solely from module names or the conceptual flow above.

## 3. Current composition model

### 3.1 Composition as the conceptual foundation

Composition is Decoframe's fundamental concern. It describes how declared elements and their relationships are combined into an effective result.

In the current model, component definitions are the primary composable units. Their schemas describe the properties and relationships available to the framework, while supplied definitions and applicable overrides provide the inputs from which effective component results are resolved.

This distinction between the fundamental concern and its current representation does not establish a requirement for a generalized composition interface or support for alternative representations. Such support would require concrete requirements and a separate architectural decision.

### 3.2 Component definitions and identity

A component definition combines an identity with its defining information, including its schema and properties.

In the current model, component identity is determined by the pair `name` and `version`. Identity is used when locating definitions and resolving relationships between components.

Identity is distinct from:

- **Definition content:** the schema, properties, and relationships associated with a component.
- **Instance overrides:** values supplied for a particular use of a component.
- **Resolved result:** the effective component produced after applicable composition rules have been applied.

Two definitions sharing an identity should not be assumed to be interchangeable merely because of an independently assessed notion of content equality. Likewise, an overridden instance and its underlying definition are not the same conceptual object.

The identity scheme describes the current model; it is not a universal rule for every possible future representation.

### 3.3 Component relationships

The current model includes relationships such as inheritance, nested component values, and references.

These relationships have different roles in composition. Inheritance contributes inherited properties to an effective definition. Nested component values allow a component to contain other components that are resolved as part of its result. References identify components without necessarily embedding their full resolved output.

The framework uses component identity, available definitions, and applicable schemas to resolve these relationships. Their exact lookup rules, compatibility requirements, and diagnostic behavior belong to the specification.

### 3.4 Overrides and composition behavior

Defaults, inheritance, instance overrides, recursive object merging, array replacement, `$append`, and interpolation participate in the formation of effective properties.

These mechanisms do not all have the same semantics. For example, merging object values, replacing an array, and appending to an array represent different operations. Their application depends on the declared property schema and the applicable inputs.

This section identifies the architectural concepts involved; it does not replace the specification's detailed rules for precedence, merge behavior, interpolation, or validation.

### 3.5 Definitions and resolved results

A resolved component is not merely a copy of its original definition. Its effective properties may reflect defaults, inheritance, instance overrides, interpolation, and the resolution of nested components.

The result represents the outcome of applying the current composition rules to the supplied definitions and inputs. It is therefore useful to distinguish the declaration being composed from the effective result produced by resolution.

Three perspectives help describe this model accurately:

- **Model semantics** describe what declarations and relationships mean.
- **Resolution mechanisms** apply those meanings to definitions and inputs.
- **Implementation structure** consists of the concrete functions and data structures that perform the work.

These are conceptual perspectives on the same implemented system, not claims that Decoframe contains three separate subsystems.

## 4. Resolution pipeline and data flow

Compilation consists of preparation, per-component resolution, and conditional property processing. These stages describe the actual execution flow, but they should not be interpreted as a single unconditional path through every operation.

### 4.1 Compilation entry and preparation

`compileComponent()` delegates to `compileComponentInternal()`, which prepares the inputs before entering the internal composition process.

The compilation entry point:

1. Resolves the applicable resource limits and establishes defaults for optional inputs.
2. Takes bounded snapshots of the supplied schema, component, registry, schemas, and context.
3. Returns diagnostics if snapshotting fails.
4. Checks the top-level structures and validates the supplied component schemas.
5. Establishes the resource budget used by the internal compilation process.
6. Calls `compileInternal()` with the validated inputs and the shared compilation state.

If internal compilation succeeds, the result is canonicalized and serialized as formatted JSON. If it produces diagnostics, compilation returns failure rather than successful output.

The entry point also handles `ResourceLimitError`, converting that exception into a `RESOURCE_LIMIT_EXCEEDED` diagnostic. Other exceptions are not indiscriminately converted into compilation diagnostics.

### 4.2 Per-component resolution

`compileInternal()` resolves an individual component in the context of the current compilation.

Its main responsibilities include:

- Establishing the component identity and checking the active component-resolution stack for cycles.
- Enforcing applicable depth and work limits.
- Constructing properties with schema defaults.
- Resolving inheritance.
- Applying instance overrides to the effective properties.
- Resolving interpolations.
- Validating the resulting effective component.
- Processing applicable properties according to their declared types.

Errors at these stages can terminate processing of the current component and propagate diagnostics to the calling level.

Nested component resolution shares relevant compilation state, including the registry, schemas, context, and resource budget. Recursive calls extend the active component stack so that nested resolution can detect cycles and enforce depth limits.

Inheritance resolution has its own cycle and lookup logic. Inheritance cycles and cycles encountered during nested component resolution are distinct cases and should not be conflated.

### 4.3 Conditional property compilation

After effective properties have been prepared and validated, the compiler processes applicable properties in a deterministic key order.

The processing path depends on the property's schema:

- **Ordinary values** are copied into the resolved properties as appropriate.
- **References** are checked against the component registry and applicable schema constraints. A successful reference remains a reference rather than automatically becoming a fully resolved nested component.
- **Direct component properties** are resolved through component lookup, schema selection, and recursive compilation.
- **Arrays of components** process their items conditionally. Component items may require identity lookup, schema compatibility checks, and recursive resolution; ordinary items follow a different path.

Not every property follows the same resolution path. The array-item and component branches also have conditional behavior, so the pipeline should not be interpreted as requiring every value to undergo recursive compilation.

Diagnostics may accumulate during property processing. The component returns failure if diagnostics have accumulated; otherwise, the resolved component is returned with its identity, schema, and effective properties.

### 4.4 Validation as a separate operation

`validateComponent()` has its own path. It snapshots the schema and component using its validation snapshot limits, returns snapshot diagnostics if necessary, and otherwise calls `validateComponentInternal()` directly.

It does not enter the full compilation pipeline. This distinction matters when describing public behavior: validation and compilation are related operations, but they are not simply two names for the same execution path.

### 4.5 Canonicalization, serialization, and resource controls

Successful compilation canonicalizes the resolved output before serializing it as formatted JSON. Canonicalization sorts object keys and recursively processes values, contributing to deterministic output.

Resource controls apply at different stages. Snapshotting has node and depth limits; compilation has work and composition-depth limits; interpolation has a character budget; and canonicalization accounts for output-related characters and work.

The output character budget is enforced during canonicalization by accounting for string values and object keys. It should not be described as a direct measurement of the final serialized JSON's byte size.

These controls are part of the execution model, not merely deployment configuration. Their exact defaults, accounting rules, and observable consequences are defined by the specification.

## 5. Implementation components and responsibilities

The principal source responsibilities are summarized below.

| Module or area | Responsibility | Boundary and relationship |
|---|---|---|
| `src/index.ts` | Public functions and exported types | Exposes `compileComponent()` and `validateComponent()` as the public source API. |
| `src/internal.ts` | Internal compiler entry point and resource-limit utilities | Provides additional access intended for testing and development; this does not automatically make these utilities part of the public API contract. |
| `src/core.ts` | Main framework implementation | Contains the implementation of validation, composition, resolution, resource control, and output generation. |
| Tests | Verification of framework behavior and internal paths | Tests exercise public functionality and selected internal functionality. |
| Build and package configuration | Defines compilation and runtime assumptions | Establishes the TypeScript build and the environment in which tests execute. |

The source-level API boundary is explicit, but it should not be confused with a fully enforced package-distribution boundary. The package is currently private, and its configuration does not define a package export map that independently enforces the distinction between public and internal entry points.

The current build uses TypeScript with strict checking, ES2023 as the target, NodeNext module resolution, and ECMAScript modules. The declared Node.js requirement is version 24 or later. The test workflow builds the TypeScript output and runs Node's test runner against the built JavaScript entry points.

These configuration details matter insofar as they establish the current execution and testing environment. They do not, by themselves, establish broader portability or distribution guarantees.

The concentration of implementation responsibilities in `src/core.ts` is an important structural fact. The module contains several related but distinguishable concerns. This does not establish that those concerns are improperly coupled or that the module must be split. It does mean that changes to different aspects of the framework may intersect within the same implementation module, a consideration when evaluating future maintenance or architectural changes.

## 6. Architectural rationale and trade-offs

### 6.1 Composition and representation

Treating composition as the fundamental concern distinguishes the framework's conceptual purpose from the particular representation currently used to realize it.

This distinction allows the architecture to be discussed without making the current component model synonymous with every conceivable form of composition. Its consequence is conceptual flexibility, not an existing abstraction or a commitment to implement alternatives.

### 6.2 Semantics and implementation mechanisms

Distinguishing model semantics from resolution mechanisms and implementation structure helps prevent an implementation detail from being mistaken for a fundamental behavioral rule.

The implementation may change while preserving the applicable behavior and established constraints. Conversely, a change that alters established behavior should not be treated as a purely internal refactoring merely because it is implemented within existing functions.

Documentation that clarifies existing intent is different from a decision to change behavior. The specification remains the reference for defined behavior, while architectural decisions should record consequential choices that require explicit agreement.

This distinction does not require separate modules for semantics and mechanisms. It establishes a way to reason about changes even when the relevant responsibilities remain co-located.

### 6.3 Component identity

The current `name`-and-`version` identity scheme provides the basis for locating components and resolving their relationships.

Separating identity from definition content, instance overrides, and resolved output makes it easier to reason about what a reference identifies and how a component's effective result is produced.

The trade-off is that identity rules influence multiple parts of resolution. Any future identity change would therefore need to consider lookup, inheritance, references, nested resolution, and cycle detection together. This is a consideration for evaluating a concrete proposal, not a reason to redesign identity pre-emptively.

### 6.4 Concentrated implementation responsibilities

The implementation currently groups several major responsibilities in `src/core.ts`. Keeping related processing in one module is a fact about the present structure; whether a different organization would be better depends on demonstrated needs.

Modularization could be evaluated if concrete evidence showed that the current organization materially impeded testing, maintenance, or evolution. In the absence of such evidence, the architecture document should record the structure accurately rather than label it a defect or prescribe a refactoring.

## 7. Boundaries, dependencies, and constraints

### 7.1 Public and internal source boundaries

`src/index.ts` defines the intended public source API, while `src/internal.ts` provides additional entry points for internal use. Both depend on implementation functionality in `src/core.ts`.

This is a source-level distinction. The current package configuration does not independently enforce the same boundary through an export map, so the architecture should not claim stronger package-level isolation than the configuration provides.

### 7.2 Runtime and build environment

The current project declares Node.js 24 or later, uses ECMAScript modules, and compiles TypeScript under strict checking with an ES2023 target and NodeNext module resolution.

The build produces JavaScript in `dist/`. The test workflow builds first and then executes the tests against that output.

These are the current implementation and verification assumptions. A change to the runtime, module format, build process, or distribution model would need to account for their effects on the source entry points and tests.

### 7.3 Dependencies and external boundaries

The architecture should identify dependencies only where they materially affect module responsibilities, runtime assumptions, or architectural constraints.

The build and test environment forms an important external boundary: the framework is developed and verified through the configured TypeScript and Node.js toolchain. Further claims about dependency isolation or the absence of particular external dependencies should be based on a complete review of the relevant configuration and source rather than inferred from the high-level module organization.

### 7.4 Resource constraints

The framework applies resource controls to input snapshotting, work performed during compilation, composition depth, interpolation, and output canonicalization.

These controls constrain the processing of supplied definitions and the production of resolved output. They also influence failure handling, because exceeding certain limits can result in diagnostics rather than successful compilation.

The implementation applies these controls at distinct stages. They should not be reduced to a single generic claim that all inputs or outputs are subject to one uniform size limit.

The specification remains authoritative for the exact limits, defaults, accounting behavior, and resulting diagnostics.

## 8. Evolution and open architectural questions

Architectural evolution should begin with a demonstrated requirement, problem, or constraint. A possible improvement is not, by itself, evidence that the current design is deficient.

### 8.1 Structural questions

The concentration of responsibilities in `src/core.ts` is a known characteristic of the current implementation. Whether those responsibilities should be separated is an open question only in the general sense that future evidence may justify evaluating it.

Relevant evidence could include repeated unintended interactions between responsibilities, material difficulty testing or maintaining distinct concerns, or a demonstrated requirement for a clearer implementation boundary.

These are possible criteria for a future evaluation, not claims that such problems currently exist.

### 8.2 Future representations and identity

Alternative composition representations may be considered if concrete requirements arise. Their conceptual possibility does not establish current support, a planned abstraction, or a roadmap commitment.

Likewise, the current component identity scheme may be revisited if a justified requirement emerges. Any proposal would need to evaluate the effects on lookup, inheritance, references, nested resolution, and cycle detection, alongside the relevant behavioral contract and implementation constraints.

Neither possibility requires an immediate change.

### 8.3 Conditions for architectural change

A proportionate architectural evaluation should:

1. Identify the requirement, problem, or constraint that motivates the change.
2. Establish which model semantics, resolution mechanisms, implementation boundaries, and observable behaviors are affected.
3. Evaluate relevant alternatives and their consequences against the evidence.
4. Preserve applicable contracts and constraints unless a behavior change is explicitly approved through the project's decision process.
5. Update the specification and architectural records where the resulting decision warrants it.

Not every implementation change requires a new architectural decision. The level of review should reflect the significance of the change and its consequences.

An open architectural question is not automatically a defect, task, or commitment. Recording a possibility preserves it for future evaluation without implying that intervention is necessary.
