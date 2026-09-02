# Chromatis target architecture

This document defines the target architecture for Chromatis applications and `@chromatis/base`.

It describes the intended end state: how a correctly structured Chromatis system should look, including its architecture, programming model, tooling, configuration, database, quality controls, and shared technical standards.

It does not describe migration steps or the current implementation state.

## 1. Scope

Chromatis is an opinionated shared platform for multiple web applications.

It centralizes technical decisions that should not be made independently in every application. These include:

* project structure,
* module boundaries,
* TypeScript and ESLint rules,
* formatting,
* UI foundations,
* configuration,
* secrets,
* PostgreSQL,
* development tooling,
* deployment,
* testing conventions.

Chromatis is not a general-purpose framework. It is allowed to make strong decisions where doing so simplifies development, improves consistency, or prevents applications from drifting apart.

Application-specific domain responsibilities do not belong in `@chromatis/base`.

## 2. Design principles

### 2.1 Convention over repeated decisions

Decisions that should be identical across Chromatis applications are made centrally.

An application should only override a shared default when it has a concrete technical or domain-specific reason.

### 2.2 Small public interfaces

Public interfaces express intent and hide implementation details.

This applies to:

* modules,
* tooling,
* infrastructure,
* database access,
* configuration,
* future agent-facing tools.

> Public interfaces describe what should happen. The technical implementation stays internal.

### 2.3 Explicit ownership

Every domain or functional responsibility has exactly one owner.

The owner controls:

* behavior,
* state,
* domain data,
* internal models,
* persistence,
* module configuration,
* module-owned database artifacts.

Other parts of the application interact with that responsibility through its public contract.

### 2.4 Explicit and reproducible systems

Important system state must be visible, inspectable, and reproducible from version-controlled source.

A working application must not depend on undocumented manual changes in a database, deployment environment, or developer machine.

### 2.5 Mechanically enforced standards

Rules that can be checked reliably should be checked automatically.

Documentation explains a rule. It does not replace enforcement where enforcement is practical.

### 2.6 Tooling as a public developer interface

Developers work through a small set of stable project operations.

Tools such as ESLint, Prettier, Taplo, Wrangler, Docker, PostgreSQL utilities, and migration generators are implementation details.

The public command should describe what the developer wants to do, not which internal tool performs the work.

## 3. Technology baseline

| Area                             | Standard                                                              |
| -------------------------------- | --------------------------------------------------------------------- |
| Runtime and package manager      | Bun                                                                   |
| Language                         | TypeScript in strict mode                                             |
| UI                               | React 19                                                              |
| Routing and full-stack framework | React Router 7                                                        |
| Build and local development      | Vite 7                                                                |
| Styling                          | Tailwind CSS 4, CSS, and shared UI foundations from `@chromatis/base` |
| Validation                       | Zod                                                                   |
| Configuration                    | TOML                                                                  |
| Server database                  | PostgreSQL                                                            |
| Quality                          | TypeScript, ESLint, Prettier, architecture checks, and tests          |
| Deployment                       | Cloudflare/Wrangler or Bun in the shared Docker setup                 |
| Canonical local environment      | Linux + VS Code                                                       |

PostgreSQL is a deliberate platform choice. It is not hidden behind a database-agnostic ORM abstraction.

## 4. Application model

Chromatis applications are modular monoliths.

An application is developed, deployed, and operated as one system. Inside that system, domain and functional responsibilities are separated into explicit modules.

### 4.1 Project structure

```text
src/
  app/
  modules/
  adapter/
  helper/
```

## 5. `modules/`

`modules/` contains domain and functional responsibilities.

Examples:

```text
auth
courses
worksheets
quiz
mail
```

A module owns its responsibility completely.

It may contain:

* domain logic,
* state,
* domain models,
* repositories,
* database artifacts,
* UI components,
* hooks,
* configuration definitions,
* secret definitions,
* technical implementation that exists only for that responsibility.

### 5.1 Public entry point

Every module has exactly one public entry point:

