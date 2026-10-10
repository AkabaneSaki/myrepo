import { homeApiScript } from './api';
import { homeDailyRandomDrawScript } from './daily-random';
import { homeModalsScript } from './modals';
import { homePresentationScript } from './presentation';
import { homePublishCheckScript } from './publish-check';
import { homeCardsRenderScript } from './render/cards';
import { homeDetailModalRenderScript } from './render/detail-modal';
import { homeExternalLinksScript } from './external-links';
import { homeReviewDiffRenderScript } from './render/review-diff';
import { homeLayoutRenderScript } from './render/layout';
import { homeInstalledManagerScript } from './installed-manager';
import { homeRepairScript } from './repair-ui';
import { homeStateScript } from './state';
import { homeTavernBridgeScript } from './tavern-bridge';
import { homeUploadPreviewScript } from './upload-preview';
import { homeUpdateCenterScript } from './update-center';
import { homeUtilsScript } from './utils';
import { PROJECT_CONTENT_POLICY } from '../../config/project-content-policy';
import { PROJECT_TAXONOMY } from '../../config/project-taxonomy';
import { WORKSHOP_LIMITS } from '../../config/runtime-limits';
import { homeAppAuthFlowScript } from './app/auth-flow';
import { homeAppActionsScript } from './app/actions';
import { homeAppBootstrapScript } from './app/bootstrap';
import workshopConfig from '../../../../config/workshop.json';
import uploadChecker from '../../generated/upload-checker-revision.json';
import reviewChecker from '../../generated/review-checker-revision.json';
import { CHECKER_LIMITS } from '../../utils/ejs-checker/limits.mjs';

const projectContentPolicyJson = JSON.stringify(PROJECT_CONTENT_POLICY);
const projectTaxonomyJson = JSON.stringify(PROJECT_TAXONOMY);
const workshopConfigJson = JSON.stringify(workshopConfig);
const workshopLimitsJson = JSON.stringify(WORKSHOP_LIMITS);

export const homeScript = String.raw`
(function() {
  const app = document.getElementById('app');
  const PROJECT_CONTENT_POLICY = ${projectContentPolicyJson};
  const PROJECT_TAXONOMY = ${projectTaxonomyJson};
  const WORKSHOP_CONFIG = ${workshopConfigJson};
  const WORKSHOP_LIMITS = ${workshopLimitsJson};
  const UPLOAD_CHECKER_URL = '/assets/upload-checker.js?v=${uploadChecker.revision}';
  const REVIEW_CHECKER_URL = '/assets/review-checker.js?v=${reviewChecker.revision}';
  const UPLOAD_CHECKER_TIMEOUT_MS = ${CHECKER_LIMITS.browserTimeoutMs};

  ${homeStateScript}
  ${homeUtilsScript}
  ${homeTavernBridgeScript}
  ${homeApiScript}
  ${homeDailyRandomDrawScript}
  ${homeCardsRenderScript}
  ${homeDetailModalRenderScript}
  ${homeExternalLinksScript}
  ${homeUploadPreviewScript}
  ${homeReviewDiffRenderScript}
  ${homeInstalledManagerScript}
  ${homeLayoutRenderScript}
  ${homePublishCheckScript}
  ${homeModalsScript}
  ${homeRepairScript}
  ${homeUpdateCenterScript}
  ${homePresentationScript}

${homeAppAuthFlowScript}

${homeAppActionsScript}

${homeAppBootstrapScript}
})();
`;
