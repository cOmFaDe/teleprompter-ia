"use strict";

const STOPWORDS = new Set([
  "a", "o", "as", "os", "um", "uma", "uns", "umas", "de", "do", "da",
  "dos", "das", "em", "no", "na", "nos", "nas", "e", "que", "com", "para",
  "por", "se", "ao", "aos", "ou", "mas", "pra", "pro", "ja", "ate", "me",
  "te", "lhe", "seu", "sua"
]);

function normalise(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text) {
  const value = normalise(text);
  return value ? value.split(" ") : [];
}

function weightOf(token) {
  return STOPWORDS.has(token) || token.length <= 2
    ? 0.35
    : 1 + Math.min(0.6, Math.max(0, token.length - 4) * 0.1);
}

function levenshtein(a, b) {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = previous[j];
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      diagonal = above;
    }
  }
  return previous[b.length];
}

const similarityCache = new Map();
function similarity(a, b) {
  if (a === b) return 1;
  const key = a < b ? `${a}|${b}` : `${b}|${a}`;
  if (similarityCache.has(key)) return similarityCache.get(key);

  const max = Math.max(a.length, b.length);
  const min = Math.min(a.length, b.length);
  let result = 0;
  if (min >= 3 && Math.abs(a.length - b.length) <= 3) {
    const ratio = 1 - levenshtein(a, b) / max;
    const threshold = max <= 4 ? 0.75 : max <= 7 ? 0.7 : 0.65;
    if (ratio >= threshold) result = ratio * 0.9;
  }
  if (!result && min >= 5) {
    let prefix = 0;
    while (prefix < min && a[prefix] === b[prefix]) prefix += 1;
    if (prefix >= 5 && prefix / max >= 0.6) result = 0.7;
  }
  if (similarityCache.size > 50000) similarityCache.clear();
  similarityCache.set(key, result);
  return result;
}

class ScriptTracker {
  constructor() {
    this.blocks = [];
    this.tokens = [];
    this.blockStart = [];
    this.blockWords = [];
    this.pos = 0;
    this.confidence = 0;
    this.misses = 0;
    this.pending = null;
    this.lastKey = "";
  }

  setScript(blocks) {
    this.blocks = (Array.isArray(blocks) ? blocks : []).map((block) => String(block ?? ""));
    this.tokens = [];
    this.blockStart = [];
    this.blockWords = [];
    this.blocks.forEach((text, block) => {
      this.blockStart.push(this.tokens.length);
      const words = text.split(/\s+/).filter(Boolean);
      this.blockWords.push(words.length);
      words.forEach((word, wordIndex) => {
        tokenize(word).forEach((token) => {
          this.tokens.push({ t: token, w: weightOf(token), block, word: wordIndex });
        });
      });
    });
    this.reset(0);
  }

  reset(blockIndex = 0) {
    this.pos = 0;
    this.misses = 0;
    this.pending = null;
    this.lastKey = "";
    this.confidence = 0;
    this.setBlock(blockIndex);
  }

  setBlock(blockIndex) {
    if (!this.blocks.length) {
      this.pos = 0;
      return;
    }
    const index = Math.max(0, Math.min(blockIndex | 0, this.blocks.length - 1));
    this.pos = Math.min(this.blockStart[index], this.tokens.length);
    this.pending = null;
    this.misses = 0;
    this.lastKey = "";
  }

  getState() {
    const total = this.tokens.length;
    if (!this.blocks.length) {
      return { pos: 0, blockIndex: 0, wordIndex: 0, progress: 0, confidence: 0, total: 0 };
    }
    if (this.pos >= total) {
      const last = this.blocks.length - 1;
      return {
        pos: total,
        blockIndex: last,
        wordIndex: this.blockWords[last],
        progress: 1,
        confidence: this.confidence,
        total
      };
    }
    const token = this.tokens[this.pos];
    const start = this.blockStart[token.block];
    const end = token.block + 1 < this.blocks.length ? this.blockStart[token.block + 1] : total;
    return {
      pos: this.pos,
      blockIndex: token.block,
      wordIndex: token.word,
      progress: end > start ? (this.pos - start) / (end - start) : 0,
      confidence: this.confidence,
      total
    };
  }

