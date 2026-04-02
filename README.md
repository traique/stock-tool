# AlphaPulse Elite

A modern investment dashboard for the Vietnam market, built to track **stocks, gold, and fuel prices** in one place.

It combines a **Next.js frontend**, **Supabase database**, **GitHub Actions schedulers**, and **Python update scripts** to deliver a lightweight but practical personal market-monitoring system.

---

## Highlights

- **Stock dashboard** with signal-oriented metrics
- **Gold price board** for SJC, SJC ring, and world gold
- **Fuel price board** for major Vietnam fuel categories
- **Watchlist management**
- **Manual update buttons** directly from the web UI
- **Automatic scheduled updates** using GitHub Actions
- **Supabase-backed storage** for market data and job tracking
- **Vercel deployment** for fast frontend delivery

---

## Tech Stack

### Frontend
- Next.js
- React
- Lucide React

### Backend / API
- Next.js API Routes
- Python scripts for scheduled data updates

### Database
- Supabase PostgreSQL

### Deployment & Automation
- Vercel
- GitHub Actions

---

## Core Features

### 1. Stocks
- Price display
- RSI, MA20/50/100, MACD, volume ratio
- Screener view
- Signal score and confidence score
- Optional trade plan display when data exists
- Watchlist support

### 2. Gold
- SJC gold
- SJC ring 9999
- World gold (XAU/USD)
- Buy / sell price display for domestic gold
- Unified price display for world gold
- Change display and latest update time

### 3. Fuel
- RON95-V
- RON95-III
- E5 RON92-II
- E10 RON95-III
- Diesel 0.001S-V
- Diesel 0.05S-II
- Dầu hỏa 2-K

### 4. Update System
- Manual update from UI
- Job progress tracking
- Separate workflows for stocks, gold, and fuel
- Automatic schedule-based refresh

---

## Project Structure

```bash
pages/
  index.js
  api/
    prices.js
    screener.js
    gold.js
    fuel.js
    stocks.js
    status.js
    run-update.js
    job-status.js

.github/workflows/
  update.yml
  update_gold.yml
  update_fuel.yml
  manual-update.yml

update.py
update_gold.py
update_fuel.py
job_progress.py
requirements.txt
package.json
README.md
```

---

## Environment Overview

This project uses three main services:

1. **Supabase** for storing market data
2. **Vercel** for serving the web app and API routes
3. **GitHub Actions** for running scheduled jobs and manual update dispatches

---

## Supabase Setup

Create a new Supabase project, then collect these values from:

**Settings → API**

- `Project URL`
- `anon key`
- `service_role key`

You also need the PostgreSQL connection string:
- `DB_URL`

---

## Database Schema

### Gold prices table

```sql
create table if not exists gold_prices (
  id bigserial primary key,
  source text,
  gold_type text not null,
  display_name text,
  subtitle text,
  buy_price numeric,
  sell_price numeric,
  unit text,
  change_buy numeric,
  change_sell numeric,
  price_time timestamptz,
  created_at timestamptz default now()
);
```

### Fuel prices table

```sql
create table if not exists fuel_prices (
  id bigserial primary key,
  fuel_type text not null,
  price numeric,
  unit text,
  effective_time timestamptz,
  created_at timestamptz default now()
);
```

### Job tracking table

```sql
create table if not exists job_runs (
  id bigserial primary key,
  job_name text not null,
  target text not null,
  status text not null default 'queued',
  progress int not null default 0,
  message text,
  error_text text,
  source text default 'manual',
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_job_runs_created_at
on job_runs (created_at desc);

create index if not exists idx_job_runs_target_created_at
on job_runs (target, created_at desc);

create or replace function set_updated_at_job_runs()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_job_runs_updated_at on job_runs;

create trigger trg_job_runs_updated_at
before update on job_runs
for each row
execute function set_updated_at_job_runs();
```

### Quick RLS-off setup

If you want the fastest configuration path for internal use:

```sql
alter table gold_prices disable row level security;
alter table fuel_prices disable row level security;
alter table job_runs disable row level security;
```

---

## Sample Seed Data

### Gold seed

```sql
delete from gold_prices;

insert into gold_prices
(source, gold_type, display_name, subtitle, buy_price, sell_price, unit, change_buy, change_sell, price_time, created_at)
values
('manual', 'sjc_hcm', 'SJC 9999', 'SJL1L10', 169800000, 172800000, 'VND/lượng', 1200000, 1200000, now(), now()),
('manual', 'ring_9999_hcm', 'Nhẫn SJC', 'SJ9999', 169600000, 172600000, 'VND/lượng', 1200000, 1200000, now(), now()),
('manual', 'world_xauusd', 'Vàng thế giới', 'XAU/USD', 4464.29, 4464.29, 'USD/ounce', -30.29, -30.29, now(), now());
```

