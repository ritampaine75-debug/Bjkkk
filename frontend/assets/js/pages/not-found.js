import { icon } from '../utils/icons.js';

export default async function mountNotFound(container) {
  container.innerHTML = `
    <div class="page">
      <div class="card">
        <div class="card__body">
          <div class="empty">
            <div class="empty__icon">${icon('search')}</div>
            <h3>Page not found</h3>
            <p class="secondary">The page you requested does not exist or is not available yet.</p>
            <div class="empty__actions">
              <a class="btn btn--primary" href="#/dashboard">Back to overview</a>
            </div>
          </div>
        </div>
      </div>
    </div>`;
}