```text
modules/<name>/index.ts
```

`index.ts` is the only file allowed directly inside the module directory.

Example:

```text
modules/
  auth/
    index.ts
    domain/
    database/
    repositories/
    config/
    ui/
```

All subdirectories are private outside the module.

`index.ts` contains no substantial implementation. It exports only the deliberately chosen public contract.

Allowed:

```ts
import { getCurrentUser, type CurrentUser } from "@/modules/auth";
```

Not allowed:

```ts
import { SessionRepository } from "@/modules/auth/repositories/session";
```

This restriction also applies to:

* type-only imports,
* relative imports,
* dynamic imports,
* aliases.

### 5.2 Public contracts

Public parameter and return types are part of the owning module's contract.

Internal entities, database models, repository types, and internal state structures remain private unless they are deliberately part of the public API.

There is no global directory for shared domain types.

### 5.3 Choosing module boundaries

Modules are organized by responsibility, not by technical category.

A separate module is usually appropriate when a responsibility:

* owns distinct domain or functional behavior,
* owns its own state or domain data,
* can expose a small meaningful public API,
* can change mostly independently.

If two areas are almost always changed together, share the same state, or repeatedly need access to each other's internals, the boundary is probably wrong.

## 6. `app/`

`app/` is the composition root and thin orchestration layer.

It contains application-level composition such as:

* routing,
* global providers,
* technical composition,
* explicit module composition,
* cross-module workflows,
* central application configuration.

`app/` does not own domain responsibilities.

If an application use case develops its own domain rules, models, state, or persistence, that is a sign that a new module responsibility may have emerged.

> The application layer coordinates. Modules make domain decisions.

## 7. `adapter/`

`adapter/` contains domain-neutral technical infrastructure.

Examples include:

* PostgreSQL connections,
* logging,
* runtime integration,
* deployment-specific adapters,
* technical error handling,
* external technical clients.

Adapters provide capabilities. They do not own:

* domain rules,
* domain state,
* domain data.

An adapter may be PostgreSQL-specific.

Technical interchangeability should only be abstracted when there is a concrete reason for it.

## 8. `helper/`

`helper/` contains small technical helpers that do not justify their own module.

A helper:

* consists of exactly one file,
* does not import from `modules`, `adapter`, or `app`,
* contains no domain state,
* contains no domain rules.

`helper/` must not become a generic `shared` directory.

## 9. Dependency rules

Allowed dependency directions:

```text
app
 ├── module A through its public API
 ├── module B through its public API
 └── adapter

module A
 ├── module B through its public API, where appropriate
 └── adapter

helper
 └── no dependency on app, modules, or adapter
```

Additional rules:

* Code outside a module cannot deep-import into that module.
* A module modifies only the state and domain data it owns.
* Adapters remain domain-neutral.
* Cyclic module dependencies are forbidden.
* A generic `shared` module must not be used to hide unclear ownership or incorrect module boundaries.

When a cycle appears, check whether:

* the responsibilities should belong to one module,
* the shared orchestration belongs in `app/`,
* only a smaller public contract is needed.

## 10. Communication between modules

Modules communicate directly through explicit, typed TypeScript APIs.

Typical interfaces include:

* queries,
* commands,
* functions,
* hooks,
* components.

Example:

```ts
import { getCurrentUser } from "@/modules/auth";
import { enrollUser } from "@/modules/courses";

export async function enrollCurrentUser(courseId: string) {
  const user = await getCurrentUser();

  if (!user) {
    throw new Error("Authentication required");
  }

  return enrollUser({ courseId, userId: user.id });
}
```

If no single module owns the complete workflow, coordination belongs in `app/`.

If one module clearly owns the complete operation, it may coordinate the workflow internally.

General-purpose command buses, event buses, message buses, automatic module registration, universal service frameworks, and custom dependency injection containers are not part of the standard architecture.

They require a concrete reason before being introduced.

## 11. Programming model

### 11.1 Functions and plain data

Chromatis prefers functions and plain data over long-lived object graphs.

Preferred:

