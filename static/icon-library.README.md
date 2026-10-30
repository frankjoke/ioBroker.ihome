# Icon library snapshot

`icon-library.js` is a frozen copy of the icon data that ships with
**ioBroker Admin 8.2.0**, taken on 2026-10-30 from:

```
http://<broker>:8081/assets/iconLibraryData-B5fiyl1C.js
```

It is **not imported anywhere yet** and is not loaded by the app. It is kept in
`static/` so a later icon picker can use it without depending on the Admin
version that happens to be installed.

## Format

The module exports two arrays:

```js
import { ICON_LIBRARY, ICON_LIBRARY_CATEGORIES } from "./icon-library.js";
```

- `ICON_LIBRARY`: `{ c, id, n, p }[]` — `c` category id, `id` the MDI name,
  `n` localized names (`en`, `de`, `ru`, …), `p` the SVG path.
- `ICON_LIBRARY_CATEGORIES`: `{ id, name: { en, de, … } }[]` — 17 categories
  (Rooms, Buildings & floors, Furniture, Lighting, Climate & heating, …).

## Licences / attribution

- Icon paths are **Material Design Icons (MDI)** — Apache-2.0,
  <https://pictogrammers.com/library/mdi/>.
- The category names are from ioBroker Admin (MIT).
- Keep this notice with the file if it is used or redistributed.

## Notes

- The data is a build artefact with a content hash in its original name; do not
  fetch it from Admin at runtime (it changes between Admin versions).
- If used, import it lazily (a dynamic import or a `<script type="module">` on
  first picker open) so the ~264 KB does not enter the main bundle.
