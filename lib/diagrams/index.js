// Diagram dispatcher — one renderer per type. Adding a new diagram type
// is just a new file + entry in TYPES below; nothing else changes.

import { renderBarGraph }   from './bar_graph.js';
import { renderNumberLine } from './number_line.js';

const TYPES = {
  bar_graph:   renderBarGraph,
  number_line: renderNumberLine,
};

export function renderDiagram(spec) {
  if (!spec || typeof spec !== 'object') throw new Error('renderDiagram: spec required');
  const fn = TYPES[spec.type];
  if (!fn) throw new Error(`renderDiagram: unknown type "${spec.type}"`);
  return fn(spec);
}

export function listDiagramTypes() {
  return Object.keys(TYPES);
}
