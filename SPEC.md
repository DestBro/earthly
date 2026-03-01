Nostr GeoJSON Event Specification

Goal – Define a minimal, interoperable way to publish, catalogue and consume GeoJSON datasets over Nostr relays, together with collection/index events that reference them.

⸻

1 GeoJSON Data Event (kind 37515)

Field Purpose
kind 37515 identifies the event as a GeoJSON dataset.
content JSON.stringify(...) of a valid RFC 7946 FeatureCollection (may include extra fields). Stored verbatim – no base64.
tags Metadata and discovery (see below).

1.1 Mandatory Tags

Tag Example Notes
d ["d", "a9d5ea20-2e3f-4b67-93e9-7c60a9f9f4f4"] Random UUID – new unique identifier generated for each dataset event.
bbox ["bbox", "16.1,48.1,16.7,48.4"] West-South-East-North (WGS-84) comma-separated.

1.2 Recommended Tags

Tag Example Purpose
g ["g", "u2yh7"] Geohash (5–7 chars) of dataset centroid for fast proximity search.
crs ["crs", "EPSG:4326"] Coordinate reference system of geometry. Default is EPSG:4326.
checksum ["checksum", "9b06e56ee3…"] SHA-256 of content for integrity.
size ["size", "142359"] Uncompressed byte length of content.
v ["v", "2"] Semantic version or monotonically increasing integer for this dataset.
r ["r", "wss://geo.relay.org"] Relay where future updates will be published.
t ["t", "parks"] Hashtags / thematic categories. Multiple allowed.
collection ["collection", "37516:npub1pubkey…:city_parks_2025"] (Optional) Back-link to a parent collection event.
c ["c", "37518:npub1contextauthor…:hiking_trails"] (Optional) Attach dataset to a map context. Multiple allowed.

1.3 Optional Tags

Free-form tags permitted for domain-specific metadata, e.g. srid, license, source, lang, map_style, etc.

1.4 Example Data Event

{
"id": "…",
"pubkey": "npub1pubkeyexample…", // publisher's **public** key (never nsec!)
"kind": 37515,
"content": "{\"type\":\"FeatureCollection\",\"name\":\"Vienna Trailheads 2025\",…}",
"tags": [
["d","a9d5ea20-2e3f-4b67-93e9-7c60a9f9f4f4"],
["bbox","16.1,48.1,16.7,48.4"],
["g","u2yh7"],
["crs","EPSG:4326"],
["checksum","9b06e56ee3…"],
["t","trails"],
["v","1"],
["r","wss://geo.relay.org"]
]
}

1.5 External Geometry Blobs

Large FeatureCollections can exceed typical relay payload limits (~4 MB). Publishers may host the heavy GeoJSON in object storage (HTTPS, IPFS, Arweave, etc.) and reference it from a lightweight stub event using blob tags:

Tag format: ["blob","<scope>","<url>","sha256=<hex>","size=<bytes>","mime=<type>"]

• scope = "collection" to indicate the entire FeatureCollection lives at the URL.  
• scope = "feature:<feature-id>" to indicate a single feature with the given id must be fetched remotely.  
• url points to the JSON blob (MUST be HTTPS/IPFS/...)   
• sha256 / size / mime parameters are optional but recommended. Omit the key=value pair if unknown.

Clients SHOULD keep bbox/g/t metadata inside the stub event for discovery, then lazily fetch the blob when needed. Example tags:

["blob","collection","https://example.org/Russia_regions.geojson","size=7349314","mime=application/geo+json"]  
["blob","feature:canada_provinces_blob","https://example.org/canada_provinces.geojson","sha256=21ab…","size=2810040"]

When using feature scoped blobs, include a placeholder feature in the stub event with the matching id so clients know how to substitute the fetched geometry.

Hybrid datasets are fully supported: keep lightweight inline features (points, centroids, simplified boundaries) inside the event content and attach blob tags for heavyweight members. Clients SHOULD merge the two sources – inline features stay as-is, while downloaded features are appended. Placeholders that are meant to be replaced SHOULD either set geometry to null or use extremely simplified geometry so visual artefacts are avoided until the blob finishes loading.

Scope behaviors:
• collection – the remote FeatureCollection represents additional members for this dataset. Inline features inside the stub MAY remain (e.g. previews), but clients typically prefer the fetched geometry for editing/rendering.  
• feature:<id> – the referenced blob replaces one logical feature. The stub MUST include a placeholder feature whose Feature.id matches <id> (geometry may be null). Once fetched, clients remove the placeholder and insert every feature contained in the blob payload. This allows one placeholder to expand into many fully detailed features.

Example content with a mixture of inline geometries and a feature placeholder:

