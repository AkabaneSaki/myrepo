export const homePresentationScript = String.raw`
function clampVisualValue(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function applyCoverPresentationPreview(element, x, y, zoom) {
  if (!element) return;
  const px = clampVisualValue(x, 0, 100, 50);
  const py = clampVisualValue(y, 0, 100, 50);
  const pz = clampVisualValue(zoom, 1, 3, 1);
  element.style.backgroundPosition = px + '% ' + py + '%';
  element.style.transform = 'scale(' + pz + ')';
  element.style.transformOrigin = px + '% ' + py + '%';
}

function openCoverPresentationModal(project) {
  if (!project?.coverImage) {
    showToast('这个项目还没有封面图', 'warning');
    return;
  }

  const sources = getCoverImageSources(project);
  const x = clampVisualValue(project.coverPositionX, 0, 100, 50);
  const y = clampVisualValue(project.coverPositionY, 0, 100, 50);
  const zoom = clampVisualValue(project.coverZoom, 1, 3, 1);
  const html = '<form id="coverPresentationForm" class="visual-editor-form">'
    + '<p class="visual-editor-note">这里只改变显示构图，不会重新上传或重新压缩原图。</p>'
    + '<div class="visual-editor-preview visual-editor-cover-preview"><div id="coverPresentationPreview" class="visual-editor-cover-image" data-cover-src="' + escapeHtml(sources.primary) + '" data-cover-fallback-src="' + escapeHtml(sources.fallback) + '" data-cover-placeholder-src="' + escapeHtml(sources.placeholder) + '" data-cover-auth-src="' + escapeHtml(sources.authenticated || '') + '" style="background-image:url(\'' + escapeHtml(sources.primary) + '\')"></div></div>'
    + '<div class="visual-editor-controls">'
    + '<label><span>水平位置 <b id="coverXValue">' + Math.round(x) + '%</b></span><input id="coverPosX" type="range" min="0" max="100" step="1" value="' + x + '"></label>'
    + '<label><span>垂直位置 <b id="coverYValue">' + Math.round(y) + '%</b></span><input id="coverPosY" type="range" min="0" max="100" step="1" value="' + y + '"></label>'
    + '<label><span>缩放 <b id="coverZoomValue">' + zoom.toFixed(2) + '×</b></span><input id="coverZoom" type="range" min="1" max="3" step="0.05" value="' + zoom + '"></label>'
    + '</div><div class="visual-editor-actions"><button type="button" class="btn btn-outline" id="coverPresentationReset">重置</button><button type="submit" class="btn btn-primary">保存显示位置</button></div></form>';

  const overlay = openModal(html, '<i class="fas fa-crop-simple"></i> 调整封面');
  const form = overlay.querySelector('#coverPresentationForm');
  const preview = overlay.querySelector('#coverPresentationPreview');
  const xInput = overlay.querySelector('#coverPosX');
  const yInput = overlay.querySelector('#coverPosY');
  const zoomInput = overlay.querySelector('#coverZoom');

  const update = () => {
    applyCoverPresentationPreview(preview, xInput.value, yInput.value, zoomInput.value);
    overlay.querySelector('#coverXValue').textContent = Math.round(Number(xInput.value)) + '%';
    overlay.querySelector('#coverYValue').textContent = Math.round(Number(yInput.value)) + '%';
    overlay.querySelector('#coverZoomValue').textContent = Number(zoomInput.value).toFixed(2) + '×';
  };

  [xInput, yInput, zoomInput].forEach(input => input.addEventListener('input', update));
  overlay.querySelector('#coverPresentationReset').onclick = () => {
    xInput.value = '50';
    yInput.value = '50';
    zoomInput.value = '1';
    update();
  };
  update();

  form.onsubmit = async event => {
    event.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      const presentation = {
        coverPositionX: Number(xInput.value),
        coverPositionY: Number(yInput.value),
        coverZoom: Number(zoomInput.value),
      };
      await updateCoverPresentation(project.id, presentation);
      Object.assign(project, presentation);
      overlay.dataset.dirty = 'false';
      overlay.remove();
      showToast('封面显示位置已保存');
      if (isDiscoverHomeView()) {
        await fetchDiscoverShelves(true);
      } else {
        await fetchProjects(true, { page: 0, pageSize: state.projectPagination.pageSize });
      }
    } catch (error) {
      showToast('保存封面位置失败: ' + error.message, 'error');
    } finally {
      submit.disabled = false;
    }
  };
}

function applyBannerEditorPreview(root, prefix, x, y, zoom) {
  const img = root.querySelector('#' + prefix + 'PreviewImage');
  if (!img) return;
  const px = clampVisualValue(x, 0, 100, 50);
  const py = clampVisualValue(y, 0, 100, 50);
  const pz = clampVisualValue(zoom, 1, 3, 1);
  img.style.objectPosition = px + '% ' + py + '%';
  img.style.transform = 'scale(' + pz + ')';
  img.style.transformOrigin = px + '% ' + py + '%';
}

function openDiscoverBannerSettingsModal() {
  if (!state.currentUser?.isAdmin) {
    showToast('只有管理员可以修改首页 Banner', 'error');
    return;
  }

  const banner = state.discoverBanner || {};
  const imageUrl = banner.imageUrl || '/discover-preview-banner.png';
  const desktopX = clampVisualValue(banner.positionX, 0, 100, 50);
  const desktopY = clampVisualValue(banner.positionY, 0, 100, 50);
  const desktopZoom = clampVisualValue(banner.zoom, 1, 3, 1);
  const mobileX = clampVisualValue(banner.mobilePositionX, 0, 100, desktopX);
  const mobileY = clampVisualValue(banner.mobilePositionY, 0, 100, desktopY);
  const mobileZoom = clampVisualValue(banner.mobileZoom, 1, 3, desktopZoom);

  const html = '<form id="discoverBannerForm" class="visual-editor-form banner-editor-form">'
    + '<p class="visual-editor-note">管理员可以替换全站 Banner，也可以分别调整桌面与手机构图。只调位置不会重新上传图片。</p>'
    + '<div class="banner-editor-previews">'
    + '<div><small>DESKTOP · 10:3</small><div class="banner-editor-preview banner-editor-preview--desktop"><img id="desktopPreviewImage" src="' + escapeHtml(imageUrl) + '" alt="桌面 Banner 预览"></div></div>'
    + '<div><small>MOBILE · 16:9</small><div class="banner-editor-preview banner-editor-preview--mobile"><img id="mobilePreviewImage" src="' + escapeHtml(imageUrl) + '" alt="手机 Banner 预览"></div></div>'
    + '</div>'
    + '<label class="banner-editor-upload"><span>替换 Banner 图片</span><input id="bannerFileInput" type="file" accept="image/jpeg,image/png,image/webp"><small>不选文件时只保存构图参数。</small></label>'
    + '<div class="banner-editor-control-grid">'
    + '<fieldset><legend>Desktop</legend>'
    + '<label><span>水平 <b id="bannerXValue"></b></span><input id="bannerX" type="range" min="0" max="100" step="1" value="' + desktopX + '"></label>'
    + '<label><span>垂直 <b id="bannerYValue"></b></span><input id="bannerY" type="range" min="0" max="100" step="1" value="' + desktopY + '"></label>'
    + '<label><span>Zoom <b id="bannerZoomValue"></b></span><input id="bannerZoom" type="range" min="1" max="3" step="0.05" value="' + desktopZoom + '"></label></fieldset>'
    + '<fieldset><legend>Mobile</legend>'
    + '<label><span>水平 <b id="bannerMobileXValue"></b></span><input id="bannerMobileX" type="range" min="0" max="100" step="1" value="' + mobileX + '"></label>'
    + '<label><span>垂直 <b id="bannerMobileYValue"></b></span><input id="bannerMobileY" type="range" min="0" max="100" step="1" value="' + mobileY + '"></label>'
    + '<label><span>Zoom <b id="bannerMobileZoomValue"></b></span><input id="bannerMobileZoom" type="range" min="1" max="3" step="0.05" value="' + mobileZoom + '"></label></fieldset>'
    + '</div><div class="visual-editor-actions"><button type="submit" class="btn btn-primary">保存 Banner</button></div></form>';

  const overlay = openModal(html, '<i class="fas fa-panorama"></i> 首页 Banner');
  const form = overlay.querySelector('#discoverBannerForm');
  const fileInput = overlay.querySelector('#bannerFileInput');
  let objectUrl = '';

  const readValues = () => ({
    positionX: Number(overlay.querySelector('#bannerX').value),
    positionY: Number(overlay.querySelector('#bannerY').value),
    zoom: Number(overlay.querySelector('#bannerZoom').value),
    mobilePositionX: Number(overlay.querySelector('#bannerMobileX').value),
    mobilePositionY: Number(overlay.querySelector('#bannerMobileY').value),
    mobileZoom: Number(overlay.querySelector('#bannerMobileZoom').value),
  });

  const update = () => {
    const values = readValues();
    applyBannerEditorPreview(overlay, 'desktop', values.positionX, values.positionY, values.zoom);
    applyBannerEditorPreview(overlay, 'mobile', values.mobilePositionX, values.mobilePositionY, values.mobileZoom);
    overlay.querySelector('#bannerXValue').textContent = Math.round(values.positionX) + '%';
    overlay.querySelector('#bannerYValue').textContent = Math.round(values.positionY) + '%';
    overlay.querySelector('#bannerZoomValue').textContent = values.zoom.toFixed(2) + '×';
    overlay.querySelector('#bannerMobileXValue').textContent = Math.round(values.mobilePositionX) + '%';
    overlay.querySelector('#bannerMobileYValue').textContent = Math.round(values.mobilePositionY) + '%';
    overlay.querySelector('#bannerMobileZoomValue').textContent = values.mobileZoom.toFixed(2) + '×';
  };

  overlay.querySelectorAll('input[type="range"]').forEach(input => input.addEventListener('input', update));
  fileInput.addEventListener('change', () => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    const file = fileInput.files?.[0];
    if (!file) return;
    objectUrl = URL.createObjectURL(file);
    overlay.querySelectorAll('.banner-editor-preview img').forEach(img => { img.src = objectUrl; });
  });
  update();

  form.onsubmit = async event => {
    event.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      if (fileInput.files?.[0]) {
        await uploadDiscoverBanner(fileInput.files[0]);
      }
      await updateDiscoverBannerPresentation(readValues());
      overlay.dataset.dirty = 'false';
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      overlay.remove();
      renderApp();
      showToast('首页 Banner 已保存');
    } catch (error) {
      showToast('Banner 保存失败: ' + error.message, 'error');
    } finally {
      submit.disabled = false;
    }
  };
}
`;
