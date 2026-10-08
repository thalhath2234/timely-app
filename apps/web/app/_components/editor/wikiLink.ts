import { InputRule, Node as TiptapNode, mergeAttributes } from "@tiptap/react";

/*
 * [[Page]] links as Obsidian writes them. The target is a page title, kept
 * as text so the file round-trips; clicking looks the page up by title.
 */

export interface WikiLinkAttrs {
  target: string;
  alias: string | null;
  embed: boolean;
}

/** Visible text of a wiki link. */
export function wikiLinkLabel(attrs: Partial<WikiLinkAttrs>) {
  return attrs.alias || attrs.target || "page";
}

/** The page title part of a target, without a #heading suffix. */
export function wikiLinkPage(target: string) {
  return target.split("#")[0].trim();
}

export const WikiLink = TiptapNode.create({
  name: "wikiLink",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      target: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-target") ?? "",
        renderHTML: (attributes) => ({ "data-target": attributes.target }),
      },
      alias: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-alias"),
        renderHTML: (attributes) => (attributes.alias ? { "data-alias": attributes.alias } : {}),
      },
      embed: {
        default: false,
        parseHTML: (element) => element.getAttribute("data-embed") === "true",
        renderHTML: (attributes) => (attributes.embed ? { "data-embed": "true" } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: "a[data-wiki-link]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const attrs = node.attrs as WikiLinkAttrs;
    return [
      "a",
      mergeAttributes(HTMLAttributes, {
        "data-wiki-link": "",
        class: attrs.embed ? "doc-wiki-link doc-wiki-embed" : "doc-wiki-link",
        href: "#",
        title: attrs.embed ? `Embedded page: ${attrs.target}` : `Page: ${attrs.target}`,
      }),
      wikiLinkLabel(attrs),
    ];
  },

  renderText({ node }) {
    return wikiLinkLabel(node.attrs as WikiLinkAttrs);
  },

  addInputRules() {
    // Typing [[Page]] or [[Page|alias]] makes a link.
    return [
      new InputRule({
        find: /\[\[([^[\]|\n]+?)(?:\|([^[\]\n]*))?\]\]$/,
        handler: ({ state, range, match }) => {
          const node = state.schema.nodes.wikiLink.create({
            target: match[1].trim(),
            alias: match[2]?.trim() || null,
            embed: false,
          });
          state.tr.replaceWith(range.from, range.to, node);
        },
      }),
    ];
  },
});
