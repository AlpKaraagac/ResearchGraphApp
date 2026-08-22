# Research graph

**Live demo:** <https://alpkaraagac.github.io/ResearchGraphApp/> · **Tests:** [tests.html](https://alpkaraagac.github.io/ResearchGraphApp/tests.html)

![The demo graph — questions with sub-questions, and experiments carrying their own results](docs/screenshot.png)

A single-page app for mapping **one research project** as a graph of nodes. It is
deliberately simple: no lint, no rules about what may connect to what, no vocabularies
to learn. You write down what you are asking and what you did, and the tool draws it,
saves it, and lets you carry it around.

Plain HTML, CSS and ES modules. No build step, no framework, no dependencies, no
backend, no accounts, no analytics. The graph is one JSON object; everything else is
rendering. Work is autosaved to `localStorage` per graph, and the toolbar always shows
whether it is stored.

## The model

Four node types, and only three things you really need:

**`question`** — something the project asks. Give a question a **parent** and it becomes
a sub-question; the tree is drawn for you with dashed links, so you never manage those
edges by hand.

**`experiment`** — one investigation *and what it returned*, in a single node:

- **nature** — what kind of thing it is: statistical, computational, qualitative,
  simulation, theoretical, literature, replication, or anything else you type
- **what the experiment was** — design, data, procedure
- **result** — what came out of it, including nulls

Merging the experiment and its result into one node is the point: a result never
drifts away from the thing that produced it, and reading the card tells you what was
done and what happened, in that order.

**`source`** — a citable work. **`note`** — a caveat, a decision, a reminder.

Everything else is optional. Links between nodes take a free-text label (or none).
Statuses are suggestions, not vocabularies. Nothing is validated beyond "this node has
an id, a type and a label", so the tool never argues with you about how you work.

## What it does

- **Render** — force-directed layout over a pannable, zoomable canvas, with cards
  styled per type. Tap a node to dim everything not adjacent and open a detail panel
  whose links you can follow. Mobile-first: the panel is a bottom sheet, the add-node
  flow a full-screen form. **Spread** recomputes the layout; overlapping cards are
  separated automatically on load.
- **Edit** — add, edit and delete nodes and links. Deleting a node warns about what it
  takes with it. A raw-JSON tab covers bulk edits.
- **Share** — export as graph JSON, as [JSON Canvas](https://jsoncanvas.org) (`.canvas`,
  readable in Obsidian), or as a **self-contained HTML file** with the whole viewer
  inlined — mail it to a colleague and they see exactly what you see, from a
  double-click, with nothing installed. Import accepts all three back.
- **Sources** — paste or drop a CSL-JSON or BibTeX export and each item becomes a
  `source` node; re-importing updates rather than duplicating (matched on Zotero key,
  then DOI, then citation key). Optional one-way pull from the
  [Zotero Web API](https://www.zotero.org/support/dev/web_api/v3/start), behind an API
  key that never leaves your browser.

## Importing an older map

Graphs written under the earlier, stricter schema (see [SCHEMA.md](SCHEMA.md), archived)
import automatically and are simplified on the way in:

- `rq` → question, and `asks` edges become `parent` fields
- `study` / `experiment` → experiment, with **its findings folded into its result**
- `paper` → source
- everything else (claims, gaps, constructs, methods, materials, tasks) is kept as a
  note, tagged with what it used to be — nothing is discarded
- links keep their labels, and a link that pointed at a folded-in result now points at
  the experiment

## Running it

It is a static site — any static server works:

```bash
python3 -m http.server 4173
```

then open <http://localhost:4173>. (Opening `index.html` straight from `file://` is
blocked by Chrome and Firefox, which refuse module imports from file pages — the
self-contained HTML *export* is the artifact that opens anywhere.) The tests are a
plain page with no runner: open [tests.html](https://alpkaraagac.github.io/ResearchGraphApp/tests.html)
and read the green.

## Layout of the repo

```
index.html        app shell
css/app.css       all styles (mobile-first)
js/schema.js      the four types, parent links, structural validation
js/layout.js      force-directed layout + exact card de-overlap
js/render.js      cards, edges, detail panel
js/view.js        pan / zoom / fit
js/forms.js       add and edit dialogs
js/exporter.js    JSON, JSON Canvas, self-contained HTML
js/migrate.js     older maps in, results folded into experiments
js/sources.js     CSL-JSON + BibTeX import, Zotero Web API
js/store.js       localStorage persistence
tests.html        assertion tests, no runner
examples/         the demo graph
```
