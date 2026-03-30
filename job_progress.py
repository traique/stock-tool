import os
import sys
from datetime import datetime, timezone

import psycopg2


def get_db_url():
    return os.environ.get("DB_URL")


def update_job(job_run_id, status=None, progress=None, message=None, error_text=None, finished=False):
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
    # usage:
    # python job_progress.py <job_run_id> <status> <progress> <message>
    job_run_id = sys.argv[1] if len(sys.argv) > 1 else None
    status = sys.argv[2] if len(sys.argv) > 2 else None
    progress = int(sys.argv[3]) if len(sys.argv) > 3 else None
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
