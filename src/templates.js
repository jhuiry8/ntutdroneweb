// NTUT Drone Club - server-rendered HTML pages (with i18n support).
// Each page lives in src/templates/; this module re-exports them for the route modules.
export { renderPublicLoanForm } from './templates/public-loan.js';
export { renderLandingPage } from './templates/landing.js';
export { renderBlogList, renderBlogPost, renderCustomPage } from './templates/content.js';
export { renderLogin } from './templates/login.js';
export { renderAdminDashboard } from './templates/admin.js';
