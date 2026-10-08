import { createScriptIdIframe, teleportStyle } from '@util/script';
import { createCreativeWorkshopBridgeHost } from './bridge/host';
import { getCreativeWorkshopOrigin, getCreativeWorkshopUrl } from './services/config';

const AGREEMENT_STORAGE_KEY = 'creative_workshop_agreement_accepted';

function hasAcceptedAgreement(): boolean {
  return localStorage.getItem(AGREEMENT_STORAGE_KEY) === 'true';
}

function showAgreementPopup() {
  const existing = $('#creative-workshop-agreement-overlay');
  if (existing.length) existing.remove();

  const { destroy } = teleportStyle();

  const $overlay = $('<div id="creative-workshop-agreement-overlay">').css({
    position: 'fixed',
    inset: '0',
    zIndex: 2147483647,
    background: 'rgba(0,0,0,0.75)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    padding: '24px',
    backdropFilter: 'blur(6px)',
  });

  const $card = $('<div>').css({
    background: '#18191c',
    borderRadius: '20px',
    padding: '36px 32px 28px',
    width: 'min(520px, 92vw)',
    maxHeight: '85vh',
    overflowY: 'auto',
    boxShadow: '0 24px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.08)',
    color: '#ececea',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  });

  const $title = $('<h2>')
    .css({
      margin: '0 0 24px 0',
      fontSize: '1.4rem',
      fontWeight: '700',
      textAlign: 'center',
      color: '#F8FAFC',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '10px',
    })
    .html('<i class="fas fa-shield-alt" style="color:#b89d76"></i> 免责声明');

  const disclaimerItems = [
    {
      icon: 'fa-user-edit',
      title: '用户内容责任',
      text: '创意工坊中用户分享的所有内容均由分享者本人负责，虽然开发者拥有审核机制，但开发者不对用户生成内容（UGC）的合法性、准确性和适当性承担任何责任。',
    },
    {
      icon: 'fa-exclamation-triangle',
      title: '使用风险',
      text: '用户使用创意工坊的一切行为和后果由用户自行承担。开发者在法律允许的最大范围内，不对因使用或无法使用创意工坊而导致的任何直接或间接损失承担责任。',
    },
    {
      icon: 'fa-file-contract',
      title: '条款变更',
      text: '开发者保留随时修改本声明的权利，修改后的内容在更新后立即生效。',
    },
  ];

  const $list = $('<div>').css({
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    marginBottom: '28px',
  });

  disclaimerItems.forEach((item, index) => {
    const $item = $('<div>').css({
      background: 'rgba(255,255,255,0.04)',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: '12px',
      padding: '16px',
    });

    const $itemTitle = $('<div>')
      .css({
        fontWeight: '600',
        fontSize: '0.95rem',
        color: '#CBD5E1',
        marginBottom: '8px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
      })
      .html(`<i class="fas ${item.icon}" style="color:#b89d76;font-size:0.85rem"></i> ${index + 1}. ${item.title}`);

    const $itemText = $('<div>')
      .css({
        fontSize: '0.88rem',
        lineHeight: '1.6',
        color: '#94A3B8',
      })
      .text(item.text);

    $item.append($itemTitle, $itemText);
    $list.append($item);
  });

  const $buttons = $('<div>').css({
    display: 'flex',
    gap: '12px',
    justifyContent: 'center',
  });

  const $acceptBtn = $('<button>')
    .css({
      padding: '12px 32px',
      background: 'linear-gradient(135deg, #3B82F6, #2563EB)',
      border: 'none',
      borderRadius: '12px',
      color: 'white',
      fontSize: '0.95rem',
      fontWeight: '600',
      cursor: 'pointer',
      boxShadow: '0 4px 15px rgba(59,130,246,0.4)',
      transition: 'all 0.2s',
    })
    .text('同意并继续')
    .on('mouseenter', function () {
      $(this).css('transform', 'translateY(-1px)');
    })
    .on('mouseleave', function () {
      $(this).css('transform', 'translateY(0)');
    })
    .on('click', () => {
      localStorage.setItem(AGREEMENT_STORAGE_KEY, 'true');
      close();
      openCreativeWorkshop();
    });

  const $cancelBtn = $('<button>')
    .css({
      padding: '12px 32px',
      background: 'rgba(255,255,255,0.08)',
      border: '1px solid rgba(255,255,255,0.15)',
      borderRadius: '12px',
      color: '#94A3B8',
      fontSize: '0.95rem',
      fontWeight: '500',
      cursor: 'pointer',
      transition: 'all 0.2s',
    })
    .text('取消')
    .on('mouseenter', function () {
      $(this).css('background', 'rgba(255,255,255,0.12)');
    })
    .on('mouseleave', function () {
      $(this).css('background', 'rgba(255,255,255,0.08)');
    })
    .on('click', () => {
      close();
    });

  $buttons.append($cancelBtn, $acceptBtn);
  $card.append($title, $list, $buttons);
  $overlay.append($card).appendTo('body');

  $overlay.on('click', event => {
    if (event.target === $overlay[0]) {
      close();
    }
  });

  function close() {
    $overlay.remove();
    destroy();
  }
}

