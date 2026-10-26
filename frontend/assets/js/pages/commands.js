/** Command manager page: CRUD, enable/disable, Telegram sync and import. */
import { escapeHtml, relativeTime } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { api } from '../api-client.js';
import { loadBot } from '../services/bot-context.js';
import { renderBotHeader, bindBotHeader } from '../components/bot-header.js';
import { skeletonPage, renderPageError } from '../components/states.js';
import { openCommandEditor } from '../components/command-editor.js';
import { confirmDialog } from '../components/modal.js';
import { toastSuccess, toastError, toastWarning } from '../components/toast.js';

export default async function mountCommands(container, { params }) {
  container.innerHTML = skeletonPage();
  let botData;
  let commandData;
  let workflows = [];
  try {
    botData = await loadBot(params.botId);
    commandData = await api.get(`/bots/${encodeURIComponent(params.botId)}/commands`);
    try {
      const res = await api.get(`/bots/${encodeURIComponent(params.botId)}/workflows`);
      workflows = res.workflows || [];
    } catch {
      workflows = [];
    }
  } catch (err) {
    renderPageError(container, {
      title: 'Could not load commands',
      message: err.message,
      retry: () => mountCommands(container, { params }),
    });
    return;
  }

  const bot = botData.bot;
  const { commands, sync } = commandData;
  const reload = () => mountCommands(container, { params });

  const syncBadge =
    sync.state === 'in_sync'
      ? '<span class="badge badge--success">Telegram menu in sync</span>'
      : sync.state === 'pending_changes'
        ? '<span class="badge badge--warning">Local changes not published to Telegram</span>'
        : '<span class="badge badge--neutral">Never synced to Telegram</span>';

  container.innerHTML = `
    <div class="page">
      ${renderBotHeader(bot, 'commands')}

      <div class="row-between">
        <div class="row" style="gap:var(--space-2)">
          ${syncBadge}
          <span class="small muted">${sync.lastSyncedAt ? `Last sync ${relativeTime(sync.lastSyncedAt)}` : 'No sync recorded'}</span>
        </div>
        <div class="row">
          <button class="btn btn--secondary btn--sm" type="button" id="import-commands">${icon('download')} Import from Telegram</button>
          <button class="btn btn--secondary btn--sm" type="button" id="sync-commands">${icon('upload')} Sync menu to Telegram</button>
          <button class="btn btn--primary btn--sm" type="button" id="new-command">${icon('plus')} New command</button>
        </div>
      </div>

      <div class="alert alert--info small">
        ${icon('info')}
        <div class="alert__body"><div class="alert__text">
          BotForge answers commands from this list through its own runtime. <strong>Sync menu</strong> only updates the
          command menu Telegram shows to users - it never deletes commands from BotForge.
        </div></div>
      </div>

      ${
        commands.length === 0
          ? `<section class="card"><div class="card__body">
              <div class="empty">
                <div class="empty__icon">${icon('terminal')}</div>
                <h3>No commands yet</h3>
                <p class="secondary">Create a <code>/start</code> command to greet new users, or import the command menu already configured in BotFather.</p>
                <div class="empty__actions">
                  <button class="btn btn--primary" type="button" id="empty-new-command">${icon('plus')} Create /start</button>
                  <button class="btn btn--secondary" type="button" id="empty-import">${icon('download')} Import from Telegram</button>
                </div>
              </div>
            </div></section>`
          : `<section class="card">
              <div class="card__header">
                <div>
                  <h2 class="card__title">Commands</h2>
                  <p class="card__subtitle">${commands.length} command${commands.length === 1 ? '' : 's'} · ${commands.filter((c) => c.enabled).length} enabled</p>
                </div>
              </div>
              <div class="card__body card__body--flush">
                <div class="list">${commands.map(commandRow).join('')}</div>
              </div>
            </section>`
      }
    </div>`;

  bindBotHeader(container, {
    bot,
    onRefresh: async () => {
      try {
        await api.post(`/bots/${encodeURIComponent(bot.id)}/validate`);
        toastSuccess('Connection revalidated.');
      } catch (err) {
        toastError(err.message);
      }
      reload();
    },
  });

  const openEditor = (command = null) =>
    openCommandEditor({ botId: bot.id, command, workflows, onSaved: () => reload() });

  container.querySelector('#new-command')?.addEventListener('click', () => openEditor());
  container.querySelector('#empty-new-command')?.addEventListener('click', () =>
    openEditor({ name: 'start', description: 'Show the welcome menu', reply: { text: '' }, keyboard: { rows: [] } }),
  );

  const doImport = async () => {
    try {
      const result = await api.post(`/bots/${encodeURIComponent(bot.id)}/commands/import`);
      if (result.imported.length === 0) {
        toastWarning('Telegram has no additional commands to import.');
      } else {
        toastSuccess(`Imported ${result.imported.join(', ')}.`);
      }
      reload();
    } catch (err) {
      toastError(err.message);
    }
  };
  container.querySelector('#import-commands')?.addEventListener('click', doImport);
  container.querySelector('#empty-import')?.addEventListener('click', doImport);

  container.querySelector('#sync-commands')?.addEventListener('click', async () => {
    const enabled = commands.filter((c) => c.enabled);
    const preview = enabled.map((c) => `/${c.name}${c.description ? ` - ${c.description}` : ''}`).join('\n');
    const confirmed = await confirmDialog({
      title: 'Replace the Telegram command menu?',
      message: `Telegram will show exactly these ${enabled.length} command(s):\n\n${preview || '(none - the menu will be cleared)'}\n\nThis overwrites the menu currently stored in Telegram for the default scope.`,
      confirmLabel: 'Sync to Telegram',
      tone: 'primary',
    });
    if (!confirmed) return;
    try {
      const result = await api.post(`/bots/${encodeURIComponent(bot.id)}/commands/sync`, { confirm: true });
      toastSuccess(`Synced ${result.commands.length} command(s) to Telegram.`);
      reload();
    } catch (err) {
      toastError(err.message);
    }
  });

  container.querySelectorAll('[data-edit-command]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const command = commands.find((c) => c.id === btn.dataset.editCommand);
      openEditor(command);
    }),
  );

  container.querySelectorAll('[data-toggle-command]').forEach((input) =>
    input.addEventListener('change', async () => {
      const command = commands.find((c) => c.id === input.dataset.toggleCommand);
      try {
        await api.post(`/bots/${encodeURIComponent(bot.id)}/commands`, { ...command, enabled: input.checked });
        reload();
      } catch (err) {
        toastError(err.message);
        input.checked = !input.checked;
      }
    }),
  );

  container.querySelectorAll('[data-delete-command]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const command = commands.find((c) => c.id === btn.dataset.deleteCommand);
      const confirmed = await confirmDialog({
        title: `Delete /${command.name}?`,
        message: 'The command and its reply are removed from BotForge. The Telegram menu is unchanged until you sync again.',
        confirmLabel: 'Delete command',
        tone: 'danger',
      });
      if (!confirmed) return;
      try {
        await api.delete(`/bots/${encodeURIComponent(bot.id)}/commands/${encodeURIComponent(command.id)}`);
        toastSuccess(`Deleted /${command.name}.`);
        reload();
      } catch (err) {
        toastError(err.message);
      }
    }),
  );
}

