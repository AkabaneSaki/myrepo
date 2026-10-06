import { homeModalCoreScript } from './modal/core';
import { homeProjectDetailModalScript } from './modal/project-detail';
import { homeProjectUpdateModalScript } from './modal/project-update';
import { homeProjectInstallModalScript } from './modal/project-install';
import { homeProjectEditorModalScript } from './modal/project-editor';
import { homeAdminReviewModalScript } from './modal/admin-review';
import { homeAdminToolsModalScript } from './modal/admin-tools';
import { homeDevTeamRecommendModalScript } from './modal/devteam-recommend';

export const homeModalsScript = [
  homeModalCoreScript,
  homeProjectDetailModalScript,
  homeProjectUpdateModalScript,
  homeProjectInstallModalScript,
  homeProjectEditorModalScript,
  homeAdminReviewModalScript,
  homeAdminToolsModalScript,
  homeDevTeamRecommendModalScript,
].join('\n');
