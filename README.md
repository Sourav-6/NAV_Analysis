# NAV Analysis (Mutual Fund Performance Tracker)

A full-stack web application designed to track, rank, and analyze the historical performance of Mutual Funds. This tool calculates advanced financial metrics over rolling windows to help investors make data-driven decisions.

## Features

- **Comprehensive Dashboard**: View NAV history, rankings, and deep financial metrics.
- **Advanced Metrics**: Calculates Sortino Ratio, Maximum Drawdown, Ulcer Index, and proprietary SRP Category Rankings over dynamic rolling windows (e.g., 1-year window over a 5-year analysis period).
- **Interactive Time-Series Charts**: Click on any metric to view its daily historical movement plotted on interactive line charts.
- **Fund Comparison**: Select up to 4 funds and view side-by-side performance overlays.
- **Real-Time Data Engine**: Powered by an efficient backend that calculates massive time-series arrays and caches them in SQLite.

## Tech Stack

**Frontend:**
- React (Vite)
- Lightweight Charts (by TradingView) for fast, interactive time-series plotting
- CSS Modules & Vanilla CSS with a responsive, modern "glassmorphism" UI

**Backend:**
- Node.js (Express)
- SQLite (better-sqlite3) for fast local data persistence
- Custom expanding-window metric calculation engine

## Getting Started

### Prerequisites
- Node.js installed on your machine
- Git

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/Sourav-6/NAV_Analysis.git
   ```
2. Navigate into the project folder:
   ```bash
   cd NAV_Analysis
   ```
3. Install dependencies for both frontend and backend:
   ```bash
   npm run install:all
   ```

### Running the App Locally

To start both the Node.js backend server and the React frontend development server concurrently, run:

```bash
npm run dev:full
```

- The frontend will be accessible at `http://localhost:5173`
- The backend API runs on `http://localhost:3001`

## Project Structure
- `/frontend` - Contains the React application, UI components, and API utilities.
- `/backend` - Contains the Express server, SQLite database schema, data fetching scripts, and the ranking calculation engine.