  align(spoken, lo, hi) {
    const m = spoken.length;
    const n = hi - lo;
    if (!m || n <= 0) return null;
    const width = n + 1;
    const scores = new Float32Array((m + 1) * width);
    const starts = new Int32Array((m + 1) * width);
    const matches = new Uint8Array((m + 1) * width);
    let best = null;

    for (let i = 1; i <= m; i += 1) {
      for (let j = 1; j <= n; j += 1) {
        const index = i * width + j;
        const diagonal = (i - 1) * width + j - 1;
        const above = (i - 1) * width + j;
        const left = i * width + j - 1;
        const target = this.tokens[lo + j - 1];
        const sim = similarity(spoken[i - 1].t, target.t);
        const weight = Math.max(target.w, spoken[i - 1].w * 0.5);
        const substitution = sim === 1
          ? 2 * weight
          : sim > 0 ? 1.2 * weight * sim : -0.8 * Math.min(1, weight + 0.2);
        let value = 0;
        let source = 0;
        const diagonalValue = Math.max(0, scores[diagonal]) + substitution;
        if (diagonalValue > value && (sim > 0 || scores[diagonal] > 0)) {
          value = diagonalValue;
          source = 1;
        }
        if (scores[above] > 0 && scores[above] - (0.5 * spoken[i - 1].w + 0.1) > value) {
          value = scores[above] - (0.5 * spoken[i - 1].w + 0.1);
          source = 2;
        }
        if (scores[left] > 0 && scores[left] - (0.5 * target.w + 0.1) > value) {
          value = scores[left] - (0.5 * target.w + 0.1);
          source = 3;
        }
        scores[index] = value;
        if (!source) continue;
        const parent = source === 1 ? diagonal : source === 2 ? above : left;
        starts[index] = source === 1 && scores[diagonal] <= 0 ? lo + j - 1 : starts[parent];
        matches[index] = matches[parent];
        if (source === 1 && sim > 0) matches[index] += 1;
        if (source === 1 && sim > 0) {
          const end = lo + j - 1;
          const jump = Math.max(0, starts[index] - this.pos);
          const behind = Math.max(0, this.pos - 1 - end);
          const adjusted = value - 0.03 * jump - 0.12 * behind + 0.001 * end;
          if (!best || adjusted > best.adjusted) {
            best = { adjusted, score: value, jStart: starts[index], jEnd: end, matches: matches[index] };
          }
        }
      }
    }
    if (!best) return null;
    const spokenStart = Math.max(0, best.jStart - lo);
    const spokenWeight = spoken.slice(spokenStart).reduce((sum, item) => sum + item.w, 0);
    best.confidence = Math.max(0, Math.min(1, best.matches / Math.max(0.5, spokenWeight)));
    return best;
  }

  update(text) {
    const spoken = tokenize(text).slice(-32).map((t) => ({ t, w: weightOf(t) }));
    if (!spoken.length || !this.tokens.length) return null;
    const key = spoken.map((item) => item.t).join(" ");
    if (key === this.lastKey) return { changed: false, state: this.getState() };
    this.lastKey = key;
    const local = this.align(spoken, Math.max(0, this.pos - 8), Math.min(this.tokens.length, this.pos + 45));
    const acceptable = local && local.jEnd + 1 > this.pos
      && ((local.matches >= 2 && local.score >= 1.8) || (local.matches >= 1 && local.jStart <= this.pos + 1));
    if (acceptable) {
      const previous = this.pos;
      this.pos = Math.min(this.tokens.length, local.jEnd + 1);
      this.confidence = local.confidence;
      this.misses = 0;
      this.pending = null;
      return { changed: previous !== this.pos, state: this.getState() };
    }

    this.misses += 1;
    if (this.misses < 2 || spoken.length < 4) return { changed: false, state: this.getState() };
    const global = this.align(spoken, 0, this.tokens.length);
    if (!global || global.matches < 4 || global.score < 5 || global.confidence < 0.55) {
      this.pending = null;
      return { changed: false, state: this.getState() };
    }
    const target = global.jEnd + 1;
    if (Math.abs(target - this.pos) <= 2) return { changed: false, state: this.getState() };
    if (this.pending && Math.abs(this.pending - target) <= 6) {
      this.pos = target;
      this.confidence = global.confidence;
      this.pending = null;
      this.misses = 0;
      return { changed: true, jumped: true, state: this.getState() };
    }
    this.pending = target;
    return { changed: false, state: this.getState() };
  }
}

module.exports = { ScriptTracker, normalise, tokenize };
