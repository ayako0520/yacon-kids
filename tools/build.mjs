// クイズの問題データ（site/quiz-data.json）を検証し、site/index.html に反映するスクリプト。
// 使い方：
//   node tools/build.mjs          … index.html を更新する
//   node tools/build.mjs --check  … index.html が JSON と一致しているかだけ確かめる（不一致なら終了コード1）
// 外部パッケージは使わない（Node.js 18 以上）。

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataPath = join(root, 'site', 'quiz-data.json');
const htmlPath = join(root, 'site', 'index.html');
const checkOnly = process.argv.includes('--check');

const DRAFT_MARK = '【要監修】';

// ---- 1. 問題データの検証 ----
const data = JSON.parse(readFileSync(dataPath, 'utf8'));
const errors = [];
const qs = data.questions;
if (!Array.isArray(qs) || qs.length < 3 || qs.length > 5) {
  errors.push(`問題数は3〜5問にしてください（いまは ${Array.isArray(qs) ? qs.length : 0} 問）`);
}
const seenIds = new Set();
(qs || []).forEach((q, i) => {
  const at = `${i + 1}問目（${q.id ?? 'id なし'}）`;
  if (!q.id) errors.push(`${at}: id がありません`);
  if (seenIds.has(q.id)) errors.push(`${at}: id が重複しています`);
  seenIds.add(q.id);
  if (!q.question) errors.push(`${at}: question（問題文）がありません`);
  if (!q.explanation) errors.push(`${at}: explanation（解説）がありません`);
  if (!Array.isArray(q.choices) || q.choices.length < 2) errors.push(`${at}: choices（選択肢）が2つ以上必要です`);
  const choiceIds = (q.choices || []).map((c) => c.id);
  if (new Set(choiceIds).size !== choiceIds.length) errors.push(`${at}: 選択肢の id が重複しています`);
  if (!choiceIds.includes(q.answer)) errors.push(`${at}: answer「${q.answer}」が選択肢にありません`);
  if (!data.sections?.[q.review]) errors.push(`${at}: review「${q.review}」が sections にありません`);
});
// 復習先のIDが、ページ内に実在する章かどうか
const htmlSrc = readFileSync(htmlPath, 'utf8');
for (const id of Object.keys(data.sections || {})) {
  if (!htmlSrc.includes(`id="${id}"`)) errors.push(`sections の「${id}」が index.html にありません`);
}
// ふりがな記法 {漢字|よみ} の閉じ忘れ
const allText = JSON.stringify(qs);
if (/\{[^}|]*$/.test(allText) || (allText.match(/\{/g) || []).length !== (allText.match(/\}/g) || []).length) {
  errors.push('ふりがな記法 {漢字|よみ} の括弧が閉じていない所があります');
}
if (errors.length) {
  console.error('問題データにエラーがあります：\n- ' + errors.join('\n- '));
  process.exit(1);
}

// ---- 2. HTML の生成 ----
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// {漢字|よみ} を <ruby> に変換（それ以外はエスケープ）
const ruby = (s) =>
  String(s)
    .split(/(\{[^{}|]+\|[^{}]+\})/)
    .map((part) => {
      const m = part.match(/^\{([^{}|]+)\|([^{}]+)\}$/);
      return m ? `<ruby>${esc(m[1])}<rp>（</rp><rt>${esc(m[2])}</rt><rp>）</rp></ruby>` : esc(part);
    })
    .join('');
const mark = data.draft ? `<span class="kanshu">${DRAFT_MARK}</span>` : '';

const total = qs.length;
const staticHtml = [
  '        <p class="noscript-note">JavaScript が使えないため、問題と答えをまとめて表示しています。「こたえと解説を見る」をおすと、答えが出ます。</p>',
  '        <ol class="static-list">',
  ...qs.map((q, i) => {
    const correct = q.choices.find((c) => c.id === q.answer);
    return [
      '          <li class="static-q">',
      `            <h3>もんだい ${i + 1} / ${total}</h3>`,
      `            <p class="q-text">${ruby(q.question)}${mark}</p>`,
      q.figure ? `            <div class="placeholder placeholder-small">${esc(q.figure)}</div>` : '',
      '            <ul class="static-choices">',
      ...q.choices.map((c, j) => `              <li><span class="choice-label">${'ABCDE'[j]}</span> <span class="choice-text">${ruby(c.text)}</span></li>`),
      '            </ul>',
      '            <details class="static-answer">',
      '              <summary>こたえと解説を見る</summary>',
      `              <p><strong>こたえ：${'ABCDE'[q.choices.indexOf(correct)]}</strong> ${ruby(correct.text)}</p>`,
      `              <p>${ruby(q.explanation)}${mark}</p>`,
      `              <p><a href="#${esc(q.review)}">「${esc(data.sections[q.review])}」をもういちど読む</a></p>`,
      '            </details>',
      '          </li>',
    ].filter(Boolean).join('\n');
  }),
  '        </ol>',
].join('\n');

