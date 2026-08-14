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
| `claim` | what you argue *from* findings. One level up from a finding. Carries `kind`: `empirical` (rests on findings) or `argued` (rests on sources, constructs and reasoning). | "Every null here is a limit on what was visible" (empirical); "Quality is never observed, so it cannot be identified" (argued) |
| `note` | a caveat, decision, correction or terminology rule | "Write these as limits, not absences" |
| `task` | an open action | "Verify this citation" |

**The finding/claim split is the load-bearing distinction.** A finding is what the analysis
returned; a claim is what you say it means. Keeping them apart is what lets the tool notice
that a claim has nothing under it, or that a finding is being asked to carry three claims.

**The `kind` field on claims exists because not every claim is empirical.** An identification
argument, a definitional contribution, or a reframing of a literature rests on sources and
reasoning, not on a result. Marking those `argued` stops the linter demanding findings that
were never going to exist — and, more usefully, makes visible how much of a thesis is
argued rather than shown.

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

| relation | from → to | what it means |
|---|---|---|
| `asks` | question → question | sub-question of |
| `motivates` | gap → question, finding → study, claim → study | why the next thing was done |
| `addresses` | study → question | |
| `uses` | method → study, material → study | |
| `yields` | finding → study | |
| `extends` | study → study | a follow-up sharing the design |
| `validates` | finding → method, finding → study | a diagnostic or check result, not a substantive one |
| `invalidates` | finding → finding, study → finding | this result retracts or breaks that one |
| `supports` | finding → claim, finding → finding | |
| `contradicts` | finding → claim, finding → finding, source → claim, source → finding | |
| `bounds` | finding → finding, finding → question | states how large an effect would have had to be |
| `converges` | source → finding, source → claim | independent evidence of the same shape, from elsewhere |
| `answers` | claim → question | |
| `composes` | claim → claim | a component of a larger claim |
| `qualifies` | note → anything | |
| `grounds` | source → construct, source → gap, source → claim, source → question | |
| `documents` | source → material | the paper the dataset comes from |
| `builds-on` | source → source | literature structure: defends, deploys, replies to |
| `threatens` | source → claim, source → gap | |
| `inspires` | source → method, source → study | |
| `blocks` | task → anything | |

`threatens` is the one people forget to model and the one that gets them at the viva: the
paper that occupies your territory, the result that undercuts your claim.

`validates` and `converges` were added in v1.1 after the first real migration. Without
`validates`, every diagnostic and robustness check in a project reads as an orphan finding.
Without `converges`, there is nowhere to put the sentence "our null matches theirs", which
in practice is one of the most-written sentences in any discussion section.

---

## 4. Lint rules

What the tool checks and reports. This is the whole product.

1. **Unsupported claim** — a `claim` with `kind: empirical` and no incoming `supports`
   from a `finding`. Claims marked `argued` are exempt, but see rule 9.
2. **Orphan finding** — a `finding` with status `supported` or `null-with-bound` that has no
   outgoing `supports`, `bounds`, `contradicts` or `validates`. Findings marked
   `untestable`, `withdrawn`, `invalid` or `sealed` are exempt: those are reported for
   completeness and are not supposed to carry anything.
3. **Unaddressed question** — a leaf `question` with no `study` addressing it and no `claim`
   answering it. A parent question is instead flagged **no synthesis** if it has no `claim`
   of its own, which is a warning rather than an error.
4. **Unwarranted question** — a *root* `question` with no `gap` motivating it. Sub-questions
   inherit their parent's warrant and are not flagged.
5. **Bare study** — a `study` with no `finding`. Fine while `planned` or `running`; a
   problem once `complete`.
6. **Unverified citation** — any `source` still `unverified` or `to-read` that already
   `grounds` or `converges` with anything.
7. **Unhandled threat** — a `source` with `threatens` or `contradicts` reaching a `claim`
   that is `established`.
8. **Status mismatch** — a `question` marked `answered` whose only supporting findings are
   `untestable`, `sealed` or `withdrawn`.
9. **Argued claim with no grounds** — a `claim` with `kind: argued` and no incoming
   `grounds` from any `source` or `construct`. An argument with no literature under it is
   an assertion.

Rule 8 is the one that would have caught the mistake this schema came out of. Rules 2, 3
and 4 were all narrowed in v1.1: in their v1 form they produced 39 flags on a real graph, of
which about a dozen were real.

**Severity matters more than count.** Rules 1, 7, 8 and 9 are errors — the argument is
broken. Rules 2, 3, 5 and 6 are warnings — the map is incomplete, which is the normal state
of a project in progress. Show them separately or the error count is never zero and stops
meaning anything.

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

Expect the migration to drop edges. When it does, read the list before accepting it: a
concentration of drops in one place is the schema being wrong, not the graph. In the first
real migration, 56 edges were dropped and roughly 40 of them were the schema refusing to let
a source comment on a result — which was a genuine hole, now filled by `converges`,
`contradicts` and `documents`.

---

## 8. Changelog

**v1.1** — first revision after migrating a real thesis map (176 nodes, 267 edges).

- Added `kind` to `claim` (`empirical` / `argued`) and lint rule 9.
- Added relations: `extends`, `validates`, `invalidates`, `converges`, `composes`,
  `documents`, `builds-on`.
- Widened `motivates` to accept findings and claims as sources, `contradicts` to accept
  sources and findings, and `grounds` to accept questions as targets.
- Narrowed lint rule 2 (findings exempt by status), rule 3 (leaf questions only, parents get
  a warning), rule 4 (root questions only — sub-questions inherit their warrant).
- Split lint output into errors and warnings.
