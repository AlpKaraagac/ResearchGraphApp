// The nine lint rules from SCHEMA.md §4 (v1.1). Severity matters more than
// count: errors mean the argument is broken; warnings mean the map is
// incomplete, which is the normal state of a project in progress. lint()
// expects a graph that already passed validateGraph(); edges with a missing
// endpoint are skipped rather than crashing so a half-edited graph still
// lints.
//
// Rule 4 is assigned no severity by the schema's own split (it lists errors
// 1/7/8/9 and warnings 2/3/5/6); it is treated as a warning here, alongside
// the other narrowed map-completeness rules it was grouped with.

export const LINT_RULES = [
  {
    rule: 1,
    id: 'unsupported-claim',
    severity: 'error',
    title: 'Unsupported claim',
    description: 'An empirical claim with no incoming supports from a finding. Argued claims are exempt (see rule 9).',
  },
  {
    rule: 2,
    id: 'orphan-finding',
    severity: 'warning',
    title: 'Orphan finding',
    description: 'A supported or null-with-bound finding with no outgoing supports, bounds, contradicts or validates. Untestable, withdrawn, invalid and sealed findings are exempt.',
  },
  {
    rule: 3,
    id: 'unaddressed-question',
    severity: 'warning',
    title: 'Unaddressed question',
    description: 'A leaf question with no study addressing it and no claim answering it.',
  },
  {
    rule: 3,
    id: 'no-synthesis',
    severity: 'warning',
    title: 'No synthesis',
    description: 'A parent question with no claim of its own — the sub-questions have nothing pulling them together.',
  },
  {
    rule: 4,
    id: 'unwarranted-question',
    severity: 'warning',
    title: 'Unwarranted question',
    description: 'A root question with no gap motivating it. Sub-questions inherit their parent\'s warrant.',
  },
  {
    rule: 5,
    id: 'bare-study',
    severity: 'warning',
    title: 'Bare study',
    description: 'A study with no finding. Fine while planned or running; a problem once complete.',
  },
  {
    rule: 6,
    id: 'unverified-citation',
    severity: 'warning',
    title: 'Unverified citation',
    description: 'A source still unverified or to-read that already grounds or converges with anything.',
  },
  {
    rule: 7,
    id: 'unhandled-threat',
    severity: 'error',
    title: 'Unhandled threat',
    description: 'A source with threatens or contradicts reaching a claim that is established.',
  },
  {
    rule: 8,
    id: 'status-mismatch',
    severity: 'error',
    title: 'Status mismatch',
    description: 'A question marked answered whose only supporting findings are untestable, sealed or withdrawn.',
  },
  {
    rule: 9,
    id: 'ungrounded-argument',
    severity: 'error',
    title: 'Argued claim with no grounds',
    description: 'An argued claim with no incoming grounds from a source or construct. An argument with no literature under it is an assertion.',
  },
];

const RULE_BY_ID = new Map(LINT_RULES.map((r) => [r.id, r]));