// 埋め込み用 JSON（</script> 対策で < をエスケープ）
const json = JSON.stringify({ draft: !!data.draft, sections: data.sections, questions: qs }).replace(/</g, '\\u003c');
const dataHtml = `  <script type="application/json" id="quiz-data">${json}</script>`;

const replaceBlock = (src, name, body) => {
  const re = new RegExp(`(<!-- ${name}:START -->)[\\s\\S]*?(<!-- ${name}:END -->)`);
  if (!re.test(src)) throw new Error(`index.html に ${name} の目印がありません`);
  return src.replace(re, `$1\n${body}\n$2`);
};
const out = replaceBlock(replaceBlock(htmlSrc, 'QUIZ-STATIC', staticHtml), 'QUIZ-DATA', dataHtml);

// ---- 3. にぎやか案（nigiyaka.html）の生成 ----
// index.html と同じ内容に、nigiyaka.css と目印のクラスを足し、題名を1文字ずつ色分けする。
// 文章を直すときは index.html だけを直し、このスクリプトで nigiyaka.html を作り直す。
const nigiyakaPath = join(root, 'site', 'nigiyaka.html');
const mustReplace = (src, from, to) => {
  if (!src.includes(from)) throw new Error(`にぎやか案の生成：index.html に「${from.slice(0, 40)}」がありません`);
  return src.replace(from, to);
};
// 題名の文字を色の順に包む（ふりがなの ruby は1つの塊として扱う）
const colorize = (text, startIndex) => {
  const parts = text.match(/<ruby>[\s\S]*?<\/ruby>|./g);
  return parts.map((p, i) => `<span class="c${((startIndex + i) % 5) + 1}">${p}</span>`).join('');
};
const h1Line1 = 'ヤーコン';
const h1Line2 = 'たんけん<ruby>隊<rp>（</rp><rt>たい</rt><rp>）</rp></ruby>！';
let nigiyaka = out;
nigiyaka = mustReplace(nigiyaka, '<link rel="stylesheet" href="styles.css">',
  '<link rel="stylesheet" href="styles.css">\n  <link rel="stylesheet" href="nigiyaka.css">');
nigiyaka = mustReplace(nigiyaka, '<body>', '<body class="theme-nigiyaka">');
nigiyaka = mustReplace(nigiyaka, '<strong>【試作】</strong>', '<strong>【試作・にぎやか案】</strong>');
nigiyaka = mustReplace(nigiyaka,
  `<h1><span class="h1-line">${h1Line1}</span><span class="h1-line">${h1Line2}</span></h1>`,
  `<h1><span class="h1-line">${colorize(h1Line1, 0)}</span><span class="h1-line">${colorize(h1Line2, 4)}</span></h1>`);
nigiyaka = nigiyaka.replace('<!DOCTYPE html>', '<!DOCTYPE html>\n<!-- このファイルは tools/build.mjs が index.html から生成する。手で書きかえない -->');

if (checkOnly) {
  let ng = false;
  if (out !== htmlSrc) {
    console.error('index.html が quiz-data.json と一致していません。node tools/build.mjs を実行してください。');
    ng = true;
  }
  let current = '';
  try { current = readFileSync(nigiyakaPath, 'utf8'); } catch { /* 無い場合は不一致として扱う */ }
  if (current !== nigiyaka) {
    console.error('nigiyaka.html が index.html と一致していません。node tools/build.mjs を実行してください。');
    ng = true;
  }
  if (ng) process.exit(1);
  console.log(`OK：${total} 問。index.html と nigiyaka.html は最新です。`);
} else {
  writeFileSync(htmlPath, out);
  writeFileSync(nigiyakaPath, nigiyaka);
  console.log(`index.html と nigiyaka.html を更新しました（${total} 問）。`);
}
