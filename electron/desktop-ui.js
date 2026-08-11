/* ============================================================
   SparkMinds Lab — Desktop UI Enhancements
   Injected via Electron for DOM restructuring
   ============================================================ */

(function () {
  'use strict';

  if (window.__desktopUIInjected) return;
  window.__desktopUIInjected = true;

  var isElectron = typeof window.electronAPI !== 'undefined';
  if (!isElectron) return;

  /* ===== 1. Custom Titlebar ===== */
  function createTitlebar() {
    if (document.querySelector('.desktop-titlebar')) return;

    var brandImg = document.querySelector('.trae-brand img');
    var logoSrc = brandImg ? brandImg.src : '';
    var brandText = document.querySelector('.trae-brand');
    var brandName = brandText ? brandText.textContent.trim() : 'SparkMinds Lab';

    var titlebar = document.createElement('div');
    titlebar.className = 'desktop-titlebar';
    titlebar.innerHTML =
      '<div class="desktop-titlebar-title">' +
      (logoSrc ? '<img src="' + logoSrc + '" alt="logo">' : '') +
      '<span>' + brandName + '</span>' +
      '</div>' +
      '<div class="desktop-titlebar-controls">' +
      '<button class="desktop-titlebar-btn minimize" title="最小化">' +
      '<svg viewBox="0 0 12 12"><rect x="1" y="5.5" width="10" height="1" rx="0.5"/></svg>' +
      '</button>' +
      '<button class="desktop-titlebar-btn maximize" title="最大化">' +
      '<svg viewBox="0 0 12 12"><rect x="1.5" y="1.5" width="9" height="9" rx="1" fill="none" stroke="currentColor" stroke-width="1"/></svg>' +
      '</button>' +
      '<button class="desktop-titlebar-btn close" title="关闭">' +
      '<svg viewBox="0 0 12 12"><path d="M2 2 L10 10 M10 2 L2 10" stroke="currentColor" stroke-width="1.2" fill="none" stroke-linecap="round"/></svg>' +
      '</button>' +
      '</div>';

    document.body.insertBefore(titlebar, document.body.firstChild);

    var minBtn = titlebar.querySelector('.minimize');
    var maxBtn = titlebar.querySelector('.maximize');
    var closeBtn = titlebar.querySelector('.close');

    minBtn.addEventListener('click', function () {
      if (window.electronAPI.minimize) window.electronAPI.minimize();
    });

    maxBtn.addEventListener('click', function () {
      if (window.electronAPI.maximize) window.electronAPI.maximize();
    });

    closeBtn.addEventListener('click', function () {
      if (window.electronAPI.close) window.electronAPI.close();
    });

    if (window.electronAPI.onMaximizeChange) {
      window.electronAPI.onMaximizeChange(function (isMaximized) {
        if (isMaximized) {
          maxBtn.innerHTML = '<svg viewBox="0 0 12 12"><rect x="2.5" y="1.5" width="7" height="8" rx="0.8" fill="none" stroke="currentColor" stroke-width="1"/><rect x="1.5" y="2.5" width="7" height="8" rx="0.8" fill="none" stroke="currentColor" stroke-width="1"/></svg>';
          maxBtn.title = '还原';
        } else {
          maxBtn.innerHTML = '<svg viewBox="0 0 12 12"><rect x="1.5" y="1.5" width="9" height="9" rx="1" fill="none" stroke="currentColor" stroke-width="1"/></svg>';
          maxBtn.title = '最大化';
        }
      });
    }
  }

  /* ===== 2. Category Rail in Sidebar ===== */
  function createCategoryRail() {
    var sidebar = document.querySelector('.trae-sidebar');
    if (!sidebar) return;
    if (sidebar.querySelector('.desktop-cat-rail')) return;

    var cats = document.querySelectorAll('.trae-cat');
    if (cats.length === 0) return;

    var catIcons = {
      lab: '\u{1F52C}',
      inventory: '\u{1F4E6}',
      user: '\u{1F464}',
      admin: '\u2699\uFE0F'
    };

    var catRail = document.createElement('div');
    catRail.className = 'desktop-cat-rail';

    cats.forEach(function (cat) {
      if (cat.classList.contains('admin-only') && !document.body.classList.contains('is-admin')) {
        return;
      }

      var catType = cat.dataset.cat;
      var btn = document.createElement('button');
      btn.className = 'desktop-cat-btn' + (cat.classList.contains('active') ? ' active' : '');
      btn.dataset.cat = catType;
      btn.dataset.tooltip = cat.textContent.trim();
      btn.innerHTML =
        '<span class="cat-icon">' + (catIcons[catType] || '\u{1F4C1}') + '</span>' +
        '<span class="cat-label">' + cat.textContent.trim() + '</span>';

      btn.addEventListener('click', function () {
        cat.click();
      });

      catRail.appendChild(btn);
    });

    var nav = sidebar.querySelector('.trae-sidebar-nav');
    sidebar.insertBefore(catRail, nav);
  }

  /* ===== 3. Sync Category Active State ===== */
  function syncCategoryActive() {
    var cats = document.querySelectorAll('.trae-cat');

    cats.forEach(function (cat) {
      var catType = cat.dataset.cat;
      var desktopBtn = document.querySelector('.desktop-cat-btn[data-cat="' + catType + '"]');
      if (!desktopBtn) return;

      new MutationObserver(function () {
        desktopBtn.classList.toggle('active', cat.classList.contains('active'));
      }).observe(cat, { attributes: true, attributeFilter: ['class'] });
    });
  }

  /* ===== 4. Admin Category Visibility ===== */
  function observeAdminClass() {
    var body = document.body;

    new MutationObserver(function () {
      var adminCat = document.querySelector('.trae-cat[data-cat="admin"]');
      var adminBtn = document.querySelector('.desktop-cat-btn[data-cat="admin"]');
      if (!adminCat) return;

      if (body.classList.contains('is-admin')) {
        if (!adminBtn) {
          var catIcons = { admin: '\u2699\uFE0F' };

          adminBtn = document.createElement('button');
          adminBtn.className = 'desktop-cat-btn' + (adminCat.classList.contains('active') ? ' active' : '');
          adminBtn.dataset.cat = 'admin';
          adminBtn.dataset.tooltip = adminCat.textContent.trim();
          adminBtn.innerHTML =
            '<span class="cat-icon">' + (catIcons.admin || '\u{1F4C1}') + '</span>' +
            '<span class="cat-label">' + adminCat.textContent.trim() + '</span>';

          adminBtn.addEventListener('click', function () {
            adminCat.click();
          });

          var catRail = document.querySelector('.desktop-cat-rail');
          if (catRail) catRail.appendChild(adminBtn);

          new MutationObserver(function () {
            adminBtn.classList.toggle('active', adminCat.classList.contains('active'));
          }).observe(adminCat, { attributes: true, attributeFilter: ['class'] });
        } else if (adminBtn.style.display === 'none') {
          adminBtn.style.display = '';
        }
      } else {
        if (adminBtn) adminBtn.style.display = 'none';
      }
    }).observe(body, { attributes: true, attributeFilter: ['class'] });
  }

  /* ===== 5. Status Bar ===== */
  function createStatusBar() {
    var mainScreen = document.getElementById('mainScreen');
    if (!mainScreen) return;
    if (mainScreen.querySelector('.desktop-statusbar')) return;

    var statusbar = document.createElement('div');
    statusbar.className = 'desktop-statusbar';
    statusbar.innerHTML =
      '<div class="desktop-statusbar-left">' +
      '<div class="desktop-statusbar-item" id="desktopConnItem">' +
      '<span class="dot offline"></span>' +
      '<span class="conn-text">\u8FDE\u63A5\u4E2D...</span>' +
      '</div>' +
      '</div>' +
      '<div class="desktop-statusbar-right">' +
      '<div class="desktop-statusbar-item" id="desktopUserItem">' +
      '<span>\u672A\u767B\u5F55</span>' +
      '</div>' +
      '<div class="desktop-statusbar-divider"></div>' +
      '<div class="desktop-statusbar-item">' +
      '<span>SparkMinds Lab v2.5</span>' +
      '</div>' +
      '</div>';

    mainScreen.appendChild(statusbar);
  }

  /* ===== 6. Sync Status Bar ===== */
  function syncStatusBar() {
    var connStatus = document.getElementById('connStatus');
    var desktopConn = document.getElementById('desktopConnItem');
    if (connStatus && desktopConn) {
      var updateConn = function () {
        var text = connStatus.textContent.trim();
        var isOnline = connStatus.classList.contains('online') || text.indexOf('\u5728\u7EBF') !== -1;
        var dot = desktopConn.querySelector('.dot');
        var connText = desktopConn.querySelector('.conn-text');
        if (dot) {
          dot.className = 'dot ' + (isOnline ? 'online' : 'offline');
        }
        if (connText) {
          connText.textContent = text.replace(/^\u25CF\s*/, '');
        }
      };

      new MutationObserver(updateConn).observe(connStatus, {
        childList: true,
        characterData: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class']
      });
      updateConn();
    }

    var userName = document.getElementById('traeUserName');
    var userUid = document.getElementById('traeUserUid');
    var desktopUser = document.getElementById('desktopUserItem');
    if (userName && desktopUser) {
      var updateUser = function () {
        var name = userName.textContent.trim();
        var uid = userUid ? userUid.textContent.trim() : '';
        desktopUser.innerHTML = '<span>' + name + '</span>' + (uid ? ' \u00B7 <span>' + uid + '</span>' : '');
      };

      if (userName) {
        new MutationObserver(updateUser).observe(userName, { characterData: true, subtree: true, childList: true });
      }
      if (userUid) {
        new MutationObserver(updateUser).observe(userUid, { characterData: true, subtree: true, childList: true });
      }
      updateUser();
    }
  }

  /* ===== 7. Add Tooltips to Sidebar Items ===== */
  function addTooltips() {
    var items = document.querySelectorAll('.trae-sidebar-item');
    items.forEach(function (item) {
      if (!item.dataset.tooltip) {
        var label = item.querySelector('span:not(.icon):not(.badge)');
        if (label) {
          item.dataset.tooltip = label.textContent.trim();
        }
      }
    });
  }

  /* ===== 8. Observe Sidebar Changes ===== */
  function observeSidebar() {
    var nav = document.getElementById('sidebarNav');
    if (!nav) return;

    new MutationObserver(function () {
      addTooltips();
    }).observe(nav, { childList: true, subtree: true });
  }

  /* ===== 9. Keyboard Shortcut: Ctrl+B to Toggle Sidebar ===== */
  function setupKeyboardShortcuts() {
    document.addEventListener('keydown', function (e) {
      if (e.ctrlKey && e.key === 'b') {
        e.preventDefault();
        var sidebar = document.querySelector('.trae-sidebar');
        if (sidebar) {
          sidebar.classList.toggle('desktop-collapsed');
          if (sidebar.classList.contains('desktop-collapsed')) {
            sidebar.style.width = '0px';
            sidebar.style.borderRight = 'none';
          } else {
            sidebar.style.width = '';
            sidebar.style.borderRight = '';
          }
        }
      }
    });
  }

  /* ===== 10. Init ===== */
  function init() {
    var tryCount = 0;
    var tryInit = function () {
      var sidebar = document.querySelector('.trae-sidebar');
      var mainScreen = document.getElementById('mainScreen');
      var cats = document.querySelectorAll('.trae-cat');

      if (sidebar && mainScreen && cats.length > 0) {
        createCategoryRail();
        createStatusBar();
        syncCategoryActive();
        observeAdminClass();
        syncStatusBar();
        addTooltips();
        observeSidebar();
        setupKeyboardShortcuts();
      } else if (tryCount < 30) {
        tryCount++;
        setTimeout(tryInit, 200);
      }
    };
    tryInit();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
