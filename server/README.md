# BasuRANT — Firebase Admin API (local)

This small Express server demonstrates how to list Firebase Authentication users using the Firebase Admin SDK. Browsers cannot list / enumerate all Auth users — that must be done server-side with admin credentials.

Prerequisites
- Node.js 16+ installed
- A Firebase project service account JSON (create in Firebase Console -> Project Settings -> Service accounts -> Generate new private key)

Installation

Open PowerShell in this folder and run:

```powershell
# set path to service account JSON and an API key (example)
$Env:GOOGLE_APPLICATION_CREDENTIALS = "C:\path\to\serviceAccountKey.json"
$Env:ADMIN_API_KEY = "supersecret"

npm install
npm start
```

Endpoints
- GET /users?maxResults=100&apiKey=supersecret
  - Returns up to `maxResults` users and a `nextPageToken` if more are available
- GET /user?email=...&apiKey=supersecret
  - Returns a single user by email

Client example (fetch from browser)

```javascript
// call from client (never embed your service account or admin API key in client-side code for production)
fetch('http://localhost:4000/users?maxResults=100', {
  headers: { 'x-api-key': 'supersecret' }
}).then(r => r.json()).then(console.log).catch(console.error);
```

Security note
- Keep your service account JSON and ADMIN_API_KEY secret. Do not deploy this unprotected to public servers.
- For production, protect this endpoint with a proper auth method (Firebase Auth + custom token checks, IAM, or Cloud Functions restricted by IAM).

Alternatives
- If your goal is to let users log in, prefer the client-side Firebase Auth SDK: use signInWithEmailAndPassword(auth, email, password) — that lets Firebase manage credentials and sessions without exposing admin credentials.
