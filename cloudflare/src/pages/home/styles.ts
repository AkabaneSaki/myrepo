export const homeStyles = String.raw`
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #0F172A; color: #E2E8F0; line-height: 1.5; min-height: 100vh; }
:root { --bg-color:#0F172A; --card-base:#1E293B; --card-dark:#0F172A; --card-light:#334155; --text-color:#E2E8F0; --highlight-color:#FFD700; --color-primary:#6366F1; --color-system:#3B82F6; --color-character:#10B981; --color-event:#F59E0B; --color-extension:#8B5CF6; }
.container { max-width:1400px; margin:0 auto; padding:calc(20px + env(safe-area-inset-top)) calc(20px + env(safe-area-inset-right)) calc(20px + env(safe-area-inset-bottom)) calc(20px + env(safe-area-inset-left)); }
.header { position:relative; z-index:60; display:flex; flex-direction:column; align-items:stretch; margin-bottom:32px; gap:16px; background:rgba(30,41,59,0.7); backdrop-filter:blur(8px); padding:16px 24px; border-radius:24px; border:1px solid rgba(255,255,255,0.08); }
.header-top { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; width:100%; }
.header-bottom { display:flex; justify-content:flex-start; width:100%; min-width:0; }
.header-left { display:flex; align-items:flex-start; gap:20px; flex:0 0 auto; min-width:0; }
.header-discover { display:flex; flex-direction:column; align-items:flex-start; gap:10px; width:100%; min-width:0; }
.logo h1 { font-size:1.8rem; font-weight:700; background:linear-gradient(135deg, #6366F1, #8B5CF6); -webkit-background-clip:text; -webkit-text-fill-color:transparent; display:flex; align-items:center; gap:10px; white-space:nowrap; }
.release-notice { display:inline-flex; align-items:center; gap:7px; min-height:32px; padding:6px 11px; border-radius:999px; border:1px solid rgba(245,158,11,0.42); background:rgba(120,53,15,0.22); color:#FDE68A; cursor:pointer; font:inherit; font-size:0.76rem; white-space:nowrap; transition:background 0.18s ease,border-color 0.18s ease,transform 0.18s ease; }
.release-notice:hover { background:rgba(180,83,9,0.3); border-color:rgba(251,191,36,0.7); transform:translateY(-1px); }
.release-notice i { color:#FBBF24; }
.release-notice strong { color:#FEF3C7; font-weight:700; }
.release-update-guide { display:flex; flex-direction:column; gap:16px; }
.release-update-lead { color:rgba(226,232,240,0.9); }
.release-update-steps { margin-left:22px; display:flex; flex-direction:column; gap:9px; }
.release-update-steps code { color:#C7D2FE; }
.release-update-codebox { position:relative; }
.release-update-code { display:block; width:100%; min-height:92px; resize:none; padding:14px 82px 14px 14px; border-radius:12px; background:rgba(15,23,42,0.9); border:1px solid rgba(99,102,241,0.34); color:#C7D2FE; font:0.86rem/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; white-space:pre-wrap; overflow-wrap:anywhere; user-select:text; outline:none; }
.release-update-code:focus { border-color:rgba(129,140,248,0.75); box-shadow:0 0 0 2px rgba(99,102,241,0.14); }
.release-update-copy-btn { position:absolute; top:9px; right:9px; display:inline-flex; align-items:center; gap:6px; min-height:34px; padding:6px 10px; border:1px solid rgba(129,140,248,0.45); border-radius:9px; background:rgba(30,41,59,0.96); color:#E0E7FF; font:inherit; font-size:0.78rem; cursor:pointer; }
.release-update-copy-btn:hover { background:rgba(79,70,229,0.28); border-color:rgba(129,140,248,0.75); }
.user-info { display:flex; align-items:flex-start; justify-content:flex-end; gap:16px; flex-wrap:wrap; margin-left:auto; max-width:100%; }
.header-search { display:flex; align-items:center; gap:10px; width:100%; min-width:0; max-width:none; flex:1; padding:10px 14px; border-radius:999px; background:rgba(15,23,42,0.72); border:1px solid rgba(255,255,255,0.08); }
.tag-filter { display:flex; align-items:center; justify-content:flex-start; gap:8px; flex-wrap:wrap; width:100%; }
.tag-filter-btn { border:1px solid rgba(148,163,184,0.35); background:rgba(15,23,42,0.62); color:#CBD5E1; border-radius:999px; padding:5px 12px; font-size:0.76rem; line-height:1.2; cursor:pointer; transition:background 0.18s ease, border-color 0.18s ease, color 0.18s ease, transform 0.18s ease; }
.tag-filter-btn:hover { transform:translateY(-1px); border-color:rgba(226,232,240,0.55); color:#E2E8F0; }
.tag-filter-btn.active { color:#FFFFFF; }
.tag-filter-btn.is-disabled { opacity:0.55; cursor:wait; transform:none; }
.tag-filter-btn.all.active { border-color:rgba(99,102,241,0.62); background:rgba(99,102,241,0.22); }
.tag-filter-btn.system.active { border-color:rgba(59,130,246,0.62); background:rgba(59,130,246,0.22); }
.tag-filter-btn.character.active { border-color:rgba(16,185,129,0.62); background:rgba(16,185,129,0.22); }
.tag-filter-btn.event.active { border-color:rgba(245,158,11,0.62); background:rgba(245,158,11,0.22); }
.tag-filter-btn.extension.active { border-color:rgba(139,92,246,0.62); background:rgba(139,92,246,0.22); }
  .toggle-group { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  .sort-select { display:inline-flex; align-items:center; gap:8px; padding:6px 12px; border-radius:999px; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.08); font-size:0.82rem; white-space:nowrap; }
  .sort-select span { display:inline-flex; align-items:center; gap:6px; color:#CBD5E1; }
  .sort-select select { background:transparent; border:none; color:#E2E8F0; outline:none; font-size:0.82rem; cursor:pointer; }
  .sort-select select option { color:#0F172A; }
  .tavern-status { display:inline-flex; align-items:center; gap:8px; padding:6px 12px; border-radius:999px; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.08); font-size:0.82rem; white-space:nowrap; }
  .tavern-status--connected { color:#86EFAC; border-color:rgba(34,197,94,0.35); }
  .tavern-status--connecting { color:#FDE68A; border-color:rgba(245,158,11,0.35); }
  .tavern-status--disconnected { color:#CBD5E1; }
  .tavern-status--error { color:#FCA5A5; border-color:rgba(239,68,68,0.35); }
  .header-search input { width:100%; background:transparent; border:none; color:#E2E8F0; outline:none; font-size:0.95rem; }

.header-search i { color:#94A3B8; }
.avatar,.detail-author-avatar,.author-avatar { border-radius:50%; object-fit:cover; }
.avatar { width:40px; height:40px; border:2px solid #6366F1; }
.author-avatar { width:24px; height:24px; }
.detail-author-avatar { width:36px; height:36px; border:2px solid rgba(99,102,241,0.4); }
.btn { background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.12); border-radius:30px; padding:8px 20px; color:#E2E8F0; font-weight:500; cursor:pointer; transition:all 0.2s; display:inline-flex; align-items:center; gap:8px; white-space:nowrap; }
.btn-primary { background:linear-gradient(135deg, #6366F1, #4F46E5); border:none; box-shadow:0 4px 15px rgba(99,102,241,0.4); }
.btn-primary:hover { transform:translateY(-2px); box-shadow:0 6px 20px rgba(99,102,241,0.5); }
.btn-outline:hover,.action-btn:hover { background:rgba(99,102,241,0.2); border-color:#6366F1; }
.workshop-close-btn { min-height:44px; padding:8px 14px; border-color:rgba(248,113,113,0.45); background:rgba(127,29,29,0.22); color:#FECACA; }
.workshop-close-btn:hover { background:rgba(185,28,28,0.42); border-color:#F87171; color:#FFFFFF; transform:translateY(-1px); }
.is-loading { position:relative; opacity:0.92; cursor:progress; }
.is-loading i.fa-spinner { animation:cw-spin 0.8s linear infinite; }
.is-loading::after { content:''; position:absolute; inset:0; border-radius:inherit; pointer-events:none; box-shadow:inset 0 0 0 1px rgba(255,255,255,0.08), 0 0 24px rgba(99,102,241,0.18); }
@keyframes cw-spin { from { transform:rotate(0deg); } to { transform:rotate(360deg); } }
.badge-admin { background:#6366F1; padding:2px 8px; border-radius:30px; }
.badge-rejected { background:#B91C1C; }
.user-menu { position:relative; }
.user-menu-trigger { display:flex; align-items:center; gap:10px; background:transparent; border:none; color:#E2E8F0; cursor:pointer; }
.user-menu-name { max-width:160px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.user-menu-dropdown { position:absolute; top:calc(100% + 10px); right:0; min-width:180px; background:rgba(15,23,42,0.96); border:1px solid rgba(255,255,255,0.08); border-radius:14px; padding:8px; display:none; box-shadow:0 18px 40px rgba(0,0,0,0.35); z-index:20; }
.user-menu.open .user-menu-dropdown { display:flex; flex-direction:column; gap:6px; }
.user-menu-item { width:100%; border:none; background:rgba(255,255,255,0.04); color:#E2E8F0; border-radius:10px; padding:10px 12px; text-align:left; cursor:pointer; display:flex; align-items:center; gap:8px; }
.user-menu-item:hover { background:rgba(99,102,241,0.18); }
.user-menu-item.active { background:rgba(99,102,241,0.22); color:#C7D2FE; }
.sort-menu-trigger { padding:10px 12px; border-radius:10px; background:rgba(255,255,255,0.04); }
.sort-menu-trigger:hover { background:rgba(99,102,241,0.18); }
.sort-menu .user-menu-dropdown { min-width:210px; }
.projects-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:24px; margin-top:24px; }
.project-load-more { margin-top:28px; display:flex; flex-direction:column; align-items:center; gap:10px; }
.project-load-more-btn { min-width:220px; justify-content:center; }
.project-load-more-meta { font-size:0.82rem; color:rgba(226,232,240,0.68); }
.project-card { background:linear-gradient(145deg, #1E293B, #0F172A); border:1px solid rgba(255,255,255,0.08); border-radius:20px; overflow:hidden; transition:all 0.25s; display:flex; flex-direction:column; cursor:pointer; }
  .project-card:hover { transform:translateY(-6px); border-color:rgba(99,102,241,0.5); box-shadow:0 20px 25px -5px rgba(0,0,0,0.5), 0 0 0 1px rgba(99,102,241,0.3); }
  .project-card:focus-visible { outline:2px solid #818CF8; outline-offset:3px; }
  .card-cover { height:160px; background-size:cover; background-position:center; background-color:#0F172A; position:relative; }
  .card-overlay-actions { position:absolute; right:12px; bottom:12px; display:flex; align-items:center; gap:8px; flex-wrap:wrap; justify-content:flex-end; }
  .icon-stat-btn { display:inline-flex; align-items:center; gap:6px; padding:6px 10px; border-radius:999px; background:rgba(15,23,42,0.82); border:1px solid rgba(255,255,255,0.1); color:#E2E8F0; font-size:0.78rem; backdrop-filter:blur(8px); position:relative; transition:transform 0.18s ease, background 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease, color 0.18s ease; }
  .like-btn { cursor:pointer; }
  .like-btn:hover { transform:translateY(-1px); box-shadow:0 10px 24px rgba(15,23,42,0.42); background:rgba(127,29,29,0.36); border-color:rgba(248,113,113,0.72); color:#FECACA; }
  .icon-stat-btn.liked { color:#FCA5A5; border-color:rgba(239,68,68,0.35); }
  .icon-stat-btn__hint { position:absolute; left:50%; bottom:calc(100% + 10px); transform:translateX(-50%) translateY(4px); pointer-events:none; opacity:0; padding:6px 10px; border-radius:10px; white-space:nowrap; background:rgba(15,23,42,0.96); border:1px solid rgba(255,255,255,0.12); color:#E2E8F0; font-size:0.72rem; line-height:1; box-shadow:0 12px 30px rgba(0,0,0,0.35); transition:opacity 0.18s ease, transform 0.18s ease; }
  .icon-stat-btn__hint::after { content:''; position:absolute; left:50%; top:100%; transform:translateX(-50%); border:6px solid transparent; border-top-color:rgba(15,23,42,0.96); }
  .like-btn:hover .icon-stat-btn__hint { opacity:1; transform:translateX(-50%) translateY(0); }
  .icon-stat-btn--static { cursor:default; opacity:0.9; }
  .icon-stat-btn.is-disabled { opacity:0.5; cursor:not-allowed; box-shadow:none; transform:none; }
  .icon-stat-btn.is-disabled:hover { background:rgba(15,23,42,0.82); border-color:rgba(255,255,255,0.1); color:#E2E8F0; transform:none; box-shadow:none; }
  .icon-stat-btn.is-disabled:hover .icon-stat-btn__hint { opacity:1; transform:translateX(-50%) translateY(0); }
  .card-content { padding:16px; display:flex; flex-direction:column; gap:12px; }

.card-row1,.card-meta,.detail-title-row { display:flex; justify-content:space-between; align-items:center; gap:12px; }
.type-badge { padding:4px 12px; border-radius:30px; font-size:0.7rem; font-weight:600; text-transform:uppercase; background:rgba(59,130,246,0.2); color:#60A5FA; border:1px solid rgba(59,130,246,0.3); }
.type-badge.system { background:rgba(59,130,246,0.2); color:#60A5FA; }
.type-badge.character { background:rgba(16,185,129,0.2); color:#34D399; }
.type-badge.event { background:rgba(245,158,11,0.2); color:#FBBF24; }
.type-badge.extension { background:rgba(139,92,246,0.2); color:#A78BFA; }
  .project-name { font-weight:600; font-size:1rem; line-height:1.4; flex:1; text-align:right; }
  .card-author,.detail-author,.detail-meta,.detail-section-title,.detail-keywords { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  .install-badge { display:inline-flex; align-items:center; gap:6px; padding:4px 10px; border-radius:999px; font-size:0.72rem; color:#BBF7D0; background:rgba(34,197,94,0.12); border:1px solid rgba(34,197,94,0.3); margin-left:auto; }
  .install-badge--update { color:#FDE68A; border-color:rgba(245,158,11,0.35); background:rgba(245,158,11,0.12); }
  .project-tags,.detail-keyword-list { display:flex; flex-wrap:wrap; gap:8px; }
  .tag { background:rgba(255,255,255,0.08); padding:2px 10px; border-radius:30px; font-size:0.7rem; }
.tag-system-ejs { color:#E9D5FF; background:rgba(147,51,234,.16); border:1px solid rgba(192,132,252,.42); box-shadow:inset 0 0 0 1px rgba(255,255,255,.03); }
.tag-system-artwork { color:#BBF7D0; background:rgba(22,163,74,.14); border:1px solid rgba(74,222,128,.38); box-shadow:inset 0 0 0 1px rgba(255,255,255,.03); }
  .card-meta { font-size:0.75rem; opacity:0.7; }
  .card-meta--version { align-items:center; }
  .version-block { display:inline-flex; align-items:center; gap:8px; flex-wrap:wrap; }
  .version-diff { display:inline-flex; align-items:center; gap:6px; }
  .version-diff__from { color:#CBD5E1; }
  .version-diff__to { color:#FDE68A; font-weight:600; }
  .inline-update-btn { padding:4px 10px; font-size:0.72rem; border-radius:999px; }
  .card-actions,.admin-actions,.admin-card-actions { display:flex; gap:8px; justify-content:space-between; }
  .admin-actions--draft { flex-wrap:wrap; }
  .admin-actions--draft > * { flex:1 1 calc(50% - 4px); }
  .card-actions--primary > * { flex:1; }
  .install-btn { flex:1; }
  .edit-btn,.delete-btn,.delete-project-btn { flex:1; }
  .action-btn { background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.1); border-radius:8px; padding:6px 12px; color:inherit; cursor:pointer; transition:0.2s; font-size:0.8rem; display:inline-flex; align-items:center; justify-content:center; gap:6px; white-space:nowrap; }
  .action-btn.is-disabled,.btn.is-disabled { opacity:0.45; cursor:not-allowed; pointer-events:none; }

  .action-btn.is-loading { opacity:0.75; cursor:wait; }
  .inline-loading-spinner,.loading-spinner { display:inline-block; border-radius:50%; border:2px solid rgba(255,255,255,0.2); border-top-color:#C7D2FE; animation:spin 0.8s linear infinite; }
  .inline-loading-spinner { width:14px; height:14px; }
  .loading-spinner { width:32px; height:32px; }
  @keyframes spin { from { transform:rotate(0deg); } to { transform:rotate(360deg); } }
  .toggle-switch { display:flex; align-items:center; gap:8px; background:rgba(255,255,255,0.06); padding:4px 12px; border-radius:30px; cursor:pointer; }

.toggle-switch span { white-space:nowrap; }
.toggle-switch input { width:40px; height:20px; appearance:none; background:#334155; border-radius:20px; position:relative; cursor:pointer; }
.toggle-switch input:checked { background:#6366F1; }
.toggle-switch input::before { content:''; width:16px; height:16px; background:white; border-radius:50%; position:absolute; top:2px; left:2px; transition:0.2s; }
.toggle-switch input:checked::before { left:22px; }
.modal-overlay { position:fixed; inset:0; background:rgba(0,0,0,0.8); backdrop-filter:blur(8px); display:flex; justify-content:center; align-items:flex-start; padding:40px 20px; z-index:9999; overflow-y:auto; }
.modal-content { background:var(--bg-color); color:var(--text-color); border-radius:24px; max-width:860px; width:100%; max-height:calc(100vh - 80px); display:flex; flex-direction:column; overflow:hidden; border:1px solid rgba(255,255,255,0.12); box-shadow:0 25px 50px -12px black; animation:slideUp 0.3s ease; }
@keyframes slideUp { from { opacity:0; transform:translateY(30px); } to { opacity:1; transform:translateY(0); } }
.modal-header { display:flex; justify-content:space-between; align-items:center; padding:24px 24px 12px; border-bottom:1px solid rgba(255,255,255,0.08); flex-shrink:0; }
.modal-header h2 { font-size:1.5rem; display:flex; align-items:center; gap:8px; }
.close-btn { width:44px; height:44px; display:inline-flex; align-items:center; justify-content:center; flex:none; background:none; border:none; border-radius:12px; color:inherit; font-size:1.4rem; cursor:pointer; opacity:0.72; touch-action:manipulation; }
.close-btn:hover { opacity:1; }
.modal-body { flex:1; overflow-y:auto; padding:20px 24px 24px; }
.detail-loading { min-height:240px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:16px; color:rgba(226,232,240,0.9); }
.detail-loading-text { font-size:0.95rem; }
.form-group { margin-bottom:16px; }
.form-group label { display:block; margin-bottom:6px; font-weight:500; opacity:0.8; }
.form-group input,.form-group textarea,.form-group select { width:100%; padding:10px 12px; background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.1); border-radius:8px; color:inherit; }
.form-hint { margin-top:6px; font-size:.82rem; line-height:1.45; color:rgba(226,232,240,.62); }
.file-drop { border:2px dashed rgba(255,255,255,0.2); border-radius:12px; padding:30px; text-align:center; cursor:pointer; transition:0.2s; }
.file-drop:hover { border-color:#6366F1; background:rgba(99,102,241,0.1); }
.upload-file-preview { margin-top:10px; display:flex; flex-direction:column; gap:10px; }
.upload-file-preview[hidden] { display:none; }
.upload-file-preview .detail-section { margin:0; }
.upload-preview-summary { display:flex; justify-content:space-between; align-items:center; gap:12px; padding:9px 11px; border-radius:10px; border:1px solid rgba(99,102,241,.22); background:rgba(30,41,59,.52); color:rgba(226,232,240,.78); font-size:.82rem; }
.upload-preview-summary span { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.upload-preview-summary strong { flex:none; color:#E0E7FF; font-size:.8rem; }
.upload-preview-files { display:flex; flex-wrap:wrap; gap:7px; }
.upload-preview-file-chip { display:inline-flex; align-items:center; gap:6px; max-width:100%; padding:6px 8px; border-radius:999px; border:1px solid rgba(148,163,184,.18); background:rgba(15,23,42,.58); color:rgba(226,232,240,.78); font-size:.76rem; }
.upload-preview-file-chip b { color:#C7D2FE; font-weight:600; }
.upload-preview-error { display:flex; align-items:center; gap:8px; padding:10px 12px; border-radius:10px; border:1px solid rgba(248,113,113,.32); background:rgba(127,29,29,.18); color:#FECACA; font-size:.84rem; }
.upload-cover-image { display:block; width:100%; height:220px; object-fit:cover; object-position:center; border-radius:18px; border:1px solid rgba(255,255,255,.08); background:#0F172A; }
.edit-current-content { margin:18px 0 20px; display:flex; flex-direction:column; gap:12px; }
.edit-current-content .detail-section { margin:0; }
.edit-current-cover { border:1px solid rgba(148,163,184,.18); border-radius:12px; overflow:hidden; background:rgba(15,23,42,.46); }
.edit-current-cover .detail-section-title { padding:10px 12px; margin:0; }
.edit-current-cover img { display:block; width:100%; max-height:220px; object-fit:cover; }
.edit-current-cover--empty .empty-state { padding:18px 12px; }
.form-submit-btn { width:100%; padding:12px; justify-content:center; }
.toast { position:fixed; bottom:20px; right:20px; background:#1E293B; color:white; padding:12px 24px; border-radius:30px; box-shadow:0 8px 20px black; z-index:10000; border-left:4px solid #6366F1; }
.admin-review-modal,.admin-review-detail-modal { max-width:1040px; }
.admin-review-queue { display:flex; flex-direction:column; gap:14px; }
.admin-review-queue-summary { display:flex; justify-content:space-between; gap:12px; align-items:center; padding:12px 14px; border:1px solid rgba(99,102,241,0.22); background:rgba(30,41,59,0.52); border-radius:14px; color:rgba(226,232,240,0.78); font-size:0.86rem; }
.admin-review-queue-summary strong { color:#E0E7FF; font-size:1.05rem; }
.admin-review-list { display:flex; flex-direction:column; gap:12px; }
.admin-review-card { background:linear-gradient(145deg,rgba(30,41,59,0.92),rgba(15,23,42,0.88)); border:1px solid rgba(148,163,184,0.16); border-radius:16px; padding:16px; box-shadow:0 10px 26px rgba(0,0,0,0.14); transition:transform .18s ease,border-color .18s ease,background .18s ease; }
.admin-review-card:hover { border-color:rgba(129,140,248,0.35); }
.admin-review-card.is-skipped { animation:adminReviewSkip .45s ease; }
@keyframes adminReviewSkip { 0% { transform:translateX(0); opacity:1; } 45% { transform:translateX(18px); opacity:.55; } 100% { transform:translateX(0); opacity:1; } }
.admin-review-card-head { display:flex; align-items:flex-start; gap:12px; }
.admin-review-position { flex:none; min-width:46px; padding:5px 8px; border-radius:999px; text-align:center; font-size:.72rem; font-weight:700; color:#C7D2FE; background:rgba(99,102,241,.13); border:1px solid rgba(99,102,241,.25); }
.admin-review-card-heading { min-width:0; flex:1; }
.admin-review-title { font-size:1.08rem; font-weight:750; line-height:1.35; word-break:break-word; }
.admin-review-author { margin-top:4px; font-size:.8rem; color:rgba(226,232,240,.68); display:flex; align-items:center; gap:6px; }
.admin-review-state { flex:none; padding:5px 9px; border-radius:999px; font-size:.72rem; color:#FDE68A; background:rgba(245,158,11,.1); border:1px solid rgba(245,158,11,.22); }
.admin-review-meta { display:flex; flex-wrap:wrap; gap:8px; margin-top:12px; }
.admin-review-meta-item { display:inline-flex; align-items:center; gap:6px; max-width:100%; padding:5px 9px; border-radius:999px; background:rgba(255,255,255,.045); border:1px solid rgba(255,255,255,.07); color:rgba(226,232,240,.7); font-size:.75rem; }
.admin-review-desc-preview { margin:12px 0 14px; color:rgba(226,232,240,.82); line-height:1.55; display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:3; overflow:hidden; white-space:pre-wrap; word-break:break-word; }
.admin-review-card-actions { display:flex; justify-content:flex-end; gap:8px; }
.admin-review-card-actions .btn { min-width:118px; justify-content:center; }
.admin-review-detail-shell { display:flex; flex-direction:column; gap:16px; min-height:0; }
.admin-review-summary { display:flex; flex-direction:column; gap:14px; padding:18px; border-radius:18px; border:1px solid rgba(148,163,184,.16); background:linear-gradient(145deg,rgba(30,41,59,.92),rgba(15,23,42,.88)); }
.admin-review-summary-head { display:flex; align-items:flex-start; gap:12px; }
.admin-review-summary-heading { min-width:0; flex:1; }
.admin-review-summary-heading h3 { margin:0 0 5px; font-size:1.25rem; line-height:1.35; }
.admin-review-summary-heading > div { color:rgba(226,232,240,.68); font-size:.82rem; }
.admin-review-signals { display:flex; flex-wrap:wrap; gap:8px; }
.admin-review-signal { display:inline-flex; align-items:center; gap:6px; padding:6px 10px; border-radius:999px; font-size:.76rem; color:#CBD5E1; background:rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.08); }
.admin-review-signal--info { color:#C7D2FE; border-color:rgba(99,102,241,.34); background:rgba(99,102,241,.1); }
.admin-review-signal--ejs { color:#E9D5FF; border-color:rgba(192,132,252,.42); background:rgba(147,51,234,.15); }
.admin-review-signal--good { color:#BBF7D0; border-color:rgba(34,197,94,.3); background:rgba(34,197,94,.1); }
.admin-review-signal--warning { color:#FDE68A; border-color:rgba(245,158,11,.34); background:rgba(245,158,11,.1); }
.admin-review-description { border:1px solid rgba(255,255,255,.08); border-radius:14px; background:rgba(15,23,42,.58); overflow:hidden; }
.admin-review-description summary { display:flex; justify-content:space-between; gap:12px; align-items:center; padding:11px 13px; cursor:pointer; font-weight:650; color:#E2E8F0; }
.admin-review-description summary::-webkit-details-marker { display:none; }
.admin-review-description-hint { font-size:.72rem; font-weight:500; color:rgba(226,232,240,.5); }
.admin-review-description-body { max-height:260px; overflow:auto; padding:0 13px 13px; white-space:pre-wrap; word-break:break-word; color:rgba(226,232,240,.8); line-height:1.55; }
.admin-review-sticky-actions { position:sticky; bottom:0; z-index:4; display:flex; justify-content:flex-end; gap:8px; padding:12px; border-radius:14px; border:1px solid rgba(148,163,184,.16); background:rgba(15,23,42,.92); backdrop-filter:blur(12px); box-shadow:0 -12px 28px rgba(0,0,0,.22); }
.admin-review-sticky-actions .btn { min-width:108px; justify-content:center; }
.admin-review-approve-btn { color:#DCFCE7; border:1px solid rgba(34,197,94,.38); background:rgba(22,163,74,.24); }
.admin-review-approve-btn:hover { background:rgba(22,163,74,.4); }
.admin-review-reject-btn { color:#FECACA; border:1px solid rgba(248,113,113,.36); background:rgba(185,28,28,.22); }
.admin-review-reject-btn:hover { background:rgba(185,28,28,.4); }
.admin-review-diff-summary { padding:16px; border-radius:16px; border:1px solid rgba(99,102,241,.28); background:linear-gradient(145deg,rgba(49,46,129,.18),rgba(15,23,42,.78)); display:flex; flex-direction:column; gap:12px; }
.admin-review-diff-summary-head { display:flex; justify-content:space-between; gap:12px; align-items:center; color:#CBD5E1; }
.admin-review-diff-summary-head strong { font-size:1.35rem; color:#E0E7FF; }
.admin-review-diff-summary-head span { font-size:.8rem; color:rgba(226,232,240,.58); }
.admin-review-diff-counts { display:flex; flex-wrap:wrap; gap:8px; }
.admin-review-diff-counts span,.admin-review-diff-status { display:inline-flex; align-items:center; gap:5px; padding:5px 9px; border-radius:999px; font-size:.75rem; font-weight:750; border:1px solid transparent; }
.admin-review-diff-counts .added,.admin-review-diff-status--added { color:#BBF7D0; background:rgba(22,163,74,.12); border-color:rgba(34,197,94,.3); }
.admin-review-diff-counts .modified,.admin-review-diff-status--modified { color:#FDE68A; background:rgba(217,119,6,.12); border-color:rgba(245,158,11,.3); }
.admin-review-diff-counts .deleted,.admin-review-diff-status--deleted { color:#FECACA; background:rgba(185,28,28,.13); border-color:rgba(248,113,113,.3); }
.admin-review-diff-counts .unchanged,.admin-review-diff-status--unchanged { color:#CBD5E1; background:rgba(100,116,139,.12); border-color:rgba(148,163,184,.22); }
.admin-review-risk-delta { display:flex; flex-direction:column; gap:8px; padding-top:10px; border-top:1px solid rgba(255,255,255,.07); }
.admin-review-risk-delta strong { font-size:.8rem; color:#E2E8F0; }
.admin-review-risk-delta > div { display:flex; flex-wrap:wrap; gap:7px; }
.admin-review-risk-chip { display:inline-flex; align-items:center; gap:6px; padding:5px 9px; border-radius:999px; font-size:.74rem; }
.admin-review-risk-chip--warning { color:#FDE68A; background:rgba(217,119,6,.11); border:1px solid rgba(245,158,11,.28); }
.admin-review-risk-chip--good { color:#BBF7D0; background:rgba(22,163,74,.1); border:1px solid rgba(34,197,94,.25); }
.admin-review-risk-chip--danger { color:#FECACA; background:rgba(185,28,28,.11); border:1px solid rgba(248,113,113,.28); }
.admin-review-diff-section { display:flex; flex-direction:column; gap:10px; }
.admin-review-diff-list { display:flex; flex-direction:column; gap:10px; }
.admin-review-diff-entry { overflow:hidden; border-radius:14px; border:1px solid rgba(148,163,184,.15); background:rgba(15,23,42,.72); }
.admin-review-diff-entry--added { border-color:rgba(34,197,94,.24); }
.admin-review-diff-entry--modified { border-color:rgba(245,158,11,.24); }
.admin-review-diff-entry--deleted { border-color:rgba(248,113,113,.24); }
.admin-review-diff-entry > summary { list-style:none; cursor:pointer; display:grid; grid-template-columns:auto minmax(120px,1fr) auto; gap:10px; align-items:center; padding:11px 12px; }
.admin-review-diff-entry > summary::-webkit-details-marker { display:none; }
.admin-review-diff-entry-title { min-width:0; font-weight:720; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.admin-review-diff-fields { font-size:.72rem; color:rgba(226,232,240,.52); text-align:right; }
.admin-review-diff-entry-body { border-top:1px solid rgba(255,255,255,.06); }
.admin-review-diff-code { overflow:auto; max-height:520px; padding:8px 0; background:#0B1120; font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:.76rem; line-height:1.5; }
.admin-review-diff-line { display:grid; grid-template-columns:26px minmax(max-content,1fr); min-width:max-content; }
.admin-review-diff-line > span { user-select:none; text-align:center; color:rgba(226,232,240,.35); }
.admin-review-diff-line code { padding:1px 14px 1px 4px; white-space:pre; color:#CBD5E1; }
.admin-review-diff-line--add { background:rgba(22,163,74,.13); }
.admin-review-diff-line--add > span,.admin-review-diff-line--add code { color:#BBF7D0; }
.admin-review-diff-line--del { background:rgba(185,28,28,.14); }
.admin-review-diff-line--del > span,.admin-review-diff-line--del code { color:#FECACA; }
.admin-review-diff-line--same code { color:rgba(203,213,225,.62); }
.admin-review-diff-skip { padding:5px 14px 5px 30px; color:#818CF8; background:rgba(79,70,229,.08); font-size:.72rem; }
.admin-review-diff-empty,.admin-review-no-changes { padding:16px; text-align:center; color:rgba(226,232,240,.58); border:1px dashed rgba(148,163,184,.16); border-radius:12px; }
.admin-review-unchanged { border:1px solid rgba(148,163,184,.13); border-radius:14px; background:rgba(30,41,59,.42); overflow:hidden; }
.admin-review-unchanged > summary { list-style:none; cursor:pointer; padding:11px 13px; display:flex; justify-content:space-between; gap:10px; align-items:center; color:#CBD5E1; }
.admin-review-unchanged > summary::-webkit-details-marker { display:none; }
.admin-review-unchanged > summary small { color:rgba(226,232,240,.46); }
.admin-review-unchanged-titles { display:flex; flex-wrap:wrap; gap:6px; padding:0 13px 11px; }
.admin-review-unchanged-titles span { padding:4px 8px; border-radius:8px; background:rgba(255,255,255,.045); color:rgba(226,232,240,.68); font-size:.72rem; }
.admin-review-load-unchanged { margin:0 13px 13px; }
.admin-review-unchanged [data-admin-unchanged-content] { padding:0 13px 13px; }

.admin-list-item,.admin-card { background:rgba(30,41,59,0.8); border-radius:12px; padding:12px; margin-bottom:12px; }
.admin-list-item { display:flex; justify-content:space-between; align-items:center; gap:12px; }
.admin-card-title { font-weight:bold; margin-bottom:4px; }
.admin-card-desc { margin:8px 0; }
  .detail-panel,.detail-summary,.detail-section,.detail-entry-meta { display:flex; flex-direction:column; gap:16px; }
  .detail-panel-scroll { overflow-y:auto; padding-right:4px; }
  .detail-cover { height:220px; border-radius:18px; background-size:cover; background-position:center; background-color:#0F172A; border:1px solid rgba(255,255,255,0.08); overflow:hidden; box-shadow:inset 0 -80px 120px rgba(15,23,42,0.35); }
  .detail-summary { padding:20px; background:linear-gradient(145deg, rgba(30,41,59,0.95), rgba(15,23,42,0.92)); border:1px solid rgba(255,255,255,0.08); border-radius:20px; }
  .detail-summary--split { display:grid; grid-template-columns:minmax(0, 1fr) 220px; gap:20px; align-items:start; }
  .detail-summary-main { display:flex; flex-direction:column; gap:16px; min-width:0; }
  .detail-actions-panel { display:flex; flex-direction:column; gap:12px; padding:16px; border-radius:16px; background:rgba(15,23,42,0.72); border:1px solid rgba(255,255,255,0.08); }
  .detail-install-btn,.detail-update-btn { justify-content:center; width:100%; }

.detail-card-row { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
.detail-card-row-title { align-items:flex-start; }
.detail-tags-row { margin-top:2px; }
.detail-project-name { font-size:1.6rem; font-weight:700; line-height:1.25; word-break:break-word; }
.detail-meta-row { font-size:0.82rem; color:rgba(226,232,240,0.75); }
.detail-meta-item { display:inline-flex; align-items:center; gap:6px; padding:6px 10px; border-radius:999px; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.08); }
.detail-description,.detail-entry-content { border-radius:16px; background:rgba(15,23,42,0.72); border:1px solid rgba(255,255,255,0.06); color:rgba(226,232,240,0.88); white-space:pre-wrap; word-break:break-word; }
.entry-behavior-meta { display:flex; flex-wrap:wrap; gap:7px; padding:10px 12px; border-radius:12px; background:rgba(14,116,144,.08); border:1px solid rgba(34,211,238,.16); }
.entry-behavior-meta span { display:inline-flex; align-items:center; gap:5px; padding:4px 8px; border-radius:999px; background:rgba(255,255,255,.05); color:rgba(224,242,254,.82); font-size:.72rem; line-height:1.2; }
.admin-review-diff-entry-body > .entry-behavior-meta { margin:10px 10px 0; }
.detail-description { padding:16px 18px; }
.external-links-section { gap:12px; }
.external-links-note { display:flex; align-items:flex-start; gap:8px; padding:10px 12px; border-radius:12px; background:rgba(245,158,11,.11); border:1px solid rgba(251,191,36,.38); color:#FDE68A; font-size:.78rem; font-weight:600; line-height:1.45; }
.external-links-note i { margin-top:2px; flex:none; color:#FBBF24; }
.external-link-groups { display:flex; flex-direction:column; gap:8px; }
.external-link-domain { overflow:hidden; border:1px solid rgba(148,163,184,.14); border-radius:12px; background:rgba(15,23,42,.6); }
.external-link-domain > summary { list-style:none; cursor:pointer; display:flex; justify-content:space-between; align-items:center; gap:12px; padding:10px 12px; color:#E2E8F0; font-size:.82rem; font-weight:650; }
.external-link-domain > summary::-webkit-details-marker { display:none; }
.external-link-domain > summary span { display:inline-flex; align-items:center; gap:7px; min-width:0; }
.external-link-domain > summary span:first-child { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.external-link-domain > summary span:last-child { flex:none; color:rgba(226,232,240,.55); font-size:.72rem; }
.external-link-list { display:flex; flex-direction:column; gap:8px; padding:0 10px 10px; }
.external-link-item { min-width:0; padding:10px; border-radius:10px; background:rgba(2,6,23,.48); border:1px solid rgba(255,255,255,.05); }
.external-link-item code { display:block; max-width:100%; overflow-wrap:anywhere; white-space:pre-wrap; color:#BFDBFE; font-size:.76rem; line-height:1.45; user-select:text; }
.external-link-sources { display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; }
.external-link-sources span { display:inline-flex; max-width:100%; padding:3px 7px; border-radius:999px; background:rgba(255,255,255,.05); color:rgba(226,232,240,.62); font-size:.68rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.detail-entry-list { display:flex; flex-direction:column; gap:12px; }
.entry-item { border:1px solid rgba(255,255,255,0.1); border-radius:12px; overflow:hidden; background:rgba(15,23,42,0.55); }
.entry-header { background:rgba(0,0,0,0.3); padding:12px 14px; cursor:pointer; display:flex; align-items:center; gap:8px; font-weight:500; }
.entry-title { min-width:0; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.entry-remove-btn { flex:none; width:36px; height:36px; margin-left:auto; display:inline-flex; align-items:center; justify-content:center; border-radius:9px; border:1px solid rgba(248,113,113,0.38); background:rgba(127,29,29,0.28); color:#FCA5A5; cursor:pointer; }
.entry-remove-btn:hover { background:rgba(185,28,28,0.48); border-color:rgba(248,113,113,0.72); color:#FFF; }
.entry-remove-btn i { transform:none !important; font-size:0.82rem; }
.entry-header i { font-size:0.8rem; transition:transform 0.2s; }
.entry-header.open i { transform:rotate(90deg); }
.entry-content { padding:0 14px; max-height:0; overflow:hidden; transition:max-height 0.3s ease, padding 0.3s ease, margin 0.3s ease; }
.entry-content.open { padding:0 14px 14px; margin-top:2px; max-height:280px; overflow-y:auto; }
.strategy-badge { display:inline-block; width:24px; text-align:center; font-weight:bold; }
.strategy-constant { color:#3B82F6; }
.strategy-selective { color:#10B981; }
.detail-keywords-block { display:flex; flex-direction:column; gap:10px; padding:12px; border:1px solid rgba(99,102,241,0.28); border-radius:14px; background:rgba(30,41,59,0.5); }
.detail-keywords-title { font-size:0.78rem; font-weight:700; letter-spacing:0.08em; color:#C7D2FE; text-transform:uppercase; }
.detail-keyword-list { margin-top:6px; }
.keyword-chip { display:inline-flex; align-items:center; padding:4px 10px; border-radius:999px; border:1px solid rgba(99,102,241,0.6); background:rgba(99,102,241,0.08); color:#C7D2FE; font-size:0.78rem; line-height:1.2; box-shadow:inset 0 0 0 1px rgba(255,255,255,0.04); }
.detail-entry-content { padding:14px; }
  .empty-state { padding:18px; border-radius:14px; border:1px dashed rgba(255,255,255,0.14); color:rgba(226,232,240,0.72); text-align:center; }
  .update-modal { display:flex; flex-direction:column; gap:20px; }
  .update-diff-group { display:flex; flex-direction:column; gap:16px; }
  .update-modal-actions { display:flex; justify-content:flex-end; gap:12px; padding-top:8px; }
  .install-worldbook-form { display:flex; flex-direction:column; gap:18px; }
  .install-target-switch { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); overflow:hidden; border:1px solid rgba(148,163,184,.22); border-radius:14px; background:rgba(15,23,42,.7); }
  .install-target-option { min-height:48px; justify-content:center; gap:8px; border:0; border-radius:0; background:transparent; color:rgba(226,232,240,.72); box-shadow:none; }
  .install-target-option + .install-target-option { border-left:1px solid rgba(148,163,184,.18); }
  .install-target-option:hover:not(:disabled) { background:rgba(99,102,241,.09); color:#E0E7FF; transform:none; box-shadow:none; }
  .install-target-option.active { background:rgba(99,102,241,.2); color:#C7D2FE; box-shadow:inset 0 0 0 1px rgba(129,140,248,.28); }
  .install-target-option:disabled { cursor:not-allowed; opacity:.4; }
  .install-additional-panel { display:flex; flex-direction:column; gap:10px; }
  .install-additional-panel[hidden] { display:none !important; }
  .install-worldbook-search-wrap { position:relative; }
  .install-worldbook-search-wrap > i { position:absolute; left:13px; top:50%; transform:translateY(-50%); color:rgba(148,163,184,.65); pointer-events:none; }
  .install-worldbook-search-wrap input { width:100%; padding-left:38px; }
  .install-worldbook-list { display:flex; flex-direction:column; gap:8px; max-height:220px; overflow-y:auto; padding:2px; }
  .install-worldbook-option { width:100%; display:grid; grid-template-columns:auto minmax(0,1fr) auto; align-items:center; gap:10px; padding:11px 12px; border:1px solid rgba(148,163,184,.16); border-radius:11px; background:rgba(15,23,42,.55); color:#E2E8F0; text-align:left; cursor:pointer; }
  .install-worldbook-option span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .install-worldbook-option > i:last-child { opacity:0; color:#A7F3D0; }
  .install-worldbook-option:hover { border-color:rgba(129,140,248,.38); background:rgba(99,102,241,.08); }
  .install-worldbook-option.active { border-color:rgba(52,211,153,.48); background:rgba(16,185,129,.1); }
  .install-worldbook-option.active > i:last-child { opacity:1; }
  .install-worldbook-empty { padding:18px 12px; border:1px dashed rgba(148,163,184,.18); border-radius:11px; color:rgba(203,213,225,.62); text-align:center; }
  .install-submit-btn { width:100%; justify-content:center; min-height:46px; border:1px solid rgba(52,211,153,.55); background:linear-gradient(135deg,#059669,#10B981); color:#ECFDF5; box-shadow:0 6px 18px rgba(16,185,129,.2); }
  .install-submit-btn:hover { transform:translateY(-1px); border-color:rgba(110,231,183,.8); box-shadow:0 8px 22px rgba(16,185,129,.28); }
  @media (max-width: 960px) { .header-top { flex-direction:column; align-items:stretch; } .header-left { width:100%; } .user-info { width:100%; justify-content:flex-end; margin-left:0; } }
  @media (max-width: 640px) { .header-discover { width:100%; min-width:0; } .header-search { max-width:none; } .tag-filter { width:100%; } .modal-overlay { padding:calc(12px + env(safe-area-inset-top)) calc(12px + env(safe-area-inset-right)) calc(12px + env(safe-area-inset-bottom)) calc(12px + env(safe-area-inset-left)); } .modal-content { max-height:calc(100dvh - 24px - env(safe-area-inset-top) - env(safe-area-inset-bottom)); border-radius:18px; } .modal-header { padding:12px 12px 8px 18px; } .modal-header h2 { font-size:1.2rem; min-width:0; } .modal-body { padding:14px 18px calc(18px + env(safe-area-inset-bottom)); } .detail-cover { height:180px; } .detail-summary { padding:16px; } .detail-summary--split { grid-template-columns:1fr; } .detail-card-row { align-items:flex-start; } }
  @media (max-width: 960px) { .header-left { flex-wrap:wrap; } }
  @media (max-width: 640px) { .release-notice { max-width:100%; white-space:normal; text-align:left; } }
  @media (max-width: 640px) { .admin-review-queue-summary { align-items:flex-start; flex-direction:column; } .admin-review-card-head { flex-wrap:wrap; } .admin-review-state { margin-left:58px; } .admin-review-meta-item { border-radius:10px; } .admin-review-card-actions { display:grid; grid-template-columns:1fr 1fr; } .admin-review-card-actions .btn { min-width:0; } .admin-review-summary-head { flex-wrap:wrap; } .admin-review-description-hint { display:none; } .admin-review-sticky-actions { display:grid; grid-template-columns:1fr 1fr; padding:10px; } .admin-review-sticky-actions .btn { min-width:0; } .admin-review-diff-summary-head { align-items:flex-start; flex-direction:column; } .admin-review-diff-entry > summary { grid-template-columns:auto minmax(0,1fr); } .admin-review-diff-fields { grid-column:1 / -1; text-align:left; } .admin-review-diff-code { max-height:60dvh; font-size:.7rem; } .admin-review-unchanged > summary { align-items:flex-start; flex-direction:column; } }

`;