function openCreativeWorkshop() {
  const creativeWorkshopUrl = getCreativeWorkshopUrl();
  const hostWindow = window.parent !== window ? window.parent : window;
  const hostDocument = hostWindow.document;
  const host$ = (hostWindow as Window & { $: JQueryStatic }).$;

  console.info('[CreativeWorkshop] openCreativeWorkshop:start', {
    creativeWorkshopUrl,
    hostOrigin: hostWindow.location.origin,
    currentOrigin: window.location.origin,
    parentEqualsWindow: window.parent === window,
  });

  const existing = host$('#creative-workshop-overlay');
  if (existing.length) {
    console.warn('[CreativeWorkshop] openCreativeWorkshop:remove-existing-overlay', {
      count: existing.length,
    });
    existing.remove();
  }

  const { destroy } = teleportStyle(hostDocument.head);
  const $overlay = host$('<div id="creative-workshop-overlay">').css({
    position: 'absolute',
    top: '0',
    right: '0',
    left: '0',
    zIndex: 2147483647,
    background: 'rgba(0,0,0,0.7)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'flex-start',
    paddingTop: '20px',
    paddingRight: '24px',
    paddingBottom: '20px',
    paddingLeft: '24px',
    boxSizing: 'border-box',
    overflow: 'auto',
    overscrollBehavior: 'contain',
  });

  const $frameShell = host$('<div>').css({
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    height: '100%',
    flex: '0 0 auto',
    overflow: 'hidden',
    background: '#0f1012',
    borderRadius: '20px',
    boxShadow: '0 24px 80px rgba(0,0,0,0.45)',
  });

  // Host-owned WebView chrome: stays clickable even when the child iframe
  // is blank, offline, or stuck before/after bridge initialization.
  const $topBar = host$('<div role="toolbar" aria-label="创意工坊窗口控制栏">').css({
    position: 'relative',
    zIndex: 3,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flex: '0 0 48px',
    minHeight: '48px',
    padding: '0 4px 0 16px',
    boxSizing: 'border-box',
    background: '#1b1d22',
    borderBottom: '1px solid rgba(255,255,255,0.09)',
  });
  const $topBarTitle = host$('<span>').text('命定创意工坊').css({
    minWidth: '0',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: '#e5e7eb',
    fontSize: '13px',
    fontWeight: '600',
    letterSpacing: '0.02em',
  });
  const $closeButton = host$('<button type="button" aria-label="关闭创意工坊" title="关闭创意工坊">×</button>').css({
    flex: '0 0 44px',
    width: '44px',
    height: '44px',
    marginLeft: '8px',
    border: '0',
    borderRadius: '9px',
    background: 'transparent',
    color: '#d1d5db',
    fontSize: '28px',
    fontWeight: '300',
    lineHeight: '1',
    cursor: 'pointer',
    touchAction: 'manipulation',
  });
  $topBar.append($topBarTitle, $closeButton);

  const $frame = createScriptIdIframe()
    .removeAttr('srcdoc')
    .css({
      display: 'block',
      width: '100%',
      height: 'auto',
      flex: '1 1 0',
      minHeight: '0',
      border: '0',
      background: '#0f1012',
    });

  const $loading = host$('<div role="status" aria-live="polite">正在打开创意工坊…</div>').css({
    position: 'absolute',
    inset: '48px 0 0',
    zIndex: 2,
    display: 'grid',
    placeItems: 'center',
    borderRadius: '20px',
    background: '#0f1012',
    color: '#a9a49b',
    fontSize: '14px',
    letterSpacing: '0.02em',
    pointerEvents: 'none',
  });

  const updateOverlayLayout = () => {
    const useFullscreenLayout = hostWindow.innerWidth < 1000;
    const viewportHeight = hostWindow.visualViewport?.height ?? hostWindow.innerHeight;
    const viewportTop = (hostWindow.visualViewport?.offsetTop ?? 0) + hostWindow.scrollY;

    $overlay.css({
      top: `${viewportTop}px`,
      height: `${viewportHeight}px`,
      alignItems: useFullscreenLayout ? 'stretch' : 'center',
      // Chrome's visual viewport excludes browser chrome. Extra insets also
      // protect against cutouts and gesture areas in standalone/fullscreen hosts.
      paddingTop: useFullscreenLayout ? 'calc(env(safe-area-inset-top, 0px) + 14px)' : '24px',
      paddingRight: useFullscreenLayout ? 'calc(env(safe-area-inset-right, 0px) + 12px)' : '24px',
      paddingBottom: useFullscreenLayout ? 'calc(env(safe-area-inset-bottom, 0px) + 14px)' : '24px',
      paddingLeft: useFullscreenLayout ? 'calc(env(safe-area-inset-left, 0px) + 12px)' : '24px',
    });

    $frameShell.css({
      width: useFullscreenLayout ? '100%' : '90vw',
      // Mobile fills only the padded, safe visual viewport, not the physical
      // display. Flex shrinking prevents the bottom edge from being clipped.
      height: useFullscreenLayout ? 'auto' : '90vh',
      flex: useFullscreenLayout ? '1 1 0' : '0 0 auto',
      minHeight: '0',
      borderRadius: useFullscreenLayout ? '12px' : '20px',
      boxShadow: useFullscreenLayout ? '0 8px 30px rgba(0,0,0,0.28)' : '0 24px 80px rgba(0,0,0,0.45)',
    });
    // The iframe flexes below the permanent ST-owned top bar. No overlay
    // controls ever need a message from the cross-origin Workshop page.
  };

  updateOverlayLayout();
  host$(hostWindow).on('resize.creative-workshop-overlay', updateOverlayLayout);
  host$(hostWindow).on('scroll.creative-workshop-overlay', updateOverlayLayout);
  hostWindow.visualViewport?.addEventListener('resize', updateOverlayLayout);
  hostWindow.visualViewport?.addEventListener('scroll', updateOverlayLayout);

  $frameShell.append($topBar, $frame, $loading);
  $overlay.append($frameShell).appendTo(hostDocument.body);
  const slowOpenTimer = hostWindow.setTimeout(() => {
    $loading.text('打开时间较长，可以退出后重试');
  }, 8000);

  console.info('[CreativeWorkshop] openCreativeWorkshop:overlay-mounted', {
    iframeCount: $overlay.find('iframe').length,
    bodyChildCount: hostDocument.body.children.length,
  });

  const close = () => {
    console.warn('[CreativeWorkshop] openCreativeWorkshop:close', {
      hasBridge: Boolean(bridge),
      overlayExists: hostDocument.body.contains($overlay[0]),
      activeElementTag: hostDocument.activeElement?.tagName,
    });
    hostWindow.clearTimeout(slowOpenTimer);
    bridge?.destroy();
    host$(hostWindow).off('resize.creative-workshop-overlay', updateOverlayLayout);
    host$(hostWindow).off('scroll.creative-workshop-overlay', updateOverlayLayout);
    hostWindow.visualViewport?.removeEventListener('resize', updateOverlayLayout);
    hostWindow.visualViewport?.removeEventListener('scroll', updateOverlayLayout);
    $overlay.remove();
    destroy();
  };

  $closeButton.on('click', event => {
    event.stopPropagation();
    close();
  });

  $overlay.on('click', event => {
    console.info('[CreativeWorkshop] openCreativeWorkshop:overlay-click', {
      targetIsOverlay: event.target === $overlay[0],
      targetTag: (event.target as HTMLElement | null)?.tagName,
    });
    if (event.target === $overlay[0]) {
      close();
    }
  });

  const iframe = $frame[0];
  const bridge = createCreativeWorkshopBridgeHost({
    iframe,
    targetOrigin: getCreativeWorkshopOrigin(),
    onClose: close,
    onReady: () => {
      hostWindow.clearTimeout(slowOpenTimer);
      $loading.remove();
      updateOverlayLayout();
      console.info('[CreativeWorkshop] openCreativeWorkshop:ready');
    },
  });
  console.info('[CreativeWorkshop] openCreativeWorkshop:bridge-created', {
    targetOrigin: getCreativeWorkshopOrigin(),
  });
  console.info('[CreativeWorkshop] openCreativeWorkshop:navigate-iframe', {
    creativeWorkshopUrl,
  });
  $frame.attr('src', creativeWorkshopUrl);
}

$(() => {
  console.info('[CreativeWorkshop] script-mounted');
  replaceScriptButtons([{ name: '命定创意工坊', visible: true }]);

  eventOn(getButtonEvent('命定创意工坊'), () => {
    console.info('[CreativeWorkshop] workshop-button-clicked', {
      acceptedAgreement: hasAcceptedAgreement(),
    });
    if (hasAcceptedAgreement()) {
      openCreativeWorkshop();
    } else {
      showAgreementPopup();
    }
  });

  $(window).on('pagehide', () => {
    console.warn('[CreativeWorkshop] script-pagehide');
  });
});
