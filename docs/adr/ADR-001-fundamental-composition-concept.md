# ADR-001: Fundamental Composition Concept

**Status:** Accepted

**Decision scope:** Conceptual foundation of Decoframe

## 1. Context

Decoframe is an object-oriented declarative composition framework for defining reusable components and resolving their relationships into predictable, validated output.

Its current model expresses composable units through component definitions. These definitions specify schemas, properties, and relationships that the framework validates and resolves.

Defining composition itself as inherently component-based would tie the fundamental concept to its current representation. Conversely, adopting a generalized composition architecture without demonstrated requirements would risk premature abstraction and imply implementation flexibility that has not been established.

Decoframe therefore needs an explicit distinction between its fundamental composition concept, the representation used by its current model, and the mechanisms that apply composition rules to declarations and relationships.

This distinction must clarify the conceptual foundation without overstating the capabilities of the current implementation or requiring changes to established behavior.

## 2. Decision

Composition is Decoframe’s fundamental concern and is conceptually independent of any particular representation of composable units; component definitions are the primary composable units in the current model, and no support for alternative representations is implied.

The following concepts are distinct:

- **Composition:** The fundamental concern and the rules governing how declared elements and their relationships are combined.
- **Current representation:** Component definitions, including their schemas, properties, and relationships, through which the current model expresses composable units.
- **Resolution:** The process that applies composition rules to declarations and their relationships to produce a resolved result.

These concepts describe related aspects of Decoframe, not necessarily separate implementation subsystems.

Future architectural proposals must respect this distinction unless a subsequent architectural decision explicitly revises or supersedes the principle.

## 3. Consequences

### 3.1 Architectural terminology

Architecture documentation and design discussions must distinguish composition from the component-definition representation used by the current model.

Composition is the fundamental concern; component definitions are the primary composable units in the current model. The terms should not be treated as interchangeable.

### 3.2 Architectural reasoning

Future architectural proposals should distinguish between:

- Changes to composition semantics.
- Changes to the representation of composable units.
- Changes to the mechanisms used to resolve declarations and relationships.
- Changes to the implementation structures through which those mechanisms operate.

These distinctions help clarify a proposal's intent and consequences. They do not imply that each concern must be implemented independently or assigned to a separate module.

### 3.3 Conceptual independence and implementation independence

Conceptual independence does not establish implementation independence. Composition is defined independently of the representation of its composable units, but Decoframe's current implementation operates on component definitions. This decision neither establishes that the implementation can operate on alternative representations nor requires it to do so.

### 3.4 Future generalization

The principle permits future architectural proposals to consider alternative representations when concrete requirements justify them. It does not establish a requirement, roadmap commitment, or presumption in favor of generalization.

Any such proposal must evaluate its requirements, implications for existing semantics and resolution behavior, implementation consequences, and need for a separate architectural decision.

### 3.5 Documentation consistency

The architecture documentation should remain consistent with this principle and accurately distinguish the conceptual composition model from its current implementation. The specification remains responsible for defining the observable behavior and rules of the current model. This decision does not require either document to reproduce the full ADR or mandate an immediate documentation change.

## 4. Implementation Impact

Adopting this principle does not itself change existing composition semantics, resolution behavior, or the public API contract. It requires no immediate implementation changes. The current component-definition model and its existing behavior remain governed by the applicable specification and established architectural decisions. Any future changes remain subject to the appropriate review and decision process.

## 5. Documentation Responsibilities

The project documentation and architectural decision records have distinct responsibilities:

- **ADR-001:** Establishes and justifies the fundamental composition principle, including its consequences, limitations, and alternatives.
- **`docs/architecture.md`:** Explains the current architecture and implementation structure consistently with the principle, without implying that the implementation is independent of component definitions.
- **`docs/specification.md`:** Defines the observable behavior and applicable rules of the current composition model.
- **Future ADRs:** Record separately justified architectural decisions, including changes to representation, resolution, identity, or other architectural concerns where appropriate. They must explicitly address any relevant existing decisions they revise or supersede.

These documents should remain consistent without duplicating one another's full content.

## 6. Alternatives Considered

The following are the meaningful positions considered for this decision. They are not an exhaustive survey of every possible composition architecture.

### Alternative 1: Define composition as inherently component-based

**Position:** Define composition directly in terms of component definitions, making the current representation part of the fundamental concept.

**Reason for not selecting:** This reflects the current model but conflates the broader composition concern with the representation through which the current model expresses composable units. It unnecessarily ties the conceptual definition to the current representation.

This alternative's rejection does not imply that component definitions are an unsuitable representation. They remain the primary composable units in the current model.

### Alternative 2: Adopt a generalized composition architecture

**Position:** Establish a generalized architecture intended to support alternative representations of composable units.

**Reason for not selecting:** No concrete requirement currently justifies this generalization. Adopting it now risks premature abstraction, additional complexity, and an implied degree of implementation flexibility that has not been established.

This alternative is not prohibited as a future direction. It is not justified by the requirements established for this decision and may be reconsidered through a separately justified architectural proposal.

### Alternative 3: Define composition independently while retaining the current representation

**Position:** Treat composition as the fundamental conceptual concern, retain component definitions as the primary composable units in the current model, and distinguish both from the mechanisms used to resolve them.

**Reason for selecting:** This establishes the conceptual distinction without misrepresenting current implementation capabilities or committing to unsupported generalization. It provides a normative principle for future architectural reasoning while leaving existing implementation structure and behavior unchanged by the decision itself.

## 7. Scope and Boundaries

This decision establishes a conceptual and normative principle for architectural reasoning. Its scope is limited to the relationship between composition, the representation of composable units, and the mechanisms used to resolve them.

It does not:

- Establish a universal composition interface or generalized composition architecture.
- Require or pre-approve alternative representations of composable units.
- Require implementation-module separation, new abstraction layers, or other restructuring.
- Change existing composition semantics, resolution behavior, or the public API contract.
- Make the current component-definition model or its implementation immutable.
- Authorize changes to established behavior without the appropriate review and decision process.

Alternative representations, generalized abstractions, and implementation restructuring remain outside this decision. They may be considered separately when supported by concrete requirements and evaluated through the appropriate architectural decision process.

## 8. Status and Future Review

This ADR is accepted. It establishes the fundamental composition principle for Decoframe and provides a normative basis for future architectural reasoning.

Future proposals that materially alter this principle should explicitly identify the change, explain its justification and consequences, and follow the project's established architectural decision process. Where appropriate, the relevant ADR should be revised or superseded explicitly rather than silently reinterpreted.
