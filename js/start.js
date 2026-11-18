// InfraStatera — /start: one question per screen.
// Without JavaScript the form shows every question at once and still posts.
// Submissions go to Web3Forms when access_key is set; until then Send opens an email with the answers.
(function () {
  'use strict';
  var form = document.getElementById('start-form');
  if (!form) return;
  form.classList.add('is-stepped');

  var steps = Array.prototype.slice.call(form.querySelectorAll('.start-step'));
  var bar = form.querySelector('.start-progress-bar');
  var count = form.querySelector('.start-count');
  var err = form.querySelector('.start-error');
  var back = form.querySelector('.start-back');
  var skip = form.querySelector('.start-skip');
  var next = form.querySelector('.start-next');
  var send = form.querySelector('.start-send');
  var done = document.getElementById('start-done');
  var idx = 0;
  var presetNote = form.querySelector('.start-preset');
  var presetShown = false;
  var byKeyboard = false;

  function isChoice(step) { return !!step.querySelector('input[type=radio]'); }
  function hasAnswer(step) { return !!step.querySelector('input[type=radio]:checked'); }

  // Prefill from a demo link, e.g. /start/?need=website&demo=Subcontractor%20Website
  var params = new URLSearchParams(location.search);
  var preset = params.get('need');
  if (preset) {
    var radio = form.querySelector('input[name=need][data-key="' + preset.replace(/[^a-z]/g, '') + '"]');
    if (radio) {
      radio.checked = true;
      var demo = (params.get('demo') || '').slice(0, 80);
      form.elements.source.value = demo ? 'Demo: ' + demo : 'Preset: ' + preset;
      presetNote.textContent = (demo ? 'You came from the ' + demo + ' demo, so we answered the first question for you: ' : 'We answered the first question for you: ') + radio.value + '. Use Back to change it.';
      idx = 1;
      presetShown = true;
    }
  }

  function showError(msg) { err.textContent = msg; err.hidden = !msg; }

  function render(focus) {
    steps.forEach(function (s, i) { s.classList.toggle('is-current', i === idx); });
    var step = steps[idx];
    var last = step.hasAttribute('data-last');
    bar.style.width = ((idx + 1) / steps.length * 100) + '%';
    count.textContent = 'Step ' + (idx + 1) + ' of ' + steps.length;
    back.hidden = idx === 0;
    skip.hidden = !step.hasAttribute('data-optional') || last;
    next.hidden = last || (isChoice(step) && !hasAnswer(step));
    send.hidden = !last;
    presetNote.hidden = !(presetShown && idx === 1);
    showError('');
    if (focus) {
      var target = step.querySelector('input:not([type=radio]), textarea') || step.querySelector('input[type=radio]:checked') || step.querySelector('input[type=radio]');
      if (target) target.focus({ preventScroll: true });
    }
  }

  function validate(step) {
    var name = step.querySelector('input[name=name]');
    if (name && !name.value.trim()) return 'Add your name to continue.';
    var email = step.querySelector('input[name=email]');
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) return 'Enter an email address like name@company.com.';
    if (isChoice(step) && !hasAnswer(step)) return 'Pick one to continue.';
    return '';
  }

  function go(delta) {
    if (delta > 0) {
      var msg = validate(steps[idx]);
      if (msg) { showError(msg); return; }
    }
    idx = Math.max(0, Math.min(steps.length - 1, idx + delta));
    render(true);
  }

  back.addEventListener('click', function () { go(-1); });
  next.addEventListener('click', function () { go(1); });
  skip.addEventListener('click', function () {
    steps[idx].querySelectorAll('input, textarea').forEach(function (f) { f.value = ''; });
    idx = Math.min(steps.length - 1, idx + 1); render(true);
  });

  // Tap or click a choice: move on. Arrow keys only change the selection; Enter moves on.
  form.addEventListener('keydown', function (e) {
    byKeyboard = true;
    if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && !steps[idx].hasAttribute('data-last')) {
      e.preventDefault(); go(1);
    }
  });
  form.addEventListener('pointerdown', function () { byKeyboard = false; });
  form.addEventListener('change', function (e) {
    if (e.target.type !== 'radio') return;
    render(false);
    if (!byKeyboard) setTimeout(function () { go(1); }, 220);
  });

  function answers() {
    var labels = { need: 'Need', company_type: 'Company type', team_size: 'Team size', timing: 'Timing', name: 'Name', email: 'Email', company: 'Company', phone: 'Phone', notes: 'Notes', source: 'Source' };
    var data = new FormData(form);
    return Object.keys(labels).map(function (k) { var v = (data.get(k) || '').toString().trim(); return v ? labels[k] + ': ' + v : null; }).filter(Boolean).join('\n');
  }

  function finish() {
    form.hidden = true;
    done.hidden = false;
    done.focus();
    window.scrollTo(0, 0);
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    for (var i = 0; i < steps.length; i++) {
      var msg = validate(steps[i]);
      if (msg) { idx = i; render(true); showError(msg); return; }
    }
    var key = form.elements.access_key.value;
    if (!key) {
      // Not connected to Web3Forms yet: hand the answers to the visitor's email app.
      location.href = 'mailto:' + form.getAttribute('data-email') + '?subject=' + encodeURIComponent('Project inquiry from infrastatera.com') + '&body=' + encodeURIComponent(answers());
      finish();
      return;
    }
    send.disabled = true; send.textContent = 'Sending…';
    fetch(form.action, { method: 'POST', headers: { Accept: 'application/json' }, body: new FormData(form) })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res && res.success) { finish(); return; }
        throw new Error('not sent');
      })
      .catch(function () {
        send.disabled = false; send.textContent = 'Send';
        showError('Your answers did not send. Try again, or email us at ' + form.getAttribute('data-email') + '.');
      });
  });

  render(false);
})();
