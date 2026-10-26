/** Shared loading, empty and error states. */
import { icon } from '../utils/icons.js';
import { escapeHtml } from '../utils/dom.js';

export function skeletonPage() {
  return `
    <div class="page" aria-busy="true" aria-live="polite">
      <span class="visually-hidden">Loading…</span>
      <div class="skeleton" style="width:180px;height:26px"></div>
      <div class="grid cols-2">
        ${Array.from({ length: 4 })
          .map(() => '<div class="skeleton" style="height:92px;border-radius:14px"></div>')
          .join('')}
      </div>
      <div class="skeleton" style="height:220px;border-radius:14px"></div>
    </div>`;
}

export function renderEmptyState(container, { iconName = 'info', title, description, actions = [] }) {
  container.innerHTML = `
    <div class="empty">
      <div class="empty__icon">${icon(iconName)}</div>
      <h3>${escapeHtml(title)}</h3>
      <p class="secondary">${escapeHtml(description)}</p>
      ${
        actions.length
          ? `<div class="empty__actions">${actions
              .map(
                (a) =>
                  `<a class="btn ${a.primary ? 'btn--primary' : 'btn--secondary'}" href="${escapeHtml(a.href)}">${escapeHtml(a.label)}</a>`,
              )
              .join('')}</div>`
          : ''
      }
    </div>`;
}

export function renderErrorState(container, error) {
  const message = error?.message || 'An unexpected error occurred.';
  container.innerHTML = `
    <div class="page">
      <div class="card">
        <div class="card__body">
          <div class="empty">
            <div class="empty__icon" style="color:var(--danger)">${icon('alert')}</div>
            <h3>Something went wrong</h3>
            <p class="secondary">${escapeHtml(message)}</p>
            <div class="empty__actions">
              <button class="btn btn--primary" type="button" data-retry>Try again</button>
              <a class="btn btn--secondary" href="#/dashboard">Back to overview</a>
            </div>
          </div>
        </div>
      </div>
    </div>`;
  container.querySelector('[data-retry]')?.addEventListener('click', () => window.location.reload());
}

export function renderPageError(container, { title = 'Something went wrong', message, retry = null }) {
  container.innerHTML = `
    <div class="alert alert--danger">
      ${icon('alert')}
      <div class="alert__body">
        <div class="alert__title">${escapeHtml(title)}</div>
        <div class="alert__text">${escapeHtml(message || 'Please try again.')}</div>
        ${retry ? '<button class="btn btn--secondary btn--sm" type="button" data-retry style="margin-top:8px">Retry</button>' : ''}
      </div>
    </div>`;
  if (retry) container.querySelector('[data-retry]')?.addEventListener('click', retry);
}
