# MapContext Architecture (Draft)

Status: Implemented MVP baseline; keep as living architecture notes alongside `SPEC.md`.

This document defines a new entity currently referred to as `MapContetxt` (typo).  
Canonical name in code/spec should be `MapContext`.

## 1. Problem Statement

We need a new shared entity that:

1. Is announced publicly on Nostr.
2. Lets users attach datasets (`NDKGeoEvent`, kind `37515`) and collections (`NDKGeoCollectionEvent`, kind `37516`).
3. Supports optional schema-driven validation for attached geometry properties.
4. Enables filtered map views for a selected context.
5. Works as taxonomy ("tags on steroids"), not only validation.

## 2. Critical Findings In Current System

These are important before adding any new kind:

1. Kinds `37515` and `37516` are in the `30000-39999` range (parameterized replaceable).  
   This means updates should generally keep the same `d` tag.
2. `SPEC.md` currently says "new random d on each update", but code (`publishUpdate`) reuses `d`.  
   This mismatch should be corrected when SPEC is updated.
3. Collection references currently use `a` tags and `NDKGeoCollectionEvent.datasetReferences` treats all `a` tags as dataset refs.  
   Reusing `a` naively for context attachment inside collections will break parsing unless class logic is changed.
4. Routing currently supports focus types `geoevent | collection` only (`useRouting`, store focus type).  
   A context route requires route/store/view-mode changes.
5. Update flows can drop tags if not explicitly preserved (notably dataset update path in `usePublishing.ts`).  
   Context reference tags must be persisted intentionally.

## 3. Requirements

### Functional

1. Create/edit map contexts (name, description, image, optional schema, validation mode).
2. Browse contexts in a list panel.
3. Open a context route and filter map to attached datasets/collections.
4. Validate attached geometry properties against context schema with three modes:
   - `none`
   - `optional`
   - `required` (invalid entries are hidden)
5. Support taxonomy usage independent of schema enforcement.

### Non-Functional

1. Must be relay-queryable for context filtering.
2. Must avoid coupling context attachment to full geometry republish in phase 1 if possible.
3. Must tolerate decentralized trust (no global enforcement authority).

## 4. Design Decisions

## 4.1 Schema Format

Decision: use `JSON Schema` (draft 2020-12) as canonical interchange format.

Why:

1. It is language-agnostic and serializable as event content.
2. User-generated dynamic schemas are a natural fit.
3. Other clients can validate without TypeScript/Zod runtime coupling.

Runtime validation library:

1. Primary recommendation: `ajv` + `ajv-formats` (dynamically imported in UI route/panel).
2. Keep `zod` for internal static event/content typing only, not as canonical persisted schema.

Why not "Zod-only":

1. Dynamic user schemas from network events are not ergonomic as executable Zod definitions.
2. Zod schemas are not a stable cross-client exchange format.

## 4.2 Event Model (MVP)

### New Kind

`MAP_CONTEXT_KIND = 37518` (parameterized replaceable).

### Context Definition Event (`kind: 37518`)

Content JSON:

```json
{
  "version": 1,
  "name": "Hiking Trails",
  "description": "Trails with elevation metadata",
  "image": "https://...",
  "contextUse": "hybrid",
  "validationMode": "required",
  "geometryConstraints": {
    "allowedTypes": ["LineString", "MultiLineString"]
  },
  "schemaDialect": "https://json-schema.org/draft/2020-12/schema",
  "schema": {
    "type": "object",
    "required": ["elevation"],
    "properties": {
      "elevation": { "type": "number", "minimum": -430, "maximum": 9000 }
    },
    "additionalProperties": true
  }
}
```

Tags:

1. `["d", "<context-id>"]` required, stable identifier for updates.
2. `["t", "..."]` optional hashtags.
3. `["r", "..."]` optional relay hints.
4. `["v", "<context-version>"]` optional semantic version.
5. `["schema-hash", "sha256:<hex>"]` optional integrity hint.
6. `["bbox", "w,s,e,n"]` optional geographic scope.
7. `["parent", "<context-coordinate>"]` optional taxonomy parent for hierarchy.

