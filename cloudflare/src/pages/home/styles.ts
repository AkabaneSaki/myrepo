export const homeStyles = String.raw`
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #0F172A; color: #E2E8F0; line-height: 1.5; min-height: 100vh; }
:root { --bg-color:#0F172A; --card-base:#1E293B; --card-dark:#0F172A; --card-light:#334155; --text-color:#E2E8F0; --highlight-color:#FFD700; --color-primary:#6366F1; --color-system:#3B82F6; --color-character:#10B981; --color-event:#F59E0B; --color-extension:#8B5CF6; }
.container { max-width: 1400px; margin: 0 auto; padding: 20px; }
.header { display:flex; justify-content:space-between; align-items:center; margin-bottom:32px; flex-wrap:wrap; gap:16px; background:rgba(30,41,59,0.7); backdrop-filter:blur(8px); padding:16px 24px; border-radius:24px; border:1px solid rgba(255,255,255,0.08); }
.header-left { display:flex; align-items:center; gap:20px; flex:1; min-width:280px; }
.logo h1 { font-size:1.8rem; font-weight:700; background:linear-gradient(135deg, #6366F1, #8B5CF6); -webkit-background-clip:text; -webkit-text-fill-color:transparent; display:flex; align-items:center; gap:10px; white-space:nowrap; }
.user-info { display:flex; align-items:center; gap:16px; flex-wrap:wrap; margin-left:auto; }
.header-search { display:flex; align-items:center; gap:10px; min-width:260px; max-width:420px; flex:1; padding:10px 14px; border-radius:999px; background:rgba(15,23,42,0.72); border:1px solid rgba(255,255,255,0.08); }
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
.is-loading { position:relative; opacity:0.92; cursor:progress; }
.is-loading i.fa-spinner { animation:cw-spin 0.8s linear infinite; }
.is-loading::after { content:''; position:absolute; inset:0; border-radius:inherit; pointer-events:none; box-shadow:inset 0 0 0 1px rgba(255,255,255,0.08), 0 0 24px rgba(99,102,241,0.18); }
@keyframes cw-spin { from { transform:rotate(0deg); } to { transform:rotate(360deg); } }
.badge-admin { background:#6366F1; padding:2px 8px; border-radius:30px; }
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
.project-card { background:linear-gradient(145deg, #1E293B, #0F172A); border:1px solid rgba(255,255,255,0.08); border-radius:20px; overflow:hidden; transition:all 0.25s; display:flex; flex-direction:column; }
  .project-card:hover { transform:translateY(-6px); border-color:rgba(99,102,241,0.5); box-shadow:0 20px 25px -5px rgba(0,0,0,0.5), 0 0 0 1px rgba(99,102,241,0.3); }
  .card-cover { height:160px; background-size:cover; background-position:center; background-color:#0F172A; position:relative; }
  .card-overlay-actions { position:absolute; right:12px; bottom:12px; display:flex; align-items:center; gap:8px; flex-wrap:wrap; justify-content:flex-end; }
  .icon-stat-btn { display:inline-flex; align-items:center; gap:6px; padding:6px 10px; border-radius:999px; background:rgba(15,23,42,0.82); border:1px solid rgba(255,255,255,0.1); color:#E2E8F0; font-size:0.78rem; backdrop-filter:blur(8px); position:relative; transition:transform 0.18s ease, background 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease, color 0.18s ease; }
  .like-btn,.subscribe-btn { cursor:pointer; }
  .like-btn:hover,.subscribe-btn:hover { transform:translateY(-1px); box-shadow:0 10px 24px rgba(15,23,42,0.42); }
  .like-btn:hover { background:rgba(127,29,29,0.36); border-color:rgba(248,113,113,0.72); color:#FECACA; }
  .subscribe-btn:hover { background:rgba(120,53,15,0.38); border-color:rgba(251,191,36,0.72); color:#FDE68A; }
  .icon-stat-btn.liked { color:#FCA5A5; border-color:rgba(239,68,68,0.35); }
  .icon-stat-btn.subscribed { color:#FCD34D; border-color:rgba(245,158,11,0.35); }
  .icon-stat-btn__hint { position:absolute; left:50%; bottom:calc(100% + 10px); transform:translateX(-50%) translateY(4px); pointer-events:none; opacity:0; padding:6px 10px; border-radius:10px; white-space:nowrap; background:rgba(15,23,42,0.96); border:1px solid rgba(255,255,255,0.12); color:#E2E8F0; font-size:0.72rem; line-height:1; box-shadow:0 12px 30px rgba(0,0,0,0.35); transition:opacity 0.18s ease, transform 0.18s ease; }
  .icon-stat-btn__hint::after { content:''; position:absolute; left:50%; top:100%; transform:translateX(-50%); border:6px solid transparent; border-top-color:rgba(15,23,42,0.96); }
  .like-btn:hover .icon-stat-btn__hint,.subscribe-btn:hover .icon-stat-btn__hint { opacity:1; transform:translateX(-50%) translateY(0); }
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
  .card-meta { font-size:0.75rem; opacity:0.7; }
  .card-meta--version { align-items:center; }
  .version-block { display:inline-flex; align-items:center; gap:8px; flex-wrap:wrap; }
  .version-diff { display:inline-flex; align-items:center; gap:6px; }
  .version-diff__from { color:#CBD5E1; }
  .version-diff__to { color:#FDE68A; font-weight:600; }
  .inline-update-btn { padding:4px 10px; font-size:0.72rem; border-radius:999px; }
  .card-actions,.admin-actions,.admin-card-actions { display:flex; gap:8px; justify-content:space-between; }
  .card-actions--primary > * { flex:1; }
  .detail-btn,.install-btn { flex:1; }
  .edit-btn,.delete-btn { flex:1; }
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
.close-btn { background:none; border:none; color:inherit; font-size:1.4rem; cursor:pointer; opacity:0.6; }
.close-btn:hover { opacity:1; }
.modal-body { flex:1; overflow-y:auto; padding:20px 24px 24px; }
.detail-loading { min-height:240px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:16px; color:rgba(226,232,240,0.9); }
.detail-loading-text { font-size:0.95rem; }
.form-group { margin-bottom:16px; }
.form-group label { display:block; margin-bottom:6px; font-weight:500; opacity:0.8; }
.form-group input,.form-group textarea,.form-group select { width:100%; padding:10px 12px; background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.1); border-radius:8px; color:inherit; }
.file-drop { border:2px dashed rgba(255,255,255,0.2); border-radius:12px; padding:30px; text-align:center; cursor:pointer; transition:0.2s; }
.file-drop:hover { border-color:#6366F1; background:rgba(99,102,241,0.1); }
.form-submit-btn { width:100%; padding:12px; justify-content:center; }
.toast { position:fixed; bottom:20px; right:20px; background:#1E293B; color:white; padding:12px 24px; border-radius:30px; box-shadow:0 8px 20px black; z-index:10000; border-left:4px solid #6366F1; }
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
.detail-description { padding:16px 18px; }
.detail-entry-list { display:flex; flex-direction:column; gap:12px; }
.entry-item { border:1px solid rgba(255,255,255,0.1); border-radius:12px; overflow:hidden; background:rgba(15,23,42,0.55); }
.entry-header { background:rgba(0,0,0,0.3); padding:12px 14px; cursor:pointer; display:flex; align-items:center; gap:8px; font-weight:500; }
.entry-header i { font-size:0.8rem; transition:transform 0.2s; }
.entry-header.open i { transform:rotate(90deg); }
.entry-content { padding:0 14px; max-height:0; overflow:hidden; transition:max-height 0.3s ease, padding 0.3s ease, margin 0.3s ease; }
.entry-content.open { padding:0 14px 14px; margin-top:2px; max-height:280px; overflow-y:auto; }
.strategy-badge { display:inline-block; width:24px; text-align:center; font-weight:bold; }
.strategy-constant { color:#3B82F6; }
.strategy-selective { color:#10B981; }
.detail-keywords-block { display:flex; flex-direction:column; gap:10px; padding:12px; border:1px solid rgba(99,102,241,0.28); border-radius:14px; background:rgba(30,41,59,0.5); }
.detail-keywords-title { font-size:0.78rem; font-weight:700; letter-spacing:0.08em; color:#C7D2FE; text-transform:uppercase; }
.keyword-chip { display:inline-flex; align-items:center; padding:4px 10px; border-radius:999px; border:1px solid rgba(99,102,241,0.6); background:rgba(99,102,241,0.08); color:#C7D2FE; font-size:0.78rem; line-height:1.2; box-shadow:inset 0 0 0 1px rgba(255,255,255,0.04); }
.detail-entry-content { padding:14px; }
  .empty-state { padding:18px; border-radius:14px; border:1px dashed rgba(255,255,255,0.14); color:rgba(226,232,240,0.72); text-align:center; }
  .update-modal { display:flex; flex-direction:column; gap:20px; }
  .update-diff-group { display:flex; flex-direction:column; gap:16px; }
  .update-modal-actions { display:flex; justify-content:flex-end; gap:12px; padding-top:8px; }
  @media (max-width: 640px) { .header-left { width:100%; flex-direction:column; align-items:stretch; } .header-search { max-width:none; } .user-info { width:100%; justify-content:flex-end; } .modal-overlay { padding:20px 12px; } .modal-content { max-height:calc(100vh - 40px); } .modal-header { padding:18px 18px 10px; } .modal-body { padding:16px 18px 18px; } .detail-cover { height:180px; } .detail-summary { padding:16px; } .detail-summary--split { grid-template-columns:1fr; } .detail-card-row { align-items:flex-start; } }

`;
