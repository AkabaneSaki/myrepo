export const homeShellStyles = String.raw`
/* 2026 desktop shell: reuse the mobile gallery language instead of creating a second visual system. */
.workshop-shell { width:100%; min-width:0; }
.workshop-main { min-width:0; }
:root { --workshop-content-font: "Noto Sans SC", "Microsoft YaHei", sans-serif; }
.project-name,
.card-text-preview p,
.detail-project-name,
.detail-description,
.entry-title { font-family:var(--workshop-content-font); }
.desktop-sidebar { display:none; }
.my-projects-page-head {
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:14px;
  margin:2px 0 14px;
  padding:2px 2px 12px;
  border-bottom:1px solid rgba(255,255,255,.07);
}
.my-projects-page-head > div { min-width:0; }
.my-projects-page-head small {
  display:block;
  margin-bottom:2px;
  color:#73726e;
  font-size:.68rem;
  font-weight:700;
}
.my-projects-page-head h2 {
  margin:0;
  color:#ececea;
  font-size:1.08rem;
  font-weight:800;
}
.my-projects-upload-btn {
  flex:none;
  min-height:42px;
  padding:0 16px;
  gap:8px;
  border-radius:10px;
  font-weight:760;
}

@media (min-width:1024px) {
  .container {
    max-width:1680px;
    margin:0 auto;
    padding:calc(16px + env(safe-area-inset-top)) calc(18px + env(safe-area-inset-right)) calc(28px + env(safe-area-inset-bottom)) calc(18px + env(safe-area-inset-left));
  }

  .workshop-shell {
    display:grid;
    grid-template-columns:204px minmax(0,1fr);
    gap:18px;
    align-items:start;
  }

  .desktop-sidebar {
    position:sticky;
    top:16px;
    z-index:55;
    height:calc(100dvh - 32px);
    min-height:560px;
    display:flex;
    flex-direction:column;
    padding:14px 10px 12px;
    border:1px solid rgba(255,255,255,.075);
    border-radius:13px;
    background:rgba(27,28,31,.92);
    box-shadow:0 12px 34px rgba(0,0,0,.16);
    backdrop-filter:blur(18px);
  }

  .sidebar-brand {
    display:flex;
    align-items:center;
    gap:10px;
    padding:4px 6px 15px;
    border-bottom:1px solid rgba(255,255,255,.07);
  }

  .sidebar-brand-mark {
    width:34px;
    height:34px;
    flex:none;
    display:grid;
    place-items:center;
    border:1px solid rgba(162,139,107,.22);
    border-radius:9px;
    background:rgba(162,139,107,.08);
    color:#b9a180;
    font-size:.88rem;
  }

  .sidebar-brand-copy {
    min-width:0;
    display:flex;
    flex-direction:column;
    gap:1px;
  }

  .sidebar-brand-copy strong {
    overflow:hidden;
    text-overflow:ellipsis;
    white-space:nowrap;
    color:#ececea;
    font-family:"LXGW WenKai Lite","Microsoft YaHei",sans-serif;
    font-size:.92rem;
    font-weight:760;
  }

  .sidebar-brand-copy small {
    overflow:hidden;
    text-overflow:ellipsis;
    white-space:nowrap;
    color:#66645f;
    font-size:.57rem;
    letter-spacing:.04em;
  }

  .sidebar-section-label {
    padding:15px 10px 7px;
    color:#66645f;
    font-size:.59rem;
    font-weight:760;
    letter-spacing:.08em;
  }

  .sidebar-nav {
    width:100%;
    display:flex;
    flex-direction:column;
    align-items:stretch;
    gap:3px;
  }

  .sidebar-nav-btn {
    position:relative;
    width:100%;
    min-height:40px;
    display:flex;
    align-items:center;
    justify-content:flex-start;
    gap:10px;
    padding:0 10px;
    border:1px solid transparent;
    border-radius:9px;
    background:transparent;
    color:#8f8d87;
    font-size:.75rem;
    font-weight:650;
    text-align:left;
    transition:background .14s ease,border-color .14s ease,color .14s ease;
  }

  .sidebar-nav-btn i {
    width:18px;
    flex:none;
    color:#73726e;
    text-align:center;
    font-size:.78rem;
  }

  .sidebar-nav-btn:hover {
    transform:none;
    border-color:rgba(255,255,255,.065);
    background:rgba(255,255,255,.035);
    color:#d0cfcb;
  }

  .sidebar-nav.tag-filter .sidebar-nav-btn.tag-filter-btn.active {
    border-color:rgba(162,139,107,.17);
    background:rgba(162,139,107,.085);
    color:#d5c2a5;
  }

  .sidebar-nav.tag-filter .sidebar-nav-btn.tag-filter-btn.active::before {
    content:'';
    position:absolute;
    left:-1px;
    top:8px;
    bottom:8px;
    width:2px;
    border-radius:2px;
    background:#a28b6b;
  }

  .sidebar-nav.tag-filter .sidebar-nav-btn.tag-filter-btn.active i { color:#b9a180; }
  .sidebar-nav-btn.is-disabled { opacity:.45; cursor:wait; }

  .sidebar-view-state {
    display:flex;
    align-items:center;
    gap:10px;
    min-height:48px;
    padding:8px 10px;
    border:1px solid rgba(162,139,107,.15);
    border-radius:9px;
    background:rgba(162,139,107,.06);
    color:#b9a180;
  }

  .sidebar-view-state > i { width:18px; text-align:center; }
  .sidebar-view-state > span { min-width:0; display:flex; flex-direction:column; }
  .sidebar-view-state small { color:#66645f; font-size:.58rem; }
  .sidebar-view-state strong { color:#d5c2a5; font-size:.73rem; }

  .sidebar-view-actions { margin-top:0; }
  .sidebar-view-actions .sidebar-nav-btn { min-height:38px; }
  .sidebar-view-actions .sidebar-back-shortcut {
    color:#aaa8a3;
  }
  .sidebar-view-actions .sidebar-back-shortcut:hover {
    border-color:rgba(255,255,255,.065);
    background:rgba(255,255,255,.035);
    color:#ececea;
  }

  .sidebar-spacer { flex:1; min-height:18px; }

  .sidebar-bottom {
    display:flex;
    flex-direction:column;
    gap:7px;
    padding-top:10px;
    border-top:1px solid rgba(255,255,255,.07);
  }

  .sidebar-bottom .release-notice,
  .sidebar-bottom .tavern-status {
    width:100%;
    min-height:40px;
    justify-content:flex-start;
    border-radius:9px;
    padding:8px 10px;
    background:rgba(255,255,255,.025);
    border-color:rgba(255,255,255,.065);
    box-shadow:none;
    font-size:.66rem;
  }

  .sidebar-bottom .release-notice {
    color:#b9a180;
    background:rgba(162,139,107,.055);
    border-color:rgba(162,139,107,.14);
    white-space:normal;
  }

  .sidebar-bottom .release-notice:hover {
    transform:none;
    background:rgba(162,139,107,.09);
    border-color:rgba(162,139,107,.22);
  }

  .sidebar-bottom .release-notice i,
  .sidebar-bottom .release-notice strong { color:#b9a180; }

  .sidebar-bottom .tavern-status span {
    min-width:0;
    overflow:hidden;
    text-overflow:ellipsis;
    white-space:nowrap;
  }

  .header {
    position:sticky;
    top:16px;
    z-index:60;
    min-height:54px;
    margin:0 0 14px;
    padding:7px 8px;
    border:1px solid rgba(255,255,255,.075);
    border-radius:13px;
    background:rgba(27,28,31,.90);
    box-shadow:0 10px 28px rgba(0,0,0,.12);
    backdrop-filter:blur(18px);
  }

  .header-top {
    min-height:40px;
    align-items:center;
    gap:10px;
  }

  .mobile-header-brand { display:none; }

  .desktop-toolbar {
    min-width:0;
    flex:1;
    display:flex;
    align-items:center;
    gap:8px;
  }

  .desktop-toolbar .header-search {
    height:40px;
    min-width:220px;
    max-width:680px;
    padding:0 12px;
    border-radius:9px;
    border-color:rgba(255,255,255,.075);
    background:#151619;
  }

  .desktop-toolbar .header-search input {
    font-size:.82rem;
    color:#ececea;
  }

  .desktop-toolbar .header-search i {
    color:#73726e;
    font-size:.78rem;
  }

  .desktop-toolbar-actions {
    display:flex;
    align-items:center;
    gap:6px;
    flex:none;
  }

  .desktop-toolbar .sort-menu-trigger,
  .desktop-toolbar .toggle-switch {
    min-height:40px;
    border:1px solid rgba(255,255,255,.07);
    border-radius:9px;
    background:rgba(255,255,255,.025);
    color:#aaa8a3;
    box-shadow:none;
  }

  .desktop-toolbar .sort-menu-trigger {
    padding:0 10px;
    gap:7px;
  }

  .desktop-toolbar .sort-menu-trigger:hover,
  .desktop-toolbar .toggle-switch:hover {
    background:rgba(255,255,255,.045);
    color:#d0cfcb;
  }

  .desktop-toolbar .sort-menu-trigger > i:first-child { color:#73726e; }
  .desktop-toolbar .sort-menu-trigger > i:last-child { color:#66645f; font-size:.58rem; }

  .desktop-toolbar .toggle-switch {
    padding:0 9px 0 10px;
    gap:8px;
    font-size:.68rem;
  }

  .desktop-toolbar .toggle-switch input {
    width:32px;
    height:18px;
    background:#343539;
  }

  .desktop-toolbar .toggle-switch input:checked { background:#8f7b5f; }
  .desktop-toolbar .toggle-switch input::before { width:14px; height:14px; }
  .desktop-toolbar .toggle-switch input:checked::before { left:16px; }

  .desktop-toolbar .sort-menu .user-menu-dropdown {
    top:calc(100% + 8px);
    right:auto;
    left:0;
  }

  .user-info {
    width:auto;
    flex:none;
    align-items:center;
    gap:6px;
    margin-left:auto;
    flex-wrap:nowrap;
  }

  .header .user-menu-trigger {
    min-height:40px;
    padding:3px 5px 3px 8px;
    border:1px solid rgba(255,255,255,.065);
    border-radius:9px;
    background:rgba(255,255,255,.02);
  }

  .header .user-menu-trigger:hover { background:rgba(255,255,255,.045); }
  .header .user-menu-name { max-width:118px; color:#aaa8a3; font-size:.7rem; }
  .header .user-menu-trigger > i { color:#66645f; font-size:.58rem; }

  .header .avatar {
    width:31px;
    height:31px;
    border:1px solid rgba(255,255,255,.10);
  }

  .header #loginBtn {
    min-height:40px;
    padding:0 12px;
    border:1px solid rgba(162,139,107,.18);
    border-radius:9px;
    background:rgba(162,139,107,.08);
    color:#d5c2a5;
    box-shadow:none;
    font-size:.7rem;
  }

  .header #loginBtn:hover {
    transform:none;
    background:rgba(162,139,107,.12);
    box-shadow:none;
  }

  .header .workshop-close-btn {
    width:40px;
    min-width:40px;
    height:40px;
    min-height:40px;
    padding:0;
    justify-content:center;
    border-radius:9px;
    border-color:rgba(248,113,113,.18);
    background:rgba(127,29,29,.10);
  }

  .header .workshop-close-btn span { display:none; }

  .projects-grid {
    margin-top:0;
    grid-template-columns:repeat(auto-fill,minmax(220px,1fr));
    gap:12px;
  }
}

@media (max-width:1023px) {
  .desktop-sidebar { display:none !important; }
  .workshop-shell { display:block; }
}

@media (min-width:641px) and (max-width:1023px) {
  .container {
    max-width:none;
    padding:calc(10px + env(safe-area-inset-top)) calc(12px + env(safe-area-inset-right)) calc(92px + env(safe-area-inset-bottom)) calc(12px + env(safe-area-inset-left));
  }

  .header {
    position:sticky;
    top:0;
    z-index:60;
    margin:calc(-10px - env(safe-area-inset-top)) -12px 10px;
    padding:calc(7px + env(safe-area-inset-top)) 12px 7px;
    border-radius:0;
    border-width:0 0 1px;
    background:rgba(21,22,25,.90);
    backdrop-filter:blur(18px);
  }

  .header-top {
    flex-direction:row;
    align-items:center;
    min-height:44px;
    gap:8px;
  }

  .mobile-header-brand {
    width:auto;
    min-width:0;
    flex:1;
    display:flex;
    align-items:center;
    gap:7px;
  }

  .desktop-toolbar { display:none; }

  .logo h1 {
    min-width:0;
    max-width:100%;
    overflow:hidden;
    text-overflow:ellipsis;
    white-space:nowrap;
    background:none;
    -webkit-text-fill-color:currentColor;
    color:#ececea;
    font-family:"LXGW WenKai Lite","Microsoft YaHei",sans-serif;
    font-size:1.02rem;
    font-weight:700;
  }

  .logo h1 i { display:none; }

  .release-notice {
    width:36px;
    min-width:36px;
    height:36px;
    min-height:36px;
    padding:0;
    justify-content:center;
    border-radius:9px;
    border-color:rgba(162,139,107,.18);
    background:rgba(162,139,107,.07);
    color:#b9a180;
  }

  .release-notice span,.release-notice strong { display:none; }
  .release-notice i { color:#a28b6b; }

  .user-info {
    width:auto;
    flex:none;
    margin:0;
    gap:5px;
    flex-wrap:nowrap;
    align-items:center;
  }

  .tavern-status {
    width:36px;
    height:36px;
    padding:0;
    justify-content:center;
    border-radius:9px;
    background:rgba(255,255,255,.035);
    border-color:rgba(255,255,255,.06);
  }

  .tavern-status span { display:none; }

  .workshop-close-btn {
    width:36px;
    height:36px;
    min-height:36px;
    padding:0;
    justify-content:center;
    border-radius:9px;
    font-size:0;
  }

  .workshop-close-btn i { font-size:.82rem; }

  .user-menu-trigger {
    width:38px;
    height:38px;
    padding:0;
    justify-content:center;
  }

  .user-menu-trigger .user-menu-name,.user-menu-trigger > i { display:none; }
  .avatar { width:34px; height:34px; border:1px solid rgba(255,255,255,.12); }

  #loginBtn {
    min-height:38px;
    padding:0 11px;
    border-radius:9px;
    box-shadow:none;
  }

  .projects-grid {
    grid-template-columns:repeat(auto-fill,minmax(190px,1fr));
    gap:10px;
    margin-top:12px;
  }

  .mobile-tool-dock {
    position:fixed;
    left:50%;
    bottom:max(8px,env(safe-area-inset-bottom));
    z-index:80;
    width:min(calc(100% - 18px),420px);
    transform:translateX(-50%);
    display:grid !important;
    grid-template-columns:repeat(3,minmax(0,1fr));
    gap:4px;
    padding:5px;
    border:1px solid rgba(255,255,255,.10);
    border-radius:13px;
    background:rgba(33,34,38,.88);
    box-shadow:0 16px 42px rgba(0,0,0,.34);
    backdrop-filter:blur(22px);
  }

  .mobile-tool-dock button {
    height:46px;
    display:flex;
    align-items:center;
    justify-content:center;
    gap:6px;
    border:1px solid transparent;
    border-radius:9px;
    background:transparent;
    color:#aaa8a3;
    font:700 .68rem/1 system-ui,sans-serif;
  }

  .mobile-tool-dock button i { font-size:.9rem; }

  .mobile-tool-dock button.active,.mobile-tool-dock button:active {
    color:#c5ad8b;
    background:rgba(162,139,107,.10);
    border-color:rgba(162,139,107,.16);
  }

  .mobile-tool-backdrop {
    position:fixed;
    inset:0;
    z-index:70;
    display:block !important;
    visibility:hidden;
    opacity:0;
    background:rgba(0,0,0,.34);
    transition:opacity .16s ease,visibility .16s ease;
  }

  .mobile-tool-backdrop.show { visibility:visible; opacity:1; }

  .mobile-tool-sheet {
    position:fixed;
    left:50%;
    bottom:calc(max(8px,env(safe-area-inset-bottom)) + 62px);
    z-index:75;
    width:min(calc(100% - 18px),604px);
    max-height:min(62dvh,560px);
    display:block !important;
    visibility:hidden;
    opacity:0;
    transform:translate(-50%,12px);
    overflow:hidden;
    border:1px solid rgba(255,255,255,.10);
    border-radius:13px;
    background:rgba(33,34,38,.96);
    box-shadow:0 24px 60px rgba(0,0,0,.38);
    backdrop-filter:blur(22px);
    transition:opacity .18s ease,transform .18s ease,visibility .18s ease;
  }

  .mobile-tool-sheet.show { visibility:visible; opacity:1; transform:translate(-50%,0); }

  .mobile-tool-sheet-head {
    height:50px;
    display:flex;
    align-items:center;
    padding:0 13px;
    border-bottom:1px solid rgba(255,255,255,.075);
  }

  .mobile-tool-sheet-head strong {
    font-family:"LXGW WenKai Lite","Microsoft YaHei",sans-serif;
    font-size:.9rem;
  }

  .mobile-tool-sheet-head button {
    margin-left:auto;
    height:36px;
    border:0;
    background:transparent;
    color:#c5ad8b;
    font-weight:700;
  }

  .mobile-tool-panel {
    padding:13px;
    overflow:auto;
    max-height:calc(62dvh - 50px);
  }

  .mobile-tool-panel[hidden] { display:none; }

  .mobile-search-box {
    height:48px;
    display:flex;
    align-items:center;
    gap:9px;
    padding:0 12px;
    border:1px solid rgba(255,255,255,.10);
    border-radius:9px;
    background:#1b1c1f;
    color:#73726e;
  }

  .mobile-search-box input {
    width:100%;
    height:100%;
    border:0;
    outline:0;
    background:transparent;
    color:#ececea;
    font-size:16px;
  }

  .mobile-filter-options {
    display:grid;
    grid-template-columns:repeat(2,minmax(0,1fr));
    gap:7px;
  }

  .mobile-filter-section + .mobile-filter-section { margin-top:16px; }
  .mobile-filter-section-title {
    margin:0 0 8px;
    color:#77756f;
    font-size:.72rem;
    font-weight:700;
    letter-spacing:.08em;
  }

  .mobile-official-tag-filter {
    display:flex;
    flex-direction:column;
    gap:12px;
  }

  .mobile-tag-search {
    height:42px;
    display:flex;
    align-items:center;
    gap:8px;
    padding:0 11px;
    border:1px solid rgba(255,255,255,.09);
    border-radius:9px;
    background:#1b1c1f;
    color:#77756f;
  }

  .mobile-tag-search input {
    width:100%;
    height:100%;
    border:0;
    outline:0;
    background:transparent;
    color:#ececea;
    font-size:16px;
  }

  .mobile-selected-tag-block {
    padding:10px;
    border:1px solid rgba(162,139,107,.14);
    border-radius:9px;
    background:rgba(162,139,107,.055);
  }

  .mobile-selected-tag-head {
    display:flex;
    align-items:center;
    margin-bottom:8px;
    color:#9d958a;
    font-size:.68rem;
    font-weight:700;
  }

  .mobile-selected-tag-head button {
    margin-left:auto;
    padding:2px 0;
    border:0;
    background:transparent;
    color:#bca786;
    font-size:.68rem;
  }

  .mobile-selected-tag-list,
  .mobile-official-tag-chips {
    display:flex;
    flex-wrap:wrap;
    gap:7px;
  }

  .mobile-selected-tag,
  .mobile-official-tag-chip {
    min-height:34px;
    display:inline-flex;
    align-items:center;
    gap:6px;
    padding:0 11px;
    border:1px solid rgba(255,255,255,.08);
    border-radius:999px;
    background:rgba(255,255,255,.025);
    color:#aaa8a3;
    font-size:.7rem;
    line-height:1;
  }

  .mobile-selected-tag,
  .mobile-official-tag-chip.active {
    border-color:rgba(162,139,107,.30);
    background:rgba(162,139,107,.12);
    color:#d8c4a6;
  }

  .mobile-selected-tag i,
  .mobile-official-tag-chip i {
    font-size:.58rem;
  }

  .mobile-official-tag-groups {
    display:flex;
    flex-direction:column;
    gap:14px;
  }

  .mobile-official-tag-group[hidden],
  .mobile-official-tag-chip[hidden] { display:none; }

  .mobile-official-tag-group-title {
    margin-bottom:8px;
    color:#8f8b84;
    font-size:.68rem;
    font-weight:700;
  }

  .mobile-tag-empty,
  .mobile-tag-search-empty {
    padding:18px 8px;
    text-align:center;
    color:#77756f;
    font-size:.7rem;
  }

  .mobile-filter-option {
    min-height:42px;
    border:1px solid rgba(255,255,255,.08);
    border-radius:8px;
    background:transparent;
    color:#aaa8a3;
    font-size:.72rem;
  }

  .mobile-filter-option.active {
    color:#c5ad8b;
    border-color:rgba(162,139,107,.26);
    background:rgba(162,139,107,.09);
  }

  .mobile-sort-list { padding-top:5px; padding-bottom:5px; }

  .mobile-sort-option {
    width:100%;
    height:48px;
    display:flex;
    align-items:center;
    gap:10px;
    border:0;
    border-bottom:1px solid rgba(255,255,255,.065);
    background:transparent;
    color:#d9d8d4;
    text-align:left;
  }

  .mobile-sort-option:last-child { border-bottom:0; }
  .mobile-sort-option i { margin-left:auto; color:#c5ad8b; }

  .mobile-tool-empty {
    padding:24px 12px;
    text-align:center;
    color:#77756f;
    font-size:.72rem;
  }
}

@media (min-width:1024px) {
  .mobile-tool-dock,.mobile-tool-backdrop,.mobile-tool-sheet { display:none !important; }

  .sidebar-tag-picker {
    display:flex;
    flex-direction:column;
    gap:7px;
    margin-top:14px;
  }
  .sidebar-tag-picker > span {
    display:flex;
    align-items:center;
    gap:7px;
    color:#77756f;
    font-size:.68rem;
    font-weight:700;
    letter-spacing:.06em;
  }
  .sidebar-tag-picker select {
    width:100%;
    min-height:38px;
    padding:0 9px;
    border:1px solid rgba(255,255,255,.075);
    border-radius:8px;
    background:#1b1c1f;
    color:#d9d8d4;
    font-size:.78rem;
  }
}

.card-owner-stats {
  display:inline-flex;
  align-items:center;
  gap:10px;
  color:#8f8d87;
  font-size:.72rem;
  font-variant-numeric:tabular-nums;
}
.card-owner-stats span { display:inline-flex; align-items:center; gap:4px; }
.card-owner-stats i { color:#b49a77; font-size:.7rem; }

/* Readability pass: keep the restrained layout without microscopic secondary text. */
.card-creator { font-size:.76rem; }
.card-admin-menu .action-btn { font-size:.8rem; }
.card-text-preview__type,.card-text-preview__hint { font-size:.68rem; }
.card-text-preview p { font-size:.9rem; }
.project-name { font-size:1rem; }
.project-tags .tag { font-size:.67rem; }
.card-status-line,.card-quality-signal { font-size:.66rem; }
.card-quality-signal i { font-size:.68rem; }
.card-footer .action-btn { font-size:.7rem; }

@media (min-width:1024px) {
  .sidebar-brand-mark { font-size:1rem; }
  .sidebar-brand-copy strong { font-size:1.02rem; }
  .sidebar-brand-copy small,.sidebar-section-label { font-size:.68rem; }
  .sidebar-nav-btn { font-size:.84rem; }
  .sidebar-nav-btn i { font-size:.86rem; }
  .sidebar-view-state small { font-size:.67rem; }
  .sidebar-view-state strong { font-size:.82rem; }
  .sidebar-bottom .release-notice,.sidebar-bottom .tavern-status { font-size:.74rem; }
  .desktop-toolbar .header-search input { font-size:.9rem; }
  .desktop-toolbar .sort-menu-trigger > i:last-child { font-size:.66rem; }
  .desktop-toolbar .toggle-switch { font-size:.76rem; }
  .header .user-menu-name,.header #loginBtn { font-size:.78rem; }
  .header .user-menu-trigger > i { font-size:.66rem; }
}

@media (max-width:1023px) {
  .logo h1 { font-size:1.08rem; }
  .mobile-tool-dock button { font-size:.76rem; }
  .mobile-tool-sheet-head strong { font-size:.98rem; }
  .mobile-filter-option { font-size:.82rem; }
  .mobile-tool-empty { font-size:.8rem; }
}

@media (min-width:1024px) {
  .desktop-toolbar .font-menu-trigger {
    min-height:40px;
    padding:0 10px;
    gap:7px;
    border:1px solid rgba(255,255,255,.07);
    border-radius:9px;
    background:rgba(255,255,255,.025);
    color:#aaa8a3;
    box-shadow:none;
  }
  .desktop-toolbar .font-menu-trigger:hover { background:rgba(255,255,255,.045); color:#d0cfcb; }
  .desktop-toolbar .font-menu-trigger > i:first-child { color:#73726e; }
  .desktop-toolbar .font-menu-trigger > i:last-child { color:#66645f; font-size:.66rem; }
  .desktop-toolbar .font-menu .user-menu-dropdown { top:calc(100% + 8px); right:0; left:auto; min-width:176px; }
  .font-menu-item.active { color:#d5c2a5; background:rgba(162,139,107,.085); }
  .projects-grid { grid-template-columns:repeat(3,minmax(0,1fr)); }
}

@media (min-width:1280px) {
  .projects-grid { grid-template-columns:repeat(4,minmax(0,1fr)); }
}

@media (min-width:1440px) {
  .projects-grid { grid-template-columns:repeat(5,minmax(0,1fr)); }
}

@media (max-width:1023px) {
  .mobile-tool-dock { grid-template-columns:repeat(3,minmax(0,1fr)); }
}

@media (max-width:640px) {
  .container {
    padding:calc(8px + env(safe-area-inset-top)) calc(16px + env(safe-area-inset-right)) calc(112px + env(safe-area-inset-bottom)) calc(16px + env(safe-area-inset-left));
  }

  .header {
    margin:calc(-8px - env(safe-area-inset-top)) -16px 12px;
    padding:calc(7px + env(safe-area-inset-top)) 16px 7px;
  }

  .projects-grid {
    gap:12px;
    margin-top:14px;
  }

  .project-card {
    border-color:rgba(255,255,255,.042);
    box-shadow:0 3px 12px rgba(0,0,0,.12);
  }

  .project-card:hover {
    border-color:rgba(255,255,255,.042);
    box-shadow:0 3px 12px rgba(0,0,0,.12);
  }

  .card-head {
    height:36px;
    padding:0 8px 0 10px;
    border-bottom:0;
    background:transparent;
  }

  .card-cover,
  .card-text-preview { border-bottom:0; }

  .card-content { padding:11px 10px 10px; }
  .project-name { font-size:1rem; }

  .project-tags {
    margin-top:8px;
    line-height:1.55;
  }

  .project-tags .tag {
    color:#aaa8a3;
    font-size:.72rem;
    line-height:1.55;
  }

  .project-tags .tag + .tag::before {
    margin:0 3px;
    color:#686761;
  }

  .card-footer {
    min-height:40px;
    margin-top:10px;
    padding-top:8px;
    border-top:0;
  }

  .card-footer .install-btn {
    min-height:34px;
    padding:0 10px;
    border:1px solid rgba(162,139,107,.18);
    background:rgba(162,139,107,.09);
    color:#dfcfb8;
    font-size:.74rem;
  }

  .card-footer .install-btn i { color:#c5ad8b; }
  .card-footer .install-btn:active {
    background:rgba(162,139,107,.15);
    border-color:rgba(162,139,107,.26);
    color:#f0e5d5;
  }

  .card-footer .install-btn.is-disabled {
    background:transparent;
    border-color:transparent;
    color:#77756f;
  }

  .tavern-status {
    width:28px;
    min-width:28px;
    height:36px;
    border:0;
    background:transparent;
    box-shadow:none;
    color:#85837d;
  }

  .tavern-status i { font-size:.9rem; }
  .tavern-status--connected { color:#91b092; }
  .tavern-status--connecting { color:#c5ad8b; }
  .tavern-status--error { color:#d9918b; }

  .detail-tags-row .tag {
    border:1px solid rgba(255,255,255,.045);
    background:rgba(255,255,255,.04);
    color:#c6c4be;
  }
}
/* Unified discovery: category navigation stays separate; text search and official tags share one surface. */
.unified-search { position:relative; min-width:0; }
.unified-search-box {
  min-height:44px;
  display:flex;
  align-items:center;
  gap:9px;
  padding:0 12px;
  border:1px solid rgba(255,255,255,.085);
  border-radius:11px;
  background:#151619;
  color:var(--cw-text-muted);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.02);
}
.unified-search-box:focus-within {
  border-color:rgba(162,139,107,.34);
  box-shadow:0 0 0 3px rgba(162,139,107,.08);
}
.unified-search-box > i { flex:none; color:var(--cw-text-muted); font-size:.82rem; }
.unified-search-box input {
  min-width:0;
  flex:1;
  height:42px;
  padding:0;
  border:0 !important;
  outline:0 !important;
  appearance:none;
  -webkit-appearance:none;
  background:transparent !important;
  color:var(--cw-text-primary) !important;
  font:inherit;
  font-size:.9rem;
  box-shadow:none !important;
}
.unified-search-box input::-webkit-search-cancel-button { display:none; }
.unified-search-clear {
  width:30px;
  height:30px;
  flex:none;
  display:grid;
  place-items:center;
  padding:0;
  border:0;
  border-radius:8px;
  background:transparent;
  color:var(--cw-text-muted);
}
.unified-search-clear:hover,.unified-search-clear:active { background:rgba(255,255,255,.05); color:var(--cw-text-primary); }
.search-assist { min-width:0; }
.search-assist-head {
  display:flex;
  align-items:baseline;
  gap:10px;
  margin-bottom:11px;
}
.search-assist-head span { color:var(--cw-text-primary); font-size:.78rem; font-weight:750; }
.search-assist-head small { margin-left:auto; color:var(--cw-text-muted); font-size:.66rem; }
.search-active-tags {
  margin-bottom:12px;
  padding:10px;
  border:1px solid rgba(162,139,107,.16);
  border-radius:10px;
  background:rgba(162,139,107,.055);
}
.search-active-tags-head { display:flex; align-items:center; gap:8px; margin-bottom:8px; }
.search-active-tags-head span { color:var(--cw-text-secondary); font-size:.7rem; font-weight:700; }
.search-active-tags-head button {
  margin-left:auto;
  padding:2px 0;
  border:0;
  background:transparent;
  color:#c7ae8b;
  font-size:.68rem;
  font-weight:700;
}
.search-active-tag-row,.search-tag-chip-row {
  display:flex;
  align-items:center;
  flex-wrap:wrap;
  gap:7px;
}
.search-active-tag,.search-tag-chip,.search-summary-chip {
  appearance:none;
  -webkit-appearance:none;
  min-height:32px;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  gap:6px;
  padding:0 11px;
  border:1px solid rgba(255,255,255,.085);
  border-radius:999px;
  background:rgba(255,255,255,.03);
  color:var(--cw-text-secondary);
  font:700 .72rem/1 system-ui,sans-serif;
  white-space:nowrap;
  box-shadow:none;
}
.search-active-tag,.search-tag-chip.active,.search-summary-chip {
  border-color:rgba(162,139,107,.28);
  background:rgba(162,139,107,.11);
  color:#ddc8aa;
}
.search-tag-chip:hover,.search-tag-chip:active {
  transform:none;
  border-color:rgba(162,139,107,.24);
  background:rgba(162,139,107,.075);
  color:var(--cw-text-primary);
}
.search-tag-chip.active:hover { background:rgba(162,139,107,.15); }
.search-active-tag i,.search-tag-chip i,.search-summary-chip i { font-size:.58rem; }
.search-tag-groups { display:flex; flex-direction:column; gap:13px; }
.search-tag-group-title { margin-bottom:7px; color:var(--cw-text-muted); font-size:.68rem; font-weight:750; letter-spacing:.03em; }
.search-tag-chip[hidden],.search-tag-group[hidden],.search-tag-empty[hidden] { display:none !important; }
.search-tag-empty,.search-tag-empty-state {
  padding:16px 8px;
  text-align:center;
  color:var(--cw-text-muted);
  font-size:.72rem;
}
.search-query-summary {
  display:flex;
  align-items:center;
  flex-wrap:wrap;
  gap:7px;
  margin:0 0 12px;
}
.search-query-summary-label { color:var(--cw-text-muted); font-size:.68rem; font-weight:700; }
.search-summary-query { background:rgba(91,126,166,.10); border-color:rgba(91,126,166,.22); color:#bdcde0; }
.search-summary-clear {
  min-height:30px;
  padding:0 6px;
  border:0;
  background:transparent;
  color:var(--cw-text-muted);
  font-size:.68rem;
}
.projects-empty { grid-column:1/-1; padding:28px 8px; text-align:center; color:var(--cw-text-muted); }
.mobile-breadcrumb { display:none; }

@media (min-width:1024px) {
  .desktop-toolbar .unified-search { flex:1; min-width:260px; max-width:680px; }
  .desktop-toolbar .unified-search-box { min-height:40px; height:40px; border-radius:9px; }
  .desktop-toolbar .unified-search-box input { height:38px; font-size:.88rem; }
  .unified-search--desktop .search-assist {
    position:absolute;
    top:calc(100% + 8px);
    left:0;
    z-index:100;
    width:min(640px,72vw);
    max-height:min(62vh,560px);
    display:none;
    overflow:auto;
    padding:13px;
    border:1px solid rgba(255,255,255,.09);
    border-radius:12px;
    background:rgba(27,28,31,.985);
    box-shadow:0 22px 52px rgba(0,0,0,.34);
    backdrop-filter:blur(18px);
  }
  .unified-search--desktop:focus-within .search-assist { display:block; }
}

@media (max-width:1023px) {
  .mobile-breadcrumb {
    display:flex;
    align-items:center;
    gap:7px;
    min-height:28px;
    margin:0 0 10px;
    padding:0 2px;
    color:var(--cw-text-muted);
    font-size:.72rem;
    font-weight:650;
  }
  .mobile-breadcrumb i { font-size:.58rem; opacity:.72; }
  .mobile-breadcrumb strong { color:#ddc8aa; font-size:.76rem; font-weight:750; }
  .mobile-breadcrumb-home {
    border:0;
    padding:4px 0;
    background:transparent;
    color:var(--cw-text-muted);
    font:inherit;
    font-weight:650;
    cursor:pointer;
  }
  .mobile-breadcrumb-home:active { color:#ddc8aa; }
  .mobile-page-list {
    display:grid;
    grid-template-columns:repeat(2,minmax(0,1fr));
    gap:8px;
  }
  .mobile-page-option {
    min-width:0;
    min-height:50px;
    display:flex;
    align-items:center;
    gap:9px;
    padding:0 12px;
    border:1px solid rgba(255,255,255,.07);
    border-radius:10px;
    background:rgba(255,255,255,.025);
    color:var(--cw-text-secondary);
    font:700 .76rem/1 system-ui,sans-serif;
  }
  .mobile-page-option:first-child { grid-column:1/-1; }
  .mobile-page-option > i:first-child { width:16px; color:var(--cw-text-muted); }
  .mobile-page-option > i:last-child { margin-left:auto; color:#c5ad8b; font-size:.68rem; }
  .mobile-page-option.active {
    border-color:rgba(162,139,107,.28);
    background:rgba(162,139,107,.11);
    color:#ddc8aa;
  }
  .mobile-page-option:disabled { opacity:.52; }
  .mobile-tool-dock { width:min(calc(100% - 18px),360px); grid-template-columns:repeat(3,minmax(0,1fr)) !important; }
  .unified-search--mobile .search-assist { display:block; padding-top:13px; }
  .unified-search--mobile .unified-search-box { min-height:48px; }
  .unified-search--mobile .unified-search-box input { height:46px; font-size:16px; }
  .unified-search--mobile .search-tag-chip-row {
    flex-wrap:nowrap;
    overflow-x:auto;
    padding:1px 1px 4px;
    scrollbar-width:none;
    -webkit-overflow-scrolling:touch;
  }
  .unified-search--mobile .search-tag-chip-row::-webkit-scrollbar { display:none; }
  .unified-search--mobile .search-tag-chip { flex:none; }
  .search-query-summary { margin-top:2px; }
}

/* Accessibility/readability pass: keep hierarchy through weight/spacing, not faint yellow-gray text. */
.sidebar-brand-copy strong,.logo h1 { color:var(--cw-text-heading); }
.sidebar-brand-copy small,.sidebar-section-label,.sidebar-view-state small { color:var(--cw-text-muted); }
.sidebar-nav-btn,.sidebar-view-state strong,.desktop-toolbar .sort-menu-trigger,.desktop-toolbar .toggle-switch,.header .user-menu-name,.desktop-toolbar .font-menu-trigger { color:var(--cw-text-secondary); }
.sidebar-nav-btn i,.desktop-toolbar .header-search i,.desktop-toolbar .sort-menu-trigger > i:first-child,.desktop-toolbar .sort-menu-trigger > i:last-child,.header .user-menu-trigger > i,.desktop-toolbar .font-menu-trigger > i:first-child,.desktop-toolbar .font-menu-trigger > i:last-child { color:var(--cw-text-muted); }
.sidebar-nav-btn:hover,.sidebar-nav-btn.active,.desktop-toolbar .sort-menu-trigger:hover,.desktop-toolbar .toggle-switch:hover,.desktop-toolbar .font-menu-trigger:hover { color:var(--cw-text-heading); }
.sidebar-view-state strong,.header #loginBtn,.mobile-tool-sheet-head strong,.mobile-sort-option { color:var(--cw-text-primary); }
.sidebar-bottom .release-notice { color:var(--cw-text-secondary); }
.desktop-toolbar .header-search input,.mobile-search-box input { color:var(--cw-text-primary); }
.mobile-tool-dock button,.mobile-filter-option { color:var(--cw-text-secondary); }
.mobile-tool-dock button.active,.mobile-tool-dock button:active,.mobile-filter-option.active,.mobile-tool-sheet-head button { color:var(--cw-text-heading); }
.mobile-search-box,.mobile-tool-empty { color:var(--cw-text-muted); }
.project-tags .tag,.card-creator,.card-status-line,.card-quality-signal { color:var(--cw-text-secondary); }
.card-text-preview__type,.card-text-preview__hint,.card-signals { color:var(--cw-text-muted); }
.card-footer .action-btn,.card-footer .install-btn { color:var(--cw-text-primary); }

/* Keep browse cards visually aligned and keep the primary install action readable. */
.projects-grid { align-items:stretch; }
.project-card {
  height:100%;
  display:flex;
  flex-direction:column;
}
.card-cover-wrap {
  position:relative;
  flex:none;
  overflow:hidden;
}




.card-title-row {
  flex:none;
  padding:9px 10px 8px;
  background:#1b1c1f;
  
  border-bottom:1px solid rgba(255,255,255,.075);
}
.card-content {
  flex:1;
  display:flex;
  flex-direction:column;
  gap:8px;
  min-height:0;
}
.project-name {
  height:calc(1.38em * 2);
  min-height:calc(1.38em * 2);
  max-height:calc(1.38em * 2);
  margin-bottom:0;
  display:-webkit-box;
  -webkit-box-orient:vertical;
  -webkit-line-clamp:2;
  line-clamp:2;
  overflow:hidden;
  word-break:break-word;
  overflow-wrap:anywhere;
}
.card-type-badge {
  display:inline-flex;
  align-items:center;
  gap:0;
  margin-right:.42em;
  padding:.18em .46em;
  border:1px solid var(--type-border);
  border-radius:6px;
  background:var(--type-bg);
  color:var(--type-fg);
  font-size:.68em;
  font-weight:820;
  line-height:1;
  letter-spacing:.015em;
  vertical-align:.12em;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.05);
  white-space:nowrap;
}
.card-type-icon {
  width:1.45em;
  height:1.45em;
  display:inline-grid;
  place-items:center;
  flex:none;
  border-radius:4px;
  background:var(--type-icon-bg);
}
.card-type-icon i { font-size:.72em; }
.card-type-label { line-height:1; }
.card-type-badge--system {
  --type-fg:#b8cee9;
  --type-bg:rgba(90,126,174,.14);
  --type-border:rgba(142,173,215,.30);
  --type-icon-bg:rgba(142,173,215,.18);
}
.card-type-badge--extension {
  --type-fg:#e3bd78;
  --type-bg:rgba(180,132,58,.14);
  --type-border:rgba(212,173,104,.32);
  --type-icon-bg:rgba(212,173,104,.18);
}
.card-type-badge--character {
  --type-fg:#d4afe4;
  --type-bg:rgba(151,100,174,.14);
  --type-border:rgba(198,160,217,.30);
  --type-icon-bg:rgba(198,160,217,.18);
}
.card-type-badge--event {
  --type-fg:#8fcdbc;
  --type-bg:rgba(72,142,122,.14);
  --type-border:rgba(121,189,169,.30);
  --type-icon-bg:rgba(121,189,169,.18);
}
.project-title-text { color:inherit; }
.project-tags {
  display:flex;
  flex-wrap:wrap;
  gap:4px 6px;
  margin-top:0;
  min-width:0;
  align-content:flex-start;
  white-space:normal;
  overflow:hidden;
  max-height:calc(1.55em * 2 + 4px);
}
.project-tags .tag {
  flex:none;
  line-height:1.55;
  color:#aaa69d;
}
.project-tags .tag + .tag::before {
  content:none;
  margin:0;
}
.card-art-badge {
  position:absolute;
  top:8px;
  left:8px;
  z-index:2;
  width:26px;
  height:26px;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  border:1px solid rgba(255,255,255,.12);
  border-radius:8px;
  background:rgba(20,21,24,.72);
  color:#d7c2a0;
  backdrop-filter:blur(8px);
  box-shadow:0 4px 12px rgba(0,0,0,.22);
  pointer-events:none;
}
.card-art-badge i { font-size:.78rem; }
.card-footer { margin-top:auto; }
.card-footer .install-btn:not(.is-disabled) {
  border-color:#ceb58f;
  background:#bea47d;
  color:#151619;
  font-weight:760;
}
.card-footer .install-btn:not(.is-disabled) i { color:#151619; }
.card-footer .install-btn:not(.is-disabled):hover,
.card-footer .install-btn:not(.is-disabled):active {
  border-color:#dbc39d;
  background:#cdb38b;
  color:#101113;
}
.card-footer .install-btn.is-disabled {
  opacity:1;
  cursor:not-allowed;
  border-color:rgba(162,139,107,.18);
  background:rgba(162,139,107,.08);
  color:#a49e95;
}
.card-footer .install-btn.is-disabled i { color:#958d82; }

.card-creator { font-size:.8rem; }
.card-text-preview__type,.card-text-preview__hint { font-size:.72rem; font-weight:600; }
.project-tags .tag { font-size:.72rem; font-weight:500; }
.card-status-line,.card-quality-signal { font-size:.72rem; }
.card-footer .action-btn { font-size:.76rem; }

@media (min-width:1024px) {
  .sidebar-brand-copy small,.sidebar-section-label { font-size:.72rem; }
  .sidebar-view-state small { font-size:.72rem; }
  .sidebar-bottom .release-notice,.sidebar-bottom .tavern-status { font-size:.78rem; }
  .desktop-toolbar .toggle-switch { font-size:.8rem; }
  .header .user-menu-name,.header #loginBtn { font-size:.8rem; }
}

@media (max-width:1023px) {
  .mobile-tool-dock button { font-size:.8rem; }
  .mobile-filter-option { font-size:.86rem; }
  .mobile-tool-empty { font-size:.84rem; }
}
/* Mobile five-tab navigation */
@media (max-width:1023px) {
  .header #userMenu,
  .header #loginBtn,
  .header #localAdminLoginBtn { display:none !important; }

  .mobile-tool-dock {
    width:min(calc(100% - 18px),520px);
    grid-template-columns:repeat(5,minmax(0,1fr)) !important;
  }

  .mobile-tool-dock button {
    min-width:0;
    padding:0 4px;
  }

  .mobile-tool-dock button span {
    min-width:0;
    overflow:hidden;
    text-overflow:ellipsis;
    white-space:nowrap;
  }

  .mobile-nav-avatar {
    width:22px;
    height:22px;
    flex:none;
    object-fit:cover;
    border:1px solid rgba(255,255,255,.14);
    border-radius:50%;
  }

  .mobile-account-tool-panel { padding:8px; }
  .mobile-account-panel { display:flex; flex-direction:column; gap:4px; }
  .mobile-account-profile {
    display:flex;
    align-items:center;
    gap:11px;
    padding:10px 10px 14px;
    margin-bottom:3px;
    border-bottom:1px solid rgba(255,255,255,.07);
  }
  .mobile-account-profile img {
    width:42px;
    height:42px;
    flex:none;
    object-fit:cover;
    border:1px solid rgba(255,255,255,.13);
    border-radius:50%;
  }
  .mobile-account-profile span,
  .mobile-account-action span {
    min-width:0;
    display:flex;
    flex:1;
    flex-direction:column;
    align-items:flex-start;
    gap:4px;
  }
  .mobile-account-profile strong,
  .mobile-account-action strong {
    max-width:100%;
    overflow:hidden;
    color:var(--cw-text-primary);
    font-size:.84rem;
    font-weight:760;
    text-overflow:ellipsis;
    white-space:nowrap;
  }
  .mobile-account-profile small,
  .mobile-account-action small {
    color:var(--cw-text-muted);
    font-size:.68rem;
    line-height:1.35;
  }
  .mobile-account-action {
    width:100%;
    min-height:54px;
    display:grid;
    grid-template-columns:26px minmax(0,1fr) 18px;
    align-items:center;
    gap:10px;
    padding:7px 10px;
    border:1px solid transparent;
    border-radius:10px;
    background:transparent;
    color:var(--cw-text-secondary);
    text-align:left;
  }
  .mobile-account-action > i:first-child {
    width:26px;
    color:var(--cw-text-muted);
    font-size:.92rem;
    text-align:center;
  }
  .mobile-account-action > i:last-child {
    color:var(--cw-text-muted);
    font-size:.66rem;
    text-align:right;
  }
  .mobile-account-action:active,
  .mobile-account-action.active {
    border-color:rgba(162,139,107,.22);
    background:rgba(162,139,107,.09);
  }
  .mobile-account-action.active > i,
  .mobile-account-action.active strong { color:#ddc8aa; }
  .mobile-account-primary > i:first-child { color:#b7a17e; }
  .mobile-account-danger > i:first-child,
  .mobile-account-danger strong { color:#d99a94; }
  .mobile-account-divider {
    height:1px;
    margin:5px 8px;
    background:rgba(255,255,255,.07);
  }
}

.dlc-repair-modal .modal-content { width:min(980px,calc(100vw - 24px)); max-height:min(90vh,920px); }
.dlc-repair-modal .modal-body { padding:0; overflow:auto; }
#dlcRepairRoot { min-height:220px; }
.repair-loading,.repair-empty { min-height:220px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px; padding:28px; text-align:center; color:#aaa39a; }
.repair-loading i,.repair-empty i { font-size:1.5rem; color:#a28b6b; }
.repair-scan-card { margin:14px 18px 0; overflow:hidden; border:1px solid rgba(255,255,255,.08); border-radius:14px; background:#18191c; }
.repair-scan-summary,.repair-toolbar,.repair-footer { display:flex; align-items:center; justify-content:space-between; gap:14px; }
.repair-scan-summary { padding:14px; }
.repair-scan-summary > div { min-width:0; display:flex; flex-direction:column; gap:3px; }
.repair-kicker { color:#8fa994; font-size:.67rem; font-weight:800; letter-spacing:.04em; }
.repair-scan-summary strong { color:#ece8e1; font-size:.88rem; line-height:1.45; overflow-wrap:anywhere; }
.repair-scan-summary small,.repair-other-book small,.repair-toolbar small { color:#8f8981; line-height:1.45; }
.repair-scan-summary .btn { flex:none; }
.repair-other-book { border-top:1px solid rgba(255,255,255,.065); }
.repair-other-book > summary { min-height:44px; display:flex; align-items:center; padding:0 14px; list-style:none; cursor:pointer; color:#aaa39a; font-size:.78rem; font-weight:700; }
.repair-other-book > summary::-webkit-details-marker { display:none; }
.repair-other-book > summary::before { content:'›'; width:16px; margin-right:6px; color:#77716b; font-size:1rem; transition:transform .14s ease; }
.repair-other-book[open] > summary::before { transform:rotate(90deg); }
.repair-other-book-body { display:flex; align-items:center; gap:10px; padding:0 14px 14px; }
.repair-other-book-body select { min-width:0; flex:1; height:42px; padding:0 10px; border:1px solid rgba(255,255,255,.1); border-radius:9px; outline:0; background:#111214; color:#eee8df; font-size:16px; }
.repair-toolbar { margin-top:12px; padding:12px 18px; border-top:1px solid rgba(255,255,255,.055); border-bottom:1px solid rgba(255,255,255,.055); background:rgba(20,20,22,.72); }
.repair-toolbar > div:first-child,.repair-footer > div:first-child { min-width:0; display:flex; flex-direction:column; gap:4px; }
.repair-toolbar-actions { display:flex; gap:7px; flex-wrap:wrap; justify-content:flex-end; }
#dlcRepairCopyBtn { border-color:transparent; background:transparent; color:#8f8981; }
.repair-footer { position:sticky; bottom:0; z-index:4; min-height:68px; padding:10px 18px calc(10px + env(safe-area-inset-bottom)); border-top:1px solid rgba(255,255,255,.08); background:rgba(20,20,22,.97); backdrop-filter:blur(14px); }
.repair-footer > .btn { flex:none; min-width:190px; min-height:44px; }
.repair-baseline-note { margin:14px 18px 0; padding:11px 13px; border:1px solid rgba(96,166,116,.24); border-radius:10px; background:rgba(96,166,116,.08); color:#9fd0ac; display:flex; align-items:flex-start; gap:10px; }
.repair-baseline-note > div { display:flex; flex-direction:column; gap:3px; min-width:0; }
.repair-baseline-note span { color:#aeb8b0; }
.repair-warning,.repair-blocked,.repair-error { margin:14px 18px 0; padding:11px 13px; border:1px solid rgba(226,176,72,.24); border-radius:10px; background:rgba(226,176,72,.08); color:#d9b773; }
.repair-error { border-color:rgba(211,92,92,.28); background:rgba(211,92,92,.08); color:#e39a9a; }
.repair-blocked { margin:12px 0 0; }
.repair-pending { margin:16px 18px 0; padding:14px; border:1px solid rgba(162,139,107,.22); border-radius:12px; background:rgba(162,139,107,.07); }
.repair-pending h3,.repair-pending p { margin:0 0 8px; }
.repair-pending-row { display:flex; justify-content:space-between; gap:12px; align-items:center; padding:10px 0; border-top:1px solid rgba(255,255,255,.06); }
.repair-pending-row > div { display:flex; flex-direction:column; min-width:0; }
.repair-pending-row small { color:#aaa39a; overflow-wrap:anywhere; }
.repair-candidate-list { display:flex; flex-direction:column; gap:12px; padding:16px 18px 24px; }
.repair-candidate { border:1px solid rgba(255,255,255,.08); border-radius:14px; background:rgba(255,255,255,.025); padding:14px; transition:border-color .14s ease,background .14s ease,box-shadow .14s ease; }
.repair-candidate.selected { border-color:rgba(190,164,125,.48); background:rgba(190,164,125,.075); box-shadow:inset 3px 0 0 rgba(190,164,125,.72); }
.repair-candidate-head { display:flex; align-items:center; gap:10px; }
.repair-select { flex:none; display:grid; place-items:center; width:28px; height:28px; border-radius:8px; background:rgba(255,255,255,.045); cursor:pointer; }
.repair-select input { width:18px; height:18px; accent-color:#bca27a; cursor:pointer; }
.repair-candidate.selected .repair-select { background:rgba(190,164,125,.12); box-shadow:0 0 0 1px rgba(190,164,125,.32); }
.repair-candidate-title { flex:1; min-width:0; display:flex; flex-direction:column; gap:3px; }
.repair-candidate-title strong { font-size:1rem; }
.repair-candidate-title small,.repair-muted,.repair-evidence { color:#99928a; }
.repair-item-status { flex:none; font-size:.76rem; padding:4px 8px; border-radius:999px; background:rgba(255,255,255,.06); color:#b9b1a8; }
.repair-facts { display:flex; flex-wrap:wrap; gap:7px; margin:12px 0; }
.repair-facts span { padding:5px 8px; border-radius:8px; background:rgba(255,255,255,.045); color:#aaa39a; font-size:.78rem; }
.repair-facts b { color:#eee8df; }
.repair-tech-facts { display:flex; flex-wrap:wrap; gap:6px; margin:10px 0; }
.repair-tech-facts span { padding:4px 7px; border-radius:7px; background:rgba(255,255,255,.035); color:#77716b; font-size:.7rem; }
.repair-tech-facts b { color:#aaa39a; }
.repair-details { margin-top:10px; border-top:1px solid rgba(255,255,255,.055); padding-top:9px; }
.repair-details summary { cursor:pointer; color:#827d76; font-size:.72rem; font-weight:650; }
.repair-metadata-grid { display:flex; flex-direction:column; gap:5px; margin:10px 0; }
.repair-metadata-row { display:grid; grid-template-columns:20px minmax(150px,220px) 56px minmax(0,1fr); gap:8px; align-items:center; font-size:.78rem; }
.repair-metadata-row code,.repair-match-project code,.repair-project-choice code { overflow-wrap:anywhere; color:#b7aca0; }
.repair-metadata-values { min-width:0; overflow-wrap:anywhere; color:#99928a; }
.repair-metadata-complete .repair-metadata-icon { color:#75b88a; }
.repair-metadata-missing .repair-metadata-icon { color:#d87575; }
.repair-metadata-partial .repair-metadata-icon,.repair-metadata-conflict .repair-metadata-icon { color:#d7ab5c; }
.repair-problems { margin:10px 0; padding-left:20px; color:#c9b07e; }
.repair-ok { color:#83b894; }
.repair-match-box { margin-top:12px; padding:12px; border:1px solid rgba(255,255,255,.07); border-radius:10px; background:rgba(0,0,0,.1); }
.repair-match-box.unique { border-color:rgba(96,166,116,.28); background:rgba(96,166,116,.06); }
.repair-match-project { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:4px 10px; margin-top:8px; }
.repair-match-project code { grid-column:1/-1; }
.repair-project-choice-hint { margin:10px 0 0; padding:8px 10px; border-radius:9px; background:rgba(118,109,255,.12); color:#c8c4ff; font-size:.8rem; font-weight:650; }
.repair-project-choice-hint i { margin-right:6px; }
.repair-project-candidates { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; margin-top:8px; }
.repair-project-choice { display:flex; align-items:stretch; justify-content:space-between; gap:10px; padding:0; overflow:hidden; text-align:left; border:1px solid rgba(118,109,255,.42); border-radius:10px; background:rgba(118,109,255,.08); color:inherit; cursor:pointer; transition:border-color .14s ease,background .14s ease,transform .14s ease,box-shadow .14s ease; }
.repair-project-choice:hover { border-color:rgba(143,135,255,.9); background:rgba(118,109,255,.16); transform:translateY(-1px); box-shadow:0 8px 20px rgba(0,0,0,.2); }
.repair-project-choice:focus-visible { outline:2px solid #8a82ff; outline-offset:2px; }
.repair-project-choice-copy { min-width:0; display:flex; flex:1; flex-direction:column; gap:3px; padding:11px 12px; }
.repair-project-choice small { color:#a9a3b8; }
.repair-project-choice-action { flex:none; display:flex; align-items:center; justify-content:center; gap:6px; min-width:118px; padding:10px 12px; background:rgba(118,109,255,.2); color:#ddd9ff; font-size:.78rem; font-weight:750; border-left:1px solid rgba(118,109,255,.28); }
.repair-project-choice:hover .repair-project-choice-action { background:rgba(118,109,255,.3); }
.repair-manual-search { display:flex; gap:8px; margin-top:10px; }
.repair-manual-search input { min-width:0; flex:1; border:1px solid rgba(255,255,255,.1); border-radius:9px; background:rgba(0,0,0,.18); color:#eee8df; padding:9px 10px; }

@media (max-width:640px) {
  .dlc-repair-modal .modal-content { width:calc(100vw - 12px); max-height:94vh; }
  .repair-scan-card { margin:10px 12px 0; }
  .repair-scan-summary,.repair-toolbar { align-items:stretch; flex-direction:column; }
  .repair-scan-summary .btn { width:max-content; max-width:100%; }
  .repair-other-book-body { align-items:stretch; flex-direction:column; }
  .repair-toolbar { padding:11px 12px; }
  .repair-toolbar-actions { justify-content:flex-start; }
  .repair-toolbar-actions .btn { flex:0 0 auto; }
  .repair-candidate-list { gap:9px; padding:12px 12px 18px; }
  .repair-candidate { padding:12px; border-radius:12px; }
  .repair-candidate-head { align-items:flex-start; }
  .repair-item-status { margin-top:2px; }
  .repair-footer { align-items:stretch; flex-direction:column; gap:8px; padding:9px 12px calc(9px + env(safe-area-inset-bottom)); }
  .repair-footer > div:first-child { align-items:center; font-size:.74rem; color:#8f8981; }
  .repair-footer > .btn { width:100%; min-width:0; }
  .repair-metadata-row { grid-template-columns:20px minmax(0,1fr) 52px; }
  .repair-metadata-values { grid-column:2/-1; }
  .repair-project-candidates { grid-template-columns:1fr; }
  .repair-project-choice { flex-direction:column; }
  .repair-project-choice-action { min-width:0; border-left:0; border-top:1px solid rgba(118,109,255,.28); }
  .repair-pending-row { align-items:stretch; flex-direction:column; }
  .repair-manual-search { flex-direction:column; }
}

@media (max-width:640px) {
  .mobile-tool-dock {
    left:0;
    right:0;
    bottom:0;
    width:100%;
    max-width:none;
    transform:none;
    gap:0;
    padding:5px max(6px,env(safe-area-inset-right)) calc(5px + env(safe-area-inset-bottom)) max(6px,env(safe-area-inset-left));
    border:0;
    border-top:1px solid rgba(255,255,255,.085);
    border-radius:0;
    background:rgba(22,23,26,.96);
    box-shadow:0 -10px 30px rgba(0,0,0,.28);
    backdrop-filter:blur(22px);
  }

  .mobile-tool-dock button {
    height:54px;
    flex-direction:column;
    gap:4px;
    padding:0 2px;
    border-radius:8px;
    font-size:.66rem;
  }
  .mobile-tool-dock button i { font-size:1rem; }
  .mobile-tool-dock button.active { background:rgba(162,139,107,.075); }

  .mobile-tool-sheet {
    bottom:calc(64px + env(safe-area-inset-bottom));
    width:calc(100% - 16px);
    max-height:min(68dvh,620px);
    border-radius:14px;
  }
}
`;
