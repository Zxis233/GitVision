import {
  clamp,
  escapeXml,
  estimateMonospaceWidth,
  estimateTextWidth,
  formatDate,
} from "./utils.js";

const REF_THEMES = {
  branch: {
    fill: "#ddf7e5",
    stroke: "#2b8a3e",
    text: "#14532d",
  },
  remote: {
    fill: "#f6ddff",
    stroke: "#a61eaf",
    text: "#7b1fa2",
  },
  tag: {
    fill: "#ffe8bf",
    stroke: "#d97706",
    text: "#92400e",
  },
  ref: {
    fill: "#dbeafe",
    stroke: "#2563eb",
    text: "#1d4ed8",
  },
};

const MAPLE_MONO_STACK =
  '"Maple Mono Normal NF CN", "Maple Mono NF CN", "Maple Mono", "Cascadia Mono", "Consolas", monospace';
const REF_FONT_SIZE = 12;
const REF_PILL_PADDING_X = 12;
const HASH_FONT_SIZE = 12;

function getRefTheme(ref) {
  if (ref.isHead && ref.type === "branch") {
    return {
      fill: "#c7f1d3",
      stroke: "#1f7a36",
      text: "#14532d",
    };
  }
  return REF_THEMES[ref.type] ?? REF_THEMES.ref;
}

function measureRef(ref) {
  return Math.ceil(REF_PILL_PADDING_X * 2 + estimateMonospaceWidth(ref.name, REF_FONT_SIZE));
}

function measureCommit(commit) {
  const refWidth = commit.refs.reduce((total, ref) => total + measureRef(ref) + 8, 0);
  const titleWidth = estimateTextWidth(commit.subject, 18);
  const hashWidth = estimateMonospaceWidth(commit.shortSha, HASH_FONT_SIZE);
  const detailsWidth = estimateTextWidth(
    `  ·  ${commit.authorName}  ·  ${formatDate(commit.authoredIso)}`,
    12,
  );
  const metaWidth = hashWidth + detailsWidth;

  return Math.max(refWidth + titleWidth + 40, metaWidth + 20);
}

