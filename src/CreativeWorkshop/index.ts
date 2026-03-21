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
    background: 'linear-gradient(145deg, #1E293B, #0F172A)',
    borderRadius: '20px',
    padding: '36px 32px 28px',
    width: 'min(520px, 92vw)',
    maxHeight: '85vh',
    overflowY: 'auto',
    boxShadow: '0 24px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.08)',
    color: '#E2E8F0',
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
    .html('<i class="fas fa-shield-alt" style="color:#60A5FA"></i> 免责声明');

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
      .html(`<i class="fas ${item.icon}" style="color:#60A5FA;font-size:0.85rem"></i> ${index + 1}. ${item.title}`);

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

  const existing = host$('#creative-workshop-overlay');
  if (existing.length) {
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

  const $frame = createScriptIdIframe().css({
    width: 'min(1400px, 96vw)',
    height: 'min(90vh, 920px)',
    borderRadius: '20px',
    background: '#0F172A',
    boxShadow: '0 24px 80px rgba(0,0,0,0.45)',
  });

  const updateOverlayLayout = () => {
    const useTopAlignedLayout = window.innerWidth < 1000;
    const viewportHeight = hostWindow.visualViewport?.height ?? hostWindow.innerHeight;
    const viewportTop = (hostWindow.visualViewport?.offsetTop ?? 0) + hostWindow.scrollY;

    $overlay.css({
      top: `${viewportTop}px`,
      height: `${viewportHeight}px`,
      alignItems: useTopAlignedLayout ? 'flex-start' : 'center',
      paddingTop: useTopAlignedLayout ? '16px' : '24px',
      paddingRight: '24px',
      paddingBottom: useTopAlignedLayout ? '16px' : '24px',
      paddingLeft: '24px',
    });
  };

  updateOverlayLayout();
  host$(hostWindow).on('resize.creative-workshop-overlay', updateOverlayLayout);
  host$(hostWindow).on('scroll.creative-workshop-overlay', updateOverlayLayout);
  hostWindow.visualViewport?.addEventListener('resize', updateOverlayLayout);
  hostWindow.visualViewport?.addEventListener('scroll', updateOverlayLayout);

  $overlay.append($frame).appendTo(hostDocument.body);

  const close = () => {
    bridge?.destroy();
    host$(hostWindow).off('resize.creative-workshop-overlay', updateOverlayLayout);
    host$(hostWindow).off('scroll.creative-workshop-overlay', updateOverlayLayout);
    hostWindow.visualViewport?.removeEventListener('resize', updateOverlayLayout);
    hostWindow.visualViewport?.removeEventListener('scroll', updateOverlayLayout);
    $overlay.remove();
    destroy();
  };

  $overlay.on('click', event => {
    if (event.target === $overlay[0]) {
      close();
    }
  });

  let bridge: ReturnType<typeof createCreativeWorkshopBridgeHost> | null = null;
  let hasNavigated = false;

  $frame.on('load', () => {
    const iframe = $frame[0];

    if (!bridge) {
      bridge = createCreativeWorkshopBridgeHost({
        iframe,
        targetOrigin: getCreativeWorkshopOrigin(),
      });
    }

    if (!hasNavigated) {
      hasNavigated = true;
      iframe.contentWindow?.location.replace(creativeWorkshopUrl);
    }
  });
}

$(() => {
  replaceScriptButtons([{ name: '命定创意工坊', visible: true }]);

  eventOn(getButtonEvent('命定创意工坊'), () => {
    if (hasAcceptedAgreement()) {
      openCreativeWorkshop();
    } else {
      showAgreementPopup();
    }
  });
});