### Fuel seed

```sql
delete from fuel_prices;

insert into fuel_prices (fuel_type, price, unit, effective_time, created_at)
values
('RON95-V', 24730, 'VND/liter', now(), now()),
('RON95-III', 24330, 'VND/liter', now(), now()),
('E5 RON92-II', 23320, 'VND/liter', now(), now()),
('E10 RON95-III', 23690, 'VND/liter', now(), now()),
('Diesel 0.001S-V', 35640, 'VND/liter', now(), now()),
('Diesel 0.05S-II', 35440, 'VND/liter', now(), now()),
('Dầu hỏa 2-K', 35380, 'VND/liter', now(), now());
```

---

## Local Environment Variables

Create a file named `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=YOUR_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_SUPABASE_SERVICE_ROLE_KEY
DB_URL=YOUR_POSTGRES_DB_URL

GITHUB_REPO_OWNER=traique
GITHUB_REPO_NAME=stock-tool
GITHUB_WORKFLOW_FILE=manual-update.yml
GITHUB_REF=main
GITHUB_WORKFLOW_TOKEN=YOUR_GITHUB_PAT
```

---

## Local Development

Install dependencies:

```bash
npm install
pip install -r requirements.txt
```

Run the app:

```bash
npm run dev
```

Default URL:

```bash
http://localhost:3000
```

---

## Vercel Deployment

### Step 1: Import project
- Open Vercel
- Add New Project
- Import the GitHub repository

### Step 2: Add environment variables
Add the same values from `.env.local` into:

**Project → Settings → Environment Variables**

```env
NEXT_PUBLIC_SUPABASE_URL=YOUR_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_SUPABASE_SERVICE_ROLE_KEY
DB_URL=YOUR_POSTGRES_DB_URL

GITHUB_REPO_OWNER=traique
GITHUB_REPO_NAME=stock-tool
GITHUB_WORKFLOW_FILE=manual-update.yml
GITHUB_REF=main
GITHUB_WORKFLOW_TOKEN=YOUR_GITHUB_PAT
```

After saving the variables, redeploy the project.

---

## GitHub Token for Manual Updates

To let the Vercel app trigger GitHub Actions, create a **Fine-grained Personal Access Token**.

### Required setup
- Repository access: **Only select repositories**
- Select your repo: `stock-tool`
- Permission: **Actions → Read and write**

Then place it in:

```env
GITHUB_WORKFLOW_TOKEN=YOUR_GITHUB_PAT
```

---

## GitHub Secrets

In GitHub repository settings, add:

```env
DB_URL=YOUR_POSTGRES_DB_URL
```

Path:
- Settings
- Secrets and variables
- Actions

---

## GitHub Actions Schedules

### Stocks: every 30 minutes
`.github/workflows/update.yml`

```yaml
name: Update Stocks

on:
  schedule:
    - cron: "*/30 * * * *"
  workflow_dispatch:

jobs:
  update-stocks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.11"
      - run: pip install -r requirements.txt
      - env:
          DB_URL: ${{ secrets.DB_URL }}
        run: python update.py
```

### Gold: every 30 minutes
`.github/workflows/update_gold.yml`

```yaml
name: Update Gold

on:
  schedule:
    - cron: "*/30 * * * *"
  workflow_dispatch:

jobs:
  update-gold:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.11"
      - run: pip install -r requirements.txt
      - env:
          DB_URL: ${{ secrets.DB_URL }}
        run: python update_gold.py
```

### Fuel: 00:02 and 15:02 GMT+7
GitHub Actions uses UTC, so:
- `00:02 GMT+7` = `17:02 UTC`
- `15:02 GMT+7` = `08:02 UTC`

`.github/workflows/update_fuel.yml`

```yaml
name: Update Fuel

on:
  schedule:
    - cron: "2 17 * * *"
    - cron: "2 8 * * *"
  workflow_dispatch:

jobs:
  update-fuel:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.11"
      - run: pip install -r requirements.txt
      - env:
          DB_URL: ${{ secrets.DB_URL }}
        run: python update_fuel.py
```

---

## Manual Update Workflow

`.github/workflows/manual-update.yml`