```text
dependencies + input -> result
```

Avoid designs shaped around:

```text
create object
-> mutate internal state
-> call methods in a specific order
-> result depends on hidden history
```

### 11.2 State

State is allowed where it is needed, but it must have a clear owner.

Relevant categories include:

* domain state,
* technical state,
* temporary local function state,
* ephemeral UI state.

Long-lived, implicit, or globally mutable state should be avoided.

### 11.3 Immutability

Data objects are treated as values by default.

Chromatis prefers:

* `readonly` contracts,
* creating new values instead of mutating existing ones,
* no parameter mutation,
* `const` instead of `let` when reassignment is unnecessary.

Local `let`, loops, and local mutation remain acceptable when they make the implementation easier to understand.

### 11.4 Classes and inheritance

Classes and inheritance are not part of the normal application programming model.

Application logic should not be structured around mutable service classes, manager singletons, or inheritance hierarchies.

Classes are acceptable where an external library or technical API requires them.

Such cases should remain local and justified.

### 11.5 Dependency passing

Dependencies are passed explicitly.

Deep application code does not import mutable global configuration or reach implicitly into hidden global services.

The composition root creates technical dependencies and passes them to the code that owns the corresponding behavior.

## 12. React and UI state

React is the UI layer. It is not the primary owner of domain state.

Preferred data flow:

```text
URL / Request
    ↓
React Router Loader
    ↓
plain immutable data
    ↓
React Component
    ↓
render
```

Changes usually flow through:

```text
User interaction
    ↓
React Router Action
    ↓
Module function
    ↓
PostgreSQL / State Owner
    ↓
new snapshot
    ↓
render
```

Local React state is appropriate for concerns such as:

* whether a dialog is open,
* focus,
* temporary form values,
* purely visual interaction.

Domain data should not be mirrored unnecessarily through several React state layers.

## 13. Configuration

### 13.1 Ownership

Configuration belongs to the module that uses it.

This may result in several small configuration files. Clear ownership is preferred over one large global configuration file.

Example:

```text
config/
  auth.toml
  courses.toml
  database.toml
  quiz.toml
```

### 13.2 Configuration definitions

A module defines the contract for its configuration.

The definition includes:

* name,
* type,
* default,
* description,
* validation,
* optional deprecation information.

This definition is the source of truth.

TypeScript/Zod types, defaults, runtime validation, and editor schemas are not maintained independently.

### 13.3 Composition

The application explicitly composes module configuration definitions.

There is no implicit global module registration.

### 13.4 Runtime loading

Configuration loading follows this flow:

```text
read TOML
↓
apply defaults for missing values
↓
validate against schema
↓
reject unknown values
↓
produce immutable runtime configuration
```

Missing values:

```text
→ default
```

Invalid values:

```text
→ error
```

Unknown values:

```text
→ error
```

An invalid value is never silently replaced with a default.

### 13.5 Synchronization

The interactive configuration workflow may:

* create missing module configuration files,
* add newly introduced default values,
* update schemas,
* show configuration status.

Loading runtime configuration does not modify files.

## 14. Secrets

Secrets follow the same contract model as normal configuration.

The definition is version-controlled. The secret value is not.

A secret definition may include:

* name,
* owner,
* description,
* required or optional status,
* format and validation,
* safe inspection metadata.

Examples:

```text
DATABASE_URL
SESSION_SECRET
RESEND_API_KEY
```

Secret values are stored through the appropriate local or deployment secret provider.

The public developer interface is interactive:

```sh
bun run secret
```

It can show:

* all known secrets,
* owner,
* description,
* required or optional status,
* whether the value is configured,
* environment,
* safe metadata.

Secret values are never displayed.

Structured secrets may expose non-sensitive details.

For a PostgreSQL connection string, for example:

```text
Host      ep-prod.example.com
Database  studyluma
User      studyluma_owner
Password  ********
```

This makes incorrect targets visible without exposing credentials.

## 15. PostgreSQL

### 15.1 PostgreSQL as a platform choice