Field semantics:

1. `contextUse`: `taxonomy | validation | hybrid`
2. `validationMode` only matters when `contextUse` includes validation.
3. `geometryConstraints.allowedTypes` optionally restricts allowed GeoJSON geometry types per feature.
4. For `taxonomy` contexts, schema/geometry constraints SHOULD be omitted and validation mode SHOULD be `none`.

## 4.3 Attachment Model (MVP)

Decision: attach contexts directly on target dataset/collection events via a dedicated one-letter queryable tag.

Tag on dataset/collection:

1. `["c", "<context-coordinate>"]`
2. Where `<context-coordinate>` is `<kind>:<pubkey>:<d>` for context (`37518:...`).

Rationale:

1. Queryable via `#c` filters.
2. Avoids overloading collection `a` tags (already used for dataset membership).
3. Keeps route filtering simple (single query for datasets/collections).
4. Keeps v1 simple (no per-attachment role field).

Deterministic v1 interpretation:

1. Dataset attachment:
   - `contextUse=taxonomy` => taxonomy only
   - `contextUse=validation|hybrid` => validation target
2. Collection attachment:
   - always taxonomy/reference only in v1
   - never direct schema validation target
3. No implicit inheritance in v1: attaching a collection does not auto-attach member datasets.

Note:

1. This supports users attaching their own datasets/collections by publishing updates.
2. Third-party attachment (without republishing target) is deferred to phase 2 with a dedicated attachment event if needed.

## 4.4 Validation Semantics

Validation always happens client-side. Context cannot force network-wide enforcement.

Context `validationMode` meaning:

1. `none`: no schema in context; all attached entries pass.
2. `optional`: schema and/or geometry constraints exist; invalid entries can still be shown unless consumer chooses strict.
3. `required`: schema and/or geometry constraints exist; invalid entries are filtered out.

Consumer filter modes (UI-level):

1. `off`: ignore validation.
2. `warn`: include invalid but badge them.
3. `strict`: only include valid.

Default by context mode:

1. `none -> off`
2. `optional -> warn`
3. `required -> strict`

Collection handling:

1. Collection events are displayed in context UI as references, but are excluded from geometry validation logic.
2. Dataset visibility in strict mode is based on dataset feature validation.
3. Feature validation includes both property-schema checks and geometry-type checks when configured.

## 4.5 Two-Lane Context Model

For enforced contexts (`validationMode=required`) the UI must separate:

1. Map lane (first-class):
   - only datasets that pass required validation
   - rendered on map in context view
   - used for validation counters and clean-map guarantees
2. Reference lane (second-class, still useful):
   - attached collections and curated references
   - shown in a dedicated "References" section/tab
   - not rendered as context map targets by default
   - can be opened in isolation mode outside strict context view

This preserves map cleanliness while keeping narrative/curation value.

## 4.6 Route Model

Current app is hash-routed. Proposed routes:

1. `#/contexts` -> context list panel.
2. `#/context/<naddr>` -> focused context view (filter datasets/collections by `c` tag).
3. Optional back-compat alias: `#/context` -> same as `#/contexts`.

Store/routing types must add `mapcontext` focus type and `contexts` sidebar mode.

## 5. UI/UX Architecture

## 5.1 New Panels

1. `MapContextListPanel`:
   - searchable list of context events
   - badge for mode (`none|optional|required`)
   - open/inspect actions

2. `MapContextCreatorPanel`:
   - fields: name, description, image, mode
   - schema editor:
     - basic builder (fields + required toggles)
     - advanced JSON editor
   - live "sample properties" validator preview

## 5.2 Attachment UX

1. Dataset editor/info view: "Attach to context" multi-select picker.
2. Collection editor/info view: same picker, but clearly labeled as reference attachment.
3. Attachment should preserve existing `c` tags on update and allow removal.
4. Context route should show separate sections:
   - validated/invalid datasets
   - references (collections, article bundles, narratives)

