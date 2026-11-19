// Shared behaviour for every design-system page (theme, filter, workbench tabs, modal/toast demos).
(function () {
  var root = document.documentElement;
  var body = document.body;
  var subEl = document.querySelector('.ds-brand-sub');
  var themeButtons = Array.prototype.slice.call(document.querySelectorAll('.ds-theme-seg button'));
  var mediaQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;
  var currentPref = 'dark';

  function updateComputedSwatches() {
    var cards = document.querySelectorAll('.ds-token-card[data-token-name]');
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      var name = card.getAttribute('data-token-name');
      var isOpacity = card.getAttribute('data-is-opacity') === 'true';
      var fill = card.querySelector('.ds-token-swatch-fill');
      if (!fill || !name) continue;
      var style = getComputedStyle(fill);
      var rawVar = style.getPropertyValue(name).trim();
      var bg = isOpacity ? rawVar : style.backgroundColor;
      var val = rawVar && rawVar !== bg ? rawVar + ' (' + bg + ')' : (bg || rawVar);
      var chip = card.querySelector('.ds-token-live-chip');
      if (!chip && val) {
        chip = document.createElement('span');
        chip.className = 'ds-token-live-chip';
        fill.parentNode.appendChild(chip);
      }
      if (chip) chip.textContent = val;
    }
  }

  function applyTheme(pref) {
    currentPref = pref;
    var resolved = pref === 'system' ? (mediaQuery && mediaQuery.matches ? 'light' : 'dark') : pref;
    if (resolved === 'light') {
      root.classList.add('light-mode');
      body.classList.add('light-mode');
    } else {
      root.classList.remove('light-mode');
      body.classList.remove('light-mode');
    }
    themeButtons.forEach(function (btn) {
      var label = btn.textContent.trim().toLowerCase();
      btn.setAttribute('aria-pressed', String(label === pref));
    });
    if (subEl) {
      subEl.textContent = 'Ink + jade CSS tokens · 15 plain stylesheets · 63 exported symbols · Live ' + resolved + ' mode';
    }
    requestAnimationFrame(updateComputedSwatches);
  }

  themeButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var label = btn.textContent.trim().toLowerCase();
      if (label === 'dark' || label === 'light' || label === 'system') {
        applyTheme(label);
        try { localStorage.setItem('ds-theme', label); } catch (e) {}
      }
    });
  });

  if (mediaQuery && mediaQuery.addEventListener) {
    mediaQuery.addEventListener('change', function () {
      if (currentPref === 'system') applyTheme('system');
    });
  }

  // Initial computed swatch sync
  var savedTheme = 'dark';
  try { savedTheme = localStorage.getItem('ds-theme') || 'dark'; } catch (e) {}
  applyTheme(savedTheme);

  // Search filter across tokens, icons, keyframes, cards, and component rows
  var searchInput = document.querySelector('.ds-search input');
  var clearBtn = document.querySelector('.ds-search-clear');
  function ensureClearBtn() {
    if (clearBtn) return clearBtn;
    var wrap = document.querySelector('.ds-search');
    if (!wrap) return null;
    clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'ds-search-clear';
    clearBtn.setAttribute('aria-label', 'Clear filter');
    clearBtn.innerHTML = '✕';
    clearBtn.hidden = true;
    wrap.appendChild(clearBtn);
    clearBtn.addEventListener('click', function () {
      if (searchInput) {
        searchInput.value = '';
        applyFilter('');
        searchInput.focus();
      }
    });
    return clearBtn;
  }

  function applyFilter(raw) {
    var q = (raw || '').trim().toLowerCase();
    var btn = ensureClearBtn();
    if (btn) btn.hidden = !q;

    var selectors = ['.ds-token-card', '.ds-icon-cell', '.ds-keyframe-card', '.ds-table tbody tr'];
    selectors.forEach(function (sel) {
      var items = document.querySelectorAll(sel);
      for (var i = 0; i < items.length; i++) {
        var el = items[i];
        var match = !q || el.textContent.toLowerCase().indexOf(q) !== -1;
        el.classList.toggle('ds-hidden', !match);
      }
    });
  }

  if (searchInput) {
    searchInput.addEventListener('input', function () {
      applyFilter(searchInput.value);
    });
  }

  // Sidebar highlight is static per page (each section is its own HTML file).

  // Replay @keyframes animations button
  var allButtons = document.querySelectorAll('button');
  for (var b = 0; b < allButtons.length; b++) {
    if (allButtons[b].textContent.trim() === 'Replay animations') {
      allButtons[b].addEventListener('click', function () {
        var grid = document.querySelector('.ds-motion-grid');
        if (!grid) return;
        var demos = grid.querySelectorAll('.ds-keyframe-demo');
        demos.forEach(function (d) {
          var prev = d.style.animation;
          d.style.animation = 'none';
          void d.offsetWidth;
          d.style.animation = prev;
        });
      });
    }
  }

  // Interactive controls in Primitives & Components
  var pwInput = document.getElementById('ds-auth-pw');
  var eyeBtn = document.querySelector('.auth-eye');
  if (pwInput && eyeBtn) {
    eyeBtn.addEventListener('click', function () {
      pwInput.type = pwInput.type === 'password' ? 'text' : 'password';
    });
  }

  // Interactive controls. Listeners are not cloned, so bindControls(scope) also runs on every modal panel.
  function bindControls(scope) {
  // App pattern: role=switch + aria-checked live on button.qe-trow; .qe-switch is the decorative knob.
  scope.querySelectorAll('.qe-trow[role="switch"]').forEach(function (row) {
    row.addEventListener('click', function () {
      var next = row.getAttribute('aria-checked') !== 'true';
      row.setAttribute('aria-checked', String(next));
      var knob = row.querySelector('.qe-switch');
      if (knob) knob.classList.toggle('is-on', next);
    });
  });

  // Standalone switch spans (not inside a role=switch row) keep the old behaviour.
  scope.querySelectorAll('.qe-switch').forEach(function (sw) {
    if (sw.closest('[role="switch"]')) return;
    sw.addEventListener('click', function () {
      var next = sw.getAttribute('aria-checked') !== 'true';
      sw.setAttribute('aria-checked', String(next));
      sw.classList.toggle('is-on', next);
    });
  });

  scope.querySelectorAll('.income-chip').forEach(function (chip) {
    chip.addEventListener('click', function () {
      var next = chip.getAttribute('aria-pressed') !== 'true';
      chip.setAttribute('aria-pressed', String(next));
    });
  });

  // Generic segmented / radio group toggles (excluding top theme switcher & workbench tabs)
  var segGroups = scope.querySelectorAll('.document-basis-toggle, .profile-segmented, .qe-seg, .m-seg');
  segGroups.forEach(function (group) {
    var btns = Array.prototype.slice.call(group.querySelectorAll('button'));
    btns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var role = btn.getAttribute('role');
        var attr = role === 'radio' ? 'aria-checked'
          : (role === 'tab' || btn.hasAttribute('aria-selected')) ? 'aria-selected'
          : 'aria-pressed';
        var useIsOn = group.matches('.qe-seg, .m-seg');
        btns.forEach(function (other) {
          var on = other === btn;
          other.setAttribute(attr, String(on));
          if (useIsOn) other.classList.toggle('is-on', on);
        });
      });
    });
  });
  }
  bindControls(document);

  // DayPanel tiles: one active tile or none (DayPanel.tsx).
  document.querySelectorAll('.day-panel-tiles').forEach(function (g) {
    var tiles = g.querySelectorAll('.day-panel-tile');
    tiles.forEach(function (t) {
      t.addEventListener('click', function () {
        var was = t.getAttribute('aria-pressed') === 'true';
        tiles.forEach(function (o) { o.setAttribute('aria-pressed', 'false'); });
        t.setAttribute('aria-pressed', String(!was));
      });
    });
  });

  // InfoCard ⓘ toggle: the explanation is a .m-info-text paragraph under the title (MobileUi.tsx:67-72).
  document.querySelectorAll('.m-info[data-info]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var card = btn.closest('.m-card');
      if (!card) return;
      var open = btn.getAttribute('aria-expanded') !== 'true';
      btn.setAttribute('aria-expanded', String(open));
      var text = card.querySelector('.m-info-text');
      var title = card.querySelector('.m-card-title');
      if (open && !text && title) {
        text = document.createElement('p');
        text.className = 'm-info-text';
        text.textContent = btn.getAttribute('data-info');
        title.insertAdjacentElement('afterend', text);
      } else if (!open && text) {
        text.remove();
      }
    });
  });

  // PeriodStrip Details: the grid under the strip opens and closes (PeriodSummary.tsx:120-134).
  document.querySelectorAll('.period-strip-details').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var strip = btn.closest('.period-strip');
      var grid = strip && strip.querySelector('.period-strip-grid');
      if (!grid) return;
      var open = btn.getAttribute('aria-expanded') !== 'true';
      btn.setAttribute('aria-expanded', String(open));
      btn.textContent = open ? 'Hide' : 'Details';
      grid.style.display = open ? '' : 'none';
    });
  });

  // Interactive Workbench Tabs & Inventory Preview Jumps (tabs pattern: roving tabindex, Left/Right/Home/End)
  var wbTabs = Array.prototype.slice.call(document.querySelectorAll('[data-wb-tab]'));
  var wbPanels = Array.prototype.slice.call(document.querySelectorAll('[data-wb-panel]'));
  function selectWorkbenchTab(tabId, focus) {
    wbTabs.forEach(function (t) {
      var on = t.getAttribute('data-wb-tab') === tabId;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      if (on && focus) t.focus();
    });
    wbPanels.forEach(function (p) {
      p.hidden = p.getAttribute('data-wb-panel') !== tabId;
    });
  }
  wbTabs.forEach(function (t, i) {
    t.addEventListener('click', function () {
      selectWorkbenchTab(t.getAttribute('data-wb-tab'));
    });
    t.addEventListener('keydown', function (e) {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      var next = -1;
      if (e.key === 'ArrowRight') next = (i + 1) % wbTabs.length;
      else if (e.key === 'ArrowLeft') next = (i - 1 + wbTabs.length) % wbTabs.length;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = wbTabs.length - 1;
      if (next < 0) return;
      e.preventDefault();
      selectWorkbenchTab(wbTabs[next].getAttribute('data-wb-tab'), true);
    });
  });
  var wbInitial = wbTabs.filter(function (t) { return t.getAttribute('aria-selected') === 'true'; })[0];
  if (wbInitial) selectWorkbenchTab(wbInitial.getAttribute('data-wb-tab'));
  document.querySelectorAll('[data-jump-tab]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var tabId = btn.getAttribute('data-jump-tab');
      selectWorkbenchTab(tabId);
      var stage = document.getElementById('ds-workbench-tabs');
      if (stage) stage.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  // Standalone Modal & Toast triggers
  var modalBackdrop = document.getElementById('ds-demo-modal-backdrop');
  var modalTitle = document.getElementById('ds-demo-modal-title');
  var modalDesc = document.getElementById('ds-demo-modal-desc');
  var modalExtra = document.getElementById('ds-demo-modal-extra');
  var modalStatus = document.getElementById('ds-modal-status');
  var toastEl = document.getElementById('ds-demo-toast');
  var toastMsg = document.getElementById('ds-demo-toast-msg');
  var toastTimer = null;

  var modalPanel = modalBackdrop ? modalBackdrop.querySelector('.m-alert') : null;
  var modalActions = document.getElementById('ds-demo-modal-actions');
  var modalDefaultActions = modalActions ? modalActions.innerHTML : '';
  var modalCustom = null;   // transient full panel (QuickEntryDialog / MonthlyIncomeModal), workbench only
  var modalOpener = null;
  var FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
  function modalRoot() { return modalCustom || modalPanel; }

  // opts (optional): { descHtml, actionsHtml, vertical, panel (Element) }.
  function openModal(title, desc, extraHtml, opts) {
    if (!modalBackdrop) return;
    opts = opts || {};
    modalOpener = document.activeElement;
    modalTitle.textContent = title;
    if (opts.descHtml) modalDesc.innerHTML = opts.descHtml; else modalDesc.textContent = desc;
    modalExtra.innerHTML = extraHtml || '';
    if (modalActions) {
      modalActions.innerHTML = opts.actionsHtml || modalDefaultActions;
      modalActions.classList.toggle('is-vertical', !!opts.vertical);
    }
    if (modalCustom) { modalCustom.remove(); modalCustom = null; }
    if (modalPanel) modalPanel.style.display = opts.panel ? 'none' : '';
    if (opts.panel) {
      opts.panel.style.maxHeight = 'calc(100dvh - 32px)';
      modalCustom = modalBackdrop.appendChild(opts.panel);
      bindControls(opts.panel);
    }
    modalBackdrop.hidden = false;
    var root = modalRoot();
    if (!root) return;
    var target = root.querySelector('[data-autofocus]') ||
      (root.getAttribute('tabindex') === '-1' ? root : root.querySelector(FOCUSABLE));
    if (target) target.focus();
  }
  function closeModal(statusText) {
    if (modalBackdrop) modalBackdrop.hidden = true;
    if (modalCustom) { modalCustom.remove(); modalCustom = null; }
    if (modalPanel) modalPanel.style.display = '';
    if (statusText && modalStatus) modalStatus.textContent = statusText;
    if (modalOpener && modalOpener.isConnected && modalOpener.focus) modalOpener.focus();
    modalOpener = null;
  }

  if (modalBackdrop) {
    modalBackdrop.addEventListener('click', function (e) {
      if (e.target === modalBackdrop || e.target.closest('[data-close-modal]')) {
        closeModal('Modal dismissed.');
      } else if (e.target.closest('[data-confirm-modal]')) {
        closeModal('Modal action confirmed: ' + modalTitle.textContent);
      }
    });
    document.addEventListener('keydown', function (e) {
      if (modalBackdrop.hidden) return;
      if (e.key === 'Escape') { e.preventDefault(); closeModal('Modal dismissed.'); return; }
      if (e.key !== 'Tab') return;
      var root = modalRoot();
      if (!root) return;
      var nodes = Array.prototype.filter.call(root.querySelectorAll(FOCUSABLE), function (el) {
        return !el.disabled && el.getClientRects().length > 0;
      });
      if (!nodes.length) { e.preventDefault(); return; }
      var first = nodes[0], last = nodes[nodes.length - 1], active = document.activeElement;
      if (e.shiftKey && (active === first || active === root || !root.contains(active))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (active === last || !root.contains(active))) { e.preventDefault(); first.focus(); }
    });
  }

  var X20 = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';

  // W-28: clone the static dialog from the QuickEntry tab so the modal stays in sync with that markup.
  function quickEntryPanel(edit) {
    var src = document.querySelector('#ds-wb-panel-quick-entry .qe-dialog');
    if (!src) return null;
    var d = src.cloneNode(true);
    function q(sel) { return d.querySelector(sel); }
    function drop(sel) { var n = q(sel); if (n) n.remove(); }
    function mark(sel, attr) { var n = q(sel); if (n) n.setAttribute(attr, ''); }
    d.querySelectorAll('[id]').forEach(function (n) { n.removeAttribute('id'); });
    d.removeAttribute('aria-labelledby');
    var label = edit ? 'Edit expense' : 'Add transaction';
    var h = q('.qe-d-head h2');
    if (h) h.textContent = label;
    d.setAttribute('aria-label', label);
    mark('.qe-d-head .qe-fx', 'data-close-modal');
    mark('.qe-d-actions .qe-btn.is-plain', 'data-close-modal');
    mark('.qe-d-actions .qe-btn.is-primary', 'data-confirm-modal');
    if (edit) {
      drop('.qe-d-queue'); drop('.qe-key-next'); drop('.qe-box'); drop('.qe-d-head .qe-mode'); drop('.qe-d-actions .qe-btn.is-ghost');
      var ok = q('.qe-key-ok');
      if (ok) { ok.setAttribute('aria-label', 'Save'); if (ok.lastChild) ok.lastChild.textContent = 'Save'; }
      var kbd = q('.qe-kbd');
      if (kbd) kbd.innerHTML = 'Type digits · <kbd>k</kbd> ×1000 · <kbd>⌫</kbd> · <kbd>Enter</kbd> save';
      var primary = q('.qe-d-actions .qe-btn.is-primary');
      if (primary) primary.textContent = 'Save changes';
      var plain = q('.qe-d-actions .qe-btn.is-plain');
      if (plain) plain.insertAdjacentHTML('afterend',
        '<button type="button" class="qe-btn is-plain is-danger" data-close-modal>' +
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-trash-2" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>Delete</button>');
    }
    return d;
  }

  // W-29: MonthlyIncomeModal in add mode (IncomeSources restrictToMonth + initiallyAdding)
  function monthlyIncomePanel() {
    var w = document.createElement('div');
    w.className = 'monthly-income-modal';
    w.setAttribute('role', 'dialog');
    w.setAttribute('aria-modal', 'true');
    w.setAttribute('aria-labelledby', 'ds-demo-mim-title');
    w.tabIndex = -1;
    w.innerHTML =
      '<div class="monthly-income-modal-header"><h2 id="ds-demo-mim-title">Income for November 2026</h2>' +
      '<button type="button" class="monthly-income-modal-close" aria-label="Close income dialog" data-close-modal>' + X20 + '</button></div>' +
      '<div class="user-profile monthly-income-modal-content"><section class="profile-panel">' +
        '<div class="profile-panel-head"><div><h2>Income sources</h2>' +
        '<p>Salary, freelance work, allowance, gifts and other payments. Each one is paid once or repeats daily, weekly (every 1, 2 or 4 weeks), twice a month, monthly or yearly; a month’s income is the sum of every payment that falls in it.</p></div>' +
        '<div class="profile-panel-tools"><p class="profile-income-month">Income month: <time datetime="2026-11">November 2026</time></p></div></div>' +
        '<dl class="profile-card profile-summary" aria-label="Income breakdown for November 2026">' +
          '<div><dt>Total for November 2026</dt><dd class="profile-positive">32.500.000 ₫</dd></div>' +
          '<div><dt>Recurring</dt><dd>28.000.000 ₫</dd></div><div><dt>One-time</dt><dd>4.500.000 ₫</dd></div></dl>' +
        '<form class="profile-card income-form" novalidate aria-label="Add income"><div class="income-form-head"><h3>Add income</h3>' +
          '<button type="button" class="profile-icon-button" aria-label="Close without saving" data-close-modal>' + X20 + '</button></div>' +
          '<fieldset class="income-form-body">' +
            '<div class="income-form-group" role="group" aria-label="Source"><span class="income-form-label">Source</span><div class="income-chips">' +
              '<button type="button" class="income-chip" aria-pressed="true">Salary</button><button type="button" class="income-chip" aria-pressed="false">Freelance</button>' +
              '<button type="button" class="income-chip" aria-pressed="false">Bonus</button><button type="button" class="income-chip" aria-pressed="false">Allowance</button>' +
              '<button type="button" class="income-chip" aria-pressed="false">Gift</button><button type="button" class="income-chip" aria-pressed="false">Investment</button>' +
              '<button type="button" class="income-chip" aria-pressed="false">Other</button><button type="button" class="income-chip" aria-pressed="false">Custom</button></div></div>' +
            '<label class="income-form-group"><span class="income-form-label">From <span class="income-optional">optional</span></span><input type="text" class="income-input" placeholder="Employer, client or person" /></label>' +
            '<label class="income-form-group"><span class="income-form-label">Amount per payment</span><span class="income-amount"><input type="text" inputmode="decimal" placeholder="0" data-autofocus /><span aria-hidden="true">₫</span></span></label>' +
            '<fieldset class="income-form-group"><legend class="income-form-label">How often</legend><div class="income-segmented">' +
              '<label class="income-segment"><input type="radio" name="ds-mim-freq" /><span>One time</span></label><label class="income-segment"><input type="radio" name="ds-mim-freq" /><span>Daily</span></label>' +
              '<label class="income-segment"><input type="radio" name="ds-mim-freq" /><span>Weekly</span></label><label class="income-segment"><input type="radio" name="ds-mim-freq" /><span>Twice a month</span></label>' +
              '<label class="income-segment"><input type="radio" name="ds-mim-freq" checked /><span>Monthly</span></label><label class="income-segment"><input type="radio" name="ds-mim-freq" /><span>Yearly</span></label></div></fieldset>' +
            '<label class="income-check"><input type="checkbox" checked /> Paid on Friday when the payday is a weekend</label>' +
            '<div class="income-dates"><label class="income-form-group"><span class="income-form-label">First payment</span><input type="date" class="income-input" value="2026-11-05" /></label>' +
            '<label class="income-form-group"><span class="income-form-label">Last payment <span class="income-optional">optional</span></span><input type="date" class="income-input" /></label></div>' +
          '</fieldset><p class="income-schedule income-schedule-empty" aria-live="polite"><span>Enter an amount to see when this income is paid.</span></p>' +
          '<div class="income-form-foot"><button type="button" class="profile-button profile-button-ghost" data-close-modal>Cancel</button>' +
          '<button type="button" class="profile-button profile-button-primary" data-confirm-modal>Add income</button></div></form>' +
      '</section></div>';
    return w;
  }

  document.querySelectorAll('[data-open-modal]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var kind = btn.getAttribute('data-open-modal');
      if (kind === 'quick-add' || kind === 'quick-edit') {
        var panel = quickEntryPanel(kind === 'quick-edit');
        if (panel) openModal(kind === 'quick-edit' ? 'Edit expense' : 'Add transaction', '', '', { panel: panel });
      } else if (kind === 'monthly-income') {
        openModal('Income for November 2026', '', '', { panel: monthlyIncomePanel() });
      } else if (kind === 'income-sheet') {
        // W-30: IncomeRecordSheet = vertical SystemAlert (IncomeRecordSheet.tsx:63-88)
        openModal('Design retainer', '',
          '<div class="income-sheet-fields">' +
            '<label><span>Amount</span><input data-autofocus class="m-alert-input" inputmode="numeric" value="4.500.000" /></label>' +
            '<label><span>Received on</span><input class="m-alert-input" type="date" value="2026-11-12" /></label>' +
            '<label><span>Note</span><input class="m-alert-input" value="Design retainer" maxlength="1000" /></label></div>',
          {
            descHtml: '<span class="income-sheet-source">Freelance</span>',
            vertical: true,
            actionsHtml: '<button type="button" class="is-primary" data-confirm-modal>Save</button>' +
              '<button type="button" class="is-destructive" data-confirm-modal>Delete payment</button>' +
              '<button type="button" data-close-modal>Cancel</button>'
          });
      }
    });
  });

  // SystemAlert demo triggers inside #ds-components (SystemAlert.tsx: confirm / destructive / prompt / vertical)
  function alertActions(okLabel, okClass) {
    return '<button type="button" data-close-modal>Cancel</button>' +
      '<button type="button" class="' + okClass + '" data-confirm-modal>' + okLabel + '</button>';
  }
  document.querySelectorAll('#ds-components button').forEach(function (btn) {
    var txt = btn.textContent.trim();
    if (txt === 'Trigger Confirm') {
      btn.addEventListener('click', function () {
        openModal('Save changes?', 'This mirrors useDialog().confirm() backed by native <dialog>.', '',
          { actionsHtml: alertActions('OK', 'is-primary') });
      });
    } else if (txt === 'Trigger Destructive') {
      btn.addEventListener('click', function () {
        openModal('Delete transaction?', 'This action cannot be undone.', '',
          { actionsHtml: alertActions('Delete', 'is-destructive') });
      });
    } else if (txt === 'Trigger Prompt') {
      btn.addEventListener('click', function () {
        openModal('Rename category', 'Enter a new category label:',
          '<input class="m-alert-input" value="Groceries" aria-label="Rename category" data-autofocus />',
          { actionsHtml: alertActions('OK', 'is-primary') });
      });
    } else if (txt === 'Direct Vertical SystemAlert') {
      btn.addEventListener('click', function () {
        openModal('Vertical SystemAlert', 'Stacked .m-alert-actions.is-vertical layout preview.', '',
          { actionsHtml: alertActions('OK', 'is-primary'), vertical: true });
      });
    } else if (txt === 'Show Live Toast') {
      btn.addEventListener('click', function () {
        if (!toastEl) return;
        toastMsg.textContent = 'Deleted "Morning espresso"';
        toastEl.hidden = false;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { toastEl.hidden = true; }, 4500);
      });
    }
  });

  var toastUndo = document.getElementById('ds-demo-toast-undo');
  var toastClose = document.getElementById('ds-demo-toast-close');
  if (toastUndo) {
    toastUndo.addEventListener('click', function () {
      toastMsg.textContent = 'Restored "Morning espresso" (Undo clicked)';
    });
  }
  if (toastClose && toastEl) {
    toastClose.addEventListener('click', function () {
      toastEl.hidden = true;
    });
  }

  // v2 Privacy Blur Toggle
  var privacyBtn = document.getElementById('ds-privacy-toggle');
  if (privacyBtn) {
    privacyBtn.addEventListener('click', function () {
      var next = !document.body.classList.contains('ds-privacy-mode');
      document.body.classList.toggle('ds-privacy-mode', next);
      privacyBtn.setAttribute('aria-pressed', String(next));
      privacyBtn.textContent = next ? 'Privacy: Hidden (**** ₫)' : 'Privacy: Off';
      try { localStorage.setItem('ds-privacy', next ? '1' : '0'); } catch (e) {}
    });
    var savedPrivacy = null;
    try { savedPrivacy = localStorage.getItem('ds-privacy'); } catch (e) {}
    if (savedPrivacy === '1') privacyBtn.click();
  }

  // v2 Unified .ui-switch & .ui-seg interactivity
  document.querySelectorAll('.ui-switch').forEach(function (sw) {
    sw.addEventListener('click', function () {
      var next = sw.getAttribute('aria-checked') !== 'true';
      sw.setAttribute('aria-checked', String(next));
    });
  });
  document.querySelectorAll('.ui-seg').forEach(function (group) {
    var btns = Array.prototype.slice.call(group.querySelectorAll('button'));
    btns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        btns.forEach(function (other) {
          other.setAttribute('aria-pressed', String(other === btn));
        });
      });
    });
  });

  // v2 1-Tap Export demo triggers
  var expStatus = document.getElementById('ds-v2-export-status');
  var expCsv = document.getElementById('ds-v2-export-csv');
  var expJson = document.getElementById('ds-v2-export-json');
  if (expCsv && expStatus) {
    expCsv.addEventListener('click', function () {
      expStatus.textContent = 'Ready: myfinance_backup_2026-11-18.csv (28 spendings, 4 plans, 7 categories).';
    });
  }
  if (expJson && expStatus) {
    expJson.addEventListener('click', function () {
      expStatus.textContent = 'Ready: myfinance_full_2026-11-18.json (complete unencrypted user export).';
    });
  }

})();
