(() => {
  const form = document.getElementById('joinForm');
  if (!form) return;

  const error = document.getElementById('joinError');
  const submit = form.querySelector('button[type="submit"]');
  const server = String(window.CHAT_SERVER_URL || '').replace(/\/$/, '');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.textContent = '';

    if (!server || server.includes('REPLACE-WITH')) {
      error.textContent = 'Set your backend URL in config.js first.';
      return;
    }

    const name = document.getElementById('name').value.trim();
    const room = document.getElementById('room').value.trim();
    const password = document.getElementById('password').value;
    const oldLabel = submit.innerHTML;
    submit.disabled = true;
    submit.textContent = 'Connecting…';

    try {
      const response = await fetch(`${server}/api/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, room, password })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not join the room.');

      // Store only the short-lived JWT and room display data. Never persist the room password.
      sessionStorage.setItem('drishya_chat_session', JSON.stringify({
        token: data.token,
        name: data.user.name,
        room: data.room
      }));
      location.assign('chat.html');
    } catch (err) {
      error.textContent = err.message || 'Could not join the room.';
      submit.disabled = false;
      submit.innerHTML = oldLabel;
    }
  });
})();
