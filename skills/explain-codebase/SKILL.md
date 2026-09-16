---
name: explain-codebase
description: Create or update a beginner-friendly, source-grounded codebase walkthrough explaining files, functions, sections, data flow, and design reasons. Use for repository explanations and onboarding documentation, not for implementing features or broad code cleanup.
---

# Explain a codebase

Produce a navigable explanation that helps a newcomer trace a user action through the implementation and identify where to make a change. Prefer repository Markdown unless the user requests a webpage or another format. Preserve an established guide rather than creating competing documents.

## Inspect before explaining

- Read repository guidance, tracked-file inventory, entry points, dependency/configuration files, and existing documentation. Inspect implementation and callers for the areas described; filenames and comments alone are not evidence of behavior.
- Separate maintained source from generated output, dependencies, assets, tests, migration history, and local secrets. Explain the role of generated files without reproducing every generated field. Do not read or include credential values or real user records to illustrate behavior.
- Trace major workflows from UI/entry point through helpers to persistence and back to rendered output. Record side effects, draft-versus-saved state, failure/retry behavior, and security enforcement where present.
- For evolving schemas or versioned code, follow replacements to their latest definitions. Describe earlier migrations as historical steps; do not report all old rules as current. Do not infer deployed state from repository state.

## Write for a newcomer

Start with purpose, a short glossary or link to an existing one, a contents list, and an architecture/data-flow overview. Use a small Mermaid diagram when it clarifies relationships, with prose that remains understandable without diagram rendering.

For each maintained module or coherent section, explain:

- What it enables for the user or another module.
- Its main functions, components, state groups, inputs, outputs, and callers.
- The reason it exists, supported by observed dependencies or behavior. Label uncertain design intent as inference rather than attributing it to the author.
- Non-obvious rules: ordering dependencies, null handling, async cancellation, duplicate protection, validation, authorization, and error recovery where applicable.
- A relative source link so the reader can inspect the implementation.

Use function/section tables when useful; avoid paraphrasing every assignment. Expand unfamiliar terminology at first use. Include a small synthetic example for tricky logic. Distinguish placeholders from implemented capabilities and compile-time types from runtime checks.

Cover tests, configuration, assets, and database routines as well as the UI. For a large migration history, supply a chronological map and explain current critical routines in depth, linking to an existing schema reference for field-level details. State any areas summarized or not verified rather than claiming exhaustive coverage.

Finish with a practical “where to change what” map and a way to refresh the documentation. Keep deployment instructions in the existing setup guide unless the user requested them here.

## Validate and deliver

- Check source links and inventory coverage. Verify function names, payload shapes, and non-obvious claims against source; treat stale prose as a clue rather than authority.
- Format only the documentation being changed using the project's existing tooling. For documentation-only work, link/coverage/format checks are usually sufficient; do not imply runtime tests ran if they did not.
- Do not alter application behavior, generated code, or applied migrations to make the explanation easier. In-code comments or cleanup require scope from the user.
- Link the finished guide and briefly state what it covers, plus any material verification limits. Do not publish a webpage or modify external systems merely because a webpage was an allowed output format.
