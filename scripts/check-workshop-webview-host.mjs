import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/CreativeWorkshop/index.ts', import.meta.url), 'utf8');
const start = source.indexOf('function openCreativeWorkshop() {');
const end = source.indexOf('\n$(() => {', start);
assert.ok(start >= 0 && end > start, 'Workshop host open function must exist');
const host = source.slice(start, end);

assert.match(host, /hostWindow\.document/, 'WebView chrome must be owned by the ST host document');
assert.match(host, /role="toolbar" aria-label="创意工坊窗口控制栏"/, 'ST must create a WebView toolbar');
assert.match(host, /aria-label="关闭创意工坊" title="关闭创意工坊">×<\/button>/, 'X must have an accessible label');
assert.match(host, /minHeight: '48px'/, 'top bar must have reserved layout height');
assert.match(host, /width: '44px',[\s\S]*?height: '44px'/, 'close target must be touch friendly');
assert.match(host, /flex: '1 1 0'/, 'iframe must flex under the host chrome');
assert.match(host, /inset: '48px 0 0'/, 'loading screen must not hide the host toolbar');
assert.match(host, /visualViewport\?\.height/, 'container must follow usable mobile visual viewport');
assert.match(host, /safe-area-inset-top, 0px\) \+ 12px/, 'mobile top margin must protect notch/status bar');
assert.match(host, /safe-area-inset-bottom, 0px\) \+ 12px/, 'mobile bottom margin must protect gesture area');
assert.match(host, /safe-area-inset-right, 0px\) \+ 8px/, 'mobile right edge must not be flush with screen');
assert.match(host, /safe-area-inset-left, 0px\) \+ 8px/, 'mobile left edge must not be flush with screen');
assert.match(host, /height: useFullscreenLayout \? 'auto' : '90vh'/, 'mobile panel must shrink within padded viewport');
assert.match(host, /flex: useFullscreenLayout \? '1 1 0' : '0 0 auto'/, 'mobile content must flex rather than overflow behind system UI');
assert.match(host, /\$frameShell\.append\(\$topBar, \$frame, \$loading\)/, 'toolbar must be outside and above iframe');
assert.doesNotMatch(host, /workshopReady|display: useFullscreenLayout &&/, 'ready handshake must not hide the escape button');
assert.doesNotMatch(host, /rgba\(185,28,28/, 'do not restore the red floating close control');
assert.match(host, /\$closeButton\.on\('click', event => \{[\s\S]*?close\(\);/, 'host X must call local close');
assert.match(host, /bridge\?\.destroy\(\);[\s\S]*?\$overlay\.remove\(\);/, 'local close must clean up Bridge and iframe');

const toolbar = host.indexOf('const $topBar =');
const mount = host.indexOf('$overlay.append($frameShell).appendTo(hostDocument.body)');
const closeClick = host.indexOf("$closeButton.on('click'");
const navigation = host.indexOf("$frame.attr('src', creativeWorkshopUrl)");
assert.ok(toolbar >= 0 && toolbar < mount && mount < navigation, 'host toolbar must mount before iframe network navigation');
assert.ok(closeClick > mount && closeClick < navigation, 'host close handler must bind before iframe navigation');
console.log('Workshop WebView host: independent X, 44px touch target, layout & offline escape assertions PASS.');
