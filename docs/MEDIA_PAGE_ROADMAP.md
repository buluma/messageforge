# Media Page Roadmap

This plan covers the next media-manager improvements after the thumbnail and filter fixes.

## 1. Selection Mode / Bulk Actions

Goal: make large media sets manageable.

- Add card-level checkboxes and a selected-item toolbar.
- Support `Select visible`, `Clear`, and `Delete selected`.
- Later actions can add `Download selected`, `Move to folder`, and `Tag`.
- Keep selection stable across filtering, but prune deleted files.

## 2. Better Person-Filter UX

Goal: make person filters obvious and reversible.

- Show the active person as a removable filter chip.
- Add a person-focused status line: name, file count, and clear action.
- Consider previous/next person navigation once person clusters are stable.
- Avoid accidental toggles when editing names or linking contacts.

## 3. Timeline Grouping

Goal: reduce the flat-wall effect of the grid.

- Group results by `Today`, `Yesterday`, `This week`, month, or year.
- Keep sort controls compatible with grouped mode.
- Add a compact/un-grouped toggle for users who prefer the current grid.

## 4. Source / Type Grouping

Goal: make folder/source browsing first-class.

- Build source filters from `folder` values returned by `/api/media`.
- Keep existing type pills for media kind.
- Show source filter chips alongside type/person/search filters.
- Use source filters as the first step toward folder organization.

## 5. Quick Preview On Hover

Goal: make video cards more informative.

- Generate multiple seek frames per video or a short animated preview.
- On hover/focus, rotate through preview frames.
- Keep generation lazy and cacheable under `data/.thumbs`.
- Fall back to the existing single thumbnail when preview generation fails.

## 6. Metadata Panel

Goal: inspect media without committing to a full lightbox.

- Add a right-side details panel for selected/opened media.
- Show filename, size, date, folder, type, duration/dimensions, duplicate status, linked people, and actions.
- Keep the existing lightbox for full-size viewing.

## 7. Favorite / Keep Marker

Goal: protect important files during cleanup.

- Add a star/keep marker on each card.
- Store favorite URLs in a small persisted dashboard state.
- Exclude favorites from destructive bulk cleanup unless explicitly confirmed.

## 8. Duplicate Hints Inline

Goal: make duplicate information visible where users browse.

- After duplicate scan, mark duplicate files directly in the grid.
- Add a duplicate filter later, once duplicate groups are cached.
- Keep the existing duplicate section for group-level cleanup.

## 9. Face Filter Improvements

Goal: make face-index cleanup practical.

- Add smart face filters: `Unassigned`, `Multiple people`, `No face detected`, `Low confidence`.
- Surface confidence and cluster quality in a compact way.
- Keep merge/link operations separate from browsing filters.

## 10. Smart Cleanup Views

Goal: turn common cleanup tasks into saved views.

- Add quick views for `Large files`, `Old videos`, `Duplicates`, `No person`, `Failed thumbnails`, and `Recent uploads`.
- Implement them as composable filters, not separate pages.
- Show clear active chips so users can reset back to normal browsing.

## 11. Folder Move / Organize

Goal: let users organize files without leaving the dashboard.

- Add a `Move` bulk action in `smm/js/media.js` for selected media cards.
- Add `PATCH /api/media/move` in `lib/mediaRoutes.js` with `{ urls, folder }`.
- Keep destination folders constrained under `data/` and reject dot-directories.
- Refresh `/api/media` after a move so folder/source filters stay truthful.
- Add an inline folder picker with common folders plus free-form folder creation.

## 12. Keyboard Navigation

Goal: make dense media browsing usable without the mouse.

- Track a focused card index for the current `filtered()` result set in `smm/js/media.js`.
- Support arrow keys to move card focus, `Enter` to open, `Space` to select, `Delete` to delete selected, and `Escape` to clear active filters or close lightbox.
- Keep focus stable after delete, filter changes, and load-more.
- Add clear focus-visible styles in `smm/css/styles.css`.

## 13. Better Empty States

Goal: make empty states explain what filter caused the result.

- Replace generic `No media found.` with filter-aware text.
- Show active causes: type, source, search, person.
- Offer direct actions: `Clear person`, `Clear search`, `Reset filters`.
- Reuse the existing active filter chip handlers so empty-state actions do not add a second code path.

## 14. Persistent Filters

Goal: preserve useful browsing preferences without trapping users in stale state.

- Store `activeType`, `activeSource`, `sortKey`, and search text in `localStorage`.
- Do not persist `activePerson` unless the person still exists after loading people.
- Restore filter controls after `/api/media` and `/api/media/persons` both load.
- Version the stored payload so incompatible future filter state can be ignored safely.

## First Implementation Batch

Start with:

- Bulk selection and selected-file deletion. Initial implementation added.
- Inline duplicate badges after duplicate scan. Initial implementation added.
- Dynamic source filter based on media folders. Initial implementation added.
- Bulk folder move. Initial implementation added.
- Keyboard navigation. Initial implementation added.
- Filter-aware empty states. Initial implementation added.
- Persistent type/source/sort/search filters. Initial implementation added.
