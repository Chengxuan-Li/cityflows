# CityFlows GeoJSON interchange

Import accepts a parsed `FeatureCollection` of roads and places. Each feature has a
`geometry` and a `properties` object. Roads may use `properties: null` for all defaults.
Extra properties are ignored.

## Coordinates

By default, positions are `[longitude, latitude]` in WGS 84 decimal degrees. The importer
projects them through the destination city's geographic reference and reports an error if
that reference is missing. Longitude must be within ±180° and latitude must be inside ±90°.
[RFC 7946](https://www.rfc-editor.org/rfc/rfc7946.html)

For local data, set `"cityflows:coordinates": "local"` on the collection. Positions then
mean `[x, y]` in meters, with x east and y south. This CityFlows extension lets synthetic
cities round-trip. The caller can override the coordinate mode with
`options.coordinates` (`'local'` or `'lonlat'`). A third ordinate is discarded.

## Roads

A `LineString` describes a centerline in travel order. Provide at least two positions.

| Property | Values and defaults |
| --- | --- |
| `lanes` | Integer from 1 to 64. The default is 1 for a one-way road and 2 for a two-way road. |
| `oneway` | Boolean, defaults to `true`. With `false`, the road needs at least two lanes and creates two opposite directed roads. The forward direction gets the extra lane when the total is odd. |
| `speed` | Positive speed in meters per second. Defaults to 30 km/h (about 8.33 m/s). |
| `class` | `motorway`, `trunk`, `primary`, `secondary`, `tertiary`, `residential` (default), `service`, or `ramp`. |
| `name` | String or `null` (default). |
| `cityflows:id` | Optional `r:<integer>` for the forward road. |

Each endpoint snaps to the nearest node within `options.snapToleranceM` (default 1 m,
inclusive), or creates an uncontrolled node. The search includes nodes created earlier in
the import. Interior vertices and geometric crossings do not create junctions. A road
whose endpoints snap to the same node is rejected.

Residential and service lanes are 3 m wide. Other lanes are 3.5 m wide. Each lane allows
cars, trucks and buses. Two-way roads place their lane blocks according to the destination
city's driving side.

## Places

A `Point` is a single position. A `Polygon` has one closed exterior ring with at least
four positions, including the repeated first position. The importer accepts either winding.

| Property | Values and defaults |
| --- | --- |
| `kind` | Required. `residential`, `work`, `retail`, `school`, `station`, `airport`, `parking`, `gateway`, or `other`. |
| `population`, `jobs` | Nonnegative integers, both default to 0. |
| `name` | Optional string. Defaults to the kind. |
| `cityflows:id` | Optional `p:<integer>`. |

Imported places have no road connectors. Add connectors before using them to generate trips.

## IDs and validation

An unused `cityflows:id` is preserved. Its suffix must be a nonnegative integer below
`Number.MAX_SAFE_INTEGER`. IDs must be unique within the file. If a requested ID is already
in use in the city, the importer allocates a replacement and reports both IDs in a
`geojson_id_remapped` warning. The successful result's `idMap` maps every supplied ID
to its assigned ID. Unnamed entities receive newly allocated IDs. If parsing or validation
fails, the importer returns diagnostics, a null city and an empty ID map. The input city
is left intact.

## Export

Export writes one LineString per directed road with `oneway: true` and one Point or
Polygon per place. Geographic cities export longitude and latitude, with counterclockwise
exterior polygon rings. Synthetic cities export local coordinates. The collection also
carries the CityFlows schema version, the synthetic traffic notice and available geographic
source attribution.

The collection's `cityflows:lossy` array lists omitted data. It covers node IDs and layers,
junction controls, turn rules, signals, lane widths and vehicle permissions, lateral
offsets, street grouping, place connectors and demand settings, and entity provenance.
Connectivity on import is reconstructed by endpoint snapping. Use a `.cityflows` project
file for a complete snapshot.
