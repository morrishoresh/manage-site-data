# Manage Site Data

Firefox extension (140+) to view and delete cookies and local storage for the
site in the current tab.

## Usage
Click the toolbar icon to open the popup. "Open in tab" shows the same view
in a full tab, still bound to the original tab.

- **Cookies** tab: name, value and expiry per cookie; delete one or all.
- **Local Storage** tab: key and value per entry; delete one or all.

## Behavior
- Cookies are matched by substring against a base domain derived from the
  hostname (same heuristic as Cookie Quick Manager, not a Public Suffix List
  lookup), so cookies of sibling subdomains are included.
- Expired cookies are deleted when the list loads. Session cookies are never
  treated as expired.
- Local storage is read and written via `tabs.executeScript` in the target
  tab. It is unavailable on privileged pages (`about:`, AMO, etc.).
