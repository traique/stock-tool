# 🚀 AlphaPulse Elite

Nền tảng dashboard đầu tư cá nhân cho thị trường Việt Nam, tập trung vào:

- Cổ phiếu VN với tín hiệu giao dịch pro
- Giá vàng
- Giá xăng dầu
- Watchlist cá nhân
- Cập nhật thủ công từ giao diện web
- Tự động cập nhật bằng GitHub Actions
- Lưu trữ dữ liệu bằng Supabase
- Triển khai giao diện bằng Vercel

---

# 1. Tính năng chính

## Cổ phiếu
- Hiển thị giá, RSI, MA20/50/100, MACD, volume ratio
- Chấm điểm tín hiệu
- Gợi ý vùng mua, SL, TP, trailing stop
- Watchlist cá nhân
- Dashboard + Screener

## Vàng
- Hiển thị:
  - Vàng miếng SJC
  - Vàng nhẫn 9999
  - Vàng thế giới
- Giá mua vào / bán ra
- Mức tăng giảm

## Xăng dầu
- Hiển thị:
  - RON95-V
  - RON95-III
  - E5 RON92-II
  - E10 RON95-III
  - Diesel 0.001S-V
  - Diesel 0.05S-II
  - Dầu hỏa 2-K
- Sắp xếp ưu tiên:
  - RON95
  - E5 / E10
  - Diesel
  - Dầu hỏa

## Hệ thống
- Giao diện sáng / tối
- Nút cập nhật dữ liệu ngay trên web
- Thanh tiến trình cập nhật
- Tự động chạy theo lịch bằng GitHub Actions

---

# 2. Công nghệ sử dụng

- **Frontend**: Next.js
- **Backend API**: Next.js API Routes
- **Database**: Supabase PostgreSQL
- **Deployment**: Vercel
- **Scheduler / Jobs**: GitHub Actions
- **Python scripts**:
  - `update.py`
  - `update_gold.py`
  - `update_fuel.py`

---

# 3. Cấu trúc chính của project

```bash
pages/
  api/
    gold.js
    fuel.js
    prices.js
    screener.js
    stocks.js
    status.js
    run-update.js
    job-status.js

.github/
  workflows/
    update.yml
    update_gold.yml
    update_fuel.yml
    manual-update.yml

update.py
update_gold.py
update_fuel.py
job_progress.py
requirements.txt
pages/index.js
```

---

# 4. Cài Supabase

## Bước 1: Tạo project Supabase
1. Vào Supabase
2. Tạo project mới
3. Chờ project khởi tạo xong

## Bước 2: Lấy thông tin cần thiết
Trong Supabase, vào:

- **Settings**
- **API**

Lấy các giá trị sau:
- `Project URL`
- `anon key`
- `service_role key`

Ngoài ra cần lấy thêm `DB URL` hoặc connection string PostgreSQL.

---

# 5. Tạo bảng trong Supabase

Chạy các SQL schema cần thiết trong SQL Editor.

## 5.1 Bảng watchlist / stocks
Nếu project của bạn đã có sẵn thì giữ nguyên.  
Nếu chưa có, cần tạo các bảng phục vụ:
- `stocks`
- `stock_signals`
- `system_status`

## 5.2 Bảng giá vàng
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

## 5.3 Bảng giá xăng
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

## 5.4 Bảng theo dõi job cập nhật
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

---

# 6. Tắt RLS cho các bảng cần thiết

Nếu bạn không muốn cấu hình policy phức tạp, có thể tắt RLS cho các bảng này:

```sql
alter table gold_prices disable row level security;
alter table fuel_prices disable row level security;
alter table job_runs disable row level security;
```

Nếu muốn bảo mật cao hơn, bạn có thể bật RLS và tự viết policy riêng.

---

# 7. Seed dữ liệu mẫu

## 7.1 Giá vàng mẫu
```sql
delete from gold_prices;

insert into gold_prices
(source, gold_type, display_name, subtitle, buy_price, sell_price, unit, change_buy, change_sell, price_time, created_at)
values
('manual', 'sjc_hcm', 'Vàng miếng SJC', 'SJC - Hồ Chí Minh', 169800000, 172800000, 'VND/lượng', 1200000, 1200000, now(), now()),
('manual', 'ring_9999_hcm', 'Vàng nhẫn 9999', 'SJC - Hồ Chí Minh', 169600000, 172600000, 'VND/lượng', 1200000, 1200000, now(), now()),
('manual', 'world_xauusd', 'Vàng thế giới', 'Vàng/Đô la Mỹ', 4464.29, 4464.29, 'USD/ounce', -30.29, -30.29, now(), now());
```

## 7.2 Giá xăng mẫu
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

# 8. Cấu hình local `.env.local`

Tạo file:

```bash
.env.local
```

Nội dung:

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

# 9. Chạy local

## Cài dependencies
```bash
npm install
pip install -r requirements.txt
```

## Chạy frontend
```bash
npm run dev
```

Frontend mặc định:
```bash
http://localhost:3000
```

---

# 10. Cài Vercel

## Bước 1: Import project
1. Vào Vercel
2. Chọn **Add New Project**
3. Import repo GitHub `stock-tool`

## Bước 2: Thêm Environment Variables
Trong Vercel, vào:

- `Project`
- `Settings`
- `Environment Variables`

Thêm các biến:

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

Khuyến nghị chọn:
- Production
- Preview
- Development

## Bước 3: Redeploy
Sau khi thêm env, cần redeploy lại project trên Vercel.

---

# 11. Tạo GitHub token để chạy workflow từ Vercel

## Tạo Fine-grained Personal Access Token
Vào:
- GitHub Account Settings
- Developer settings
- Personal access tokens
- Fine-grained tokens
- Generate new token

