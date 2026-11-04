// たんけんクイズ（第4章 4.2 動作仕様案）
// - 問題データは index.html に埋め込んだ JSON（元は quiz-data.json）から読む
// - 成績はどこにも保存しない（サーバー・Cookie・ローカルストレージを使わない）
// - innerHTML は使わず、DOM を組み立てて表示する
(function () {
  'use strict';

  var app = document.getElementById('quiz-app');
  var fallback = document.getElementById('quiz-static');
  var dataEl = document.getElementById('quiz-data');
  if (!app || !dataEl) return;

  var data;
  try {
    data = JSON.parse(dataEl.textContent);
  } catch (e) {
    // データが壊れているときは、代替表示のまま何もしない
    return;
  }
  var questions = data.questions || [];
  if (questions.length === 0) return;

  var LETTERS = 'ABCDE';
  var DRAFT_MARK = '【要監修】';

  // 状態：いまの問題番号、各問の回答（選択肢ID）
  var current = 0;
  var answers = [];

  // ---- 小さな道具 ----
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'text') node.textContent = attrs[k];
        else if (k === 'className') node.className = attrs[k];
        else node.setAttribute(k, attrs[k]);
      });
    }
    (children || []).forEach(function (c) {
      if (c) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  // {漢字|よみ} を <ruby> に変換した DocumentFragment を返す
  function rubyText(s) {
    var frag = document.createDocumentFragment();
    String(s).split(/(\{[^{}|]+\|[^{}]+\})/).forEach(function (part) {
      var m = part.match(/^\{([^{}|]+)\|([^{}]+)\}$/);
      if (m) {
        frag.appendChild(el('ruby', null, [m[1], el('rt', { text: m[2] })]));
      } else if (part) {
        frag.appendChild(document.createTextNode(part));
      }
    });
    return frag;
  }

  // 本文＋【要監修】の印（draft のときだけ）
  function textWithMark(s) {
    var frag = rubyText(s);
    if (data.draft) frag.appendChild(el('span', { className: 'kanshu', text: DRAFT_MARK }));
    return frag;
  }

  // 支援技術への通知（role="status" の領域）
  var status = el('p', { className: 'visually-hidden', role: 'status', 'aria-live': 'polite' });

  // ---- 1問分の画面 ----
  function renderQuestion() {
    var q = questions[current];
    var answered = answers[current] !== undefined;
    app.textContent = '';

    var heading = el('h3', { className: 'q-number', tabindex: '-1', id: 'q-heading' }, [
      'もんだい ' + (current + 1) + ' / ' + questions.length,
    ]);
    // 進みぐあいのバー（装飾。数字は見出しで伝える）
    var progress = el('div', { className: 'progress', 'aria-hidden': 'true' }, [
      el('div', { className: 'progress-bar', style: 'width:' + ((current + 1) / questions.length) * 100 + '%' }),
    ]);

    var form = el('form', { className: 'q-form', novalidate: '' });
    var fieldset = el('fieldset');
    var legend = el('legend', { className: 'q-text' });
    legend.appendChild(textWithMark(q.question));
    fieldset.appendChild(legend);

    if (q.figure) {
      fieldset.appendChild(el('div', { className: 'placeholder placeholder-small', text: q.figure }));
    }

    var list = el('div', { className: 'choices' });
    q.choices.forEach(function (c, j) {
      var id = 'q' + current + '-' + c.id;
      var input = el('input', { type: 'radio', name: 'choice', id: id, value: c.id });
      if (answered) {
        input.disabled = true;
        if (answers[current] === c.id) input.checked = true;
      }
      var label = el('label', { for: id, className: 'choice' }, [
        input,
        el('span', { className: 'choice-label', 'aria-hidden': 'true', text: LETTERS[j] }),
      ]);
      var body = el('span', { className: 'choice-text' });
      body.appendChild(rubyText(c.text));
      label.appendChild(body);
      // 回答後は、正解と自分の答えを「文字」でも示す（色だけにしない）
      if (answered) {
        if (c.id === q.answer) {
          label.classList.add('is-correct');
          label.appendChild(el('span', { className: 'tag tag-correct', text: '◯ せいかい' }));
        } else if (c.id === answers[current]) {
          label.classList.add('is-chosen');
          label.appendChild(el('span', { className: 'tag tag-chosen', text: 'あなたのこたえ' }));
        }
      }
      list.appendChild(label);
    });
    fieldset.appendChild(list);
    form.appendChild(fieldset);

    // 未選択のときのメッセージ欄
    var error = el('p', { className: 'q-error', id: 'q-error', role: 'alert' });
    form.appendChild(error);

    if (!answered) {
      form.appendChild(el('button', { type: 'submit', className: 'button', text: 'こたえあわせ' }));
      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var chosen = form.querySelector('input[name="choice"]:checked');
        if (!chosen) {
          error.textContent = 'こたえを1つえらんでから、「こたえあわせ」をおしてください。';
          form.querySelector('input[name="choice"]').focus();
          return;
        }
        answers[current] = chosen.value;
        renderQuestion();
        // 結果の欄へフォーカスを移し、読み上げさせる
        var fb = document.getElementById('q-feedback');
        if (fb) fb.focus();
      });
    }

    app.appendChild(heading);
    app.appendChild(progress);
    app.appendChild(form);
    if (answered) app.appendChild(renderFeedback(q));
  }

  // ---- 回答後の正誤・正解・解説 ----
  function renderFeedback(q) {
    var ok = answers[current] === q.answer;
    var correct = q.choices.filter(function (c) { return c.id === q.answer; })[0];
    var idx = q.choices.indexOf(correct);

    var box = el('div', {
      className: 'feedback ' + (ok ? 'feedback-ok' : 'feedback-ng'),
      id: 'q-feedback',
      tabindex: '-1',
      role: 'group',
      'aria-label': 'こたえあわせのけっか',
    });
    // 記号＋文言で正誤を伝える（色だけにしない：N09）
    box.appendChild(el('p', { className: 'feedback-title', text: ok ? '◯ せいかい！' : '△ おしい！' }));
    var ans = el('p', null, [el('strong', { text: 'こたえ：' + LETTERS[idx] + ' ' })]);
    ans.appendChild(rubyText(correct.text));
    box.appendChild(ans);
    var exp = el('p');
    exp.appendChild(textWithMark(q.explanation));
    box.appendChild(exp);
    box.appendChild(el('p', null, [
      el('a', { href: '#' + q.review, text: '「' + data.sections[q.review] + '」をもういちど読む' }),
    ]));

    var isLast = current === questions.length - 1;
    var next = el('button', { type: 'button', className: 'button', text: isLast ? 'けっかを見る' : 'つぎへ' });
    next.addEventListener('click', function () {
      if (isLast) {
        renderResult();
      } else {
        current += 1;
        renderQuestion();
        status.textContent = 'もんだい ' + (current + 1) + ' にすすみました。';
        document.getElementById('q-heading').focus();
      }
    });
    box.appendChild(next);
    return box;
  }

  // ---- 最後の結果 ----
  function renderResult() {
    app.textContent = '';
    var score = 0;
    var review = [];
    questions.forEach(function (q, i) {
      if (answers[i] === q.answer) score += 1;
      else if (review.indexOf(q.review) === -1) review.push(q.review);
    });

    var heading = el('h3', { className: 'q-number', tabindex: '-1', id: 'q-heading', text: 'たんけんのけっか' });
    app.appendChild(heading);
    // 点数による否定的な評価や順位はつけない（4.2-5）
    app.appendChild(el('p', { className: 'result-score', text: questions.length + 'もんのうち、' + score + 'もん せいかいしました。' }));
    app.appendChild(el('p', { text: 'さいごまで、よくがんばりました。' }));

    if (review.length > 0) {
      app.appendChild(el('p', { text: 'つぎの章を読むと、もっとくわしくなれます。' }));
      var ul = el('ul', { className: 'review-list' });
      review.forEach(function (id) {
        ul.appendChild(el('li', null, [el('a', { href: '#' + id, text: data.sections[id] })]));
      });
      app.appendChild(ul);
    } else {
      app.appendChild(el('p', { text: '気になった章を、もういちど読んでみましょう。' }));
    }

    var retry = el('button', { type: 'button', className: 'button', text: 'もういちど' });
    retry.addEventListener('click', function () {
      // 全問を未回答に戻す（4.2-6）
      current = 0;
      answers = [];
      renderQuestion();
      status.textContent = 'クイズを はじめから やりなおします。';
      document.getElementById('q-heading').focus();
    });
    app.appendChild(retry);
    heading.focus();
  }

  // ---- 開始：代替表示をかくして、クイズを表示する ----
  if (fallback) fallback.hidden = true;
  // 通知用の領域は、作り直さずにクイズの外へ1つだけ置く
  app.parentNode.insertBefore(status, app.nextSibling);
  app.hidden = false;
  renderQuestion();
})();