function createEdgePath(edge, laneX, rowY) {
  const x1 = laneX(edge.fromLane);
  const y1 = rowY(edge.fromRow);
  const x2 = laneX(edge.toLane);
  const y2 = rowY(edge.toRow);

  if (x1 === x2) {
    return `M ${x1} ${y1} L ${x2} ${y2}`;
  }

  const midY = y1 + (y2 - y1) / 2;
  return `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
}

function renderRefPill(ref, x, centerY) {
  const width = measureRef(ref);
  const theme = getRefTheme(ref);
  const rectY = centerY - 12;

  return {
    width,
    markup: `
      <g>
        <rect x="${x}" y="${rectY}" width="${width}" height="24" rx="12"
          fill="${theme.fill}" stroke="${theme.stroke}" stroke-width="1.2" />
        <text x="${x + REF_PILL_PADDING_X}" y="${centerY + 0.5}" class="ref-text"
          fill="${theme.text}" dominant-baseline="middle">${escapeXml(ref.name)}</text>
      </g>`,
  };
}

export function renderSvg(graph, options = {}) {
  const title = options.title || `${graph.repoName} Git Graph`;
  const rowHeight = 56;
  const laneGap = 34;
  const cardMargin = 20;
  const cardPaddingX = 28;
  const cardPaddingY = 24;
  const headerHeight = 72;
  const graphWidth = Math.max(156, (graph.laneCount - 1) * laneGap + 52);
  const visibleRefCount = graph.commits.reduce((total, commit) => total + commit.refs.length, 0);
  const contentWidth = clamp(
    Math.max(780, ...graph.commits.map((commit) => measureCommit(commit))),
    780,
    2200,
  );
  const svgWidth = Math.ceil(cardMargin * 2 + cardPaddingX * 2 + graphWidth + 32 + contentWidth);
  const svgHeight = Math.ceil(
    cardMargin * 2 + cardPaddingY * 2 + headerHeight + graph.commits.length * rowHeight + 24,
  );
  const cardWidth = svgWidth - cardMargin * 2;
  const cardHeight = svgHeight - cardMargin * 2;
  const graphX = cardMargin + cardPaddingX + 8;
  const rowsTop = cardMargin + cardPaddingY + headerHeight;
  const contentX = graphX + graphWidth + 32;
  const cardRight = cardMargin + cardWidth - cardPaddingX;
  const laneX = (lane) => graphX + lane * laneGap;
  const rowY = (row) => rowsTop + row * rowHeight + rowHeight / 2;
  const subtitle = [
    graph.repoPath,
    `${graph.commits.length} commits`,
    `${visibleRefCount} refs`,
  ].join("  ·  ");
  const generatedAt = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());

  const laneGuides = Array.from({ length: graph.laneCount }, (_, lane) => {
    const x = laneX(lane);
    return `<line x1="${x}" y1="${rowsTop - 18}" x2="${x}" y2="${svgHeight - cardMargin - 24}"
      stroke="#e5e7eb" stroke-width="1" />`;
  }).join("\n");

  const rowGuides = graph.commits
    .map((commit) => {
      const y = rowY(commit.row) + rowHeight / 2;
      return `<line x1="${graphX - 16}" y1="${y}" x2="${cardRight}" y2="${y}"
        stroke="#edf2f7" stroke-width="1" />`;
    })
    .join("\n");

  const edgeMarkup = graph.edges
    .map((edge) => {
      const dash = edge.isPrimary ? "" : ' stroke-dasharray="5 4"';
      return `<path d="${createEdgePath(edge, laneX, rowY)}" fill="none" stroke="${edge.color}"
        stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" opacity="0.92"${dash} />`;
    })
    .join("\n");

  const commitMarkup = graph.commits
    .map((commit) => {
      const x = laneX(commit.lane);
      const y = rowY(commit.row);
      const headlineY = y - 8;
      const metaY = y + 15;
      const hashWidth = estimateMonospaceWidth(commit.shortSha, HASH_FONT_SIZE);
      let cursorX = contentX;
      const refMarkup = commit.refs
        .map((ref) => {
          const rendered = renderRefPill(ref, cursorX, headlineY);
          cursorX += rendered.width + 8;
          return rendered.markup;
        })
        .join("\n");

      return `
        <g>
          <circle cx="${x}" cy="${y}" r="7.5" fill="${commit.color}" stroke="#fffdf7" stroke-width="3" />
          <circle cx="${x}" cy="${y}" r="2.2" fill="#fffdf7" opacity="${commit.parents.length > 1 ? 0.92 : 0.55}" />
          ${refMarkup}
          <text x="${cursorX}" y="${headlineY}" class="subject" dominant-baseline="middle">${escapeXml(commit.subject)}</text>
          <text x="${contentX}" y="${metaY}" class="hash" dominant-baseline="middle">${escapeXml(commit.shortSha)}</text>
          <text x="${contentX + hashWidth}" y="${metaY}" class="meta" dominant-baseline="middle">${escapeXml(
            `  ·  ${commit.authorName}  ·  ${formatDate(commit.authoredIso)}`,
          )}</text>
        </g>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}"
  viewBox="0 0 ${svgWidth} ${svgHeight}" role="img" aria-label="${escapeXml(title)}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#fff9f1" />
      <stop offset="55%" stop-color="#f8fbff" />
      <stop offset="100%" stop-color="#f5fff8" />
    </linearGradient>
    <linearGradient id="card" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#fffefb" />
      <stop offset="100%" stop-color="#fffaf0" />
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="10" stdDeviation="16" flood-color="#e2e8f0" flood-opacity="0.55" />
    </filter>
    <style>
      .title { font: 800 28px "MiSans VF", "Avenir Next", "Trebuchet MS", "PingFang SC", sans-serif; fill: #14213d; }
      .subtitle { font: 500 13px "MiSans VF", "IBM Plex Sans", "Segoe UI", "PingFang SC", sans-serif; fill: #64748b; }
      .subject { font: 700 18px "MiSans VF", "Avenir Next", "Trebuchet MS", "PingFang SC", sans-serif; fill: #111827; }
      .meta { font: 500 12px "MiSans VF", "IBM Plex Sans", "Segoe UI", "PingFang SC", sans-serif; fill: #6b7280; }
      .ref-text {
        font: 700 ${REF_FONT_SIZE}px ${MAPLE_MONO_STACK};
        letter-spacing: 0.1px;
      }
      .hash {
        font: 700 ${HASH_FONT_SIZE}px ${MAPLE_MONO_STACK};
        fill: #475569;
        letter-spacing: 0.15px;
      }
      .watermark { font: 600 12px "MiSans VF", "IBM Plex Sans", "Segoe UI", sans-serif; fill: #94a3b8; }
    </style>
  </defs>

  <rect width="${svgWidth}" height="${svgHeight}" fill="url(#bg)" />
  <rect x="${cardMargin}" y="${cardMargin}" width="${cardWidth}" height="${cardHeight}" rx="28"
    fill="url(#card)" filter="url(#shadow)" />

  <text x="${cardMargin + cardPaddingX}" y="${cardMargin + 38}" class="title">${escapeXml(title)}</text>
  <text x="${cardMargin + cardPaddingX}" y="${cardMargin + 62}" class="subtitle">${escapeXml(subtitle)}</text>
  <text x="${cardMargin + cardWidth - cardPaddingX}" y="${cardMargin + 38}" text-anchor="end" class="watermark">GitVision</text>
  <text x="${cardMargin + cardWidth - cardPaddingX}" y="${cardMargin + 60}" text-anchor="end" class="subtitle">Generated ${escapeXml(generatedAt)}</text>

  ${rowGuides}
  ${laneGuides}
  ${edgeMarkup}
  ${commitMarkup}
</svg>`;
}

export function renderHtml(svgMarkup, options = {}) {
  const title = options.title || "GitVision Export";

  return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeXml(title)}</title>
    <style>
      :root {
        color-scheme: light;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        font-family: "MiSans VF", "IBM Plex Sans", "Segoe UI", "PingFang SC", sans-serif;
        background:
          radial-gradient(circle at top left, rgba(255, 226, 178, 0.45), transparent 35%),
          radial-gradient(circle at top right, rgba(196, 247, 219, 0.5), transparent 32%),
          linear-gradient(180deg, #fff8ef 0%, #f8fbff 55%, #f5fff8 100%);
        color: #14213d;
      }

      main {
        padding: 28px;
      }

      .panel {
        overflow: auto;
        border-radius: 28px;
      }

      svg {
        display: block;
        max-width: none;
        height: auto;
      }
    </style>
  </head>
  <body>
    <main>
      <div class="panel">
        ${svgMarkup}
      </div>
    </main>
  </body>
</html>`;
}
