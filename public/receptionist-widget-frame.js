(function () {
  'use strict';
  const config = JSON.parse(document.getElementById('receptionist-data').textContent);
  const get = id => document.getElementById(id);
  const status = get('status');
  const question = get('question');
  const send = get('send');
  const retry = get('retry');
  const newChat = get('new-chat');
  const review = get('review');
  const confirm = get('confirm');
  const consent = get('consent');
  const callbackStatus = get('callback-status');
  const callbackReview = get('callback-review');
  const feedbackSection = get('feedback-section');
  const feedbackForm = get('feedback-form');
  const feedbackQuestion = get('feedback-question');
  const feedbackConsent = get('feedback-consent');
  const feedbackSave = get('feedback-save');
  const feedbackStatus = get('feedback-status');
  let feedbackEnabled = false, feedbackBusy = false, feedbackSent = false, feedbackPending = null, lastFeedbackQuestion = null, feedbackEpoch = 0;
  const fields = [get('full-name'), get('phone'), get('reason')];
  const api = `/api/public/website-receptionist/${config.publicId}`;
  let handshaken = false;
  let starting = false;
  let session = null;
  let turn = 0;
  let history = [];
  let canMessage = false;
  let busy = false;
  let pending = null;
  let callbackBusy = false;
  let callbackSent = false;
  let reviewed = null;
  let callbackPending = null;
  get('business-name').textContent = config.businessName;
  get('consent-label').textContent = `I agree ${config.businessName} may contact me about this request.`;

  function controls() {
    question.disabled = !session || !canMessage || busy || feedbackBusy || !!pending || !!feedbackPending;
    send.disabled = question.disabled;
    retry.hidden = !pending || busy || !session;
    review.disabled = !session || callbackBusy || callbackSent || !!callbackPending;
    confirm.disabled = !session || callbackBusy || callbackSent || !reviewed || !consent.checked;
    fields.forEach(field => { field.disabled = callbackBusy || callbackSent || !!callbackPending; });
    consent.disabled = callbackBusy || callbackSent || !!callbackPending;
    newChat.disabled = starting || busy || callbackBusy || feedbackBusy || !!feedbackPending;
    const feedbackReady = !!session && feedbackEnabled && !!lastFeedbackQuestion;
    feedbackSection.hidden = !feedbackReady;
    get('feedback-open').hidden = !feedbackReady || feedbackSent || !feedbackForm.hidden;
    get('feedback-open').disabled = busy || feedbackBusy || !!pending;
    get('feedback-close').disabled = feedbackBusy;
    feedbackQuestion.disabled = busy || feedbackBusy || feedbackSent || !!feedbackPending;
    feedbackConsent.disabled = feedbackQuestion.disabled;
    feedbackSave.disabled = !feedbackReady || busy || feedbackBusy || feedbackSent || (!feedbackPending && (!feedbackConsent.checked || !feedbackQuestion.value.trim()));
  }

  function expire() {
    session = null;
    pending = null;
    resetFeedback();
    canMessage = false;
    reviewed = null;
    callbackPending = null;
    consent.checked = false;
    callbackReview.hidden = true;
    status.textContent = 'This chat has ended or the business settings changed. Start a new chat to continue.';
    newChat.hidden = false;
    controls();
  }

  function active() {
    if (!session) return false;
    if (Date.now() >= Date.parse(session.expiresAt)) { expire(); return false; }
    return true;
  }

  function addMessage(speaker, text) {
    const item = document.createElement('li');
    if (speaker === 'You') item.className = 'visitor';
    const label = document.createElement('span');
    label.className = 'speaker';
    label.textContent = speaker;
    item.append(label, document.createTextNode(text));
    get('messages').append(item);
  }

  async function request(endpoint, body, token) {
    const response = await fetch(`${api}/${endpoint}`, {
      method: 'POST',
      credentials: 'omit',
      mode: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      let code;
      if (response.status === 409) {
        try {
          const body = await response.json();
          if (body?.error?.code === 'WEBSITE_CHAT_CLOSED') code = 'WEBSITE_CHAT_CLOSED';
        } catch { /* Error response bodies are optional and never displayed. */ }
      }
      throw { status: response.status, code };
    }
    const json = await response.json();
    if (!json || !json.data || typeof json.data !== 'object') throw new Error('Invalid response');
    return json.data;
  }

  function errorText(error) {
    if (error.status === 429) return 'Please wait before trying again. The business may have reached its daily limit.';
    if (error.status === 409) return 'Your previous request is still being processed. Wait a moment, then retry the same request.';
    if (error.status === 400) return 'Please check your details and try again.';
    if (error.status === 404 || error.status === 403) return 'This assistant is unavailable. Please contact the business directly.';
    return 'We could not confirm the response. You can retry, or contact the business directly.';
  }

  async function start() {
    if (!handshaken || starting || busy || callbackBusy || feedbackBusy || feedbackPending) return;
    starting = true;
    session = null;
    pending = null;
    resetFeedback();
    history = [];
    turn = 0;
    callbackSent = false;
    reviewed = null;
    callbackPending = null;
    consent.checked = false;
    callbackReview.hidden = true;
    callbackStatus.textContent = '';
    get('messages').replaceChildren();
    status.textContent = 'Connecting to the business…';
    newChat.hidden = true;
    controls();
    try {
      const data = await request('session', { siteOrigin: config.siteOrigin, website: get('website').value });
      if (!/^[a-f0-9]{64}$/.test(data.token) || !Number.isFinite(Date.parse(data.expiresAt)) || data.turn !== 0 || typeof data.greeting !== 'string' || data.greeting.length > 600) throw new Error('Invalid response');
      session = { token: data.token, expiresAt: data.expiresAt };
      feedbackEnabled = data.feedbackEnabled === true;
      canMessage = true;
      addMessage('Assistant', data.greeting);
      status.textContent = '';
    } catch (error) {
      status.textContent = errorText(error);
      newChat.hidden = false;
    } finally { starting = false; controls(); }
  }

  function boundedHistory() {
    const result = history.slice(-4);
    while (new TextEncoder().encode(result.join('\n')).length > 4000) result.shift();
    return result;
  }

  async function submitQuestion() {
    if (busy || feedbackBusy || feedbackPending || !active() || !canMessage) return;
    if (!pending) {
      const value = question.value.trim();
      if (!value || value.length > 1000 || value.includes('\0') || new TextEncoder().encode(value).length > 2000) {
        status.textContent = 'Please use a shorter question, up to 1,000 characters.';
        return;
      }
      pending = { requestId: crypto.randomUUID(), expectedTurn: turn, question: value, history: boundedHistory(), website: get('website').value };
    }
    const body = pending;
    busy = true;
    status.textContent = 'Waiting for a reply…';
    controls();
    try {
      const data = await request('message', body, session.token);
      if (typeof data.reply !== 'string' || !data.reply.length || data.reply.length > 600 || data.turn !== turn + 1 || typeof data.canMessage !== 'boolean') throw new Error('Invalid response');
      resetFeedback();
      lastFeedbackQuestion = { requestId: body.requestId, question: body.question };
      addMessage('You', body.question);
      addMessage('Assistant', data.reply);
      turn = data.turn;
      history.push(body.question);
      history = history.slice(-4);
      canMessage = data.canMessage && turn < 6;
      question.value = '';
      pending = null;
      status.textContent = canMessage ? '' : 'This chat has reached its question limit. You can still request a callback.';
    } catch (error) {
      if (error.status === 410 || error.status === 401) expire();
      else if (error.status === 409 && error.code === 'WEBSITE_CHAT_CLOSED') {
        pending = null;
        canMessage = false;
        status.textContent = 'This chat has ended. You can still request a callback, or start a new chat.';
        newChat.hidden = false;
      } else {
        status.textContent = errorText(error);
        if (error.status === 400) pending = null;
        if (error.status === 404 || error.status === 403) { canMessage = false; pending = null; }
      }
    } finally { busy = false; controls(); }
  }

  function resetFeedback() {
    feedbackEpoch++;
    feedbackBusy = false; feedbackSent = false; feedbackPending = null; lastFeedbackQuestion = null;
    feedbackForm.hidden = true; feedbackConsent.checked = false; feedbackQuestion.value = ''; feedbackStatus.textContent = '';
  }
  get('feedback-open').addEventListener('click', function () {
    if (!active() || !feedbackEnabled || !lastFeedbackQuestion || busy || feedbackBusy || feedbackSent) return;
    feedbackQuestion.value = lastFeedbackQuestion.question; feedbackConsent.checked = false; feedbackForm.hidden = false; feedbackStatus.textContent = ''; controls(); feedbackQuestion.focus();
  });
  feedbackQuestion.addEventListener('input', function () { feedbackConsent.checked = false; controls(); });
  get('feedback-close').addEventListener('click', function () {
    if (feedbackBusy) return;
    feedbackEpoch++;
    const uncertain = !!feedbackPending;
    feedbackPending = null; feedbackSent = uncertain; feedbackForm.hidden = true; feedbackConsent.checked = false; feedbackQuestion.value = '';
    feedbackStatus.textContent = uncertain ? 'Feedback may already have been saved. No further retries will be sent.' : '';
    controls();
  });
  feedbackConsent.addEventListener('change', controls);
  feedbackForm.addEventListener('submit', function (event) { event.preventDefault(); });
  feedbackSave.addEventListener('click', async function () {
    if (!active() || !feedbackEnabled || !lastFeedbackQuestion || feedbackBusy || feedbackSent || busy) return;
    if (!feedbackPending) {
      const value = feedbackQuestion.value.trim();
      if (!feedbackConsent.checked || !value || value.length > 1000 || value.includes('\u0000') || new TextEncoder().encode(value).length > 2000) { feedbackStatus.textContent = 'Review a question up to 1,000 characters and agree before saving.'; return; }
      feedbackPending = { requestId: lastFeedbackQuestion.requestId, question: value, consented: true, website: get('website').value };
    }
    const epoch = feedbackEpoch, requestToken = session.token, payload = feedbackPending;
    const isCurrent = () => feedbackEpoch === epoch && session?.token === requestToken;
    feedbackBusy = true; feedbackStatus.textContent = 'Saving your feedback…'; controls();
    try {
      const data = await request('feedback', payload, requestToken);
      if (!isCurrent()) return;
      if (data.received !== true) throw new Error('Invalid feedback response');
      feedbackPending = null; feedbackSent = true; feedbackForm.hidden = true; feedbackQuestion.value = ''; feedbackConsent.checked = false; feedbackStatus.textContent = 'Feedback saved for the business to review.';
    } catch (error) {
      if (!isCurrent()) return;
      if (error.status === 410 || error.status === 401) expire();
      else if (error.status === 403 || error.status === 404) { resetFeedback(); feedbackEnabled = false; status.textContent = 'Feedback saving is unavailable. You can still request a callback.'; controls(); }
      else if (error.status === 400 || error.status === 409) { feedbackPending = null; feedbackConsent.checked = false; feedbackStatus.textContent = 'Feedback was not saved. Review the question and try again after the current answer.'; }
      else feedbackStatus.textContent = 'We could not confirm your feedback. Retry Save feedback to resend the same reviewed question.';
    } finally { if (isCurrent()) { feedbackBusy = false; controls(); } }
  });

  function callbackValues() {
    return { fullName: fields[0].value.trim(), phone: fields[1].value.trim(), reason: fields[2].value.trim(), confirmed: true, website: get('website').value };
  }

  function resetReview() {
    if (callbackBusy || callbackSent || callbackPending) return;
    reviewed = null;
    callbackPending = null;
    consent.checked = false;
    callbackReview.hidden = true;
    callbackStatus.textContent = '';
    controls();
  }
  fields.forEach(field => { field.addEventListener('input', resetReview); field.addEventListener('change', resetReview); });
  consent.addEventListener('change', controls);
  review.addEventListener('click', function () {
    if (callbackBusy || callbackSent || !active() || !get('callback-form').reportValidity()) return;
    const values = callbackValues();
    if (!values.fullName || values.fullName.length > 120 || !/^\+[1-9][0-9]{7,14}$/.test(values.phone) || !values.reason || values.reason.length > 1000 || [values.fullName, values.reason].some(value => value.includes('\0'))) {
      callbackStatus.textContent = 'Check your name, international phone number, and callback request.';
      return;
    }
    reviewed = values;
    consent.checked = false;
    get('review-name').textContent = values.fullName;
    get('review-phone').textContent = values.phone;
    get('review-reason').textContent = values.reason;
    callbackReview.hidden = false;
    callbackStatus.textContent = '';
    controls();
  });
  confirm.addEventListener('click', async function () {
    if (callbackBusy || callbackSent || !active() || !reviewed || !consent.checked) return;
    if (JSON.stringify(callbackValues()) !== JSON.stringify(reviewed)) { resetReview(); return; }
    callbackPending = callbackPending || { ...reviewed };
    callbackBusy = true;
    callbackStatus.textContent = 'Sending your request…';
    controls();
    try {
      const data = await request('callback', callbackPending, session.token);
      if (data.received !== true) throw new Error('Invalid response');
      callbackSent = true;
      callbackReview.hidden = true;
      callbackStatus.textContent = 'Your request was sent to the business for review.';
    } catch (error) {
      if (error.status === 410 || error.status === 401) expire();
      else {
        if (error.status === 400) callbackPending = null;
        callbackStatus.textContent = errorText(error);
      }
    } finally { callbackBusy = false; controls(); }
  });
  send.addEventListener('click', submitQuestion);
  get('question-form').addEventListener('submit', function (event) { event.preventDefault(); });
  get('callback-form').addEventListener('submit', function (event) { event.preventDefault(); });
  retry.addEventListener('click', submitQuestion);
  newChat.addEventListener('click', start);

  window.addEventListener('message', function (event) {
    if (window.parent === window || handshaken || event.source !== window.parent || event.origin !== config.siteOrigin || !config.allowedOrigins.includes(event.origin) || event.data?.type !== 'flowrish-receptionist:init') return;
    handshaken = true;
    start();
  });
  if (window.parent !== window) window.parent.postMessage({ type: 'flowrish-receptionist:ready' }, config.siteOrigin);
  else status.textContent = 'Open this assistant from the business website to start a chat.';
})();
