# AlphaPulse Elite

Dashboard theo dõi **cổ phiếu, vàng và giá xăng dầu** cho thị trường Việt Nam.

Project này kết hợp **Next.js**, **Supabase**, **GitHub Actions**, **Vercel** và các **script Python** để tạo một hệ thống theo dõi dữ liệu thị trường gọn nhẹ nhưng thực tế và dễ triển khai.

---

## Điểm nổi bật

- **Dashboard cổ phiếu** theo hướng tín hiệu giao dịch
- **Bảng giá vàng** cho SJC, nhẫn SJC và vàng thế giới
- **Bảng giá xăng dầu** cho các loại phổ biến tại Việt Nam
- **Watchlist** cá nhân
- **Nút cập nhật thủ công** trực tiếp trên giao diện web
- **Tự động cập nhật theo lịch** bằng GitHub Actions
- **Lưu dữ liệu trên Supabase**
- **Triển khai frontend trên Vercel**

---

## Công nghệ sử dụng

### Frontend
- Next.js
- React
- Lucide React

### Backend / API
- Next.js API Routes
- Python scripts cho các job cập nhật dữ liệu

### Database
- Supabase PostgreSQL

### Triển khai và tự động hóa
- Vercel
- GitHub Actions

---

## Tính năng chính

### 1. Cổ phiếu
- Hiển thị giá
- RSI, MA20/50/100, MACD, volume ratio
- Dashboard và Screener
- Chấm điểm tín hiệu và confidence score
- Hiển thị kế hoạch giao dịch nếu có dữ liệu
- Quản lý watchlist

### 2. Giá vàng
- Vàng SJC
- Nhẫn SJC 9999
- Vàng thế giới
- Hiển thị mua / bán cho vàng trong nước
- Hiển thị 1 giá duy nhất cho vàng thế giới
- Hiển thị mức thay đổi và thời gian cập nhật

### 3. Giá xăng dầu
- RON95-V
- RON95-III
- E5 RON92-II
- E10 RON95-III
- Diesel 0.001S-V
- Diesel 0.05S-II
- Dầu hỏa 2-K

### 4. Hệ thống cập nhật
- Cập nhật thủ công từ UI
- Theo dõi tiến trình job
- Workflow riêng cho cổ phiếu, vàng và xăng
- Tự động cập nhật theo lịch

---

## Cấu trúc thư mục chính

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
README.vi.md
```

---

## Tổng quan môi trường

Project này dùng 3 dịch vụ chính:

1. **Supabase** để lưu dữ liệu
2. **Vercel** để chạy frontend và API routes
3. **GitHub Actions** để chạy job tự động và job cập nhật thủ công

---

## Cấu hình Supabase

Tạo một project Supabase mới, sau đó lấy các giá trị sau tại:

**Settings → API**

- `Project URL`
- `anon key`
- `service_role key`

Ngoài ra cần thêm chuỗi kết nối PostgreSQL:
- `DB_URL`

---

## Schema database

### Bảng giá vàng

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

### Bảng giá xăng

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

### Bảng theo dõi job cập nhật

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

### Cấu hình nhanh: tắt RLS

Nếu bạn muốn triển khai nhanh cho mục đích cá nhân / nội bộ:

```sql
alter table gold_prices disable row level security;
alter table fuel_prices disable row level security;
alter table job_runs disable row level security;
```

---

## Dữ liệu mẫu

### Seed vàng

```sql
delete from gold_prices;

insert into gold_prices
(source, gold_type, display_name, subtitle, buy_price, sell_price, unit, change_buy, change_sell, price_time, created_at)
values
('manual', 'sjc_hcm', 'SJC 9999', 'SJL1L10', 169800000, 172800000, 'VND/lượng', 1200000, 1200000, now(), now()),
('manual', 'ring_9999_hcm', 'Nhẫn SJC', 'SJ9999', 169600000, 172600000, 'VND/lượng', 1200000, 1200000, now(), now()),
('manual', 'world_xauusd', 'Vàng thế giới', 'XAU/USD', 4464.29, 4464.29, 'USD/ounce', -30.29, -30.29, now(), now());
```

### Seed xăng

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

## Biến môi trường local

Tạo file `.env.local`:

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

## Chạy local

Cài dependency:

```bash
npm install
pip install -r requirements.txt
```

Chạy app:

```bash
npm run dev
```

Địa chỉ mặc định:

```bash
http://localhost:3000
```

---

## Deploy lên Vercel

### Bước 1: Import project
- Mở Vercel
- Chọn Add New Project
- Import repo GitHub

### Bước 2: Thêm Environment Variables
Thêm các giá trị giống `.env.local` vào:

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

Sau khi thêm xong, hãy redeploy project.

---

## GitHub token cho nút cập nhật thủ công

Để Vercel có thể gọi GitHub Actions, tạo **Fine-grained Personal Access Token**.

### Thiết lập cần có
- Repository access: **Only select repositories**
- Chọn repo: `stock-tool`
- Permission: **Actions → Read and write**

Sau đó thêm vào:

```env
GITHUB_WORKFLOW_TOKEN=YOUR_GITHUB_PAT
```

---

## GitHub Secrets

Trong repo GitHub, thêm secret:

```env
DB_URL=YOUR_POSTGRES_DB_URL
```

Đường dẫn:
- Settings
- Secrets and variables
- Actions

---

## Lịch GitHub Actions

### Cổ phiếu: mỗi 30 phút
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

### Vàng: mỗi 30 phút
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

### Xăng: 00:02 và 15:02 GMT+7
GitHub Actions dùng UTC, nên:
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

## Workflow cập nhật thủ công

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

## Ví dụ `job_progress.py`

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

## Kiểm tra nhanh

### Dữ liệu vàng

```sql
select gold_type, display_name, buy_price, sell_price, change_buy, change_sell, unit
from gold_prices
order by price_time desc, id desc
limit 10;
```

### Dữ liệu xăng

```sql
select fuel_type, price, unit, effective_time
from fuel_prices
order by effective_time desc, id desc
limit 20;
```

### Trạng thái job

```sql
select id, target, status, progress, message, error_text, created_at
from job_runs
order by id desc
limit 10;
```

---

## Lỗi thường gặp

### 403: `Resource not accessible by personal access token`
Nguyên nhân thường gặp:
- Token sai
- Token chưa có quyền **Actions → Read and write**
- Token chưa chọn đúng repo

### Tab vàng hoặc tab xăng trống
Nguyên nhân thường gặp:
- Database chưa có dữ liệu
- API route chưa dùng `SUPABASE_SERVICE_ROLE_KEY`
- Vercel chưa redeploy sau khi sửa env

### Giá vàng hiển thị sai đơn vị
Nguyên nhân thường gặp:
- Trong bảng `gold_prices` còn dữ liệu cũ lỗi đơn vị

---

## Checklist triển khai

- [ ] Tạo project Supabase
- [ ] Chạy SQL schema
- [ ] Seed dữ liệu mẫu
- [ ] Thêm env vào Vercel
- [ ] Thêm `DB_URL` vào GitHub Secrets
- [ ] Thêm GitHub PAT vào Vercel
- [ ] Redeploy Vercel
- [ ] Test `/api/gold`
- [ ] Test `/api/fuel`
- [ ] Test nút cập nhật

---

## Ghi chú

Project này phù hợp cho:
- Theo dõi thị trường cá nhân
- Theo dõi cổ phiếu Việt Nam
- Theo dõi vàng và xăng dầu
- Tự động hóa dashboard bằng GitHub Actions
