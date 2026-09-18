import type { Doc } from "./types";

export type DocNode = Doc & { children: DocNode[] };

export function buildDocTree(docs: Doc[]): DocNode[] {
  const byId = new Map<string, DocNode>();
  docs.forEach((doc) => byId.set(doc.id, { ...doc, children: [] }));

  const roots: DocNode[] = [];
  byId.forEach((node) => {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  });

  const sortNodes = (nodes: DocNode[]) => {
    nodes.sort((a, b) => a.order - b.order || b.updatedAt.localeCompare(a.updatedAt));
    nodes.forEach((node) => sortNodes(node.children));
  };
  sortNodes(roots);
  return roots;
}

export function countDocDescendants(node: DocNode): number {
  return node.children.reduce((total, child) => total + 1 + countDocDescendants(child), 0);
}
