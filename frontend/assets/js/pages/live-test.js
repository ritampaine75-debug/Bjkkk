/**
 * Live test lab: send exactly one real Telegram message to a chat you control.
 * Every send requires an explicit confirmation checkbox on this screen.
 */
import { escapeHtml, relativeTime } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { loadBot, botStateMessage } from '../services/bot-context.js';
import { renderBotHeader } from '../components/bot-header.js';
import { skeletonPage, renderPageError } from '../components/states.js';
import { api } from '../api-client.js';
import { toastError } from '../components/toast.js';

export default async function mountLiveTest(container, { params }) {
  container.innerHTML = skeletonPage();
  let bot;
  let published = [];
  try {
    const data = await loadBot(params.botId);
    bot = data.bot;
    const res = await api.get(`/bots/${encodeURIComponent(params.botId)}/workflows`);
    published = (res.workflows || []).filter((workflow) => workflow.status === 'published');
  } catch (err) {
    renderPageError(container, {
      title: 'Could not open the live test lab',
      message: err.message,
      retry: () => mountLiveTest(container, { params }),
    });
    return;
  }

  const notice = botStateMessage(bot);
  const blocked = bot.status === 'revoked' || bot.connection?.state === 'revoked';

  container.innerHTML = `<div class="page">
    ${renderBotHeader(bot, 'live-test')}
    <div class="alert alert--warning">${icon('alert')}
      <div class="alert__body">
        <div class="alert__title">This sends a real Telegram message</div>
        <div class="alert__text">
          Messages are delivered immediately to the chat id you enter, using this bot's live token.
          Only message chats you control. Use the <a href="#/bots/${encodeURIComponent(bot.id)}/simulator">simulator</a> to test workflows safely.
        </div>
      </div>
    </div>
    ${notice && notice.tone !== 'success' ? `<div class="alert alert--${notice.tone === 'danger' ? 'danger' : 'info'}">${icon('info')}
      <div class="alert__body"><div class="alert__title">${escapeHtml(notice.title)}</div><div class="alert__text">${escapeHtml(notice.text)}</div></div></div>` : ''}

    <div class="split-2">
      <section class="card">
        <div class="card__header"><div>
          <h2 class="card__title">${icon('send')} Send one test message</h2>
          <p class="card__subtitle">Delivered with the stored token through the Telegram Bot API</p>
        </div></div>
        <div class="card__body">
          <form id="live-test-form" class="stack" novalidate>
            <div class="field">
              <label class="field__label" for="chat-id">Telegram chat id</label>
              <input class="input input--mono" id="chat-id" inputmode="numeric" placeholder="123456789" required ${blocked ? 'disabled' : ''} />
              <p class="field__hint">Send any message to your bot, then open <code>https://api.telegram.org/bot&lt;token&gt;/getUpdates</code> to find your numeric id. Group ids are negative.</p>
            </div>
            <div class="field">
              <label class="field__label" for="message-text">Message</label>
              <textarea class="textarea" id="message-text" rows="4" maxlength="4096" ${blocked ? 'disabled' : ''}>BotForge live test</textarea>
              <p class="field__hint"><span id="char-count">18</span> / 4096 characters</p>
            </div>
            <label class="checkbox">
              <input type="checkbox" id="live-confirm" ${blocked ? 'disabled' : ''} />
              <span>I understand this sends a real Telegram message to the chat above.</span>
            </label>
            <div id="live-feedback" role="status" aria-live="polite"></div>
            <button class="btn btn--primary" type="submit" id="live-send" ${blocked ? 'disabled' : ''}>${icon('send')} Send message</button>
          </form>
        </div>
      </section>

      <div class="stack">
        <section class="card">
          <div class="card__header"><div>
            <h2 class="card__title">${icon('globe')} Runtime state</h2>
            <p class="card__subtitle">Is Telegram actually delivering updates?</p>
          </div></div>
          <div class="card__body" id="live-runtime"><div class="skeleton skeleton--block"></div></div>
        </section>
        <section class="card">
          <div class="card__header"><div>
            <h2 class="card__title">${icon('workflow')} Published workflows</h2>
            <p class="card__subtitle">These answer live Telegram updates</p>
          </div></div>
          <div class="card__body">
            ${
              published.length
                ? `<ul class="stack-sm small" style="margin:0;padding-left:1.1rem">${published
                    .map((workflow) => `<li>${escapeHtml(workflow.name)} — ${escapeHtml(workflow.summary?.triggerSummary || 'no trigger')}</li>`)
                    .join('')}</ul>`
                : `<p class="secondary small" style="margin:0">No workflows are published yet, so only stored command replies will answer.</p>`
            }
          </div>
        </section>
      </div>
    </div>
  </div>`;

  const form = container.querySelector('#live-test-form');
  const feedback = container.querySelector('#live-feedback');
  const chatId = container.querySelector('#chat-id');
  const messageText = container.querySelector('#message-text');
  const confirmBox = container.querySelector('#live-confirm');
  const charCount = container.querySelector('#char-count');
  const sendButton = container.querySelector('#live-send');

  messageText.addEventListener('input', () => {
    charCount.textContent = String(messageText.value.length);
  });

  async function paintRuntime() {
    const box = container.querySelector('#live-runtime');
    try {
      const [runtimeRes, webhookRes] = await Promise.all([
        api.get(`/bots/${encodeURIComponent(bot.id)}/runtime`),
        api.get(`/bots/${encodeURIComponent(bot.id)}/webhook`),
      ]);
      const runtime = runtimeRes.runtime;
      const webhook = webhookRes.webhook;
      box.innerHTML = `<dl class="stack-sm small" style="margin:0">
        <div class="row-between"><dt class="muted">Webhook</dt><dd style="margin:0">${escapeHtml(webhook.state.replace(/_/g, ' '))}</dd></div>
        <div class="row-between"><dt class="muted">Worker</dt><dd style="margin:0">${escapeHtml(runtime.worker.state)}</dd></div>
        <div class="row-between"><dt class="muted">Queue</dt><dd style="margin:0">${runtime.queue.active} active / ${runtime.queue.pending} queued</dd></div>
        <div class="row-between"><dt class="muted">Updates processed</dt><dd style="margin:0">${runtime.processedUpdates}</dd></div>
        <div class="row-between"><dt class="muted">Last update</dt><dd style="margin:0">${escapeHtml(
          runtime.lastUpdateAt ? relativeTime(runtime.lastUpdateAt) : 'none recorded',
        )}</dd></div>
      </dl>
      ${webhook.state !== 'active' ? `<p class="field__hint">Register the webhook in <a href="#/bots/${encodeURIComponent(bot.id)}/settings">bot settings</a> so Telegram starts delivering updates.</p>` : ''}`;
    } catch (err) {
      box.innerHTML = `<p class="secondary small" style="margin:0">Runtime state unavailable: ${escapeHtml(err.message)}</p>`;
    }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    feedback.innerHTML = '';
    const id = chatId.value.trim();
    if (!/^-?\d{1,20}$/.test(id)) {
      feedback.innerHTML = `<div class="alert alert--danger small">${icon('alert')}<div class="alert__body"><div class="alert__text">Enter a numeric Telegram chat id.</div></div></div>`;
      return;
    }
    if (!messageText.value.trim()) {
      feedback.innerHTML = `<div class="alert alert--danger small">${icon('alert')}<div class="alert__body"><div class="alert__text">The message cannot be empty.</div></div></div>`;
      return;
    }
    if (!confirmBox.checked) {
      feedback.innerHTML = `<div class="alert alert--danger small">${icon('alert')}<div class="alert__body"><div class="alert__text">Tick the confirmation box first — this sends a real message.</div></div></div>`;
      return;
    }
    sendButton.disabled = true;
    sendButton.classList.add('is-loading');
    try {
      const res = await api.post(`/bots/${encodeURIComponent(bot.id)}/live-test`, {
        chatId: id,
        text: messageText.value,
        confirm: true,
      });
      feedback.innerHTML = `<div class="alert alert--info small">${icon('checkCircle')}<div class="alert__body">
        <div class="alert__title">Message delivered</div>
        <div class="alert__text">Telegram accepted the message (id ${escapeHtml(String(res.messageId ?? 'unknown'))}) for chat ${escapeHtml(res.chatId)}.</div>
      </div></div>`;
    } catch (err) {
      feedback.innerHTML = `<div class="alert alert--danger small">${icon('xCircle')}<div class="alert__body">
        <div class="alert__title">Not delivered</div>
        <div class="alert__text">${escapeHtml(err.message)}${err.code ? ` (${escapeHtml(err.code)})` : ''}</div>
      </div></div>`;
      toastError(err.message);
    } finally {
      sendButton.disabled = false;
      sendButton.classList.remove('is-loading');
      paintRuntime();
    }
  });

  await paintRuntime();
}