PostgreSQL is the standard server database for Chromatis applications.

It is used directly.

An ORM is not part of the standard stack.

Handwritten SQL is explicitly supported.

Applications may use PostgreSQL features including:

* constraints,
* indexes,
* views,
* CTEs,
* `RETURNING`,
* `ON CONFLICT`,
* JSONB,
* PostgreSQL functions,
* PL/pgSQL.

Chromatis does not introduce an abstraction layer solely to preserve the theoretical option of replacing PostgreSQL.

### 15.2 Database as a source-controlled system

The database must not contain hidden structures or functions that exist only because somebody created them manually.

Version-controlled database artifacts include:

* tables,
* columns,
* constraints,
* indexes,
* views,
* PostgreSQL functions,
* PL/pgSQL functions,
* migrations.

A local database must be fully rebuildable from the repository.

### 15.3 Ownership

Database artifacts belong to the module that owns the corresponding data.

A centrally provided PostgreSQL connection does not change that ownership.

### 15.4 Logic in PostgreSQL

Logic may live in PostgreSQL when the database is the appropriate place for it.

Suitable cases include:

* data invariants,
* atomic data changes,
* relational transformations,
* aggregations,
* views,
* operations that affect only data owned by one module.

A database function may implement domain rules belonging to its owning module.

Cross-module orchestration should not become hidden database behavior.

### 15.5 Migrations

Persistent database changes are delivered through versioned migrations.

During development, several intermediate migrations may be consolidated before release so the permanent migration history does not contain unnecessary intermediate steps.

Published and applied migrations are not modified retroactively.

### 15.6 Desired state and drift

Editable SQL artifacts may describe the desired state of views and functions.

Tooling must detect when those definitions diverge from delivered migrations.

Local reset workflows rebuild the database from source and therefore regularly verify that it remains reproducible.

## 16. Quality model

### 16.1 Separation of responsibilities

Each quality tool has a separate responsibility:

```text
TypeScript
→ static type checking

ESLint
→ code quality and architecture

Prettier
→ formatting

Tests
→ behavior
```

These responsibilities should not be duplicated unnecessarily.

### 16.2 TypeScript

TypeScript runs in strict mode.

Inference is used where the result is clear.

Public contracts remain explicitly typed where that improves readability.

### 16.3 ESLint

ESLint is strict and uses errors instead of warnings.

Target:

```text
0 errors
0 warnings
```

Linting runs with:

```sh
eslint . --max-warnings 0
```

The shared configuration includes at least the following rules.

#### Type safety

* no accidental explicit `any`,
* no unsafe propagation of `any`,
* no unsafe calls, member access, or returns,
* no unhandled or misused promises,
* consistent type imports,
* no unused variables or imports,
* no CommonJS `require()` in normal application TypeScript.

#### Readability and maintainability

* `no-var`,
* `prefer-const`,
* `eqeqeq`,
* required braces,
* avoid magic numbers,
* no parameter mutation,
* avoid mutable data structures where practical,
* no unnecessary service classes,
* no inheritance as the default application architecture.

Practical exceptions for magic numbers include values such as:

* `-1`,
* `0`,
* `1`,
* array indices,
* enums,
* numeric literal types.

#### Size limits

Default limits:

```text
max-lines: 500
max-lines-per-function: 100
```

Blank lines and comments do not count toward the file limit.

These limits may be adjusted centrally when practical experience, especially with React and JSX, justifies it.

Individual applications do not weaken them independently.

#### React

React and Hooks rules are enabled centrally.

Checks include:

* Hook dependencies,
* Hook ordering,
* problematic React state patterns.

### 16.4 Architecture enforcement

Architecture rules run as part of the same ESLint execution.

At minimum, enforcement covers:

* allowed dependencies between `app`, `modules`, `adapter`, and `helper`,
* cross-module access only through `index.ts`,
* no deep imports,
* no cyclic module dependencies,
* only `index.ts` directly inside a module directory.

Architecture enforcement is resolver-aware and must account for:

* aliases,
* relative imports,
* type-only imports,
* dynamic imports,
* TypeScript module resolution.

If a file-structure rule cannot be enforced reliably with an existing plugin, it may be implemented as a small local ESLint rule.

There is no separate architecture-lint command outside ESLint.

### 16.5 Lint exceptions

Rules may be disabled locally when there is a concrete technical reason.

Example:

```ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- External library exposes an untyped payload.
const normalize = (payload: any) => {
  // ...
};
```

Global rule disabling to work around isolated problems is not allowed.

Unused disable comments are errors.

Disable comments require an explanation.

## 17. Prettier

Prettier is responsible only for formatting.

Shared baseline:

```json
{
  "semi": true,
  "singleQuote": false,
  "trailingComma": "all"
}
```

Prettier controls:

* indentation,
* whitespace,
* line wrapping,
* quotes,
* semicolons,
* commas,
* JSX formatting.

ESLint does not contain competing formatting rules.

## 18. Tests

Tests are part of the shared Chromatis standard.

The concrete test runner and the exact division between unit, integration, database, and UI tests are defined centrally instead of being reinvented per application.

The standard covers:

* unit tests,
* module and integration tests,
* database tests,
* relevant React/UI tests,
* test data,
* test database setup.

The public command is:

```sh
bun run test
```

The normal repository quality check includes the standardized test suite.

## 19. Developer tooling

### 19.1 Public command surface

The public developer interface stays small:

```sh
bun run dev
bun run build
bun run start
bun run check
bun run fix
bun run test
bun run doctor
bun run config
bun run secret
bun run db
bun run deploy
```

Additional internal scripts may exist, but they are not part of the normal developer interface.

### 19.2 `check`

`check` is the deterministic, non-mutating quality gate.

It verifies at least:

* TypeScript,
* ESLint,
* architecture rules,
* Prettier,
* TOML and configuration schemas,
* database artifact consistency,
* tests.

### 19.3 `fix`

`fix` changes only things that can be corrected safely and automatically.

Examples include:

* ESLint auto-fixes,
* Prettier,
* TOML formatting.

After applying fixes, it runs the quality checks again.

### 19.4 `doctor`

`doctor` diagnoses the local or deployment-related environment.

Checks may include:

* runtime version,
* dependencies,
* configuration files,
* secrets,
* active environment,
* database connectivity,
* actual database target,
* migration state,
* deployment prerequisites.

`doctor` explains problems and points to the appropriate developer operation.

It does not silently repair infrastructure.

### 19.5 Interactive workflows

The following areas are primarily managed through small interactive CLI workflows:

```text
config
secret
db
deploy
```

Developers should not need to memorize large sets of CRUD-style subcommands.

For example:

```sh
bun run db
```

opens an interface showing database status and available actions.

Likewise:

```sh
bun run secret
```

opens the secret workflow.

These interfaces remain normal terminal applications rather than complex fullscreen TUIs.

## 20. Deployment

Deployment is exposed through:

```sh
bun run deploy
```

The implementation may use:

* Cloudflare/Wrangler,
* Bun,
* the shared Docker image.

The public developer workflow should remain as consistent as possible regardless of the underlying deployment mechanism.

Before deployment, at least the following are checked:

* code quality,
* tests,
* configuration,
* required secrets,
* database state,
* target environment.

## 21. VS Code and editor integration

### 21.1 Repository files

Chromatis projects contain at least:

```text
.editorconfig
.prettierrc
eslint.config.mjs
.vscode/extensions.json
.vscode/settings.json
```

TypeScript configuration is also derived from the shared Chromatis baseline.

### 21.2 Recommended extensions

The Web profile uses:

```text
editorconfig.editorconfig
streetsidesoftware.code-spell-checker
streetsidesoftware.code-spell-checker-german
usernamehw.errorlens
mechatroner.rainbow-csv
dbaeumer.vscode-eslint
esbenp.prettier-vscode
tamasfe.even-better-toml
redhat.vscode-yaml
```

TypeScript support comes from VS Code itself.