```json
{
  "type": "FeatureCollection",
  "name": "Canada provinces",
  "features": [
    {
      "type": "Feature",
      "id": "canada_provinces_blob",
      "geometry": null,
      "properties": {
        "name": "Full-resolution provinces",
        "externalPlaceholder": true
      }
    },
    {
      "type": "Feature",
      "id": "overview-centroid",
      "geometry": {
        "type": "Point",
        "coordinates": [-95.358, 60.108]
      },
      "properties": {
        "name": "Dataset centroid preview"
      }
    }
  ]
}
```

Tags for this event would include `["blob","feature:canada_provinces_blob","https://example.org/canada.geojson","size=2800000","mime=application/geo+json"]` to signal where the real polygon geometry is stored.

⸻

2 GeoJSON Collection Event (kind 37516)

A lightweight catalogue pointing to multiple GeoJSON datasets.

Field Purpose
kind 37516 identifies a collection.
content JSON with human-readable metadata: { name, description, picture?, ownerPk?, license?, tags? }.
tags One a tag per dataset plus structural metadata.

2.1 Tags

Tag Example Notes
d ["d", "city_parks_2025"] Random UUID for this collection event.
a ["a", "37515:npub1pubkey…:a9d5ea20…"] Coordinate of a GeoJSON Data Event using publisher’s npub. Multiple.
bbox Combined extent of all members (optional).
g ["g", "u2yh7"] Geohash of collection centroid.
t Hashtags categorising the collection.
r Recommended relay.
c ["c", "37518:npub1contextauthor…:thirty_year_war"] (Optional) Attach collection as context reference.

2.2 Example Collection Event

{
"id": "…",
"pubkey": "npub1maintainer…",
"kind": 37516,
"content": "{\"name\":\"City Parks Dataset\",\"description\":\"Boundaries and amenities for Vienna parks\",\"picture\":\"https://…/parks.png\",\"license\":\"CC-BY-4.0\"}",
"tags": [
["d","city_parks_2025"],
["bbox","16.1,48.1,16.7,48.4"],
["g","u2yh7"],
["a","37515:npub1pubkey…:a9d5ea20…"],
["a","37515:npub1otherpubkey…:bb17c530…"],
["t","parks"]
]
}

⸻

2.3 Map Context Event (kind 37518)

Map contexts provide shared taxonomy and optional schema validation envelopes for attached datasets/collections.

Field Purpose
kind 37518 identifies a map context definition.
content JSON with { version?, name, description?, image?, contextUse, validationMode, schemaDialect?, schema? }.
tags Addressing and optional metadata.

Tag Example Notes
d ["d", "hiking_trails"] Stable context identifier (parameterized replaceable key).
bbox ["bbox", "16.1,48.1,16.7,48.4"] Optional geographic scope.
t ["t", "history"] Optional hashtags.
r ["r", "wss://geo.relay.org"] Optional relay hint.
v ["v", "2"] Optional context version marker.
schema-hash ["schema-hash", "sha256:..."] Optional schema integrity hint.
parent ["parent", "37518:<pubkey>:<d>"] Optional hierarchy edge.

Content fields:
1. contextUse: taxonomy | validation | hybrid
2. validationMode: none | optional | required
3. schemaDialect: optional JSON Schema dialect URI (recommended 2020-12)
4. schema: optional self-contained JSON Schema object (no external $ref in v1)

Deterministic v1 interpretation (no attachment role field):
1. Dataset + taxonomy context: taxonomy only, no schema validation.
2. Dataset + validation/hybrid context: schema validation target.
3. Collection attachment: reference/taxonomy lane only, never direct validation target.
4. Collection attachment does not inherit to member datasets in v1.

Context attachment tag semantics (`c`):
1. `["c", "<context-coordinate>"]` where `<context-coordinate>` is `<kind>:<pubkey>:<d>`.
2. Publishers may include multiple `c` tags to attach one event to multiple contexts.

Validation behavior:
1. `none`: no schema enforcement.
2. `optional`: schema can validate and surface warnings.
3. `required`: invalid datasets may be filtered in strict context views.
4. Consumers can choose filter mode `off | warn | strict`; required contexts default to strict but can still be viewer-overridden.

Two-lane context view behavior:
1. Map lane: dataset candidates attached by `c`; strict mode includes only schema-valid entries.
2. Reference lane: attached collections (and similar references) shown for navigation/isolation, not for direct map-lane validation.

⸻

3 Encrypted / Extended GeoJSON (kind 30078)

For private datasets or large binary attachments:
• Publish a kind 30078 event with the same d tag as the plaintext event.
• Encrypt content to the intended readers.
• Tags SHOULD mirror those of the plaintext stub (except sensitive data).

⸻

4 Auxiliary Events

Kind Purpose
10000 Ban / mute list (e.g. malicious datasets).
30000 Role lists (admins, editors, viewers).
10002 Outbox relay list for the geo app.

⸻

5 Versioning & Updates 1. Kinds 37515/37516/37518 are parameterized replaceable in this app model and SHOULD reuse the same d tag for updates. 2. Use the v tag to communicate a logical version sequence within a lineage. 3. Publish a new d only when intentionally creating a new lineage/breaking fork. 4. Reference predecessors via ["p", "<old-event-id>"] if history is desirable.