// Findings: { rule, id, severity, nodeId, related, message }. nodeId is the
// node the panel should jump to; related lists the other nodes involved.
export function lint(graph) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const allEdges = Array.isArray(graph?.edges) ? graph.edges : [];

  const byId = new Map();
  for (const node of nodes) {
    if (node && typeof node.id === 'string' && !byId.has(node.id)) byId.set(node.id, node);
  }
  const edges = allEdges.filter((e) => e && byId.has(e.from) && byId.has(e.to));

  const incoming = new Map();
  const outgoing = new Map();
  for (const edge of edges) {
    if (!incoming.has(edge.to)) incoming.set(edge.to, []);
    incoming.get(edge.to).push(edge);
    if (!outgoing.has(edge.from)) outgoing.set(edge.from, []);
    outgoing.get(edge.from).push(edge);
  }
  const inOf = (id) => incoming.get(id) ?? [];
  const outOf = (id) => outgoing.get(id) ?? [];
  const typeOf = (id) => byId.get(id)?.type;

  const findings = [];
  const report = (ruleId, node, message, related = []) => {
    const rule = RULE_BY_ID.get(ruleId);
    findings.push({
      rule: rule.rule, id: ruleId, severity: rule.severity, nodeId: node.id, related, message,
    });
  };

  const supportersOf = (id) =>
    inOf(id)
      .filter((e) => e.relation === 'supports' && typeOf(e.from) === 'finding')
      .map((e) => byId.get(e.from));

  const ORPHANABLE = ['supported', 'null-with-bound'];
  const DISCHARGES = ['supports', 'bounds', 'contradicts', 'validates'];

  for (const node of nodes) {
    if (!byId.get(node?.id) || byId.get(node.id) !== node) continue;

    if (node.type === 'claim') {
      if (node.kind === 'argued') {
        const grounded = inOf(node.id).some(
          (e) => e.relation === 'grounds' && ['source', 'construct'].includes(typeOf(e.from)),
        );
        if (!grounded) {
          report('ungrounded-argument', node, `"${node.label}" is argued but nothing grounds it`);
        }
      } else if (supportersOf(node.id).length === 0) {
        report('unsupported-claim', node, `"${node.label}" has no finding supporting it`);
      }

      if (node.status === 'established') {
        for (const edge of inOf(node.id)) {
          if (['threatens', 'contradicts'].includes(edge.relation) && typeOf(edge.from) === 'source') {
            const source = byId.get(edge.from);
            report(
              'unhandled-threat',
              node,
              `"${node.label}" is established, but "${source.label}" ${edge.relation} it`,
              [source.id],
            );
          }
        }
      }
    }

    if (node.type === 'finding' && ORPHANABLE.includes(node.status)) {
      const discharges = outOf(node.id).some((e) => DISCHARGES.includes(e.relation));
      if (!discharges) {
        report('orphan-finding', node,
          `"${node.label}" supports, bounds, contradicts and validates nothing`);
      }
    }

    if (node.type === 'question') {
      // asks runs from the sub-question to its parent: a parent has incoming
      // asks, a root has no outgoing asks, a leaf has no incoming asks.
      const isParent = inOf(node.id).some(
        (e) => e.relation === 'asks' && typeOf(e.from) === 'question',
      );
      const isRoot = !outOf(node.id).some(
        (e) => e.relation === 'asks' && typeOf(e.to) === 'question',
      );
      const answeredBy = inOf(node.id).filter(
        (e) => e.relation === 'answers' && typeOf(e.from) === 'claim',
      );

      if (isParent) {
        if (answeredBy.length === 0) {
          report('no-synthesis', node, `"${node.label}" has sub-questions but no claim of its own`);
        }
      } else {
        const addressedBy = inOf(node.id).filter(
          (e) => e.relation === 'addresses' && typeOf(e.from) === 'study',
        );
        if (addressedBy.length === 0 && answeredBy.length === 0) {
          report('unaddressed-question', node,
            `no study addresses and no claim answers "${node.label}"`);
        }
      }

      if (isRoot) {
        const motivatedBy = inOf(node.id).filter(
          (e) => e.relation === 'motivates' && typeOf(e.from) === 'gap',
        );
        if (motivatedBy.length === 0) {
          report('unwarranted-question', node, `no gap motivates "${node.label}"`);
        }
      }

      // Rule 8, unchanged from v1: the direct finding-supporters of the
      // claims answering this question. An answered question with no
      // supporters at all is rule 1's territory, not rule 8's.
      if (node.status === 'answered') {
        const supporters = [];
        const seen = new Set();
        for (const edge of answeredBy) {
          for (const f of supportersOf(edge.from)) {
            if (!seen.has(f.id)) {
              seen.add(f.id);
              supporters.push(f);
            }
          }
        }
        const bad = ['untestable', 'sealed', 'withdrawn'];
        if (supporters.length > 0 && supporters.every((f) => bad.includes(f.status))) {
          const statuses = [...new Set(supporters.map((f) => f.status))].join(', ');
          report(
            'status-mismatch',
            node,
            `"${node.label}" is marked answered, but its only supporting findings are ${statuses}`,
            supporters.map((f) => f.id),
          );
        }
      }
    }

    if (node.type === 'study' && node.status === 'complete') {
      const yieldsIn = inOf(node.id).filter(
        (e) => e.relation === 'yields' && typeOf(e.from) === 'finding',
      );
      if (yieldsIn.length === 0) {
        report('bare-study', node, `"${node.label}" is complete but has no finding`);
      }
    }

    if (node.type === 'source' && (node.status === 'unverified' || node.status === 'to-read')) {
      const loadBearing = outOf(node.id).filter(
        (e) => e.relation === 'grounds' || e.relation === 'converges',
      );
      if (loadBearing.length > 0) {
        const count = loadBearing.length;
        report(
          'unverified-citation',
          node,
          `"${node.label}" is ${node.status} but grounds or converges with ${count} thing${count === 1 ? '' : 's'}`,
          loadBearing.map((e) => e.to),
        );
      }
    }
  }

  // errors first, then warnings, each in rule order; graph order within a rule
  const severityRank = { error: 0, warning: 1 };
  findings.sort((a, b) =>
    severityRank[a.severity] - severityRank[b.severity] || a.rule - b.rule);
  return findings;
}