`Error Lens` is useful but may be disabled by developers who find its presentation too aggressive.

### 21.3 Save behavior

JavaScript and TypeScript are formatted with Prettier and corrected with ESLint auto-fixes on save.

Baseline:

```json
{
  "editor.formatOnSave": true,
  "[javascript]": {
    "editor.defaultFormatter": "esbenp.prettier-vscode"
  },
  "[javascriptreact]": {
    "editor.defaultFormatter": "esbenp.prettier-vscode"
  },
  "[typescript]": {
    "editor.defaultFormatter": "esbenp.prettier-vscode"
  },
  "[typescriptreact]": {
    "editor.defaultFormatter": "esbenp.prettier-vscode"
  },
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": "explicit"
  },
  "prettier.requireConfig": true
}
```

Editor behavior supports the workflow but is not authoritative.

The authoritative repository-level check remains:

```sh
bun run check
```

### 21.4 TOML

TOML configuration receives generated schemas.

VS Code can therefore provide:

* completion,
* allowed values,
* type validation,
* hover documentation,
* inline errors.

A custom Chromatis VS Code extension is not required for this.

## 22. Shared platform boundary

`@chromatis/base` owns technical capabilities that should remain consistent across multiple applications.

These include:

* UI foundations,
* shared design baseline,
* technical React helpers,
* TypeScript configuration,
* ESLint configuration,
* Prettier configuration,
* architecture enforcement,
* tooling implementation,
* configuration and secret systems,
* database workflow,
* deployment workflow,
* testing standards,
* reusable technical capabilities shared by multiple applications.

The following do not belong in `@chromatis/base`:

* application-specific domain logic,
* application-specific offline synchronization,
* application-specific data models,
* product-specific features used by only one application.

A fix that applies generally to Chromatis applications should be made once in `@chromatis/base` instead of being copied into several applications.

## 23. Architecture checklist

When introducing a new responsibility or architecture decision, check at least the following:

1. Who owns the domain or functional responsibility?
2. Who owns the state and data?
3. Can the behavior be expressed clearly as a function over inputs and dependencies?
4. Is every other module accessed only through its public API?
5. Is `index.ts` the only file directly inside the module directory?
6. Are internal models, persistence structures, or state leaking unnecessarily into public contracts?
7. Is the public API deliberately small?
8. Does a cross-module workflow belong in `app/`, or does one module clearly own it?
9. Does the design introduce a cyclic dependency?
10. Does it introduce global or hidden mutable state?
11. Is configuration explicitly defined, validated, and assigned to an owner?
12. Are required secrets described in version-controlled definitions?
13. Can the complete database structure be reproduced from the repository?
14. Does database logic have a clear owner?
15. Is infrastructure being abstracted even though a direct implementation would be sufficient?
16. Can a rule be enforced automatically instead of existing only in documentation?
17. Does an internal tool leak unnecessarily into the public developer interface?

## 24. Core rule

> A Chromatis project should be understandable and reproducible from its source code. Modules own their responsibilities completely, shared technical standards are enforced centrally, and developers work through small stable interfaces instead of hidden implementation details.

## 25. Migration

The migration will happen gradually so existing applications do not break solely because directory names or import conventions change:

1. Establish the target architecture as the shared, authoritative architecture convention.
2. Create new responsibilities as modules with a public `index.ts`. Existing feature slices are migrated only when they are already being changed for functional reasons.
3. Update alias conventions in consuming applications from `@core/*`, `@features/*`, and optionally `@platform/*` to `app`, `modules`, `adapter`, and `helper`.
4. Encode the target structure and import rules in the shared ESLint flat config. Then remove `checkArchitectureBoundaries.ts` and its separate invocation from project scripts. ESLint must also verify that `index.ts` is the only file directly inside each module directory.
5. Move SQLite WASM and offline synchronization to DropSort. Then remove the related exports, implementations, and unused dependencies from `@chromatis/base`.
6. After all consuming applications have been migrated, remove the old layer names and transitional rules.

