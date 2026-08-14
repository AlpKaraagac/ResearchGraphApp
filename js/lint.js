// The eight lint rules from SCHEMA.md §4. lint() expects a graph that already
// passed validateGraph(); edges with a missing endpoint are skipped rather
// than crashing so a half-edited graph still lints.

export const LINT_RULES = [
  {
    rule: 1,
    id: 'unsupported-claim',
    title: 'Unsupported claim',
    description: 'A claim with no incoming supports from a finding.',
  },
  {
    rule: 2,
    id: 'orphan-finding',
    title: 'Orphan finding',
    description:
      'A finding not linked to any claim or question. Either it does no work, or you have an unwritten claim.',
  },
  {
    rule: 3,
    id: 'unaddressed-question',
    title: 'Unaddressed question',
    description: 'A question with no study addressing it and no claim answering it.',
  },
  {
    rule: 4,
    id: 'unwarranted-question',
    title: 'Unwarranted question',
    description: 'A question with no gap motivating it.',
  },
  {
    rule: 5,
    id: 'bare-study',
    title: 'Bare study',
    description: 'A study with no finding. Fine while planned or running; a problem once complete.',
  },
  {
    rule: 6,
    id: 'unverified-citation',
    title: 'Unverified citation',
    description: 'A source still unverified or to-read that already grounds a claim.',
  },
  {
    rule: 7,
    id: 'unhandled-threat',
    title: 'Unhandled threat',
    description: 'A source with a threatens edge to a claim that is established.',
  },
  {
    rule: 8,
    id: 'status-mismatch',
    title: 'Status mismatch',
    description:
      'A question marked answered whose only supporting findings are untestable, sealed or withdrawn.',
  },
];

const RULE_BY_ID = new Map(LINT_RULES.map((r) => [r.id, r]));

// Findings: { rule, id, nodeId, related, message }. nodeId is the node the
// panel should jump to; related lists the other nodes involved.
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
    findings.push({ rule: rule.rule, id: ruleId, nodeId: node.id, related, message });
  };

  // Direct finding-supporters of a node (rules 1 and 8 both need this).
  const supportersOf = (id) =>
    inOf(id)
      .filter((e) => e.relation === 'supports' && typeOf(e.from) === 'finding')
      .map((e) => byId.get(e.from));

  // Rule 2: a finding counts as linked if it reaches a claim or question
  // through supports/bounds/contradicts edges, following chains across
  // intermediate findings (confirmed reading: chains count).
  const reachesClaimOrQuestion = (start) => {
    const queue = [start];
    const visited = new Set([start]);
    while (queue.length > 0) {
      const id = queue.shift();
      for (const edge of outOf(id)) {
        if (!['supports', 'bounds', 'contradicts'].includes(edge.relation)) continue;
        const targetType = typeOf(edge.to);
        if (targetType === 'claim' || targetType === 'question') return true;
        if (targetType === 'finding' && !visited.has(edge.to)) {
          visited.add(edge.to);
          queue.push(edge.to);
        }
      }
    }
    return false;
  };

  for (const node of nodes) {
    if (!byId.get(node?.id) || byId.get(node.id) !== node) continue;

    if (node.type === 'claim') {
      if (supportersOf(node.id).length === 0) {
        report('unsupported-claim', node, `"${node.label}" has no finding supporting it`);
      }
    }

    if (node.type === 'finding') {
      if (!reachesClaimOrQuestion(node.id)) {
        report('orphan-finding', node, `"${node.label}" is not linked to any claim or question`);
      }
    }

    if (node.type === 'question') {
      const addressedBy = inOf(node.id).filter(
        (e) => e.relation === 'addresses' && typeOf(e.from) === 'study',
      );
      const answeredBy = inOf(node.id).filter(
        (e) => e.relation === 'answers' && typeOf(e.from) === 'claim',
      );
      if (addressedBy.length === 0 && answeredBy.length === 0) {
        report('unaddressed-question', node, `no study addresses and no claim answers "${node.label}"`);
      }

      const motivatedBy = inOf(node.id).filter(
        (e) => e.relation === 'motivates' && typeOf(e.from) === 'gap',
      );
      if (motivatedBy.length === 0) {
        report('unwarranted-question', node, `no gap motivates "${node.label}"`);
      }

      // Rule 8, on the confirmed reading of "supporting findings": the direct
      // finding-supporters of the claims answering this question. An answered
      // question with no supporters at all is rule 1's territory, not rule 8's.
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
      const groundedClaims = outOf(node.id).filter(
        (e) => e.relation === 'grounds' && typeOf(e.to) === 'claim',
      );
      if (groundedClaims.length > 0) {
        const count = groundedClaims.length;
        report(
          'unverified-citation',
          node,
          `"${node.label}" is ${node.status} but grounds ${count} claim${count === 1 ? '' : 's'}`,
          groundedClaims.map((e) => e.to),
        );
      }
    }

    if (node.type === 'claim' && node.status === 'established') {
      for (const edge of inOf(node.id)) {
        if (edge.relation === 'threatens' && typeOf(edge.from) === 'source') {
          const source = byId.get(edge.from);
          report(
            'unhandled-threat',
            node,
            `"${node.label}" is established, but "${source.label}" threatens it`,
            [source.id],
          );
        }
      }
    }
  }

  findings.sort((a, b) => a.rule - b.rule);
  return findings;
}
