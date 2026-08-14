# Research graph schema v1

A small, opinionated schema for mapping a single research project (thesis, paper, or
dissertation chapter) as a typed graph.

The point of the schema is that it is **not** a general mind map. It knows the difference
between a finding and a claim, between a null result and an untestable one, and between a
question you answered and one you bounded. Those distinctions are what make it lintable.

---

## 1. Node types

Eleven types, in four families.

### Asking

| type | what it is | examples |
|---|---|---|
| `question` | something the project asks. Nest with `parent` for sub-questions. | "How much of the reaction is the perceiver?" |
| `gap` | why the question is worth asking — what the literature has not done | "No joint decomposition across person, situation and stimulus" |

### Grounding

| type | what it is | examples |
|---|---|---|
| `construct` | a concept, theory or definition the project depends on | "Perceiver", "Exchangeability", "CAPS" |
| `source` | any citable work | a paper, dataset paper, book, preprint, standard |

### Doing

| type | what it is | examples |
|---|---|---|
| `study` | a unit of investigation with its own design | experiment, survey wave, interview round, simulation, corpus build, case study, proof |
| `method` | a procedure, instrument or analysis used inside a study | "Paired bootstrap of the gap", "semi-structured interview protocol" |
| `material` | what the study was run on or with | dataset, corpus, participant sample, artefact, codebase |

### Concluding

| type | what it is | examples |
|---|---|---|
| `finding` | what came out of a study. Includes nulls, failures and non-results. | "p = .665, with a bound of 0.10" |
| `claim` | what you argue *from* findings. One level up from a finding. | "Every null here is a limit on what was visible" |
| `note` | a caveat, decision, correction or terminology rule | "Write these as limits, not absences" |
| `task` | an open action | "Verify this citation" |

**The finding/claim split is the load-bearing distinction.** A finding is what the analysis
returned; a claim is what you say it means. Keeping them apart is what lets the tool notice
that a claim has nothing under it, or that a finding is being asked to carry three claims.

---

## 2. Status vocabularies

Status is **per type**, not global. "Sealed" means nothing for a source; "to-read" means
nothing for a finding. A shared status list is what makes generic tools useless here.

```json
{
  "question": ["open", "answered", "partly-answered", "bounded", "abandoned"],
  "gap":      ["asserted", "verified", "contested", "closed-by-others"],
  "study":    ["planned", "running", "complete", "abandoned"],
  "finding":  ["supported", "null-with-bound", "untestable", "sealed", "withdrawn", "invalid"],
  "claim":    ["established", "provisional", "contested", "abandoned"],
  "source":   ["to-read", "read", "verified", "unverified"],
  "method":   ["draft", "preregistered", "run", "superseded"],
  "material": ["planned", "collected", "frozen"],
  "note":     [],
  "task":     ["todo", "doing", "done"]
}
```

Three of these are worth defending because no other tool has them:

- `bounded` (question) — you did not answer it, and you know how big an answer would have
  had to be for you to have seen it. Different from `open`.
- `untestable` (finding) — examined and found unanswerable with this data. Different from
  `null-with-bound`, which is a real test that returned nothing, and very different from
  `withdrawn`, which is a result you retracted.
- `sealed` (finding) — computed but deliberately not inspected, pending a validation gate.

---

## 3. Relations

A closed set. Free-text relations kill validation, and validation is the feature.

| relation | from → to |
|---|---|
| `asks` | question → question (sub-question of) |
| `motivates` | gap → question |
| `addresses` | study → question |
| `uses` | method → study, material → study |
| `yields` | finding → study |
| `supports` | finding → claim, finding → finding |
| `contradicts` | finding → claim, source → claim |
| `bounds` | finding → finding, finding → question |
| `qualifies` | note → anything |
| `answers` | claim → question |
| `grounds` | source → construct, source → gap, source → claim |
| `threatens` | source → claim, source → gap |
| `inspires` | source → method, source → study |
| `blocks` | task → anything |

`threatens` is the one people forget to model and the one that gets them at the viva: the
paper that occupies your territory, the result that undercuts your claim.

---

## 4. Lint rules

What the tool checks and reports. This is the whole product.

1. **Unsupported claim** — a `claim` with no incoming `supports` from a `finding`.
2. **Orphan finding** — a `finding` not linked to any `claim` or `question`. Either it does
   no work, or you have an unwritten claim.
3. **Unaddressed question** — a `question` with no `study` addressing it and no `claim`
   answering it.
4. **Unwarranted question** — a `question` with no `gap` motivating it.
5. **Bare study** — a `study` with no `finding`. Fine while `planned` or `running`; a
   problem once `complete`.
6. **Unverified citation** — any `source` still `unverified` or `to-read` that already
   `grounds` a `claim`.
7. **Unhandled threat** — a `source` with a `threatens` edge to a `claim` that is
   `established`.
8. **Status mismatch** — a `question` marked `answered` whose only supporting findings are
   `untestable`, `sealed` or `withdrawn`.

Rule 8 is the one that would have caught the mistake this schema came out of.

---

## 5. Zotero mapping

`source` nodes map onto CSL-JSON, so a Zotero item becomes a node with no re-typing.

| node field | CSL-JSON |
|---|---|
| `id` | `citation-key` (fall back to `id`) |
| `label` | authors + year + short title, generated |
| `fields.Citation` | container-title, volume, pages, DOI |
| `fields.Type` | `type` |
| `meta.doi` | `DOI` |
| `meta.zoteroKey` | item key, so re-imports update rather than duplicate |

Three ways in, in order of how well they work in a static browser app:

1. **Paste or drop a CSL-JSON / BibTeX export.** Always works, no auth, no CORS, no setup.
   Do this first; it is an afternoon.
2. **Zotero Web API** (`https://api.zotero.org`, API key + library ID). HTTPS, so no mixed
   content. Verify CORS behaviour before committing to it.
3. **Zotero local API** (`http://localhost:23119/api/`). Do not plan around this. It is
   documented as being for code running on the user's own machine, it rejects requests with
   browser user-agent strings unless a custom header is set, and Zotero's own staff have
   said in the forums that you cannot connect to it from a browser. A local API from an
   HTTPS-hosted page is the wrong shape regardless.

---

## 6. Sharing

The graph is one JSON object. Sharing is copy, paste, or download — no accounts, no server,
no sync. A self-contained HTML file with the JSON embedded is the whole distribution story,
and it means a graph outlives the app that made it.

Worth also emitting JSON Canvas (`.canvas`) on export: it is an open MIT-licensed format,
it tolerates extra fields on nodes and edges, and it makes the graph readable in Obsidian
and anything else that speaks it.

---

## 7. Migration from the current map

| old | new |
|---|---|
| `rq` | `question` |
| `experiment` | `study` |
| `result` | `finding` |
| `paper` | `source` |
| `corpus` | `material` |
| `venue` | drop — make it a `task` |
| `gap`, `construct`, `method`, `claim`, `note`, `task` | unchanged |

Statuses split by type per section 2. `not-estimable` becomes `untestable`; `established`
on a finding becomes `supported`; `established` on a claim stays.