## 5.3 Validation UX

1. Context route shows counters: `valid / invalid / unresolved`.
2. Invalid reasons shown in expandable panel (property path + error).
3. Strict mode should explain why filtered entries disappeared.

## 6. Data/Validation Flow

On `#/context/<naddr>`:

1. Resolve context event (kind `37518`).
2. Query datasets and collections with `#c = contextCoordinate`.
3. For each dataset:
   - resolve full feature collection (including blob refs)
   - validate each feature `properties` against schema (if schema exists)
4. For each collection:
   - place into Reference lane
   - do not include as direct geometry validation target
5. Apply consumer strictness mode (`off|warn|strict`).

Caching key:

`<contextAddress>|<targetEventId>|<schemaHash>|<targetUpdatedAt>`

## 7. Event Update Semantics

## 7.1 MapContext updates

1. Reuse same `d` (parameterized replaceable).
2. Increment content/tag version (`v`) for visibility.
3. Use new event id each publish; latest wins per `(kind,pubkey,d)`.

## 7.2 Breaking schema changes

Strong recommendation:

1. Non-breaking edits can update in place.
2. Breaking schema changes should create a new context (`new d`) and optionally link old context via `["e", "<old-event-id>", "supersedes"]` or custom `["supersedes", "<coord>"]`.

Reason: strict consumers could lose large portions of existing attached content after in-place hardening.

## 8. Known Collisions And Mitigations

1. Collision: current collection parser assumes all `a` tags are dataset refs.  
   Mitigation: use dedicated `c` tag for context attachment.
2. Collision: `usePublishing.handlePublishUpdate` copies selected tags only.  
   Mitigation: explicitly carry forward `c` tags, or add a generic tag preservation utility.
3. Collision: route/store focus typing excludes contexts.  
   Mitigation: extend `focusType`, `SidebarViewMode`, and hash parser.
4. Collision: SPEC/code mismatch on replaceable update semantics.  
   Mitigation: align in SPEC update before shipping context kind docs.
5. Collision: current update lineage uses `p` tag for previous event id (non-standard use).  
   Mitigation: use explicit custom tag (`prev`) or `e` with marker in revised spec.

## 9. Phase Plan

## Phase 1 (MVP)

1. Add `NDKMapContextEvent` + kind `37518`.
2. Add list/create panels and `#/contexts`, `#/context/<naddr>` routes.
3. Add attachment via `c` tags on datasets/collections.
4. Add JSON Schema validation (`ajv`) in context route.
5. Add strictness toggle (`off|warn|strict`).

## Phase 2

1. Add optional third-party attachment event kind (if needed).
2. Add trust/ranking signals (author reputation, reactions, follows).
3. Add moderation controls specific to contexts.

## 10. Open Questions For Iteration

Resolved decisions from this iteration:

1. Contexts are also taxonomy primitives ("tags on steroids"), not only validation envelopes.
2. Mandatory (`required`) validation filters invalid entries out.
3. No server-assisted indexing for now.
4. Schema must be self-contained in v1 (no external `$ref` URLs).
5. Context archive/tombstone behavior is accepted for future inclusion.
6. v1 uses no per-attachment role field; interpretation is deterministic by event type + `contextUse`.
7. Enforced contexts use two lanes: Map lane (validated datasets) and Reference lane (collections/references).

Remaining design question:

1. In a future phase, should collection taxonomy attachment optionally inherit to member datasets (opt-in), or stay strictly non-inheriting?

## 11. Implementation Alignment

Implemented in current MVP:

1. Kind `37518` defined and wired.
2. `c` attachment tags on datasets/collections.
3. Deterministic v1 interpretation (no attachment role field).
4. Validation mode semantics (`none|optional|required`) with viewer override (`off|warn|strict`).
5. Two-lane context behavior (Map lane + Reference lane).
6. Self-contained schema policy in v1 (no external `$ref` URLs).
7. Replaceable update guidance aligned in `SPEC.md`.
