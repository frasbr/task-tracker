# Filter and sort live in the webview, not the store

The board's filter and sort are held in the webview and written nowhere. They are a
presentation choice with no field in the schema. The host re-sends the whole task list on every
render, so the view is re-derived from a fresh copy each time.

This is the only state the webview owns, and it is allowed because it is not authoritative. An
agent writing to the store underneath a filtered board changes what is shown, never what was
chosen.