```yaml
name: Manual Update

on:
  workflow_dispatch:
    inputs:
      target:
        description: "stocks | gold | fuel | all"
        required: true
        default: "stocks"
      job_run_id:
        description: "job_runs.id from Supabase"
        required: false
        default: ""

jobs:
  manual-update:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.11"
      - run: pip install -r requirements.txt

      - name: Mark started
        if: ${{ github.event.inputs.job_run_id != '' }}
        env:
          DB_URL: ${{ secrets.DB_URL }}
        run: python job_progress.py "${{ github.event.inputs.job_run_id }}" "running" "12" "Khởi tạo workflow"

      - name: Run stocks
        if: ${{ github.event.inputs.target == 'stocks' || github.event.inputs.target == 'all' }}
        env:
          DB_URL: ${{ secrets.DB_URL }}
        run: python update.py

      - name: Run gold
        if: ${{ github.event.inputs.target == 'gold' || github.event.inputs.target == 'all' }}
        env:
          DB_URL: ${{ secrets.DB_URL }}
        run: python update_gold.py

      - name: Run fuel
        if: ${{ github.event.inputs.target == 'fuel' || github.event.inputs.target == 'all' }}
        env:
          DB_URL: ${{ secrets.DB_URL }}
        run: python update_fuel.py

      - name: Mark success
        if: ${{ success() && github.event.inputs.job_run_id != '' }}
        env:
          DB_URL: ${{ secrets.DB_URL }}
        run: python job_progress.py "${{ github.event.inputs.job_run_id }}" "success" "100" "Hoàn tất cập nhật"

      - name: Mark failure
        if: ${{ failure() && github.event.inputs.job_run_id != '' }}
        env:
          DB_URL: ${{ secrets.DB_URL }}
        run: python job_progress.py "${{ github.event.inputs.job_run_id }}" "failed" "100" "Job thất bại"
```

---

## Example `job_progress.py`

```python
import os
import sys
from datetime import datetime, timezone
import psycopg2


def get_db_url():
    return os.environ.get("DB_URL")


def safe_int(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def update_job(job_run_id, status=None, progress=None, message=None, error_text=None, finished=False):
    job_run_id = safe_int(job_run_id)
    if not job_run_id:
        return

    db_url = get_db_url()
    if not db_url:
        return

    conn = psycopg2.connect(db_url)
    cur = conn.cursor()

    fields = []
    values = []

    if status is not None:
        fields.append("status = %s")
        values.append(status)
    if progress is not None:
        fields.append("progress = %s")
        values.append(progress)
    if message is not None:
        fields.append("message = %s")
        values.append(message)
    if error_text is not None:
        fields.append("error_text = %s")
        values.append(error_text)
    if finished:
        fields.append("finished_at = %s")
        values.append(datetime.now(timezone.utc))

    if not fields:
        cur.close()
        conn.close()
        return

    values.append(job_run_id)
    sql = f"update job_runs set {', '.join(fields)} where id = %s"
    cur.execute(sql, values)
    conn.commit()
    cur.close()
    conn.close()


if __name__ == "__main__":
    job_run_id = sys.argv[1] if len(sys.argv) > 1 else None
    status = sys.argv[2] if len(sys.argv) > 2 else None
    progress = int(sys.argv[3]) if len(sys.argv) > 3 and str(sys.argv[3]).isdigit() else None
    message = sys.argv[4] if len(sys.argv) > 4 else None
    error_text = sys.argv[5] if len(sys.argv) > 5 else None

    update_job(
        job_run_id=job_run_id,
        status=status,
        progress=progress,
        message=message,
        error_text=error_text,
        finished=status in ["success", "failed"],
    )
```

---

## Quick Checks

### Gold data

```sql
select gold_type, display_name, buy_price, sell_price, change_buy, change_sell, unit
from gold_prices
order by price_time desc, id desc
limit 10;
```

### Fuel data

```sql
select fuel_type, price, unit, effective_time
from fuel_prices
order by effective_time desc, id desc
limit 20;
```

### Job status

```sql
select id, target, status, progress, message, error_text, created_at
from job_runs
order by id desc
limit 10;
```

---

## Common Issues

### 403: `Resource not accessible by personal access token`
Usually caused by:
- Wrong token
- Token missing **Actions → Read and write** permission
- Token not scoped to the correct repository

### Gold or fuel tab is empty
Usually caused by:
- No data in database
- API route not using `SUPABASE_SERVICE_ROLE_KEY`
- Vercel not redeployed after env changes

### Gold values show incorrect unit
Usually caused by old incorrect rows still stored in `gold_prices`

---

## Deployment Checklist

- [ ] Create Supabase project
- [ ] Run SQL schema
- [ ] Seed sample data
- [ ] Add env vars to Vercel
- [ ] Add `DB_URL` to GitHub Secrets
- [ ] Add GitHub PAT to Vercel
- [ ] Redeploy Vercel
- [ ] Test `/api/gold`
- [ ] Test `/api/fuel`
- [ ] Test update buttons

---

## Notes

This project is best suited for:
- Personal market tracking
- Vietnam stock monitoring
- Gold and fuel tracking
- Semi-automated or fully automated dashboard workflows