## Cấu hình token
- Repository access: `Only select repositories`
- Chọn repo: `stock-tool`

## Permissions
Bật:
- **Actions → Read and write**

Sau đó copy token và dán vào:

```env
GITHUB_WORKFLOW_TOKEN=YOUR_GITHUB_PAT
```

trong Vercel.

---

# 12. GitHub Secrets

Trong repo GitHub, vào:

- `Settings`
- `Secrets and variables`
- `Actions`

Thêm secret:

```env
DB_URL=YOUR_POSTGRES_DB_URL
```

---

# 13. GitHub Actions schedules

## Cổ phiếu: mỗi 30 phút
File:
```bash
.github/workflows/update.yml
```

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

## Vàng: mỗi 30 phút
File:
```bash
.github/workflows/update_gold.yml
```

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

## Xăng: 00:02 và 15:02 GMT+7
GitHub dùng UTC, nên đổi thành:
- `00:02 GMT+7` → `17:02 UTC`
- `15:02 GMT+7` → `08:02 UTC`

File:
```bash
.github/workflows/update_fuel.yml
```

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

# 14. Workflow cập nhật thủ công từ web

File:
```bash
.github/workflows/manual-update.yml
```

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
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: "3.11"

      - name: Install dependencies
        run: |
          python --version
          pip install -r requirements.txt

      - name: Debug inputs
        run: |
          echo "target=${{ github.event.inputs.target }}"
          echo "job_run_id=${{ github.event.inputs.job_run_id }}"

      - name: Mark started
        if: ${{ github.event.inputs.job_run_id != '' }}
        env:
          DB_URL: ${{ secrets.DB_URL }}
        run: |
          python job_progress.py "${{ github.event.inputs.job_run_id }}" "running" "12" "Khởi tạo workflow"

      - name: Run stocks
        if: ${{ github.event.inputs.target == 'stocks' || github.event.inputs.target == 'all' }}
        env:
          DB_URL: ${{ secrets.DB_URL }}
        run: |
          python update.py

      - name: Run gold
        if: ${{ github.event.inputs.target == 'gold' || github.event.inputs.target == 'all' }}
        env:
          DB_URL: ${{ secrets.DB_URL }}
        run: |
          python update_gold.py

      - name: Run fuel
        if: ${{ github.event.inputs.target == 'fuel' || github.event.inputs.target == 'all' }}
        env:
          DB_URL: ${{ secrets.DB_URL }}
        run: |
          python update_fuel.py

      - name: Mark success
        if: ${{ success() && github.event.inputs.job_run_id != '' }}
        env:
          DB_URL: ${{ secrets.DB_URL }}
        run: |
          python job_progress.py "${{ github.event.inputs.job_run_id }}" "success" "100" "Hoàn tất cập nhật"

      - name: Mark failure
        if: ${{ failure() && github.event.inputs.job_run_id != '' }}
        env:
          DB_URL: ${{ secrets.DB_URL }}
        run: |
          python job_progress.py "${{ github.event.inputs.job_run_id }}" "failed" "100" "Job thất bại"
```

---

# 15. File `job_progress.py`

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
        print("Skip update_job: job_run_id is invalid")
        return

    db_url = get_db_url()
    if not db_url:
        print("Skip update_job: DB_URL missing")
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

    sql = f"""
      update job_runs
      set {", ".join(fields)}
      where id = %s
    """

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

# 16. Kiểm tra lỗi nhanh

## Kiểm tra dữ liệu vàng
```sql
select gold_type, display_name, buy_price, sell_price, change_buy, change_sell, unit
from gold_prices
order by price_time desc, id desc
limit 10;
```

## Kiểm tra dữ liệu xăng
```sql
select fuel_type, price, unit, effective_time
from fuel_prices
order by effective_time desc, id desc
limit 20;
```

## Kiểm tra job mới nhất
```sql
select id, target, status, progress, message, error_text, created_at
from job_runs
order by id desc
limit 10;
```

---

# 17. Các lỗi thường gặp

## Lỗi 403 Resource not accessible by personal access token
Nguyên nhân:
- `GITHUB_WORKFLOW_TOKEN` sai
- token chưa bật `Actions: Read and write`
- token chưa chọn đúng repo

## Vàng hiển thị sai 0.2M
Nguyên nhân:
- DB có bản ghi cũ sai đơn vị
- cần xóa các dòng `buy_price` quá nhỏ với `unit = 'VND/lượng'`

## Tab vàng hoặc tab xăng trống
Nguyên nhân:
- bảng chưa có dữ liệu
- API route chưa dùng `SUPABASE_SERVICE_ROLE_KEY`
- Vercel chưa redeploy sau khi sửa env

---

# 18. Triển khai nhanh

## Checklist
- [ ] Tạo project Supabase
- [ ] Tạo bảng SQL
- [ ] Seed dữ liệu mẫu
- [ ] Thêm env vào Vercel
- [ ] Thêm `DB_URL` vào GitHub Secrets
- [ ] Thêm GitHub PAT vào Vercel
- [ ] Push workflow files
- [ ] Redeploy Vercel
- [ ] Test `/api/gold`
- [ ] Test `/api/fuel`
- [ ] Test nút cập nhật

---

# 19. Ghi chú

Project này phù hợp cho:
- dashboard đầu tư cá nhân
- theo dõi cổ phiếu Việt Nam
- theo dõi biến động vàng
- theo dõi giá xăng dầu
- tự động hóa cập nhật bằng GitHub Actions

---

# 20. Tác giả

Xây dựng và tùy biến cho nhu cầu cá nhân của bạn với:
- Supabase
- Vercel
- GitHub Actions
- Next.js
- Python
