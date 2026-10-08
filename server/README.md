# ChatApp Public Backend

## Deploy

Recommended:
- Backend: Render or Railway
- Database: managed PostgreSQL
- Frontend: Netlify

Set these environment variables on the backend:

- `DATABASE_URL`
- `JWT_SECRET` — long random secret, 32+ chars
- `CLIENT_ORIGIN` — exact Netlify URL
- `NODE_ENV=production`

Optional for reliable calls:
- `TURN_URL`
- `TURN_USERNAME`
- `TURN_PASSWORD`

Start command:

```bash
npm install
npm start
```

Health check:

```text
https://YOUR-BACKEND/health
```

The server automatically creates its PostgreSQL tables on first boot.

### Security notes

- Room passwords are bcrypt-hashed.
- Socket.IO requires a signed short-lived JWT.
- CORS is restricted to the configured frontend origin.
- Helmet security headers are enabled.
- Join endpoint is rate-limited.
- Messages are length-limited.
- Users can delete only their own messages.
- Database queries are parameterized.
- Never commit `.env` or credentials.
