const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (character) => ESCAPES[character]);
}

/** Only web, mail and relative targets become links; other schemes stay text. */
function safeHref(url: string): string | null {
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url.trim());
  return !scheme || /^(https?|mailto)$/i.test(scheme[1]) ? url.trim() : null;
}

function inline(text: string): string {
  const escaped = escapeHtml(text);
  const tokens: string[] = [];
  // Private-use delimiters cannot come from normal help text.
  const stash = (html: string) => `\uE000${tokens.push(html) - 1}\uE000`;

  // Code and links first: their contents must not get emphasis.
  let out = escaped.replace(/`([^`]+)`/g, (_match, code: string) =>
    stash(`<code>${code}</code>`),
  );
  out = out.replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    (match, label: string, url: string) => {
      const href = safeHref(url);
      if (href === null) return match;
      const external = /^https?:\/\//i.test(href);
      const attrs = external
        ? ' target="_blank" rel="noopener noreferrer"'
        : "";
      return stash(`<a href="${href}"${attrs}>${label}</a>`);
    },
  );
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  return out.replace(
    /\uE000(\d+)\uE000/g,
    (_match, index: string) => tokens[Number(index)],
  );
}

function renderBlocks(source: string): string {
  const lines = source.split(/\r?\n/);
  const blocks: string[] = [];
  let paragraph: string[] = [];

  const flush = () => {
    if (!paragraph.length) return;
    blocks.push(`<p>${paragraph.map(inline).join("<br>")}</p>`);
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) {
      flush();
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      const level = heading[1].length;
      blocks.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      flush();
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(`<li>${inline(lines[i].replace(/^\s*[-*]\s+/, ""))}</li>`);
        i++;
      }
      i--;
      blocks.push(`<ul>\n${items.join("\n")}\n</ul>`);
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      flush();
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(`<li>${inline(lines[i].replace(/^\s*\d+\.\s+/, ""))}</li>`);
        i++;
      }
      i--;
      blocks.push(`<ol>\n${items.join("\n")}\n</ol>`);
      continue;
    }
    paragraph.push(line);
  }
  flush();
  return blocks.length ? `${blocks.join("\n")}\n` : "";
}

/** Render the small Markdown subset used by template help. */
export async function renderHelp(markdown?: string): Promise<string> {
  return renderBlocks(markdown?.trim() ?? "");
}
