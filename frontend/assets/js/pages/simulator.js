/**
 * Workflow simulator: an interactive, Telegram-like test chat backed by the
 * real workflow engine and a mock transport. Nothing here sends real messages.
 */
import { escapeHtml } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { loadBot, botStateMessage } from '../services/bot-context.js';
import { renderBotHeader } from '../components/bot-header.js';
import { skeletonPage, renderPageError } from '../components/states.js';
import {
  renderTranscript,
  renderStepTimeline,
  renderVariables,
  renderRunSummary,
  renderSimulatorError,
} from '../components/workflow-simulator.js';
import { api } from '../api-client.js';
import { toastSuccess, toastError } from '../components/toast.js';

export default async function mountSimulator(container, { params, query = {} }) {
  container.innerHTML = skeletonPage();
  let bot;
  let workflows = [];
  try {
    const data = await loadBot(params.botId);
    bot = data.bot;
    const res = await api.get(`/bots/${encodeURIComponent(params.botId)}/workflows`);
    workflows = res.workflows || [];
  } catch (err) {
    renderPageError(container, {
      title: 'Could not open the simulator',
      message: err.message,
      retry: () => mountSimulator(container, { params, query }),
    });
    return;
  }

  const state = {
    workflowId: [query.workflowId, query.workflow].find((id) => id && workflows.some((w) => w.id === id)) || workflows[0]?.id || null,
    source: query.source === 'published' ? 'published' : 'draft',
    messages: [],
    execution: null,
    steps: [],
    variables: {},
    trigger: null,
    error: null,
    busy: false,
    scenarios: [],
  };

  const botName = bot.telegram?.username ? `@${bot.telegram.username}` : bot.displayName || 'Your bot';
  const notice = botStateMessage(bot);

  if (!workflows.length) {
    container.innerHTML = `<div class="page">
      ${renderBotHeader(bot, 'simulator')}
      <div class="card"><div class="card__body"><div class="empty">
        ${icon('workflow')}
        <h3>No workflows to simulate yet</h3>
        <p class="secondary">Create a workflow first — the simulator runs your real workflow logic against a mock Telegram bot.</p>
        <div class="empty__actions">
          <a class="btn btn--primary" href="#/bots/${encodeURIComponent(bot.id)}/workflows">${icon('workflow')} Go to automations</a>
        </div>
      </div></div></div>
    </div>`;
    return;
  }

  container.innerHTML = `<div class="page">
    ${renderBotHeader(bot, 'simulator')}
    ${
      notice && notice.tone !== 'success'
        ? `<div class="alert alert--info">${icon('info')}<div class="alert__body">
            <div class="alert__title">${escapeHtml(notice.title)}</div>
            <div class="alert__text">${escapeHtml(notice.text)}</div>
          </div></div>`
        : ''
    }

    <div class="alert alert--info">${icon('flask')}
      <div class="alert__body">
        <div class="alert__title">Sandbox only</div>
        <div class="alert__text">Simulated runs use the real workflow engine with a mock Telegram adapter. No messages are sent to Telegram and no users are messaged.</div>
      </div>
    </div>

    <div class="sim-layout">
      <section class="card sim-phone" aria-label="Simulated Telegram chat">
        <div class="card__header sim-phone__header">
          <div class="sim-phone__title">
            <span class="sim-phone__avatar">${icon('bot')}</span>
            <div>
              <h2 class="card__title">${escapeHtml(botName)}</h2>
              <p class="card__subtitle" id="sim-context">Select a workflow to begin</p>
            </div>
          </div>
          <button class="btn btn--ghost btn--sm" type="button" id="sim-reset" title="Clear the conversation">${icon('refresh')} Reset</button>
        </div>
        <div class="sim-phone__body">
          <div id="sim-thread" aria-live="polite"></div>
          <form class="sim-composer" id="sim-form" autocomplete="off">
            <input class="input sim-composer__input" id="sim-text" type="text" maxlength="500"
              placeholder="Message ${escapeHtml(botName)}…" aria-label="Message to send to the simulated bot" />
            <button class="btn btn--primary btn--icon" type="submit" id="sim-send" aria-label="Send message">${icon('send')}</button>
          </form>
        </div>
      </section>

      <div class="sim-side">
        <section class="card">
          <div class="card__header"><div>
            <h2 class="card__title">${icon('workflow')} Run setup</h2>
            <p class="card__subtitle">Which workflow and version should answer?</p>
          </div></div>
          <div class="card__body stack">
            <div class="field">
              <label class="field__label" for="sim-workflow">Workflow</label>
              <select class="select" id="sim-workflow">
                ${workflows
                  .map(
                    (workflow) =>
                      `<option value="${escapeHtml(workflow.id)}"${workflow.id === state.workflowId ? ' selected' : ''}>${escapeHtml(
                        workflow.name,
                      )} (${escapeHtml(workflow.status)})</option>`,
                  )
                  .join('')}
              </select>
            </div>
            <div class="field">
              <label class="field__label" for="sim-source">Version</label>
              <select class="select" id="sim-source">
                <option value="draft"${state.source === 'draft' ? ' selected' : ''}>Draft (latest unsaved-to-live edits)</option>
                <option value="published"${state.source === 'published' ? ' selected' : ''}>Published version</option>
              </select>
            </div>
            <div class="row row--wrap">
              <button class="btn btn--secondary btn--sm" type="button" id="sim-send-start">${icon('play')} Send /start</button>
              <button class="btn btn--ghost btn--sm" type="button" id="sim-save-scenario">${icon('save')} Save scenario</button>
            </div>
            <div id="sim-scenarios"></div>
          </div>
        </section>

        <section class="card">
          <div class="card__header"><div>
            <h2 class="card__title">${icon('branch')} Branch tracing</h2>
            <p class="card__subtitle">Every executed step, in order</p>
          </div></div>
          <div class="card__body"><div id="sim-run"></div><div id="sim-steps"></div></div>
        </section>

        <section class="card">
          <div class="card__header"><div>
            <h2 class="card__title">${icon('code')} Variables</h2>
            <p class="card__subtitle">Captured during this run</p>
          </div></div>
          <div class="card__body"><div id="sim-variables"></div></div>
        </section>
      </div>
    </div>
  </div>`;

  const els = {
    thread: container.querySelector('#sim-thread'),
    form: container.querySelector('#sim-form'),
    input: container.querySelector('#sim-text'),
    send: container.querySelector('#sim-send'),
    workflow: container.querySelector('#sim-workflow'),
    source: container.querySelector('#sim-source'),
    run: container.querySelector('#sim-run'),
    steps: container.querySelector('#sim-steps'),
    variables: container.querySelector('#sim-variables'),
    scenarios: container.querySelector('#sim-scenarios'),
    context: container.querySelector('#sim-context'),
    reset: container.querySelector('#sim-reset'),
    start: container.querySelector('#sim-send-start'),
    saveScenario: container.querySelector('#sim-save-scenario'),
  };

  const currentWorkflow = () => workflows.find((workflow) => workflow.id === state.workflowId) || null;

  function paintThread() {
    els.thread.innerHTML = state.error
      ? renderSimulatorError(state.error)
      : renderTranscript(state.messages, { botName: botName.startsWith('@') ? botName : bot.displayName || 'Your bot' });
    els.thread.scrollTop = els.thread.scrollHeight;
  }

  function paintResults() {
    els.run.innerHTML = state.execution ? renderRunSummary(state.execution, state.trigger) : '';
    els.steps.innerHTML = state.execution ? renderStepTimeline(state.steps) : '';
    els.variables.innerHTML = renderVariables(state.variables);
  }

  function paintContext() {
    const workflow = currentWorkflow();
    els.context.textContent = workflow
      ? `${workflow.name} · ${state.source === 'draft' ? 'draft' : `published v${workflow.publishedVersion ?? '?'}`}`
      : 'Select a workflow to begin';
  }

  function setBusy(busy) {
    state.busy = busy;
    els.send.disabled = busy;
    els.input.disabled = busy;
    els.start.disabled = busy;
    els.send.classList.toggle('is-loading', busy);
  }

  async function paintScenarios() {
    try {
      const res = await api.get(`/bots/${encodeURIComponent(params.botId)}/simulate/scenarios`);
      state.scenarios = res.scenarios || [];
    } catch {
      state.scenarios = [];
    }
    if (!state.scenarios.length) {
      els.scenarios.innerHTML = `<p class="secondary small" style="margin:0">Saved scenarios replay a conversation with one tap.</p>`;
      return;
    }
    els.scenarios.innerHTML = `<div class="stack-sm">
      <p class="field__label" style="margin:0">Saved scenarios</p>
      ${state.scenarios
        .map(
          (scenario) => `<div class="row row--between sim-scenario">
            <button class="btn btn--ghost btn--sm" type="button" data-scenario="${escapeHtml(scenario.id)}">${icon('play')} ${escapeHtml(
              scenario.name,
            )}</button>
            <button class="btn btn--ghost btn--sm btn--icon" type="button" data-scenario-delete="${escapeHtml(
              scenario.id,
            )}" aria-label="Delete scenario ${escapeHtml(scenario.name)}">${icon('trash')}</button>
          </div>`,
        )
        .join('')}
    </div>`;
  }

  /** Runs the simulator with an event, appending the user turn to the chat. */
  async function run(event, { echo = true } = {}) {
    if (state.busy) return;
    if (!state.workflowId) {
      toastError('Choose a workflow first.');
      return;
    }
    state.error = null;
    if (echo) {
      state.messages.push({
        direction: 'in',
        kind: event.callbackData ? 'callback' : 'text',
        text: event.callbackData ? '' : event.text,
        callbackData: event.callbackData || null,
        at: new Date().toISOString(),
      });
      paintThread();
    }
    setBusy(true);
    try {
      const res = await api.post(`/bots/${encodeURIComponent(params.botId)}/simulate`, {
        workflowId: state.workflowId,
        source: state.source,
        event: {
          type: event.type || (event.callbackData ? 'callback' : 'text'),
          text: event.text || '',
          callbackData: event.callbackData || null,
        },
      });
      state.execution = res.execution;
      state.steps = res.steps || [];
      state.variables = res.variables || {};
      state.trigger = res.trigger || null;
      // Replace local optimistic turns with the authoritative transcript.
      state.messages = res.transcript || state.messages;
    } catch (err) {
      state.execution = null;
      state.steps = [];
      state.variables = {};
      state.trigger = null;
      state.error = { message: err.message, details: err.details || [], code: err.code };
    } finally {
      setBusy(false);
      paintThread();
      paintResults();
    }
  }

  els.form.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = els.input.value.trim();
    if (!text) return;
    els.input.value = '';
    run({ type: text.startsWith('/') ? 'text' : 'text', text });
  });

  els.start.addEventListener('click', () => run({ type: 'text', text: '/start' }));

  // Inline keyboard taps are delegated: bubbles are re-rendered constantly.
  els.thread.addEventListener('click', (event) => {
    const button = event.target.closest('[data-callback]');
    if (!button) return;
    run({ type: 'callback', callbackData: button.dataset.callback }, { echo: true });
  });

  els.workflow.addEventListener('change', () => {
    state.workflowId = els.workflow.value;
    state.messages = [];
    state.execution = null;
    state.steps = [];
    state.variables = {};
    state.error = null;
    paintThread();
    paintResults();
    paintContext();
  });

  els.source.addEventListener('change', () => {
    state.source = els.source.value;
    paintContext();
  });

  els.reset.addEventListener('click', () => {
    state.messages = [];
    state.execution = null;
    state.steps = [];
    state.variables = {};
    state.trigger = null;
    state.error = null;
    paintThread();
    paintResults();
    els.input.focus();
  });

  els.saveScenario.addEventListener('click', async () => {
    const name = window.prompt('Name this scenario', 'Starting conversation');
    if (!name) return;
    try {
      await api.post(`/bots/${encodeURIComponent(params.botId)}/simulate/scenarios`, {
        name,
        workflowId: state.workflowId,
        events: [{ type: 'text', text: els.input.value.trim() || '/start' }],
      });
      toastSuccess('Scenario saved.');
      await paintScenarios();
    } catch (err) {
      toastError(err.message);
    }
  });

  els.scenarios.addEventListener('click', async (event) => {
    const replay = event.target.closest('[data-scenario]');
    const remove = event.target.closest('[data-scenario-delete]');
    if (replay) {
      const scenario = state.scenarios.find((item) => item.id === replay.dataset.scenario);
      if (!scenario) return;
      state.messages = [];
      if (scenario.workflowId && workflows.some((workflow) => workflow.id === scenario.workflowId)) {
        state.workflowId = scenario.workflowId;
        els.workflow.value = scenario.workflowId;
        paintContext();
      }
      for (const step of scenario.events || []) {
        await run({ type: step.type, text: step.text, callbackData: step.callbackData });
      }
    }
    if (remove) {
      try {
        await api.delete(`/bots/${encodeURIComponent(params.botId)}/simulate/scenarios/${encodeURIComponent(remove.dataset.scenarioDelete)}`);
        toastSuccess('Scenario deleted.');
        await paintScenarios();
      } catch (err) {
        toastError(err.message);
      }
    }
  });

  paintThread();
  paintResults();
  paintContext();
  await paintScenarios();
  els.input.focus();
}
