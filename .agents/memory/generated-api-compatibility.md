---
name: Generated API compatibility
description: Compatibility constraint between OpenAPI code generation and the workspace's runtime validator version.
---

OpenAPI-generated Zod validators must target the Zod major version installed by the workspace; otherwise generation can succeed while the API package fails typechecking on unsupported validator APIs.

**Why:** The shared workspace currently uses Zod 3, while generated output can select Zod 4-only helpers for formats and numeric constraints.

**How to apply:** When changing the OpenAPI contract, regenerate clients and run the API typecheck immediately. If generated code uses newer Zod APIs, simplify the affected schema constraints or align the dependency before proceeding.