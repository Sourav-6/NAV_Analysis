# NAV Analysis (Mutual Fund Performance Tracker)

A full-stack web application designed to track, rank, and analyze the historical performance of Indian Mutual Funds. This tool calculates advanced financial metrics over rolling windows to help investors make data-driven decisions and deeply understand a fund's historical risk-adjusted returns.

## Features

- **Comprehensive Dashboard**: View NAV history, proprietary rankings, and deep financial metrics for thousands of schemes.
- **Advanced Categorization**: Navigate funds easily with multi-select hierarchical grouping, spanning main categories like Equity, Debt, Hybrid, and Sectoral/Speciality (including Specialized Investment Funds - SIF).
- **Advanced Risk & Return Metrics**: Calculates sophisticated metrics typically used by professional quants, including:
  - **Rolling Sortino Ratio**: Measures risk-adjusted return relative to downside volatility.
  - **Rolling Maximum Drawdown (MDD)**: Captures the maximum observed loss from a peak to a trough.
  - **Rolling Ulcer Index**: Evaluates both the depth and duration of drawdowns.
  - **SRP Category Ranking**: A weighted, composite score factoring in daily leadership, recent momentum, and risk metrics.
- **Interactive Time-Series Charts**: Click on any metric (e.g., Drawdown, Sortino, Overall Score) to view its daily historical movement plotted on interactive, synchronized line charts.
- **Fund Comparison**: Select up to 4 funds and view side-by-side performance overlays.
- **Real-Time Data Engine**: Powered by a custom-built, highly optimized backend engine that computes millions of data points over expanding and rolling windows on-the-fly.

## Tech Stack

**Frontend:**
- **React (Vite)**: Fast, modern UI development.
- **Lightweight Charts (TradingView)**: For ultra-fast, interactive time-series plotting of millions of data points.
- **Vanilla CSS**: A responsive, modern "glassmorphism" UI with advanced CSS variables and styling.

**Backend:**
- **Node.js & Express**: High-performance API server.
- **SQLite (`better-sqlite3`)**: Lightning-fast, synchronous local data persistence.
- **Custom Quantitative Engine**: An expanding-window metric calculation engine designed for heavy computational tasks.
- **Puppeteer & XLSX**: Automated data scraping and parsing for historical NAV data.

## Getting Started

### Prerequisites
- Node.js (v18 or higher recommended)
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
3. Install dependencies for both frontend and backend concurrently:
   ```bash
   npm run install:all
   ```

### Running the App Locally

To start both the Node.js backend server and the React frontend development server concurrently, simply run:

```bash
npm run dev:full
```

- The frontend will be accessible at `http://localhost:5173`
- The backend API runs on `http://localhost:3001`

### Data Fetching & Syncing

The application relies on locally cached NAV history data. To update or fetch new data, navigate to the `/backend` directory and run the following scripts:

- **Initial Full Data Fetch**: `npm run fetch-data`
- **Update Existing Full Data**: `npm run update-data`
- **Fetch SIF Data**: `npm run fetch-sif`
- **Update SIF Data**: `npm run update-sif`

## Important Note on Multi-Category Analysis

When analyzing funds across multiple categories simultaneously (e.g., comparing a newly launched "SIF" with an older "Liquid Fund"), the ranking engine is designed to enforce strict **apples-to-apples comparisons**. 

- The analysis period (e.g., 1 Year) is dynamically anchored to the **most recent data point** available across all selected funds.
- If one fund category stops reporting data early, or another fund category launched recently and lacks sufficient history covering the overlapping time period, the engine will safely exclude them to prevent skewed rankings.
- If you notice 0 funds returning in a multi-category selection, this means there is no perfectly overlapping time period of the chosen length (e.g. 1 Year) between the selected categories. Try adjusting your filters or analyzing them individually.

## Project Structure

- `/frontend` - Contains the React application, UI components (`CategoryView`, `RankingDashboard`), and API utilities.
- `/backend` - Contains the Express server (`server.js`), SQLite database schema, web scraping scripts, and the ranking calculation engine.
- `/backend/data/` - The storage location for the local `database.sqlite` cache.
