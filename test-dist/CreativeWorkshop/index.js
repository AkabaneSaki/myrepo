(() => {
  'use strict';

  const FROM_PATH = "test-dist/CreativeWorkshop/index.js";
  const TO_PATH = "dist/CreativeWorkshop/index.js";
  const TARGET_VERSION = "2.1.3";
  const FALLBACK_MESSAGE = "自动迁移失败。请回到酒馆助手，按更新提示手动修正 Creative Workshop import 路径，然后保存并刷新。";
  const SCOPES = ['character', 'preset', 'global'];

  function notify(kind, message) {
    try {
      const toast = globalThis.toastr;
      if (toast && typeof toast[kind] === 'function') {
        toast[kind](message);
        return;
      }
    } catch {}
    try { globalThis.alert?.(message); } catch {}
  }

  function findScript(trees, scriptId) {
    if (!Array.isArray(trees)) return null;
    for (const item of trees) {
      if (!item || typeof item !== 'object') continue;
      if (item.type === 'script' && String(item.id || '') === scriptId) return item;
      if (item.type === 'folder' && Array.isArray(item.scripts)) {
        const nested = item.scripts.find(script => script && String(script.id || '') === scriptId);
        if (nested) return nested;
      }
    }
    return null;
  }

  function rewriteCurrentScript(trees, scriptId) {
    const script = findScript(trees, scriptId);
    if (!script || typeof script.content !== 'string') return { trees, changed: false };

    const nextContent = script.content.split(FROM_PATH).join(TO_PATH);
    if (nextContent === script.content) return { trees, changed: false };

    script.content = nextContent;
    return { trees, changed: true };
  }

  async function migrate() {
    const getId = globalThis.getScriptId;
    const getTrees = globalThis.getScriptTrees;
    const updateTrees = globalThis.updateScriptTreesWith;

    if (typeof getId !== 'function' || typeof getTrees !== 'function' || typeof updateTrees !== 'function') {
      notify('error', FALLBACK_MESSAGE);
      return;
    }

    const scriptId = String(getId() || '');
    if (!scriptId) {
      notify('error', FALLBACK_MESSAGE);
      return;
    }

    let scope = null;
    for (const candidate of SCOPES) {
      try {
        if (findScript(getTrees({ type: candidate }), scriptId)) {
          scope = candidate;
          break;
        }
      } catch {}
    }

    if (!scope) {
      notify('error', FALLBACK_MESSAGE);
      return;
    }

    let changed = false;
    try {
      await Promise.resolve(updateTrees(trees => {
        const result = rewriteCurrentScript(trees, scriptId);
        changed = result.changed;
        return result.trees;
      }, { type: scope }));
    } catch (error) {
      console.error('[CreativeWorkshop migration] failed to rewrite legacy script', error);
      notify('error', FALLBACK_MESSAGE);
      return;
    }

    if (!changed) {
      notify('warning', FALLBACK_MESSAGE);
      return;
    }

    notify('success', 'Creative Workshop 已自动迁移到 v' + TARGET_VERSION + ' 的正式路径。正在重新载入脚本…');
  }

  void migrate();
})();
