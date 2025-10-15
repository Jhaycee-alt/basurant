const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const fs = require('fs');

// The server requires a Firebase service account JSON. Set the path via
// the environment variable GOOGLE_APPLICATION_CREDENTIALS or place the
// file next to this script named `serviceAccountKey.json`.
const SERVICE_ACCOUNT_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS || './serviceAccountKey.json';
if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
  console.error('Service account file not found at', SERVICE_ACCOUNT_PATH);
  console.error('Set process.env.GOOGLE_APPLICATION_CREDENTIALS or place serviceAccountKey.json in this folder.');
  process.exit(1);
}
const serviceAccount = require(SERVICE_ACCOUNT_PATH);

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

const app = express();
app.use(cors());
app.use(express.json());

// Simple API key protection — set ADMIN_API_KEY in env for production use.
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || 'changeme';
function requireApiKey(req, res, next) {
  const key = req.get('x-api-key') || req.query.apiKey;
  if (key !== ADMIN_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// List users (paginated). Example: /users?maxResults=100&apiKey=...
app.get('/users', requireApiKey, async (req, res) => {
  try {
    const maxResults = Math.min(1000, parseInt(req.query.maxResults, 10) || 1000);
    const pageToken = req.query.pageToken || undefined;
    const result = await admin.auth().listUsers(maxResults, pageToken);

    const users = result.users.map(u => ({
      uid: u.uid,
      email: u.email,
      displayName: u.displayName,
      disabled: u.disabled,
      providerData: u.providerData,
      metadata: u.metadata
    }));

    res.json({ users, nextPageToken: result.pageToken });
  } catch (err) {
    console.error('listUsers error', err);
    res.status(500).json({ error: err.message });
  }
});

// Get a single user by email. Example: /user?email=admin@example.com&apiKey=...
app.get('/user', requireApiKey, async (req, res) => {
  const email = req.query.email;
  if (!email) return res.status(400).json({ error: 'email query required' });
  try {
    const u = await admin.auth().getUserByEmail(email);
    res.json({
      uid: u.uid,
      email: u.email,
      displayName: u.displayName,
      disabled: u.disabled,
      providerData: u.providerData,
      metadata: u.metadata
    });
  } catch (err) {
    console.error('getUserByEmail error', err);
    res.status(404).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Admin API listening on port ${PORT}`));
