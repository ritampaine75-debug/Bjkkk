/**
 * Schedule overview: which workflows run on an interval, when they run next and
 * whether the scheduler loop is enabled on this deployment.
 */
import { escapeHtml, relativeTime, formatDate } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { loadBot } from '../services/bot-context.js';
import { renderBotHeader } from '../components/bot-header.js';
import { skeletonPage, renderPageError } from '../components/states.js';
import { api } from '../api-client.js';
import { toastSuccess, toastError } from '../components/toast.js';

export default async function mountSchedules(container, { params }) {
  container.innerHTML = skeletonPage();
  let bot;
  let schedules = [];
  let scheduler = null;
  try {
    const data = await loadBot(params.botId);
    bot = data.bot;
    const res = await api.get(`/bots/${encodeURIComponent(params.botId)}/schedules`);
    schedules = res.schedules || [];
    scheduler = res.scheduler;
  } catch (err) {
    renderPageError(container, {
      title: 'Could not load schedules',
      message: err.message,
      retry: () => mountSchedules(container, { params }),
    });
    return;
  }

  const active = schedules.filter((row) => row.active);

  container.innerHTML = `<div class="page">
    ${renderBotHeader(bot, 'workflows')}
    <div class="alert alert--${scheduler?.enabled ? 'info' : 'warning'}">${icon('clock')}
      <div class="alert__body">
        <div class="alert__title">Scheduler ${scheduler?.enabled ? 'enabled' : 'disabled'} on this deployment</div>
        <div class="alert__text">${escapeHtml(scheduler?.note || 'Scheduler state is unknown.')}
          ${scheduler?.enabled ? '' : ' You can still run any published schedule manually with "Run now".'}</div>
      </div>
    </div>

    <section class="card">
      <div class="card__header">
        <div>
          <h2 class="card__title">${icon('clock')} Interval schedules</h2>
          <p class="card__subtitle">${active.length} active of ${schedules.length} schedule trigger(s)</p>
        </div>
        <a class="btn btn--secondary btn--sm" href="#/bots/${encodeURIComponent(bot.id)}/workflows">${icon('workflow')} Manage workflows</a>
      </div>
      <div class="card__body">
        ${
          schedules.length === 0
            ? `<div class="empty">${icon('clock')}
                <h3>No schedules yet</h3>
                <p class="secondary">Add a <strong>Schedule</strong> trigger to a workflow and publish it. Interval triggers run every N minutes.</p>
                <div class="empty__actions"><a class="btn btn--secondary" href="#/bots/${encodeURIComponent(bot.id)}/workflows">${icon('workflow')} Open automations</a></div>
              </div>`
            : `<ul class="exec-list">
                ${schedules
                  .map(
                    (row) => `<li class="exec-row">
                      <div class="exec-row__main" style="cursor:default">
                        <span class="exec-row__status"><span class="badge badge--${row.active ? 'success' : 'neutral'}">${escapeHtml(
                          row.active ? 'active' : row.workflowStatus,
                        )}</span></span>
                        <span class="exec-row__body">
                          <span class="exec-row__title">${escapeHtml(row.workflowName)}</span>
                          <span class="exec-row__meta secondary small">
                            every ${row.intervalMinutes} min · next ${escapeHtml(row.nextRunAt ? relativeTime(row.nextRunAt) : 'not scheduled')}
                            · last ${escapeHtml(row.lastRunAt ? `${row.lastStatus || 'run'} ${relativeTime(row.lastRunAt)}` : 'never')}
                            ${row.lastError ? ` · <span class="text-danger">${escapeHtml(row.lastError)}</span>` : ''}
                          </span>
                        </span>
                        <span class="row" style="gap:var(--space-2)">
                          <a class="btn btn--ghost btn--sm" href="#/bots/${encodeURIComponent(bot.id)}/workflows/${encodeURIComponent(
                            row.workflowId,
                          )}">${icon('edit')} Edit</a>
                          <button class="btn btn--secondary btn--sm" type="button" data-run="${escapeHtml(row.workflowId)}" ${
                            row.active ? '' : 'disabled title="Publish the workflow first"'
                          }>${icon('play')} Run now</button>
                        </span>
                      </div>
                    </li>`,
                  )
                  .join('')}
              </ul>
              <p class="field__hint" style="margin-top:var(--space-3)">
                Scheduled runs are recorded in the execution log with trigger type <code>schedule</code>.
                ${schedules.some((row) => row.nextRunAt)
                  ? ` Next run: ${escapeHtml(formatDate(schedules.map((r) => r.nextRunAt).filter(Boolean).sort()[0]))}.`
                  : ''}
              </p>`
        }
      </div>
    </section>
  </div>`;

  container.querySelectorAll('[data-run]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        const res = await api.post(`/bots/${encodeURIComponent(bot.id)}/schedules/${encodeURIComponent(btn.dataset.run)}/run`, {});
        const status = res.result?.status || 'unknown';
        if (status === 'succeeded') toastSuccess('Scheduled run finished successfully.');
        else toastError(`Scheduled run finished with status: ${status}`);
        await mountSchedules(container, { params });
      } catch (err) {
        toastError(err.message);
        btn.disabled = false;
      }
    }),
  );
}