function commandRow(command) {
  const buttons = command.keyboard?.rows?.flat() || [];
  return `<div class="list__item" style="align-items:flex-start">
    <div class="list__main">
      <div class="row" style="gap:var(--space-2)">
        <code style="font-size:var(--fs-sm)">/${escapeHtml(command.name)}</code>
        ${command.enabled ? '' : '<span class="badge badge--neutral">disabled</span>'}
        ${command.workflowId ? '<span class="badge badge--brand">workflow</span>' : ''}
        ${buttons.length ? `<span class="badge badge--neutral">${buttons.length} button${buttons.length === 1 ? '' : 's'}</span>` : ''}
      </div>
      <div class="small secondary" style="margin-top:2px">${escapeHtml(command.description || 'No menu description')}</div>
      <div class="small muted truncate" style="margin-top:2px;max-width:60ch">
        ${escapeHtml((command.reply?.text || 'No reply text — handled by a workflow').slice(0, 140))}
      </div>
    </div>
    <div class="row" style="gap:var(--space-1);flex-wrap:nowrap">
      <label class="switch" title="Enable command">
        <input type="checkbox" data-toggle-command="${escapeHtml(command.id)}" ${command.enabled ? 'checked' : ''}
          aria-label="Enable /${escapeHtml(command.name)}" />
        <span class="switch__track"></span>
      </label>
      <button class="icon-btn" type="button" data-edit-command="${escapeHtml(command.id)}" aria-label="Edit /${escapeHtml(command.name)}">${icon('edit')}</button>
      <button class="icon-btn" type="button" data-delete-command="${escapeHtml(command.id)}" aria-label="Delete /${escapeHtml(command.name)}">${icon('trash')}</button>
    </div>
  </div>`;
}