⸻

6 Integrity & Validation Guidelines 1. Clients must verify the checksum tag matches SHA-256(content). 2. Reject events whose content fails RFC 7946 validation. 3. Use geohash and bounding-box tags to pre-filter by location. 4. Large payloads MAY be compressed (e.g. gzip) and indicated by an encoding tag.

⸻

7 Interoperability Notes
• Follows NIP-89 naming conventions where possible.
• Uses only standard Nostr tag primitives – easy to extend.
• Collection coordinates in the form <kind>:<pubkey>:<d> match NIP-51 list style.

⸻

8 GeoJSON Comment Event (kind 37517)

Comments allow users to discuss datasets and collections, optionally attaching GeoJSON annotations. Comments follow NIP-22 threading semantics for replies.

8.1 Event Structure

Field Purpose
kind 37517 identifies a geo comment.
content JSON with { "text": "...", "geojson": {...} }. The geojson field is optional.
tags NIP-22 threading tags plus geo-specific tags.

8.2 Content Format

```json
{
  "text": "The park boundary seems incorrect here. I've added a suggested fix.",
  "geojson": {
    "type": "FeatureCollection",
    "features": [...]
  }
}
```

The `text` field contains the human-readable comment. The optional `geojson` field contains a FeatureCollection with annotations, corrections, or related geometry.

8.3 Threading Tags (NIP-22)

Tag Purpose
d Unique identifier for addressability.
K Root scope kind (e.g. "37515" for datasets, "37516" for collections).
k Parent item kind (same as K for top-level comments, "37517" for replies).
A Root scope address: <kind>:<pubkey>:<d-tag>
a Parent address (same as A for top-level, or the parent comment's address).
E Root event ID (if referencing by ID instead of address).
e Parent event ID.
P Root event author pubkey.
p Parent event author pubkey.

8.4 Geo-specific Tags

Tag Example Purpose
bbox ["bbox", "16.1,48.1,16.7,48.4"] Bounding box of attached GeoJSON (if present).
g ["g", "u2yh7"] Geohash of comment's GeoJSON centroid.

8.5 Inline Geometry References

Comments may reference datasets or specific features inline using NIP-21 style URIs:

• Dataset reference: `nostr:naddr1...` pointing to a kind 37515 event.
• Feature reference: `nostr:naddr1...#featureId` to reference a specific feature within a dataset.

Clients SHOULD render these as interactive elements with:
• Eye toggle: Show/hide the referenced geometry on the map.
• Zoom button: Fly to the referenced geometry's bounds.

8.6 Example Top-Level Comment

```json
{
  "kind": 37517,
  "content": "{\"text\":\"Great dataset! The eastern boundary needs adjustment.\",\"geojson\":{\"type\":\"FeatureCollection\",\"features\":[{\"type\":\"Feature\",\"geometry\":{\"type\":\"Point\",\"coordinates\":[16.4,48.2]},\"properties\":{\"note\":\"Issue here\"}}]}}",
  "tags": [
    ["d", "comment-uuid-1"],
    ["A", "37515:npub1pubkey...:dataset-uuid"],
    ["K", "37515"],
    ["a", "37515:npub1pubkey...:dataset-uuid"],
    ["k", "37515"],
    ["P", "npub1pubkey..."],
    ["p", "npub1pubkey..."],
    ["bbox", "16.3,48.1,16.5,48.3"],
    ["g", "u2yh8"]
  ]
}
```

8.7 Example Reply to Comment

```json
{
  "kind": 37517,
  "content": "{\"text\":\"I agree, here's my suggested correction.\"}",
  "tags": [
    ["d", "comment-uuid-2"],
    ["A", "37515:npub1pubkey...:dataset-uuid"],
    ["K", "37515"],
    ["a", "37517:npub1commenter...:comment-uuid-1"],
    ["k", "37517"],
    ["e", "parent-comment-event-id", "wss://relay.example"],
    ["P", "npub1pubkey..."],
    ["p", "npub1commenter..."]
  ]
}
```

⸻

9 Reactions and Zaps

Standard Nostr reactions (kind 7) and zaps (kind 9735) can target GeoJSON events:

• Reactions SHOULD include an `a` tag pointing to the dataset/collection/comment address.
• Zaps follow standard NIP-57 flow, targeting the event author.

Example reaction to a dataset:

```json
{
  "kind": 7,
  "content": "❤️",
  "tags": [
    ["a", "37515:npub1pubkey...:dataset-uuid"],
    ["p", "npub1pubkey..."]
  ]
}
```

⸻

10 Open Questions / TODO
• Should we reserve a separate kind for single Feature objects?
• Add optional time tag for temporal datasets?
• Handling tiled GeoJSON (e.g. RFC-8462 GeoJSON seq)?

Feedback welcome!
