# Goal Pipeline · From Vision to Done

A clean, dependency-free **Kanban-style goal tracker** that flows your ambitions through five stages — **Yearly → Monthly → Weekly → Daily → Done**. Built with vanilla HTML, CSS, and JavaScript. No build step, no backend, no tracking. Everything stays in your browser via `localStorage`.

> Big goals fail when they stay big. This app is a forcing function for breaking them down.

---

## ✨ Features

### Core
- **Five-column pipeline** representing the natural progression of any goal: `Yearly · Monthly · Weekly · Daily · Done`.
- **Drag-and-drop** between columns to advance (or revert) any goal.
- **Add / Edit / Delete** goals with a clean modal (title, description, priority, deadline, reminder).
- **Color-coded priority** — 🔴 High · 🟡 Medium · 🟢 Low.
- **Overdue highlighting** with a one-click filter to show only overdue goals.
- **Search** across titles and descriptions in real time.
- **Auto-save** to `localStorage` — refresh anytime, your goals stay.

### Eisenhower Matrix view
A second view dedicated to your **daily** goals, plotted on the classic productivity grid:

|                     | **Urgent**         | **Not urgent**            |
|---------------------|--------------------|---------------------------|
| **Important**       | Q1 · **Do**        | Q2 · **Schedule**         |
| **Not important**   | Q3 · **Delegate**  | Q4 · **Drop**             |

- Drag a goal between quadrants to reclassify importance / urgency.
- Auto-classification falls back to your priority + deadline proximity.

### Quality of life
- **Dark mode** (toggle or press `D`).
- **Progress bar** showing overall completion (`done / total`).
- **Reminders** — pick a date+time and Goal Pipeline pings you with an in-app toast and a system notification (if permitted).
- **Import / Export / Clear** your data as JSON.
- **Keyboard shortcuts**:
  - `N` — new goal
  - `/` — focus search
  - `D` — toggle dark mode
  - `1` — pipeline view
  - `2` — matrix view
  - `Esc` — close modal
- **Mobile-first responsive** layout; columns stack and the FAB collapses on small screens.
- **Reduced-motion friendly** — animations honor `prefers-reduced-motion`.

---

## 🗂️ File structure

```
goal-pipeline/
├── index.html      # markup, structure, modal, matrix scaffold
├── style.css       # design system (tokens, themes, responsive)
├── script.js       # app logic — state, render, drag, reminders
└── README.md       # this file
```

No `node_modules`, no bundler, no framework. Open `index.html` and you're running.

---

## 🚀 Run locally

You have two options.

### Option 1 · Just open the file

```bash
git clone https://github.com/<your-username>/goal-pipeline.git
cd goal-pipeline
# Then double-click index.html
# or:
open index.html      # macOS
xdg-open index.html  # Linux
start index.html     # Windows
```

### Option 2 · Serve over HTTP (recommended for full notification support)

Some browsers restrict the `Notification` API on `file://` URLs. A tiny local server avoids that.

```bash
# Python 3
python3 -m http.server 5173

# Node (one-shot)
npx serve .

# PHP
php -S localhost:5173
```

Then visit <http://localhost:5173>.

---

## ☁️ Deploy to GitHub Pages

Because this is a pure static site, GitHub Pages serves it as-is.

### 1. Initialize the repo

```bash
git init
git add .
git commit -m "Initial commit: goal-pipeline tracker"
```

### 2. Push to GitHub

Create a new repo on github.com (e.g. `goal-pipeline`), then:

```bash
git branch -M main
git remote add origin https://github.com/<your-username>/goal-pipeline.git
git push -u origin main
```

### 3. Enable Pages

1. Go to your repo on GitHub.
2. **Settings → Pages**.
3. Under **Source**, choose **Deploy from a branch**.
4. Select **Branch: `main`**, **Folder: `/ (root)`**, click **Save**.
5. Wait ~1 minute. Your site will be live at:

```
https://<your-username>.github.io/goal-pipeline/
```

That's it. No build step, no workflow file required. Every push to `main` re-deploys automatically.

---

## 🧠 How the pipeline thinks

- A goal moves **left → right** as it gets refined and acted on.
- Moving anything to **Done** stamps a `doneAt` timestamp and updates the progress bar.
- Moving a goal **out** of Done removes that timestamp (so you can reopen if needed).
- **Overdue** = `deadline < today` and stage ≠ Done.
- **Urgent** (matrix) = deadline ≤ 3 days away — adjustable in `script.js`'s `URGENT_DAYS` constant.
- **Important** (matrix) = priority is High or Medium, unless you explicitly toggle it in the goal modal.

---

## 🎨 Customizing

- **Color tokens** live at the top of `style.css` under `:root` and `[data-theme='dark']`. Change once, propagates everywhere.
- **Stage labels & order** live in the `STAGES` array at the top of `script.js`.
- **Urgency window** for the matrix is the `URGENT_DAYS` constant in `script.js`.

---

## 🔒 Privacy

Everything is local. Nothing leaves your browser. The Export button gives you a JSON file you can back up or move between devices.

---

## 📜 License

MIT — do what you want, attribution appreciated.
