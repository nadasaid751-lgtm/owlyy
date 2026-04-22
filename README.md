# 🦉 Owly — Setup Guide

## Project Structure

```
owly-backend/
├── server.js          ← Express + Gemini backend
├── package.json
├── .env.example       ← Copy this to .env
├── .gitignore
├── uploads/           ← Temp folder (auto-created)
└── public/            ← Your frontend files go here
    ├── index.html
    ├── script.js      ← Updated version (connects to API)
    └── style.css
```

---

## 1 — Get your Gemini API Key

1. Go to https://aistudio.google.com/app/apikey
2. Click **Create API key**
3. Copy the key

---

## 2 — Setup

```bash
# Clone or copy the project files, then:
cd owly-backend
npm install

# Create your .env file
cp .env.example .env
```

Open `.env` and paste your key:
```
GEMINI_API_KEY=AIza...your_key_here
```

---

## 3 — Add Frontend Files

Copy your `index.html` and `style.css` into the `public/` folder.  
The `script.js` in `public/` is already the updated version.

---

## 4 — Run

```bash
# Production
npm start

# Development (auto-restarts on file changes)
npm run dev
```

Open **http://localhost:3000** in your browser.

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/upload` | Upload a PDF (multipart/form-data, field: `pdf`) |
| POST | `/api/summary` | Generate AI summary `{ sessionId }` |
| POST | `/api/chat` | Ask a question `{ sessionId, question, history[] }` |
| POST | `/api/quiz` | Generate MCQ quiz `{ sessionId, count }` |
| DELETE | `/api/session/:id` | Delete session & temp file |

---

## Notes

- PDF files are stored temporarily in `uploads/` and deleted on logout.
- Sessions are in-memory — they reset if you restart the server.
- For production, use a database (e.g. MongoDB) and store PDFs in cloud storage (e.g. Google Cloud Storage).
